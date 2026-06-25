import { adminQuery } from "./functions";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Vue TRACKER (refonte) — data des posts publiés. Deux queries scopées projet :
 *
 *  1. listTrackerPosts — la LISTE des posts publiés filtrés, avec leurs métriques
 *     LATEST servies depuis les champs DÉNORMALISÉS de la publication
 *     (vuesLatest/likesLatest/commentsLatest) → ZÉRO lecture de metricSnapshots.
 *     Alimente la zone 2 (stats globales) + la zone 3 mode Liste + les 4 charts
 *     de comparaison par catégorie (tout dérivé client-side de cette liste, cf
 *     lib/tracker-data). C'est la SEULE source en mode Liste.
 *
 *  2. trackerViewsDaily — la série temporelle "vues GAGNÉES par jour" (deltas de
 *     snapshots), pour la courbe du mode Charts UNIQUEMENT. Seul endroit qui lit
 *     metricSnapshots : range-scan BORNÉ sur l'index by_project_capturedAt à la
 *     plage de dates filtrée (jamais un collect global de tout l'historique).
 *
 * Les DEUX queries acceptent le même jeu de filtres MULTI-SELECT (un seul état UI
 * partagé) et appliquent exactement la même règle d'inclusion
 * (publishedAndMatches → matchesDimensionFilters).
 *
 * Sémantique des filtres de dimension : OU à l'intérieur d'une dimension, ET
 * entre dimensions ; liste vide/absente = pas de filtre.
 *
 * Dimensions "créateur" et "format NOMMÉ" : ABSENTES de la table publications.
 * Résolues via les assignments (targets[].publicationId / publicationId legacy →
 * creatorId + creatorNameSnapshot + formatId). Cf buildPublicationAssignmentMap.
 */

const plateformeArg = v.union(
  v.literal("TikTok"),
  v.literal("Instagram"),
  v.literal("YouTube"),
);

// Filtres partagés MULTI-SELECT. dateFrom/dateTo = bornes ms sur datePubli (le
// client passe début-de-jour "Du" et fin-de-jour "Au"). Les listes de dimension
// sont optionnelles ; vide/absente = "Tous". Le format est désormais le format
// NOMMÉ (formatIds → formats), plus le mediaType.
const filterArgs = {
  dateFrom: v.optional(v.number()),
  dateTo: v.optional(v.number()),
  creatorIds: v.optional(v.array(v.id("creators"))),
  comptes: v.optional(v.array(v.string())),
  plateformes: v.optional(v.array(plateformeArg)),
  formatIds: v.optional(v.array(v.id("formats"))),
  campaignIds: v.optional(v.array(v.id("scriptCampaigns"))),
} as const;

type FilterArgs = {
  dateFrom?: number;
  dateTo?: number;
  creatorIds?: Id<"creators">[];
  comptes?: string[];
  plateformes?: ("TikTok" | "Instagram" | "YouTube")[];
  formatIds?: Id<"formats">[];
  campaignIds?: Id<"scriptCampaigns">[];
};

type AssignmentRef = {
  creatorId: Id<"creators"> | null;
  creatorName: string;
  formatId: Id<"formats"> | null;
  formatName: string | null;
};

/**
 * Map publicationId → { créateur, format nommé }, construite depuis les
 * assignments du projet. Un assignment porte le creatorId (+ creatorNameSnapshot
 * si le créateur a été supprimé), un formatId OPTIONNEL (format nommé ; sparse —
 * les assignments de SCRIPT n'en ont pas), et matérialise 1..3 publications via
 * targets[].publicationId (et le champ legacy publicationId). Le nom vivant prime
 * (creators / formats) ; à défaut, le snapshot ; à défaut, un libellé neutre.
 *
 * Coût : collect assignments + creators + formats, bornés au projet (idiome
 * dashboard/scriptAnalytics). Aucune lecture de snapshots ici.
 */
async function buildPublicationAssignmentMap(
  ctx: QueryCtx & { projectId: Id<"projects"> },
): Promise<Map<string, AssignmentRef>> {
  const [assignments, creators, formats] = await Promise.all([
    ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect(),
    ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect(),
    ctx.db
      .query("formats")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect(),
  ]);

  const creatorNameById = new Map(creators.map((c) => [c._id as string, c.name]));
  const formatNameById = new Map(formats.map((f) => [f._id as string, f.name]));

  const raw = new Map<
    string,
    {
      creatorId: Id<"creators">;
      snapshot: string | undefined;
      formatId: Id<"formats"> | null;
    }
  >();
  for (const a of assignments) {
    const rec = {
      creatorId: a.creatorId,
      snapshot: a.creatorNameSnapshot,
      formatId: a.formatId ?? null,
    };
    if (a.publicationId) raw.set(a.publicationId as string, rec);
    for (const t of a.targets ?? []) {
      if (t.publicationId) raw.set(t.publicationId as string, rec);
    }
  }

  const resolved = new Map<string, AssignmentRef>();
  for (const [pubId, rec] of raw) {
    const liveName = creatorNameById.get(rec.creatorId as string);
    resolved.set(pubId, {
      creatorId: rec.creatorId,
      creatorName: liveName ?? rec.snapshot ?? "Créateur supprimé",
      formatId: rec.formatId,
      formatName: rec.formatId
        ? (formatNameById.get(rec.formatId as string) ?? "Format supprimé")
        : null,
    });
  }
  return resolved;
}

// ─── Matching des filtres de dimension (multi-select) ────────────────────────
// DUPLIQUÉ de lib/tracker-data (matchesDimensionFilters + PostDimensions) car
// convex/ ne peut pas importer lib/ (A6). La version lib/ est testée en vitest ;
// garder les deux EXACTEMENT synchrones. OU intra-dimension, ET inter-dimensions.

type PostDimensions = {
  creatorId: string | null;
  compte: string;
  plateforme: string;
  formatId: string | null;
  campaignId: string | null;
};

function activeFilter(list?: readonly string[]): list is readonly string[] {
  return Array.isArray(list) && list.length > 0;
}

function matchesDimensionFilters(
  d: PostDimensions,
  f: {
    creatorIds?: readonly string[];
    comptes?: readonly string[];
    plateformes?: readonly string[];
    formatIds?: readonly string[];
    campaignIds?: readonly string[];
  },
): boolean {
  if (
    activeFilter(f.creatorIds) &&
    (d.creatorId === null || !f.creatorIds.includes(d.creatorId))
  ) {
    return false;
  }
  if (activeFilter(f.comptes) && !f.comptes.includes(d.compte)) return false;
  if (activeFilter(f.plateformes) && !f.plateformes.includes(d.plateforme)) {
    return false;
  }
  if (
    activeFilter(f.formatIds) &&
    (d.formatId === null || !f.formatIds.includes(d.formatId))
  ) {
    return false;
  }
  if (
    activeFilter(f.campaignIds) &&
    (d.campaignId === null || !f.campaignIds.includes(d.campaignId))
  ) {
    return false;
  }
  return true;
}

/** Dimensions d'une publication (compte/plateforme/campagne directes ; créateur
 *  + format nommé via la map assignment). */
function dimensionsOf(
  p: Doc<"publications">,
  ref: AssignmentRef | undefined,
): PostDimensions {
  return {
    creatorId: ref?.creatorId ?? null,
    compte: p.compte,
    plateforme: p.plateforme,
    formatId: ref?.formatId ?? null,
    campaignId: p.scriptCombo?.campaignId ?? null,
  };
}

/**
 * Règle d'inclusion d'une publication : publiée (postUrl non vide) + dates +
 * filtres de dimension multi-select. Les dimensions créateur/format viennent de
 * la map assignment (publications sans assignment → null → exclues si la
 * dimension correspondante est filtrée).
 */
function publishedAndMatches(
  p: Doc<"publications">,
  args: FilterArgs,
  refOf: (pubId: string) => AssignmentRef | undefined,
): boolean {
  if (!(typeof p.postUrl === "string" && p.postUrl.length > 0)) return false;
  if (args.dateFrom !== undefined && p.datePubli < args.dateFrom) return false;
  if (args.dateTo !== undefined && p.datePubli > args.dateTo) return false;
  return matchesDimensionFilters(dimensionsOf(p, refOf(p._id as string)), {
    creatorIds: args.creatorIds,
    comptes: args.comptes,
    plateformes: args.plateformes,
    formatIds: args.formatIds,
    campaignIds: args.campaignIds,
  });
}

/** Libellé d'un post : titre/légende capturé par la sync (postTitle) en
 *  priorité ; sinon titre des ScreenRecorders (étape Hook skippée) ; sinon
 *  hookText (carousel/short interne). Vide → « (sans titre) » côté UI. */
function postLabel(p: Doc<"publications">): string {
  if (p.postTitle && p.postTitle.length > 0) return p.postTitle;
  const mediaType = p.mediaType ?? "carousel";
  if (mediaType === "screenrecorder" && p.titre && p.titre.length > 0) {
    return p.titre;
  }
  return p.hookText;
}

export const listTrackerPosts = adminQuery({
  args: filterArgs,
  handler: async (ctx, args) => {
    const refs = await buildPublicationAssignmentMap(ctx);

    // datePubli desc → ordre stable par défaut (le client re-trie selon la
    // colonne choisie, défaut vues desc). Lecture latest = champs dénormalisés.
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_project_datePubli", (q) =>
        q.eq("projectId", ctx.projectId),
      )
      .order("desc")
      .collect();

    const rows = [];
    for (const p of pubs) {
      if (!publishedAndMatches(p, args, (id) => refs.get(id))) continue;
      const ref = refs.get(p._id as string) ?? null;
      rows.push({
        _id: p._id,
        carouselId: p.carouselId,
        label: postLabel(p),
        plateforme: p.plateforme,
        mediaType: (p.mediaType ?? "carousel") as
          | "carousel"
          | "short"
          | "screenrecorder",
        compte: p.compte,
        creatorId: ref?.creatorId ?? null,
        creatorName: ref?.creatorName ?? null,
        // Format NOMMÉ rattaché (via assignment), null si aucun.
        formatId: ref?.formatId ?? null,
        formatName: ref?.formatName ?? null,
        datePubli: p.datePubli,
        postUrl: p.postUrl ?? null,
        // Métriques LATEST dénormalisées (null → 0 pour les agrégats).
        vues: p.vuesLatest ?? 0,
        likes: p.likesLatest ?? 0,
        comments: p.commentsLatest ?? 0,
      });
    }
    return rows;
  },
});

