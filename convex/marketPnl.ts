import { v } from "convex/values";
import { permissionQuery } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  assignmentPublishedAt,
  computeLivePricingBreakdown,
  loadCreatorPayrollSources,
} from "./pricing";
import { monthKeyParis, parisMonthEndMs } from "./dateFr";
import { projectFx, summarizeWhopRevenue } from "./whopRevenue";
import { collectProjectWhopPayments } from "./whopPaymentsAccess";
import { splitCostByMarket, type MarketTarget } from "./marketCost";

/**
 * RENTABILITÉ PAR MARCHÉ — ce qu'un pays coûte en créatrices, contre ce qu'il
 * rapporte.
 *
 * ⚠️ DEUX NOTIONS DE PAYS, jamais confondues, et c'est tout le sujet :
 *  - le MARCHÉ VISÉ (`comptes.targetCountry`) porte le COÛT — c'est là qu'on
 *    dépense ;
 *  - le pays de FACTURATION (`whopPayments.billingCountry`) porte le REVENU —
 *    c'est de là que l'argent vient.
 * Une même ligne les met face à face parce que c'est la décision qu'on prend
 * (« j'investis ici, ça me rapporte ça »), pas parce que ce sont les mêmes gens.
 * Le troisième pays du hub — celui de CONNEXION (géoIP PostHog) — n'entre pas
 * ici : il décrit des visiteurs, pas de l'argent.
 *
 * LE COÛT NE SE RECALCULE PAS. Il vient de `computeLivePricingBreakdown`, le
 * moteur qui paie, et n'est ici que RÉPARTI : le pays vit sur le COMPTE, un cran
 * sous la créatrice (cf convex/marketCost). Deux calculs de paie finiraient par
 * diverger, et c'est celui des Paiements qui fait foi.
 *
 * PÉRIMÈTRE DU COÛT : les vidéos PUBLIÉES dans la période. C'est la dépense
 * engagée sur ce marché à ce moment-là, quel que soit le cycle où la créatrice
 * sera payée — ancrer sur le cycle ferait sauter le coût d'un marché au rythme
 * des cycles de chaque créatrice, un artefact d'administration sans rapport avec
 * le pays.
 *
 * ⚠️ CE COÛT EST UN PLANCHER. Le CPM d'une vidéo court tant que le relevé de
 * vues lui en ajoute ; une vidéo publiée hier n'a pas fini de coûter. D'où
 * `collection`, rendu à côté des chiffres : l'écran doit pouvoir dire de quand
 * date la mesure au lieu de présenter un solde.
 *
 * Les BONUS DE PALIERS et les primes de défi sont EXCLUS : ils se gagnent sur le
 * cumul d'une créatrice, pas sur un marché. Les répartir supposerait une clé
 * qu'aucune donnée ne porte.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pays de facturation NORMALISÉ. Whop stocke la valeur brute de l'adresse (cf
 * schema) et la prod porte déjà « fr » à côté de « FR » — deux lignes pour un
 * même pays. On ne normalise QUE la casse : un code ISO et un nom complet
 * doivent rester distinguables, c'est la raison d'être du stockage brut.
 */
function normalizeBillingCountry(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  return t === "" ? null : t.toUpperCase();
}

export type MarketRow = {
  /** Code pays, ou `null` pour « non défini » (compte sans marché visé). */
  country: string | null;
  /** ── Ce qu'on investit (marché visé du compte) ── */
  creators: number;
  videos: number;
  cost: number;
  /** ── Ce que ça rapporte (pays de facturation) ── */
  clients: number;
  renewals: number;
  failures: number;
  attempts: number;
  revenueNet: number;
};

