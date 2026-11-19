import { v } from "convex/values";
import { internal } from "./_generated/api";
import { shiftDay } from "./analyticsDates";
import { authedAction, mcpPermissionQuery } from "./functions";
import {
  loadPublicationAssignmentIndex,
  postLabel,
  publishedAndMatches,
} from "./trackerData";
import {
  ajouterDepartsDePublication,
  parisDayKey,
  parisMidnightUtc,
  parisYesterdayKey,
  type SnapshotPoint,
} from "./viewsDaily";
import {
  postsParJour,
  ventesParJour,
  type FichePost,
  type VentesEtPostsParJour,
} from "./ventesParJourMath";
import { projectFx, summarizeWhopRevenue } from "./whopRevenue";
import { collectProjectWhopPayments } from "./whopPaymentsAccess";

/**
 * VENTES ET POSTS PAR JOUR — le détail « Par jour » de la carte Rentabilité.
 *
 * Chaque jour : les nouvelles ventes Whop, et les posts qui faisaient les vues.
 * Les deux séries sont posées côte à côte, jamais reliées : une vente ne dit pas
 * d'où vient l'acheteur (cf convex/ventesParJourMath).
 *
 * Le calcul lit toute la fenêtre de relevés du projet : il tourne dans une
 * ACTION, en plusieurs queries (une tranche de jours de relevés par query). La
 * courbe « vues gagnées » le fait en une seule query et plafonne à 31 jours ;
 * ici on va jusqu'à un trimestre. Chaque query vérifie `business.read` pour
 * l'appelant — le droit de la carte Rentabilité (`mcpPermissionQuery` : la garde
 * interne par personne, la même que celle de l'écran).
 */

/** Au-delà d'un trimestre, des barres par jour ne se lisent plus. */
export const VENTES_PAR_JOUR_MAX = 92;
/** Posts gardés par jour : ce qui tire un pic tient dans les premiers. */
const POSTS_PAR_JOUR = 5;
/** Relevés lus AVANT et APRÈS la période (référence de chaque post, écart qui déborde) — comme `vues`. */
const LECTURE_MARGE_MS = 7 * 86_400_000;
/** Une query de relevés couvre 7 jours (~3 500 relevés sur Snytch en novembre 2026). */
const TRANCHE_MS = 7 * 86_400_000;

function minuitParis(jour: string): number {
  const [y, m, d] = jour.split("-").map(Number);
  return parisMidnightUtc(y, m, d);
}

/** Les nouvelles ventes et les autres paiements de chaque jour de `[du, au]`. */
export const lireVentes = mcpPermissionQuery("business.read")({
  args: { jours: v.array(v.string()) },
  handler: async (ctx, { jours }) => {
    const project = await ctx.db.get(ctx.projectId);
    if (project === null || project.whop === undefined) return null;
    // Comptes internes exclus (point de passage unique) : la carte ne compte
    // pas le compte de test de l'admin dans le revenu, ici non plus.
    const { payments } = await collectProjectWhopPayments(
      ctx,
      ctx.projectId,
      project.slug ?? "",
    );
    // Référentiel de change = le résumé du lot, comme la carte et l'onglet
    // Analytics : un paiement en réals se lit en euros au taux du projet.
    const referentiel = summarizeWhopRevenue(payments, projectFx(project));
    return {
      currency: referentiel.currency,
      mixedCurrency: referentiel.mixedCurrency,
      conversions: referentiel.conversions,
      jours: ventesParJour(payments, referentiel, parisDayKey, jours),
    };
  },
});

/** Les posts que suit la courbe du Tracker (lien posé, chauffe exclue), et leur date de publication. */
export const lirePostsSuivis = mcpPermissionQuery("business.read")({
  args: {},
  handler: async (ctx) => {
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return pubs
      .filter((p) => publishedAndMatches(p, {}, () => undefined))
      .map((p) => ({ publicationId: p._id as string, publishedAt: p.datePubli }));
  },
});

/** Les relevés du projet capturés dans `[de, a[` — bruts, filtrés par l'action. */
export const lireReleves = mcpPermissionQuery("business.read")({
  args: { de: v.number(), a: v.number() },
  handler: async (ctx, { de, a }) => {
    const snaps = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_project_capturedAt", (ix) =>
        ix.eq("projectId", ctx.projectId).gte("capturedAt", de).lt("capturedAt", a),
      )
      .collect();
    return snaps.map((s) => ({
      publicationId: s.publicationId as string,
      capturedAt: s.capturedAt,
      vues: s.vues,
    }));
  },
});