// ─── Vues gagnées par jour (deltas de snapshots) ─────────────────────────────
// DUPLIQUÉ de lib/tracker-data (computeDailyViewDeltas + dayKeyUTC) car convex/
// ne peut pas importer lib/ (A6). La version lib/ est testée en vitest ; garder
// les deux EXACTEMENT synchrones.

function dayKeyUTC(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function computeDailyViewDeltas(
  snaps: { publicationId: string; capturedAt: number; vues: number }[],
): { date: string; value: number }[] {
  const byPub = new Map<
    string,
    { publicationId: string; capturedAt: number; vues: number }[]
  >();
  for (const s of snaps) {
    const arr = byPub.get(s.publicationId);
    if (arr) arr.push(s);
    else byPub.set(s.publicationId, [s]);
  }

  const dayTotals = new Map<string, number>();
  for (const arr of byPub.values()) {
    arr.sort((a, b) => a.capturedAt - b.capturedAt);
    for (let i = 1; i < arr.length; i++) {
      const delta = Math.max(0, arr[i].vues - arr[i - 1].vues);
      if (delta === 0) continue;
      const key = dayKeyUTC(arr[i].capturedAt);
      dayTotals.set(key, (dayTotals.get(key) ?? 0) + delta);
    }
  }

  return [...dayTotals.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const trackerViewsDaily = adminQuery({
  args: filterArgs,
  handler: async (ctx, args) => {
    const refs = await buildPublicationAssignmentMap(ctx);

    // 1) Déterminer l'ensemble des publications filtrées + la 1re date de publi
    //    (borne basse de la fenêtre quand "Du" n'est pas posé). Lecture latest
    //    uniquement (champs publication), pas de snapshot ici.
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();

    const filteredIds = new Set<string>();
    let minDatePubli = Number.POSITIVE_INFINITY;
    for (const p of pubs) {
      if (!publishedAndMatches(p, args, (id) => refs.get(id))) continue;
      filteredIds.add(p._id as string);
      if (p.datePubli < minDatePubli) minDatePubli = p.datePubli;
    }
    if (filteredIds.size === 0) return [];

    // 2) Range-scan BORNÉ sur by_project_capturedAt. Borne basse = "Du" si posé,
    //    sinon la 1re date de publication des posts filtrés (jamais 0 → jamais un
    //    scan de tout l'historique du projet sans raison). Borne haute = "Au" si
    //    posé, sinon le présent (fin naturelle de l'index). Un seul scan indexé,
    //    puis filtrage en mémoire sur l'ensemble filtré (idiome aggregateTimeseries).
    const lower = args.dateFrom ?? minDatePubli;
    const snapsQuery = ctx.db
      .query("metricSnapshots")
      .withIndex("by_project_capturedAt", (ix) => {
        const lo = ix.eq("projectId", ctx.projectId).gte("capturedAt", lower);
        return args.dateTo !== undefined
          ? lo.lte("capturedAt", args.dateTo)
          : lo;
      });
    const snaps = await snapsQuery.collect();

    const points = snaps
      .filter((s) => filteredIds.has(s.publicationId as string))
      .map((s) => ({
        publicationId: s.publicationId as string,
        capturedAt: s.capturedAt,
        vues: s.vues,
      }));

    return computeDailyViewDeltas(points);
  },
});
