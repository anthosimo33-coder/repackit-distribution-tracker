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
import {
  marketValueByCountry,
  marketSurvivalByCountry,
  VALUE_DAYS,
  SURVIVAL_DAYS,
} from "./marketValue";
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

/** Une case de la matrice plan × pays. */
export type PlanCountryCell = {
  planId: string;
  /** Nom lisible (`snytch_trio_weekly`) si PostHog l'a vu, sinon `null`. */
  planLabel: string | null;
  /** Prix moyen ENCAISSÉ de ce plan, toutes géographies — le libellé qui parle. */
  price: number;
  country: string | null;
  clients: number;
  paid: number;
  attempts: number;
  net: number;
};

/** Un point de la courbe : un marché, un mois. */
export type MarketTrendPoint = {
  month: string;
  country: string | null;
  cost: number;
  revenueNet: number;
};

export type MarketRow = {
  /** Code pays, ou `null` pour « non défini » (compte sans marché visé). */
  country: string | null;
  /** ── Ce qu'on investit (marché visé du compte) ── */
  creators: number;
  videos: number;
  cost: number;
  /**
   * Ids des créatrices qui visent ce marché. Des IDS, pas un compte : une
   * créatrice qui vise deux pays d'un même marché composé ne doit pas y compter
   * double, et seul l'écran sait quels pays il regroupe (cf lib/market-aggregate).
   */
  creatorIds: string[];
  /** ── Ce que ça rapporte (pays de facturation) ── */
  clients: number;
  renewals: number;
  failures: number;
  attempts: number;
  /** Paiements ENCAISSÉS de la période — le dénominateur du panier moyen. */
  paid: number;
  revenueNet: number;
  /** ── La période PRÉCÉDENTE, de même durée, pour les variations ── */
  previousClients: number;
  previousRevenueNet: number;
  /** ── Les cohortes, sur TOUT l'historique (cf convex/marketValue) ── */
  cohortClients: number;
  /** Valeur cumulée d'un client : sommes et effectifs mûrs, jamais une moyenne. */
  curve: { day: number; sum: number; mature: number }[];
  /** Combien restent abonnés, aux mêmes conditions de maturité. */
  survival: { day: number; alive: number; mature: number }[];
};

/**
 * Coût d'une période, réparti par marché ET par mois.
 *
 * Le mois est porté ici plutôt que recalculé ailleurs : le moteur de paie est
 * de loin la lecture la plus chère de cette query (une passe par créatrice et
 * par mois), et la courbe d'évolution a besoin exactement du même travail. Le
 * refaire une seconde fois doublerait le coût de l'écran pour rien.
 *
 * Clé du pays : `""` pour « non défini ».
 */