/** Coût d'une période, réparti par marché. Clé = pays, `""` pour « non défini ». */
async function costByMarket(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  from: number,
  to: number,
): Promise<Map<string, { cost: number; videos: number; creators: Set<string> }>> {
  // Pays visé de chaque compte, et vues de chaque publication : les deux clés de
  // la répartition, lues une fois pour tout le projet.
  const comptes = await ctx.db
    .query("comptes")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const paysDuCompte = new Map<string, string | null>(
    comptes.map((c) => [c._id as string, c.targetCountry ?? null]),
  );
  const publications = await ctx.db
    .query("publications")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const vuesDeLaPubli = new Map<string, number>(
    publications.map((p) => [p._id as string, p.vuesLatest ?? 0]),
  );

  const creators = await ctx.db
    .query("creators")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();

  const out = new Map<
    string,
    { cost: number; videos: number; creators: Set<string> }
  >();
  const touch = (pays: string | null) => {
    const k = pays ?? "";
    const d = out.get(k) ?? { cost: 0, videos: 0, creators: new Set<string>() };
    out.set(k, d);
    return d;
  };

  const moisCourant = monthKeyParis(Date.now());

  for (const creator of creators) {
    const assignments = (
      await ctx.db
        .query("assignments")
        .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
        .collect()
    ).filter(
      (a) =>
        a.projectId === projectId &&
        a.pricingSnapshot !== undefined &&
        (a.status === "published" || a.status === "paid"),
    );
    if (assignments.length === 0) continue;

    // Les assignations de la PÉRIODE, rangées par mois de publication : le
    // moteur raisonne par mois, la période peut en couper un.
    const parMois = new Map<string, Doc<"assignments">[]>();
    for (const a of assignments) {
      const publiée = assignmentPublishedAt(a);
      if (publiée < from || publiée > to) continue;
      const m = monthKeyParis(publiée);
      const arr = parMois.get(m);
      if (arr) arr.push(a);
      else parMois.set(m, [a]);
    }
    if (parMois.size === 0) continue;

    const sources = await loadCreatorPayrollSources(ctx, projectId, creator._id);

    for (const [month, duMois] of parMois) {
      const bd = await computeLivePricingBreakdown(
        ctx,
        projectId,
        creator._id,
        month,
        new Set(),
        monthKeyParis,
        undefined,
        sources,
        parisMonthEndMs(month),
      );
      // BASE = fixe + CPM, jamais `bd.total` : celui-ci ajoute les bonus de
      // paliers et les primes de défi, qui ne se répartissent pas par marché.
      // Mois EN COURS : le coût ENGAGÉ, comme l'écran de rentabilité — un
      // barème conditionné dont le seuil n'est pas encore franchi doit zéro à
      // ce jour, et l'afficher ainsi ferait paraître le mois excellent jusqu'à
      // la seconde où le seuil tombe.
      const base =
        month === moisCourant
          ? bd.engage.total
          : round2(bd.fixedTotal + bd.cpmTotal);

      // Poids = ce que le moteur a calculé pour CHAQUE vidéo. La base est
      // répartie au prorata plutôt que sommée depuis les vidéos : ainsi le total
      // par marché recolle EXACTEMENT au chiffre des Paiements, y compris quand
      // la base est le coût engagé (qui n'a, lui, aucun détail par vidéo).
      const poids = new Map<string, number>();
      let totalPoids = 0;
      for (const pa of bd.perAssignment) {
        const w = Math.max(0, pa.fixed + pa.cpm);
        poids.set(pa.assignmentId, w);
        totalPoids += w;
      }
      if (totalPoids <= 0) continue;

      for (const a of duMois) {
        const w = poids.get(a._id as string) ?? 0;
        if (w <= 0) continue;
        const coutVidéo = (base * w) / totalPoids;
        const cibles: MarketTarget[] = (a.targets ?? []).map((t) => ({
          country: paysDuCompte.get(t.accountId as string) ?? null,
          views: t.publicationId
            ? (vuesDeLaPubli.get(t.publicationId as string) ?? 0)
            : 0,
        }));
        for (const part of splitCostByMarket(coutVidéo, cibles)) {
          const d = touch(part.country);
          d.cost = round2(d.cost + part.cost);
          d.creators.add(creator._id as string);
        }
        // La vidéo compte UNE fois, sur le marché qui en porte la plus grosse
        // part : un compteur de vidéos réparti en fractions ne veut rien dire.
        const principal = splitCostByMarket(coutVidéo, cibles).reduce((a1, b) =>
          b.cost > a1.cost ? b : a1,
        );
        touch(principal.country).videos += 1;
      }
    }
  }
  return out;
}

/**
 * Rentabilité par marché sur une période. `from`/`to` absents ⇒ toute la
 * profondeur (le même « couvre tout » que le sélecteur du hub).
 */
