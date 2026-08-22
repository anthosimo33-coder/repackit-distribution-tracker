import { adminQuery } from "./functions";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { passesWarmupMode, type WarmupMode } from "./warmupMode";
import { computeDailyViewDeltas } from "./viewsDaily";
import { savesAvailability } from "./decisionThresholds";
import { qualificationOf } from "./quadrant";

/**
 * Vue TRACKER (refonte) — data des posts publiés. Deux queries scopées projet :
 *
 *  1. listTrackerPosts — la LISTE des posts publiés filtrés, avec leurs métriques
 *     LATEST servies depuis les champs DÉNORMALISÉS de la publication
 *     (vuesLatest/likesLatest/commentsLatest) → ZÉRO lecture de metricSnapshots.
 *     Alimente la zone 2 (stats globales) + la zone 3 mode Liste + les 4 charts
 *     de comparaison par catégorie (tout dérivé client-side de cette liste, cf
 *     lib/tracker-data). C'est la SEULE source en mode Liste.
 *     Elle sert AUSSI la carte « Vues × Intent » : les rows portent les saves et
 *     le classement `quadrant` écrit par le relevé nocturne (convex/quadrantSync),
 *     donc la carte hérite mécaniquement des mêmes filtres que le reste de la
 *     page, sans query ni règle d'inclusion supplémentaire.
 *
 *  2. trackerViewsDaily — la série temporelle "vues GAGNÉES par jour" (deltas de
 *     snapshots répartis AU PRORATA du temps couvert, cf convex/viewsDaily.ts),
 *     pour la courbe du mode Charts UNIQUEMENT. Seul endroit qui lit
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
 * WARMUP — filtre tri-état à part (pas une dimension multi-select), appliqué
 * dans publishedAndMatches donc commun aux deux queries. DÉFAUT = "exclude" :
 * les posts de chauffe sont déjà hors paie et hors rentabilité, les inclure
 * dans les vues/likes/commentaires gonflait les agrégats du tracker. C'est un
 * filtre d'AFFICHAGE : ni le moteur de paie ni le flag lui-même ne bougent.
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
  // Tri-état warmup. ABSENT ⇒ "exclude" (cf DEFAULT_WARMUP_FILTER) : le défaut
  // sûr est la lecture NON BIAISÉE, un appelant doit demander explicitement à
  // réintégrer les posts de chauffe.
  warmup: v.optional(
    v.union(v.literal("exclude"), v.literal("all"), v.literal("only")),
  ),
} as const;

type FilterArgs = {
  dateFrom?: number;
  dateTo?: number;
  creatorIds?: Id<"creators">[];
  comptes?: string[];
  plateformes?: ("TikTok" | "Instagram" | "YouTube")[];
  formatIds?: Id<"formats">[];
  campaignIds?: Id<"scriptCampaigns">[];
  warmup?: WarmupFilter;
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
export async function buildPublicationAssignmentMap(
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

// Warmup : ALIAS du helper UNIQUE convex/warmupMode.ts (jumeau de lib/warmup-mode,
// parité verrouillée par lib/warmup-mode.test.ts). Plus de logique locale (TD-019).
type WarmupFilter = WarmupMode;
const matchesWarmupFilter = passesWarmupMode;

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
 * warmup + filtres de dimension multi-select. Les dimensions créateur/format
 * viennent de la map assignment (publications sans assignment → null → exclues
 * si la dimension correspondante est filtrée).
 *
 * SOURCE UNIQUE d'inclusion des DEUX queries (liste + série temporelle) → le
 * filtre warmup s'applique mécaniquement à TOUS les agrégats de la vue (4 KPI,
 * compteur de posts, liste, charts), sans logique dupliquée par carte.
 */