/** De quoi nommer les posts qui ressortent : créatrice, compte, format, lien. */
export const lireFichesPosts = mcpPermissionQuery("business.read")({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }): Promise<FichePost[]> => {
    const { refs } = await loadPublicationAssignmentIndex(ctx);
    const campagnes = new Map<string, string | null>();
    const out: FichePost[] = [];
    for (const id of ids) {
      const pid = ctx.db.normalizeId("publications", id);
      const p = pid === null ? null : await ctx.db.get(pid);
      if (p === null || p.projectId !== ctx.projectId) continue;
      const campaignId = p.scriptCombo?.campaignId;
      let campagne: string | null = null;
      if (campaignId !== undefined) {
        if (!campagnes.has(campaignId)) {
          campagnes.set(campaignId, (await ctx.db.get(campaignId))?.name ?? null);
        }
        campagne = campagnes.get(campaignId) ?? null;
      }
      const ref = refs.get(id);
      const titre = postLabel(p);
      out.push({
        publicationId: id,
        createatrice: ref?.creatorName ?? "—",
        compte: p.compte,
        plateforme: p.plateforme,
        url: typeof p.postUrl === "string" && p.postUrl.length > 0 ? p.postUrl : null,
        titre: titre.length > 140 ? `${titre.slice(0, 139)}…` : titre,
        format: campagne ?? ref?.formatName ?? null,
        publieLe: p.datePubli,
      });
    }
    return out;
  },
});

/**
 * Le détail « Par jour » : les `jours` derniers jours COMPLETS, jusqu'à hier (un
 * jour n'a toutes ses vues qu'après le relevé de 23 h 30). Appelé à la demande,
 * jamais à l'ouverture de la page Paiements.
 */
export const getVentesEtPostsParJour = authedAction({
  args: { projectId: v.id("projects"), jours: v.number() },
  handler: async (ctx, { projectId, jours: n }): Promise<VentesEtPostsParJour> => {
    if (!Number.isInteger(n) || n < 1 || n > VENTES_PAR_JOUR_MAX) {
      throw new Error(`jours : entier entre 1 et ${VENTES_PAR_JOUR_MAX}`); // i18n-exempt: erreur interne de programmation
    }
    const ids = { userId: ctx.userId, projectId };
    const au = parisYesterdayKey(Date.now());
    const du = shiftDay(au, -(n - 1));
    const jours: string[] = [];
    for (let j = du; j <= au; j = shiftDay(j, 1)) jours.push(j);

    const lecture = minuitParis(du) - LECTURE_MARGE_MS;
    const finLecture = minuitParis(shiftDay(au, 1)) + LECTURE_MARGE_MS;
    const tranches: { de: number; a: number }[] = [];
    for (let de = lecture; de < finLecture; de += TRANCHE_MS) {
      tranches.push({ de, a: Math.min(de + TRANCHE_MS, finLecture) });
    }

    // Tout part de front : ce sont des lectures, l'appel attend la plus lente.
    const [ventes, suivis, lots] = await Promise.all([
      ctx.runQuery(internal.ventesParJour.lireVentes, { ...ids, jours }),
      ctx.runQuery(internal.ventesParJour.lirePostsSuivis, ids),
      Promise.all(
        tranches.map((t) => ctx.runQuery(internal.ventesParJour.lireReleves, { ...ids, ...t })),
      ),
    ]);
    if (ventes === null) return { configured: false };

    const suivisIds = new Set(suivis.map((s) => s.publicationId));
    const releves: SnapshotPoint[] = lots.flat().filter((s) => suivisIds.has(s.publicationId));
    // Un post publié APRÈS le début de la lecture a toute sa vie lue : il part
    // de 0 vue à sa publication, comme sur la courbe du Tracker.
    const points = ajouterDepartsDePublication(
      releves,
      suivis.map((s) => ({ publicationId: s.publicationId, publishedAt: s.publishedAt })),
      lecture,
    );
    const vues = postsParJour(points, jours, POSTS_PAR_JOUR);

    const cites = [...new Set(vues.flatMap((j) => j.posts.map((p) => p.publicationId)))];
    const posts =
      cites.length === 0
        ? []
        : await ctx.runQuery(internal.ventesParJour.lireFichesPosts, { ...ids, ids: cites });

    return {
      configured: true,
      du,
      au,
      currency: ventes.currency,
      mixedCurrency: ventes.mixedCurrency,
      conversions: ventes.conversions,
      // Mêmes jours, même ordre : les deux séries viennent de `jours`.
      jours: ventes.jours.map((v, i) => ({
        ...v,
        vues: vues[i].vues,
        vuesEstimees: vues[i].vuesEstimees,
        posts: vues[i].posts,
      })),
      posts,
    };
  },
});