export const getMarketPnl = permissionQuery("business.read")({
  args: { from: v.optional(v.number()), to: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(ctx.projectId);
    const from = args.from ?? 0;
    const to = args.to ?? Date.now();

    // ── Revenu par pays de FACTURATION ────────────────────────────────────────
    // Whop-gated comme la rentabilité : sans mapping, la moitié « retour »
    // n'existe pas et l'écran doit le dire au lieu d'afficher des zéros.
    const whopConfigured = project?.whop !== undefined;
    const fx = projectFx(project);
    const revenus = new Map<
      string,
      { clients: number; renewals: number; failures: number; attempts: number; rows: Doc<"whopPayments">[] }
    >();
    const touchRev = (pays: string | null) => {
      const k = pays ?? "";
      const d =
        revenus.get(k) ??
        { clients: 0, renewals: 0, failures: 0, attempts: 0, rows: [] };
      revenus.set(k, d);
      return d;
    };
    if (whopConfigured) {
      const { payments } = await collectProjectWhopPayments(
        ctx,
        ctx.projectId,
        project?.slug ?? "",
      );
      // ANCRE CLIENT : le pays de son PREMIER paiement encaissé, la même ancre
      // que « client acquis » ailleurs dans le hub. Calculée sur TOUT
      // l'historique, pas sur la période : un client acquis en juillet reste
      // rattaché à son pays d'origine quand on regarde septembre.
      const premierPaiement = new Map<string, Doc<"whopPayments">>();
      for (const p of payments) {
        if (p.status !== "paid") continue;
        const k = p.membershipId ?? p.whopId;
        const vu = premierPaiement.get(k);
        if (!vu || p.paidAt < vu.paidAt) premierPaiement.set(k, p);
      }
      const paysDuClient = new Map<string, string | null>();
      for (const [k, p] of premierPaiement) {
        paysDuClient.set(k, normalizeBillingCountry(p.billingCountry));
      }
      for (const p of payments) {
        if (p.paidAt < from || p.paidAt > to) continue;
        const k = p.membershipId ?? p.whopId;
        const pays = paysDuClient.get(k) ?? normalizeBillingCountry(p.billingCountry);
        const d = touchRev(pays);
        if (p.status === "paid") {
          d.rows.push(p);
          d.attempts += 1;
          if (p.billingReason === "subscription_cycle") d.renewals += 1;
          const premier = premierPaiement.get(k);
          if (premier && premier.whopId === p.whopId) d.clients += 1;
        } else if (p.status === "failed") {
          d.attempts += 1;
          d.failures += 1;
        }
      }
    }

    // ── Coût par MARCHÉ VISÉ ──────────────────────────────────────────────────
    const couts = await costByMarket(ctx, ctx.projectId, from, to);

    const pays = new Set<string>([...couts.keys(), ...revenus.keys()]);
    const rows: MarketRow[] = [...pays].map((k) => {
      const c = couts.get(k);
      const r = revenus.get(k);
      return {
        country: k === "" ? null : k,
        creators: c?.creators.size ?? 0,
        videos: c?.videos ?? 0,
        cost: round2(c?.cost ?? 0),
        clients: r?.clients ?? 0,
        renewals: r?.renewals ?? 0,
        failures: r?.failures ?? 0,
        attempts: r?.attempts ?? 0,
        revenueNet: r ? summarizeWhopRevenue(r.rows, fx).net : 0,
      };
    });

    // ── Fraîcheur du relevé — condition de lecture de la colonne coût ─────────
    // Le CPM d'une vidéo court tant que le relevé lui ajoute des vues : sans
    // cette ligne, un coût non mesuré se lit comme un coût faible.
    const publications = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const dansLaPeriode = publications.filter(
      (p) => p.datePubli >= from && p.datePubli <= to,
    );
    const DEUX_JOURS = 48 * 3600 * 1000;
    const maintenant = Date.now();
    const mesurées = dansLaPeriode.filter(
      (p) =>
        p.latestSnapshotAt !== undefined &&
        maintenant - p.latestSnapshotAt <= DEUX_JOURS,
    ).length;
    const dernier = publications.reduce<number | null>(
      (max, p) =>
        p.latestSnapshotAt !== undefined && (max === null || p.latestSnapshotAt > max)
          ? p.latestSnapshotAt
          : max,
      null,
    );

    return {
      whopConfigured,
      payCurrency: (project?.payCurrency ?? null) as string | null,
      revenueCurrency: (project?.whop ? "EUR" : null) as string | null,
      fxRateToRevenue: (project?.fxRateToRevenue ?? null) as number | null,
      rows,
      collection: {
        /** Dernier relevé de vues, tous comptes confondus (ms). */
        lastAt: dernier,
        /** Vidéos de la période mesurées à moins de 48 h. */
        fresh: mesurées,
        /** Vidéos de la période, toutes mesures confondues. */
        total: dansLaPeriode.length,
        /** Vidéos dont le dernier relevé a ÉCHOUÉ (série en cours). */
        failing: publications.filter((p) => (p.collectFailureStreak ?? 0) > 0)
          .length,
      },
    };
  },
});