async function costByMarket(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  from: number,
  to: number,
): Promise<{
  parPays: Map<string, { cost: number; videos: number; creators: Set<string> }>;
  parMois: Map<string, number>;
}> {
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
  /** Coût par `pays|mois` — la série de la courbe. */
  const serieParMois = new Map<string, number>();
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
          const cle = `${part.country ?? ""}|${month}`;
          serieParMois.set(
            cle,
            round2((serieParMois.get(cle) ?? 0) + part.cost),
          );
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
  return { parPays: out, parMois: serieParMois };
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
      {
        clients: number;
        renewals: number;
        failures: number;
        attempts: number;
        paid: number;
        rows: Doc<"whopPayments">[];
      }
    >();
    const touchRev = (pays: string | null) => {
      const k = pays ?? "";
      const d =
        revenus.get(k) ??
        { clients: 0, renewals: 0, failures: 0, attempts: 0, paid: 0, rows: [] };
      revenus.set(k, d);
      return d;
    };
    /** Paiements de la PÉRIODE — partagés par les trois lectures d'argent. */
    const paiementsPeriode: Doc<"whopPayments">[] = [];
    /** whopId → pays du CLIENT (ancré sur son premier paiement). */
    const paysDuPaiement = new Map<string, string | null>();
    /** whopId des paiements qui sont le PREMIER d'un client (= une acquisition). */
    const estPremierPaiement = new Set<string>();
    /** Cohortes et survie — remplies plus bas, sur TOUT l'historique. */
    let valeurParPays: ReturnType<typeof marketValueByCountry> = [];
    let survieParPays: ReturnType<typeof marketSurvivalByCountry> = [];
    /** Période PRÉCÉDENTE, de MÊME DURÉE, juste avant. Une variation contre une
     *  fenêtre d'une autre longueur ne compare rien. */
    const avantDe = from - (to - from);
    const precedent = new Map<string, { clients: number; net: number }>();
    // ⚠️ LES LIGNES PRIMENT SUR LE DRAPEAU. `whopConfigured` dit à l'écran s'il
    // faut expliquer l'absence de revenu ; il ne décide pas de la LECTURE. Une
    // row de paiement présente est un fait, et la gater sur la config faisait
    // qu'un projet portant des paiements sans mapping affichait zéro — c'est
    // exactement ce que les tests ont trouvé.
    {
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
      for (const p of premierPaiement.values()) estPremierPaiement.add(p.whopId);
      const paysDuClient = new Map<string, string | null>();
      for (const [k, p] of premierPaiement) {
        paysDuClient.set(k, normalizeBillingCountry(p.billingCountry));
      }
      for (const p of payments) {
        if (p.paidAt < from || p.paidAt > to) continue;
        const k = p.membershipId ?? p.whopId;
        const pays =
          paysDuClient.get(k) ?? normalizeBillingCountry(p.billingCountry);
        paiementsPeriode.push(p);
        paysDuPaiement.set(p.whopId, pays);
        const d = touchRev(pays);
        if (p.status === "paid") {
          d.rows.push(p);
          d.attempts += 1;
          d.paid += 1;
          if (p.billingReason === "subscription_cycle") d.renewals += 1;
          if (estPremierPaiement.has(p.whopId)) d.clients += 1;
        } else if (p.status === "failed") {
          d.attempts += 1;
          d.failures += 1;
        }
      }

      // ── LA PÉRIODE D'AVANT, pour les variations ─────────────────────────
      // Même découpage, même ancre de pays : c'est la comparabilité qui compte,
      // pas l'exhaustivité — seuls les clients et le revenu en sortent.
      {
        const parPaysAvant = new Map<string, Doc<"whopPayments">[]>();
        for (const p of payments) {
          if (p.status !== "paid") continue;
          if (p.paidAt < avantDe || p.paidAt >= from) continue;
          const k = p.membershipId ?? p.whopId;
          const pays =
            (paysDuClient.get(k) ?? normalizeBillingCountry(p.billingCountry)) ?? "";
          const l = parPaysAvant.get(pays);
          if (l) l.push(p);
          else parPaysAvant.set(pays, [p]);
        }
        for (const [pays, lignes] of parPaysAvant) {
          precedent.set(pays, {
            clients: lignes.filter((p) => estPremierPaiement.has(p.whopId)).length,
            net: summarizeWhopRevenue(lignes, fx).net,
          });
        }
      }

      // ── LES COHORTES, sur TOUT l'historique ────────────────────────────
      // Elles décrivent le MARCHÉ, pas la fenêtre : restreindre à la période
      // viderait la colonne (cf convex/marketValue). Le net est résumé paiement
      // par paiement, avec le même résumé que partout — remboursements déduits.
      const maintenant = Date.now();
      const encaisses = payments.filter((p) => p.status === "paid");
      valeurParPays = marketValueByCountry(
        encaisses.map((p) => {
          const k = p.membershipId ?? p.whopId;
          return {
            client: k,
            country: paysDuClient.get(k) ?? normalizeBillingCountry(p.billingCountry),
            paidAt: p.paidAt,
            net: summarizeWhopRevenue([p], fx).net,
          };
        }),
        maintenant,
      );

      // ── LA SURVIE ──────────────────────────────────────────────────────
      // Le membership porte la fin d'accès ; le client, lui, est identifié
      // comme partout ailleurs (membershipId à défaut whopId). Un paiement sans
      // membership n'a donc aucun abonnement à rejoindre — il est écarté du
      // verdict, pas compté résilié.
      const memberships = await ctx.db
        .query("whopMemberships")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect();
      survieParPays = marketSurvivalByCountry(
        [...premierPaiement.entries()].map(([k, p]) => ({
          client: k,
          country: paysDuClient.get(k) ?? normalizeBillingCountry(p.billingCountry),
          firstPaidAt: p.paidAt,
        })),
        memberships.map((m) => ({
          client: m.whopMembershipId,
          accessEndsAt: m.accessEndsAt ?? null,
        })),
        maintenant,
      );
    }

    // ── Coût par MARCHÉ VISÉ ──────────────────────────────────────────────────
    const { parPays: couts, parMois: coutParMois } = await costByMarket(
      ctx,
      ctx.projectId,
      from,
      to,
    );

    // ── MATRICE PLAN × PAYS ───────────────────────────────────────────────
    // Entièrement côté Whop : plan et pays y sont à 100 % (relevé du 11/09).
    // Le « taux de réussite » qu'elle porte est le SEUL taux de conversion
    // mesurable sans croiser deux sources — il compare des tentatives de
    // paiement à des paiements encaissés, dans la même table.
    const cellules = new Map<string, PlanCountryCell>();
    const prixDuPlan = new Map<string, { somme: number; n: number }>();
    for (const p of paiementsPeriode) {
      if (p.status !== "paid" && p.status !== "failed") continue;
      const plan = p.planId ?? "";
      if (plan === "") continue;
      const pays = paysDuPaiement.get(p.whopId) ?? null;
      const cle = `${plan}|${pays ?? ""}`;
      const c =
        cellules.get(cle) ??
        {
          planId: plan,
          planLabel: null,
          price: 0,
          country: pays,
          clients: 0,
          paid: 0,
          attempts: 0,
          net: 0,
        };
      c.attempts += 1;
      if (p.status === "paid") {
        c.paid += 1;
        if (estPremierPaiement.has(p.whopId)) c.clients += 1;
        const pr = prixDuPlan.get(plan) ?? { somme: 0, n: 0 };
        pr.somme += p.grossAmount;
        pr.n += 1;
        prixDuPlan.set(plan, pr);
      }
      cellules.set(cle, c);
    }
    // Revenu net par cellule : le même résumé que partout ailleurs (remboursements
    // déduits), pas une somme naïve de `netAmount`.
    for (const [cle, c] of cellules) {
      const lignes = paiementsPeriode.filter(
        (p) =>
          p.status === "paid" &&
          (p.planId ?? "") === c.planId &&
          (paysDuPaiement.get(p.whopId) ?? null) === c.country,
      );
      c.net = summarizeWhopRevenue(lignes, fx).net;
      cellules.set(cle, c);
    }
    // NOM LISIBLE DU PLAN — depuis l'agrégat A/B, qui mappe déjà l'identifiant
    // Whop au slug émis par l'app. Whop, lui, n'expose aucun libellé : sans
    // cette jointure l'écran afficherait `plan_8Eo6l4YYhkeI5`.
    const abRow = await ctx.db
      .query("posthogCache")
      .withIndex("by_project_key", (q) =>
        q.eq("projectId", ctx.projectId).eq("key", "abPurchases"),
      )
      .unique();
    const nomDuPlan = new Map<string, string>();
    if (abRow) {
      try {
        const payload = JSON.parse(abRow.json) as {
          rows?: { plan?: string; whopPlanId?: string }[];
        };
        for (const r of payload.rows ?? []) {
          if (r.whopPlanId && r.plan) nomDuPlan.set(r.whopPlanId, r.plan);
        }
      } catch {
        // Cache illisible : les plans gardent leur identifiant. Un écran sans
        // libellé reste lisible ; une query qui jette ne l'est pas.
      }
    }
    const planCells: PlanCountryCell[] = [...cellules.values()]
      .map((c) => {
        const pr = prixDuPlan.get(c.planId);
        // Champs ÉNUMÉRÉS, jamais `...c` : la règle du dépôt vaut même quand
        // l'objet étalé est local — c'est ainsi qu'un champ ajouté plus tard
        // sort sans que personne l'ait décidé (garde scripts/check-db-spread).
        return {
          planId: c.planId,
          country: c.country,
          clients: c.clients,
          paid: c.paid,
          attempts: c.attempts,
          net: c.net,
          planLabel: nomDuPlan.get(c.planId) ?? null,
          price: pr && pr.n > 0 ? round2(pr.somme / pr.n) : 0,
        };
      })
      .sort((a, b) => a.price - b.price || b.clients - a.clients);

    // ── SÉRIE D'ÉVOLUTION ─────────────────────────────────────────────────
    // Coût et revenu par (marché, mois), CÔTE À CÔTE et jamais en ratio : le
    // retour arrive après la dépense (une vidéo d'août encaisse en septembre) et
    // le CPM d'une vidéo récente n'a pas fini de courir. Un ratio mensuel
    // flatterait le dernier mois et chargerait le premier.
    const trend = new Map<string, MarketTrendPoint>();
    const pointFor = (country: string | null, month: string) => {
      const cle = `${country ?? ""}|${month}`;
      const p =
        trend.get(cle) ?? { month, country, cost: 0, revenueNet: 0 };
      trend.set(cle, p);
      return p;
    };
    for (const [cle, cout] of coutParMois) {
      const [pays, month] = cle.split("|");
      pointFor(pays === "" ? null : pays, month).cost = cout;
    }
    for (const p of paiementsPeriode) {
      if (p.status !== "paid") continue;
      const pays = paysDuPaiement.get(p.whopId) ?? null;
      const point = pointFor(pays, monthKeyParis(p.paidAt));
      point.revenueNet = round2(
        point.revenueNet + summarizeWhopRevenue([p], fx).net,
      );
    }

    const valeurDe = new Map(valeurParPays.map((v) => [v.country ?? "", v]));
    const survieDe = new Map(survieParPays.map((v) => [v.country ?? "", v]));
    /** Une courbe VIDE a quand même ses jalons : l'écran itère dessus sans
     *  se demander si le pays a des clients. */
    const courbeVide = () => VALUE_DAYS.map((day) => ({ day, sum: 0, mature: 0 }));
    const survieVide = () => SURVIVAL_DAYS.map((day) => ({ day, alive: 0, mature: 0 }));

    // Les pays des COHORTES comptent aussi : un marché dont tous les clients ont
    // été acquis AVANT la période n'a ni coût ni revenu dans la fenêtre, mais il
    // a une valeur — et l'omettre le ferait disparaître de l'écran.
    const pays = new Set<string>([
      ...couts.keys(),
      ...revenus.keys(),
      ...valeurDe.keys(),
    ]);
    const rows: MarketRow[] = [...pays].map((k) => {
      const c = couts.get(k);
      const r = revenus.get(k);
      const v = valeurDe.get(k);
      const sv = survieDe.get(k);
      const av = precedent.get(k);
      return {
        country: k === "" ? null : k,
        creators: c?.creators.size ?? 0,
        creatorIds: [...(c?.creators ?? [])],
        videos: c?.videos ?? 0,
        cost: round2(c?.cost ?? 0),
        clients: r?.clients ?? 0,
        renewals: r?.renewals ?? 0,
        failures: r?.failures ?? 0,
        attempts: r?.attempts ?? 0,
        paid: r?.paid ?? 0,
        revenueNet: r ? summarizeWhopRevenue(r.rows, fx).net : 0,
        previousClients: av?.clients ?? 0,
        previousRevenueNet: av?.net ?? 0,
        cohortClients: v?.cohortClients ?? 0,
        curve: v?.curve ?? courbeVide(),
        survival: sv?.steps ?? survieVide(),
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
      planCells,
      trend: [...trend.values()].sort(
        (a, b) => a.month.localeCompare(b.month) || (a.country ?? "").localeCompare(b.country ?? ""),
      ),
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
