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
 * Les DEUX queries acceptent le même jeu de filtres (un seul état UI partagé) et
 * appliquent exactement la même règle d'inclusion (publishedAndMatches).
 *
 * Dimension "créateur" : ABSENTE de la table publications. Résolue via les
 * assignments (targets[].publicationId / publicationId legacy → creatorId +
 * creatorNameSnapshot). Cf buildPublicationCreatorMap.
 */

const plateformeArg = v.union(
  v.literal("TikTok"),
  v.literal("Instagram"),
  v.literal("YouTube"),
);
const mediaTypeArg = v.union(
  v.literal("carousel"),
  v.literal("short"),
  v.literal("screenrecorder"),
);

// Filtres partagés. dateFrom/dateTo sont des bornes ms sur datePubli (le client
// passe début-de-jour "Du" et fin-de-jour "Au"). Toutes optionnelles → "Tous".
const filterArgs = {
  dateFrom: v.optional(v.number()),
  dateTo: v.optional(v.number()),
  creatorId: v.optional(v.id("creators")),
  compte: v.optional(v.string()),
  plateforme: v.optional(plateformeArg),
  mediaType: v.optional(mediaTypeArg),
  campaignId: v.optional(v.id("scriptCampaigns")),
} as const;

type FilterArgs = {
  dateFrom?: number;
  dateTo?: number;
  creatorId?: Id<"creators">;
  compte?: string;
  plateforme?: "TikTok" | "Instagram" | "YouTube";
  mediaType?: "carousel" | "short" | "screenrecorder";
  campaignId?: Id<"scriptCampaigns">;
};

type CreatorRef = { creatorId: Id<"creators"> | null; creatorName: string };

/**
 * Map publicationId → créateur, construite depuis les assignments du projet.
 * Un assignment porte le creatorId (+ creatorNameSnapshot si le créateur a été
 * supprimé) et matérialise 1..3 publications via targets[].publicationId (et le
 * champ legacy publicationId). Le nom VIVANT (creators) prime ; à défaut, le
 * snapshot ; à défaut, un libellé neutre.
 *
 * Coût : 1 collect assignments + 1 collect creators, bornés au projet (idiome
 * identique à dashboard/scriptAnalytics). Aucune lecture de snapshots ici.
 */
async function buildPublicationCreatorMap(
  ctx: QueryCtx & { projectId: Id<"projects"> },
): Promise<Map<string, CreatorRef>> {
  const [assignments, creators] = await Promise.all([
    ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect(),
    ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect(),
  ]);

  const nameById = new Map(creators.map((c) => [c._id as string, c.name]));

  const raw = new Map<
    string,
    { creatorId: Id<"creators">; snapshot: string | undefined }
  >();
  for (const a of assignments) {
    const rec = { creatorId: a.creatorId, snapshot: a.creatorNameSnapshot };
    if (a.publicationId) raw.set(a.publicationId as string, rec);
    for (const t of a.targets ?? []) {
      if (t.publicationId) raw.set(t.publicationId as string, rec);
    }
  }

  const resolved = new Map<string, CreatorRef>();
  for (const [pubId, rec] of raw) {
    const liveName = nameById.get(rec.creatorId as string);
    resolved.set(pubId, {
      creatorId: rec.creatorId,
      creatorName: liveName ?? rec.snapshot ?? "Créateur supprimé",
    });
  }
  return resolved;
}

/**
 * Règle d'inclusion d'une publication dans la vue : publiée (postUrl non vide)
 * ET matchant TOUS les filtres actifs. Filtre dimension "créateur" résolu via la
 * map (publications sans assignment → creatorId null → exclues si un créateur
 * précis est demandé).
 */
function publishedAndMatches(
  p: Doc<"publications">,
  args: FilterArgs,
  creatorRefOf: (pubId: string) => CreatorRef | undefined,
): boolean {
  if (!(typeof p.postUrl === "string" && p.postUrl.length > 0)) return false;
  if (args.dateFrom !== undefined && p.datePubli < args.dateFrom) return false;
  if (args.dateTo !== undefined && p.datePubli > args.dateTo) return false;
  if (args.plateforme !== undefined && p.plateforme !== args.plateforme) {
    return false;
  }
  if (args.compte !== undefined && p.compte !== args.compte) return false;
  if (
    args.mediaType !== undefined &&
    (p.mediaType ?? "carousel") !== args.mediaType
  ) {
    return false;
  }
  if (
    args.campaignId !== undefined &&
    p.scriptCombo?.campaignId !== args.campaignId
  ) {
    return false;
  }
  if (args.creatorId !== undefined) {
    const ref = creatorRefOf(p._id as string);
    if (!ref || ref.creatorId !== args.creatorId) return false;
  }
  return true;
}

/** Libellé d'un post : titre pour les ScreenRecorders (étape Hook skippée),
 *  hookText sinon (carousel/short). */
function postLabel(p: Doc<"publications">): string {
  const mediaType = p.mediaType ?? "carousel";
  if (mediaType === "screenrecorder" && p.titre && p.titre.length > 0) {
    return p.titre;
  }
  return p.hookText;
}

export const listTrackerPosts = adminQuery({
  args: filterArgs,
  handler: async (ctx, args) => {
    const creatorRefs = await buildPublicationCreatorMap(ctx);

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
      if (!publishedAndMatches(p, args, (id) => creatorRefs.get(id))) continue;
      const ref = creatorRefs.get(p._id as string) ?? null;
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
    const creatorRefs = await buildPublicationCreatorMap(ctx);

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
      if (!publishedAndMatches(p, args, (id) => creatorRefs.get(id))) continue;
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