function publishedAndMatches(
  p: Doc<"publications">,
  args: FilterArgs,
  refOf: (pubId: string) => AssignmentRef | undefined,
): boolean {
  if (!(typeof p.postUrl === "string" && p.postUrl.length > 0)) return false;
  if (args.dateFrom !== undefined && p.datePubli < args.dateFrom) return false;
  if (args.dateTo !== undefined && p.datePubli > args.dateTo) return false;
  if (!matchesWarmupFilter(p.isWarmup === true, args.warmup ?? "exclude")) {
    return false;
  }
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
 *  hookText (carousel/short interne). Vide → « (sans titre) » côté UI.
 *  Exporté : réutilisé par le drill-down analytics scripts (scriptAnalytics). */
export function postLabel(p: Doc<"publications">): string {
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
    // Noms INTERNES des campagnes du projet — une seule lecture, comme les
    // formats plus haut. Le graphe « Vues par campagne » et le multi-select de
    // la barre de filtres lisent ainsi la même source.
    const campaignNameById = new Map(
      (
        await ctx.db
          .query("scriptCampaigns")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect()
      ).map((c) => [c._id as string, c.name]),
    );

    // FAMILLE D'ANGLE — portée par la brique HOOK du combo, pas par la
    // publication. Une seule lecture des briques du projet (index by_project,
    // celui-là même qui sert au résumé combo côté admin) puis résolution en
    // mémoire : Convex n'indexe pas les champs imbriqués, donc le join passe
    // forcément par scriptCombo.hookBrickId côté client de la query.
    const angleFamilyByBrick = new Map(
      (
        await ctx.db
          .query("scriptBricks")
          .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
          .collect()
      )
        .filter((b) => b.kind === "hook" && b.angleFamily !== undefined)
        .map((b) => [b._id as string, b.angleFamily as string]),
    );

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
        // CAMPAGNE d'origine — lue sur la publication (scriptCombo recopié à la
        // matérialisation), pas sur l'assignment : c'est déjà la source du filtre
        // multi-select campagne de cette page, donc graphe et filtre lisent la
        // MÊME chose. Nom INTERNE : écran admin (displayName est le nom exposé
        // aux créatrices, cf #59). null = publication sans campagne rattachée.
        campaignId: (p.scriptCombo?.campaignId as string | undefined) ?? null,
        campaignName: p.scriptCombo?.campaignId
          ? (campaignNameById.get(p.scriptCombo.campaignId as string) ??
            "Campagne supprimée")
          : null,
        // Famille d'angle du HOOK du combo. null = pas de combo, hook supprimé,
        // ou famille non renseignée — les trois retombent sur « Sans famille »
        // côté agrégat, ce qui est la bonne lecture : dans les trois cas on ne
        // sait pas de quelle famille relève ce post.
        angleFamily: p.scriptCombo?.hookBrickId
          ? (angleFamilyByBrick.get(p.scriptCombo.hookBrickId as string) ?? null)
          : null,
        datePubli: p.datePubli,
        postUrl: p.postUrl ?? null,
        // Flag warmup (PR #119) — pastille "hors paie" dans la liste tracker.
        // Les posts warmup sont désormais EXCLUS par défaut de cette query (cf
        // filterArgs.warmup) ; la pastille reste affichée sur les lignes quand
        // l'utilisateur choisit de les voir ("Tous"/"Warmup seulement"). Le
        // moteur de paie reste inchangé.
        isWarmup: p.isWarmup === true,
        // QUALIFICATION éditoriale, TRI-ÉTAT — et c'est tout l'objet du champ.
        // `isWarmup` ci-dessus est volontairement un booléen (la pastille « hors
        // paie » ne connaît que deux états), mais il écrase la différence entre
        // « promo, décidé » et « jamais qualifié ». La carte quadrant colore par
        // qualification : sans ce champ, un post jamais qualifié serait peint
        // « promo », c'est-à-dire qu'un défaut de saisie prendrait l'apparence
        // d'une décision. Dérivé ici, au contact du champ brut.
        qualification: qualificationOf(p.isWarmup),
        // Métriques LATEST dénormalisées (null → 0 pour les agrégats).
        vues: p.vuesLatest ?? 0,
        likes: p.likesLatest ?? 0,
        comments: p.commentsLatest ?? 0,
        // SAVES — `null` et jamais 0 par défaut : Instagram/YouTube n'exposent
        // pas la métrique et les posts antérieurs à sa collecte n'en portent
        // pas. Replier sur 0 ferait passer une absence pour un save rate nul,
        // c'est-à-dire pour une contre-performance (cf savesAvailability, qui
        // sépare « la plateforme ne le donnera jamais » de « pas encore relevé »).
        saves: p.savesLatest ?? null,
        savesAvailability: savesAvailability(p.savesLatest, p.plateforme),
        // Classement « Vues × Intent » écrit par le relevé nocturne (cf
        // convex/quadrantSync.ts). `null` = jamais recalculé → la carte l'affiche
        // « en attente du prochain relevé », pas « sous les seuils ».
        quadrant: p.quadrant ?? null,
      });
    }
    return rows;
  },
});

/**
 * Combien de posts le filtre WARMUP retire-t-il de la lecture courante ?
 *
 * La carte « Vues × Intent » ne peut pas les compter elle-même : `listTrackerPosts`
 * les a déjà retirés quand elle reçoit ses lignes. Sans ce nombre, la carte
 * affiche « 3 Scale » sans pouvoir dire que c'est 3 sur 39 classés tirés de 126
 * publiés — un effectif se lit alors comme un total.
 *
 * MÊME règle d'inclusion que les deux autres queries (`publishedAndMatches`), le
 * warmup NEUTRALISÉ le temps du comptage : on compte les posts qui passeraient
 * tous les autres filtres et que seul le mode warmup écarte. Aucune règle
 * dupliquée — c'est le même prédicat, appelé avec « all ».
 *
 * Mode « all » ⇒ 0 sans lire la base : rien n'est caché.
 */
export const trackerWarmupHidden = adminQuery({
  args: filterArgs,
  handler: async (ctx, args): Promise<number> => {
    const mode = args.warmup ?? "exclude";
    if (mode === "all") return 0;

    const refs = await buildPublicationAssignmentMap(ctx);
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();

    let caches = 0;
    for (const p of pubs) {
      const sansFiltreWarmup = { ...args, warmup: "all" as const };
      if (!publishedAndMatches(p, sansFiltreWarmup, (id) => refs.get(id))) continue;
      if (!matchesWarmupFilter(p.isWarmup === true, mode)) caches += 1;
    }
    return caches;
  },
});

// ─── Vues gagnées par jour (deltas de snapshots) ─────────────────────────────
// L'algorithme (répartition AU PRORATA du temps, jours calendaires Europe/Paris)
// vit dans le module PUR convex/viewsDaily.ts — importé tel quel ici ET par
// lib/tracker-data pour le client. Plus de réplique à tenir synchrone : c'est le
// même code des deux côtés, testé en vitest (lib/views-daily.test.ts).

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
