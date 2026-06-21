import {
  authedQuery,
  e2eMutation,
  adminMutation,
  adminQuery,
} from "./functions";
import { internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { coerceSnapshotAge } from "./snapshotMatching";
import {
  buildDisplayMetrics,
  groupSnapshotsByPublication,
} from "./metricsDisplay";

const mecaniqueValidator = v.union(
  v.literal("Erreur"),
  v.literal("Volume"),
  v.literal("Comparaison"),
  v.literal("Contradiction"),
  v.literal("Universalité"),
  v.literal("Question"),
);

const niveauValidator = v.union(
  v.literal("Broad-A"),
  v.literal("Broad-B"),
  v.literal("Niché"),
);

const formatValidator = v.union(
  v.literal("A"),
  v.literal("B"),
  v.literal("C"),
  v.literal("D"),
  v.literal("E"),
  v.literal("F"),
  v.literal("G"),
  v.literal("H"),
);

const angleValidator = v.union(
  v.literal("Psycho"),
  v.literal("Accusatoire"),
  v.literal("Pédagogique"),
  v.literal("Observation"),
  v.literal("Provocant"),
);

const langueValidator = v.union(v.literal("FR"), v.literal("EN"));

const plateformeValidator = v.union(
  v.literal("TikTok"),
  v.literal("Instagram"),
  v.literal("YouTube"),
);

const mediaTypeValidator = v.union(
  v.literal("carousel"),
  v.literal("short"),
  v.literal("screenrecorder"),
);

type MediaTypeServer = "carousel" | "short" | "screenrecorder";

// Defense in depth — dupliqué côté serveur (Convex) car on ne peut pas
// importer lib/media-type.ts depuis un module Convex (tsconfig séparé).
// Logique alignée avec ALLOWED_PLATFORMS_FOR_* côté client.
// Exporté pour la garde de soumission (P8, convex/assignments.submitAssignment).
export function isFormatAllowedOnPlatform(
  mediaType: MediaTypeServer,
  plateforme: "TikTok" | "Instagram" | "YouTube",
): boolean {
  if (mediaType === "carousel") {
    return plateforme === "TikTok" || plateforme === "Instagram";
  }
  // Short et ScreenRecorder : autorisés sur les 3 plateformes.
  return true;
}

// Préfixe d'ID de publication par mediaType (cf lib/format-config.
// getPublicationIdPrefix — dupliqué côté serveur, cross-tsconfig). Le champ
// Convex reste `carouselId` (Option B) mais son contenu est désormais
// C### (carousel) / S### (short) / SR### (screenrecorder).
const ID_PREFIX: Record<MediaTypeServer, string> = {
  carousel: "C",
  short: "S",
  screenrecorder: "SR",
};

/**
 * Calcule le prochain carouselId pour un mediaType : max des numéros des
 * publications de ce format (parsés via le préfixe ancré) + 1, padding 3
 * chiffres. Helper pur partagé par getNextPublicationId, getNextCarouselId
 * (alias) et migrateLegacyCarouselIds.
 *
 * Regex ancré : `^S(\d+)$` ne matche PAS "SR001" (R après S) → pas de
 * collision S/SR. Le filtre mediaType garantit qu'on ne compte que les ids
 * du bon format (un Short legacy "C037" non migré est ignoré par le compteur
 * short → d'où l'exigence "migration avant nouveaux créés").
 */
function computeNextPublicationId(
  pubs: { carouselId: string; mediaType?: MediaTypeServer }[],
  mediaType: MediaTypeServer,
): string {
  const prefix = ID_PREFIX[mediaType];
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const p of pubs) {
    if ((p.mediaType ?? "carousel") !== mediaType) continue;
    const m = p.carouselId.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

// ─── Anti-shadowban Shorts — sourceId ────────────────────────────────────────

// Dupliqué de lib/source-id.ts (cross-tsconfig : un module Convex ne peut pas
// importer lib/, cf isFormatAllowedOnPlatform / coerceSnapshotAge). Garder les
// deux implémentations identiques. Règle : trim → strip extension vidéo →
// lowercase.
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".avi"];
function normalizeSourceId(raw: string): string {
  const lower = raw.trim().toLowerCase();
  for (const ext of VIDEO_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return lower.slice(0, lower.length - ext.length);
    }
  }
  return lower;
}

// Format date FR "JJ/MM/AA" inline (cross-tsconfig : pas d'import lib/format).
// Aligné avec lib/format.formatDate pour des messages d'erreur cohérents.
function formatDateFr(ts: number): string {
  return new Date(ts).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

// Statut d'une publication (aligné lib/publication-status isPublished/isLate,
// dupliqué cross-tsconfig). published = postUrl non vide ; late = échéance
// passée sans lien ; draft sinon.
function sourceStatusOf(p: Doc<"publications">): "published" | "draft" | "late" {
  const isPub = typeof p.postUrl === "string" && p.postUrl.length > 0;
  if (isPub) return "published";
  if (p.datePubli < Date.now()) return "late";
  return "draft";
}

/**
 * Récupère les Shorts existants partageant un sourceId normalisé donné.
 * Utilisé par createPublication / updateDraft / duplicateCarousel (validation)
 * et getSourceStatus / listSources (lecture). collect()+filter trivial au
 * volume (pas d'index by_sourceId — décision MVP).
 *
 * `excludeCarouselId` exclut le groupe en cours d'édition (updateDraft) pour
 * ne pas se signaler doublon à soi-même.
 */
async function findExistingSourcePublications(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  normalizedSourceId: string,
  excludeCarouselId?: string,
): Promise<Array<{ publication: Doc<"publications">; normalizedSourceId: string }>> {
  // A3 — unicité (sourceId × plateforme) scopée projet : on ne cherche QUE
  // dans le projet courant.
  const all = await ctx.db
    .query("publications")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const matches: Array<{
    publication: Doc<"publications">;
    normalizedSourceId: string;
  }> = [];
  for (const p of all) {
    if ((p.mediaType ?? "carousel") !== "short") continue;
    if (p.sourceId === undefined || p.sourceId === "") continue;
    if (normalizeSourceId(p.sourceId) !== normalizedSourceId) continue;
    if (excludeCarouselId !== undefined && p.carouselId === excludeCarouselId) {
      continue;
    }
    matches.push({ publication: p, normalizedSourceId });
  }
  return matches;
}

export const createPublication = adminMutation({
  args: {
    carouselId: v.string(),
    hookId: v.union(v.id("hooks"), v.null()),
    hookText: v.string(),
    mecanique: mecaniqueValidator,
    niveau: niveauValidator,
    // Batch 1 Shorts — mediaType optional (default "carousel" pour rétro-compat
    // avec les callers existants qui ne passent pas le champ). Les champs
    // carousel-only (format/nbSlides/slides) deviennent optionnels au niveau
    // args : leur exigence est revalidée dans le handler selon mediaType.
    mediaType: v.optional(mediaTypeValidator),
    format: v.optional(formatValidator),
    nbSlides: v.optional(v.number()),
    slides: v.optional(
      v.array(v.object({ position: v.number(), texte: v.string() })),
    ),
    // Short-only : script continu remplaçant les slides découpées. Réutilisé
    // par ScreenRecorder.
    script: v.optional(v.string()),
    // Batch D — ScreenRecorder uniquement. Validation handler ci-dessous.
    titre: v.optional(v.string()),
    image: v.optional(v.id("_storage")),
    // Refinement ScreenRecorder — recordingDevice + isRepackaging required
    // pour les nouveaux SR (validation handler ci-dessous). Optional côté
    // args pour rester compat avec carousel/short qui ne les passent pas.
    recordingDevice: v.optional(
      v.union(v.literal("phone"), v.literal("desktop")),
    ),
    isRepackaging: v.optional(v.boolean()),
    angleTonal: angleValidator,
    langue: langueValidator,
    // Refinement Shorts — ICP ciblé. Required pour un Short (validation
    // handler ci-dessous). Optional côté args pour rester compat avec
    // carousel/SR qui ne le passent pas.
    icpId: v.optional(v.id("icps")),
    plateformes: v.array(plateformeValidator),
    compte: v.string(),
    datePubli: v.number(),
    notes: v.string(),
    // Anti-shadowban Shorts — sourceId (cross-format au schéma, validé Shorts
    // only). confirmDuplicateOverride débloque un doublon Instagram/YouTube
    // (jamais TikTok — strict bloquant). cf getSourceStatus pour le pré-gate UI.
    sourceId: v.optional(v.string()),
    confirmDuplicateOverride: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const mediaType = args.mediaType ?? "carousel";

    // Validation côté serveur : carousel/short ont chacun leurs champs requis.
    if (mediaType === "carousel") {
      if (
        args.format === undefined ||
        args.nbSlides === undefined ||
        args.slides === undefined
      ) {
        throw new ConvexError(
          "Carrousel : format, nbSlides et slides sont requis.",
        );
      }
    }
    // Short : pas d'exigence stricte sur script (peut être saisi plus tard
    // via updateDraft). L'UI Batch 2 imposera son propre garde-fou.
    //
    // Batch D — ScreenRecorder : titre (3-200 char trim) ET image
    // (storageId non null) sont REQUIS au moment de la création. script
    // reste optional (peut être saisi plus tard, comme un Short).
    if (mediaType === "screenrecorder") {
      const trimmed = (args.titre ?? "").trim();
      if (trimmed.length < 3 || trimmed.length > 200) {
        throw new ConvexError(
          "ScreenRecorder : titre requis (3-200 caractères).",
        );
      }
      if (args.image === undefined || args.image === null) {
        throw new ConvexError("ScreenRecorder : image requise.");
      }
      // Refinement ScreenRecorder — recordingDevice + isRepackaging required.
      // isRepackaging accepte true OU false explicite (le user voit le
      // toggle), mais pas undefined (= pas choisi). recordingDevice : pas
      // de default, force l'utilisateur à choisir explicitement.
      if (args.recordingDevice === undefined) {
        throw new ConvexError(
          "ScreenRecorder : appareil d'enregistrement requis.",
        );
      }
      if (args.isRepackaging === undefined) {
        throw new ConvexError(
          "ScreenRecorder : indique si c'est un repackaging RepackIt.",
        );
      }
    }

    // Refinement Shorts — l'ICP est REQUIS à la création d'un Short. Pour
    // carousel/screenrecorder, icpId est ignoré silencieusement (pas stocké).
    if (mediaType === "short" && args.icpId === undefined) {
      throw new ConvexError("ICP requis pour un Short.");
    }

    // Anti-shadowban Shorts — validation sourceId × plateforme. UNIQUEMENT pour
    // les Shorts avec sourceId fourni (carousel/SR ignorés). TikTok = strict
    // bloquant (toujours) ; Instagram/YouTube = bloquant sauf override confirmé.
    if (mediaType === "short" && args.sourceId !== undefined) {
      const normalized = normalizeSourceId(args.sourceId);
      if (normalized === "") {
        throw new ConvexError("SourceId vide ou invalide.");
      }
      const existing = await findExistingSourcePublications(
        ctx,
        ctx.projectId,
        normalized,
      );
      for (const plateforme of args.plateformes) {
        const onPlatform = existing.filter(
          (e) => e.publication.plateforme === plateforme,
        );
        if (onPlatform.length === 0) continue;
        const e = onPlatform[0].publication;
        if (plateforme === "TikTok") {
          throw new ConvexError(
            `Ce short a déjà été posté sur TikTok (compte ${e.compte} le ${formatDateFr(e.datePubli)}). Risque shadowban.`,
          );
        }
        if (args.confirmDuplicateOverride !== true) {
          throw new ConvexError(
            `Ce short est déjà posté sur ${plateforme} (compte ${e.compte} le ${formatDateFr(e.datePubli)}). Confirmer l'override.`,
          );
        }
      }
    }

    // Couple plateforme/mediaType : carrousel non autorisé sur YouTube.
    for (const plateforme of args.plateformes) {
      if (!isFormatAllowedOnPlatform(mediaType, plateforme)) {
        throw new ConvexError(
          `Format ${mediaType} non autorisé sur ${plateforme}.`,
        );
      }
    }

    const ids = [];
    for (const plateforme of args.plateformes) {
      const id = await ctx.db.insert("publications", {
        projectId: ctx.projectId,
        carouselId: args.carouselId,
        hookId: args.hookId,
        hookText: args.hookText,
        mecanique: args.mecanique,
        niveau: args.niveau,
        // mediaType : on stocke explicitement la valeur résolue (jamais
        // undefined côté DB pour les nouvelles rows). Les rows pré-Batch-1
        // restent undefined et sont coercées via getMediaType().
        mediaType,
        format: args.format,
        nbSlides: args.nbSlides,
        slides: args.slides,
        script: args.script,
        // Batch D — ScreenRecorder uniquement. Pour carousel/short, ces
        // valeurs sont undefined (silencieusement ignorées au insert).
        titre: args.titre,
        image: args.image,
        recordingDevice: args.recordingDevice,
        isRepackaging: args.isRepackaging,
        angleTonal: args.angleTonal,
        langue: args.langue,
        // ICP stocké uniquement pour les Shorts (ignoré pour carousel/SR
        // même si fourni — cf décision "ignoré silencieusement").
        icpId: mediaType === "short" ? args.icpId : undefined,
        plateforme,
        compte: args.compte,
        datePubli: args.datePubli,
        // TD-016 : vuesJ1/J3/J7 retirés du schéma (migrés en metricSnapshots).
        saves: null,
        commentsTotal: null,
        commentsAudit: null,
        profileVisits: null,
        likes: null,
        subsGained: null,
        notes: args.notes,
        // Anti-shadowban — stocké NORMALISÉ (cross-format). Empty → undefined.
        sourceId:
          args.sourceId !== undefined
            ? normalizeSourceId(args.sourceId) || undefined
            : undefined,
      });
      ids.push(id);
    }
    return { ids };
  },
});

/**
 * P8 — matérialise une publication À PARTIR d'un assignment validé. Insert
 * DIRECT (PAS via createPublication, dont les validations par mediaType
 * exigent des champs absents du flux créateur : slides/format pour un
 * carousel, ICP/sourceId pour un short, titre/image pour un SR).
 *
 * Champs éditoriaux absents du flux créateur (mecanique/niveau/angleTonal/
 * hookText/langue) → valeurs par défaut neutres. ARBITRAGE : ces défauts
 * polluent les analytics éditoriales (regroupement par mécanique/niveau) et
 * ne sont pas éditables a posteriori (la pub a un postUrl → updateDraft la
 * refuse). Signalé pour décision produit.
 *
 * internalMutation (jamais exposée à l'API publique) appelée par
 * assignments.validateAssignment via ctx.runMutation (MÊME transaction →
 * atomicité : si la validation échoue ensuite, l'insert est rollback).
 */
export const createFromAssignment = internalMutation({
  args: {
    projectId: v.id("projects"),
    mediaType: mediaTypeValidator,
    plateforme: plateformeValidator,
    compte: v.string(),
    datePubli: v.number(),
    postUrl: v.string(),
    // S3 — combo de script (posts issus d'un assignment de SCRIPT uniquement).
    // undefined pour les assignments de FORMAT → champ absent sur la publication.
    scriptCombo: v.optional(
      v.object({
        campaignId: v.id("scriptCampaigns"),
        hookBrickId: v.id("scriptBricks"),
        // Refonte 3 briques — corpsBrickId LEGACY/optional (cf schema).
        corpsBrickId: v.optional(v.id("scriptBricks")),
        fluxBrickId: v.id("scriptBricks"),
        ctaBrickId: v.id("scriptBricks"),
        comboKey: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Defense-in-depth : carousel interdit YouTube (la garde primaire est à la
    // soumission, cf submitAssignment).
    if (!isFormatAllowedOnPlatform(args.mediaType, args.plateforme)) {
      throw new ConvexError(
        `Format ${args.mediaType} non autorisé sur ${args.plateforme}.`,
      );
    }
    // Compteur d'ID PAR PROJET, identique à getNextPublicationId.
    const all = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const carouselId = computeNextPublicationId(all, args.mediaType);

    const id = await ctx.db.insert("publications", {
      projectId: args.projectId,
      carouselId,
      // Pas de hook éditorial pour un post créateur matérialisé.
      hookId: null,
      hookText: "",
      // Défauts neutres (champs requis non capturés par le flux créateur).
      mecanique: "Question",
      niveau: "Broad-A",
      mediaType: args.mediaType,
      angleTonal: "Observation",
      langue: "FR",
      plateforme: args.plateforme,
      compte: args.compte,
      datePubli: args.datePubli,
      // Métriques vides (alimentées ensuite par les snapshots J+X).
      saves: null,
      commentsTotal: null,
      commentsAudit: null,
      profileVisits: null,
      likes: null,
      subsGained: null,
      notes: "",
      // postUrl non vide → publication "publiée" de plein droit (KPIs, verdicts,
      // snapshots s'appliquent).
      postUrl: args.postUrl,
      // S3 — undefined (format) → champ omis ; objet (script) → join analytics.
      scriptCombo: args.scriptCombo,
    });
    return id;
  },
});

/**
 * Prochain carouselId pour un mediaType donné (compteur distinct par format).
 * mediaType optional → default "carousel" (backward compat pour un caller
 * oublié qui n'enverrait pas l'arg). Préfixe automatique C### / S### / SR###.
 */
export const getNextPublicationId = adminQuery({
  args: { mediaType: v.optional(mediaTypeValidator) },
  handler: async (ctx, args) => {
    // A2 — compteur PAR PROJET : on ne compte que les publications du projet.
    const all = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return computeNextPublicationId(all, args.mediaType ?? "carousel");
  },
});

/**
 * Backward-compat : ancien nom de getNextPublicationId, conservé pour ne pas
 * casser les callers carousel existants (route legacy app/nouveau encore
 * présente sur disque + specs e2e). Délègue au compteur carousel. Le nouveau
 * code (NouveauModal) utilise getNextPublicationId({ mediaType }).
 */
export const getNextCarouselId = adminQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return computeNextPublicationId(all, "carousel");
  },
});

/**
 * Batch D — listPublications enrichit chaque row avec `imageUrl` (résolu
 * depuis le storageId via ctx.storage.getUrl). N+1 acceptable au volume
 * actuel ; à 100+ ScreenRecorders, optimiser via batched query (TD-011).
 *
 * Pour les rows sans image (carousel/short ou ScreenRecorder dont l'image
 * a été supprimée du storage), imageUrl = null. Le client ne doit JAMAIS
 * s'appuyer sur p.image directement pour afficher une URL — toujours
 * passer par imageUrl exposé par cette query.
 */
export const listPublications = adminQuery({
  args: {
    // Refactor multi-snapshots — période d'âge sélectionnée globalement (UI).
    // Optional → "latest" (cf coerceSnapshotAge). customDay pour age="custom".
    snapshotAge: v.optional(v.string()),
    customDay: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const age = coerceSnapshotAge(args.snapshotAge);
    const rows = await ctx.db
      .query("publications")
      .withIndex("by_project_datePubli", (q) =>
        q.eq("projectId", ctx.projectId),
      )
      .order("desc")
      .collect();

    // Enrichissement ICP (scopé projet).
    const icps = await ctx.db
      .query("icps")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const icpMap = new Map(icps.map((i) => [i._id, i]));

    // Tous les snapshots DU PROJET, groupés en mémoire (évite un N+1).
    const allSnaps = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const snapsByPub = groupSnapshotsByPublication(allSnaps);

    return await Promise.all(
      rows.map(async (p) => {
        const imageUrl =
          p.image !== undefined && p.image !== null
            ? await ctx.storage.getUrl(p.image)
            : null;
        const icpDoc = p.icpId ? icpMap.get(p.icpId) : null;
        const icp = icpDoc
          ? { nom: icpDoc.nom, color: icpDoc.color ?? null }
          : null;
        const displayMetrics = buildDisplayMetrics(
          snapsByPub.get(p._id) ?? [],
          age,
          args.customDay,
        );
        return { ...p, imageUrl, icp, displayMetrics };
      }),
    );
  },
});

/**
 * Batch B — résout un carouselId vers son mediaType pour permettre au
 * catch-all /p/[carouselId] de rediriger vers la bonne page format.
 *
 * Retourne la PREMIÈRE row (n'importe laquelle) pour ce carouselId : toutes
 * les rows partagent le même mediaType par construction (cf updateDraft +
 * duplicateCarousel qui propagent source.mediaType).
 *
 * Coercion mediaType : alignée avec lib/media-type.getMediaType côté client
 * (rows pré-Batch-1-Shorts → "carousel"). Dupliquée car cross-tsconfig.
 */
export const getByCarouselId = adminQuery({
  args: {
    carouselId: v.string(),
    snapshotAge: v.optional(v.string()),
    customDay: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // A2 — résolution (projectId, carouselId) : carouselId n'est plus unique
    // globalement.
    const row = await ctx.db
      .query("publications")
      .withIndex("by_project_carouselId", (q) =>
        q.eq("projectId", ctx.projectId).eq("carouselId", args.carouselId),
      )
      .first();
    if (!row) return null;
    const age = coerceSnapshotAge(args.snapshotAge);
    const snaps = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_publication_and_capturedAt", (q) =>
        q.eq("publicationId", row._id),
      )
      .order("desc")
      .collect();
    return {
      _id: row._id,
      carouselId: row.carouselId,
      mediaType: (row.mediaType ?? "carousel") as MediaTypeServer,
      displayMetrics: buildDisplayMetrics(snaps, age, args.customDay),
    };
  },
});

/**
 * P3 — resolver deeplink legacy `/p/[carouselId]` HORS contexte projet. Cherche
 * le carouselId dans TOUS les projets (index global by_carouselId) puis retient
 * le premier match ACCESSIBLE à l'utilisateur (superadmin → tous ; sinon →
 * membership). Retourne le slug du projet + mediaType pour rediriger vers la
 * route scopée, ou null (→ 404 propre côté UI). Non scopé projet : authedQuery.
 */
export const resolveCarouselForUser = authedQuery({
  args: { carouselId: v.string() },
  handler: async (ctx, { carouselId }) => {
    const matches = await ctx.db
      .query("publications")
      .withIndex("by_carouselId", (q) => q.eq("carouselId", carouselId))
      .collect();
    if (matches.length === 0) return null;
    const user = await ctx.db.get(ctx.userId);
    const isSuperadmin = user?.role === "superadmin";
    for (const pub of matches) {
      let allowed = isSuperadmin;
      if (!allowed) {
        const membership = await ctx.db
          .query("memberships")
          .withIndex("by_user_project", (q) =>
            q.eq("userId", ctx.userId).eq("projectId", pub.projectId),
          )
          .first();
        allowed = membership !== null;
      }
      if (!allowed) continue;
      const project = await ctx.db.get(pub.projectId);
      if (project === null) continue;
      return {
        projectSlug: project.slug,
        mediaType: (pub.mediaType ?? "carousel") as MediaTypeServer,
      };
    }
    return null;
  },
});

export const updateMetrics = adminMutation({
  args: {
    id: v.id("publications"),
    // TD-016 : vuesJ1/J3/J7 retirés (le front saisit via les snapshots).
    saves: v.optional(v.union(v.number(), v.null())),
    commentsTotal: v.optional(v.union(v.number(), v.null())),
    commentsAudit: v.optional(v.union(v.number(), v.null())),
    profileVisits: v.optional(v.union(v.number(), v.null())),
    // Batch 1 Shorts — métriques short-only, nullable comme les autres.
    // L'UI carrousel ne les saisit pas (les laisse undefined → ne patch pas).
    likes: v.optional(v.union(v.number(), v.null())),
    subsGained: v.optional(v.union(v.number(), v.null())),
    notes: v.optional(v.string()),
    // Refinement Shorts — édition de l'ICP d'un Short publié via le dialog
    // métriques (le seul point d'édition d'un publié — updateDraft refuse
    // les rows publiées). Patch single-row, cohérent avec la granularité de
    // ce dialog. null = désassigner, Id = assigner, absent = ne pas toucher.
    icpId: v.optional(v.union(v.id("icps"), v.null())),
    // postUrl est volontairement intégré ici plutôt que dans une mutation
    // dédiée setPublishedUrl : l'utilisateur saisit le lien dans le même
    // dialog que les métriques (PublicationEditDialog), donc 1 seul appel
    // mutation au save. Passer "" remet la publication en "à venir".
    postUrl: v.optional(v.string()),
    // Anti-shadowban — édition rétroactive du sourceId d'un Short PUBLIÉ
    // (backfill S007/S008). Stocké normalisé. "" = unset. Pas de validation
    // triple-chemin ici : la row est déjà postée (historique), le but est
    // juste de la rattacher à sa source pour la matrice /shorts/sources.
    sourceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, icpId, sourceId, ...rest } = args;
    const existing = await ctx.db.get(id);
    if (!existing || existing.projectId !== ctx.projectId) {
      throw new Error("Publication not found");
    }

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) update[key] = value;
    }
    if (icpId !== undefined) {
      update.icpId = icpId === null ? undefined : icpId;
    }
    if (sourceId !== undefined) {
      update.sourceId = normalizeSourceId(sourceId) || undefined;
    }

    await ctx.db.patch(id, update);
    return { ok: true };
  },
});

/**
 * Modification du compte d'une publication PUBLIÉE, autorisée UNE SEULE fois
 * (friction observée : erreur de saisie du compte ~1/15 au moment du post).
 *
 * Garde-fous serveur :
 *   - publication doit être publiée (postUrl non vide) — sinon le compte est
 *     librement éditable via le DraftEditView.
 *   - accountModified !== true (modification unique et définitive).
 *   - le nouveau compte doit exister sur la MÊME plateforme que la pub.
 *
 * Patch single-row (chaque row = 1 plateforme a son propre compte). Pas de
 * updatedAt sur publications → non patché. Pattern cohérent avec updateMetrics.
 */
export const updatePublishedAccount = adminMutation({
  args: { id: v.id("publications"), newCompte: v.string() },
  handler: async (ctx, args) => {
    const pub = await ctx.db.get(args.id);
    if (!pub || pub.projectId !== ctx.projectId) {
      throw new ConvexError("Publication introuvable.");
    }

    const isPub = typeof pub.postUrl === "string" && pub.postUrl.length > 0;
    if (!isPub) {
      throw new ConvexError(
        "Modification du compte uniquement possible après publication.",
      );
    }
    if (pub.accountModified === true) {
      throw new ConvexError("Le compte ne peut être modifié qu'une seule fois.");
    }

    const comptes = await ctx.db
      .query("comptes")
      .withIndex("by_project_plateforme", (q) =>
        q.eq("projectId", ctx.projectId).eq("plateforme", pub.plateforme),
      )
      .collect();
    const match = comptes.find((c) => c.handle === args.newCompte);
    if (!match) {
      throw new ConvexError(
        `Le compte ${args.newCompte} n'existe pas sur ${pub.plateforme}.`,
      );
    }

    await ctx.db.patch(args.id, {
      compte: args.newCompte,
      accountModified: true,
    });
    return { ok: true };
  },
});

export const deletePublication = adminMutation({
  args: { id: v.id("publications") },
  handler: async (ctx, args) => {
    const pub = await ctx.db.get(args.id);
    if (!pub || pub.projectId !== ctx.projectId) return { ok: true };
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

/**
 * Modif 2 — Duplique un carrousel existant en draft.
 *
 * Crée une nouvelle row (1 mutation = 1 carouselId = 1 row pour la plateforme
 * cible). Pour dupliquer sur 2 plateformes, le user appelle 2 fois.
 *
 * Logique parentCarouselId : pointe TOUJOURS vers le parent ORIGINAL pour que
 * tous les duplicats d'une même lignée partagent un seul point d'ancrage.
 *   - source originale (parentCarouselId === undefined) → parentAncre = source.carouselId
 *   - source déjà duplicat (parentCarouselId défini)    → parentAncre = source.parentCarouselId
 *
 * Pas de garde isPublished : dupliquer une publication qui a marché pour la
 * rejouer ailleurs est un cas d'usage attendu (décision tranchée 3-bis).
 *
 * Race condition sur nextCarouselId : héritée de getNextCarouselId (TD-004),
 * pas adressée ici.
 */
export const duplicateCarousel = adminMutation({
  args: {
    sourceCarouselId: v.string(),
    targetCompte: v.string(),
    targetPlateforme: plateformeValidator,
    // Anti-shadowban Shorts — sourceId du duplicat. undefined → hérite du
    // sourceId source. Validé × targetPlateforme si Short. override = IG/YT.
    newSourceId: v.optional(v.string()),
    confirmDuplicateOverride: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const sourceRows = await ctx.db
      .query("publications")
      .withIndex("by_project_carouselId", (q) =>
        q
          .eq("projectId", ctx.projectId)
          .eq("carouselId", args.sourceCarouselId),
      )
      .collect();

    if (sourceRows.length === 0) {
      throw new ConvexError("Carrousel source introuvable.");
    }
    // N'importe quelle row : tous les champs hors plateforme/compte sont
    // identiques entre les rows d'un même carouselId (cf updateDraft).
    const source = sourceRows[0];

    // Batch 1 Shorts — propage explicitement le mediaType source. Les rows
    // pré-Shorts ont mediaType undefined → coerce en "carousel" (cohérent
    // avec getMediaType côté client). La cohérence format/plateforme cible
    // est validée juste après.
    // Batch D — supporte aussi "screenrecorder" (le union étendu).
    const sourceMediaType: MediaTypeServer = source.mediaType ?? "carousel";

    if (!isFormatAllowedOnPlatform(sourceMediaType, args.targetPlateforme)) {
      throw new ConvexError(
        `Format ${sourceMediaType} non autorisé sur ${args.targetPlateforme}.`,
      );
    }

    // Validation cross-table compte/plateforme (scopée projet).
    const allComptes = await ctx.db
      .query("comptes")
      .withIndex("by_project_plateforme", (q) =>
        q
          .eq("projectId", ctx.projectId)
          .eq("plateforme", args.targetPlateforme),
      )
      .collect();
    const matchingCompte = allComptes.find(
      (c) => c.handle === args.targetCompte,
    );
    if (!matchingCompte) {
      throw new ConvexError(
        "Le compte sélectionné n'est pas sur cette plateforme.",
      );
    }

    const parentAncre =
      source.parentCarouselId === undefined
        ? source.carouselId
        : source.parentCarouselId;

    // Anti-shadowban Shorts — sourceId du duplicat : override explicite sinon
    // hérité de la source. Validation × targetPlateforme (le duplicat est une
    // nouvelle row → pas d'exclude). TikTok strict bloquant / IG-YT override.
    const sourceIdToUse = args.newSourceId ?? source.sourceId;
    if (sourceMediaType === "short" && sourceIdToUse !== undefined) {
      const normalized = normalizeSourceId(sourceIdToUse);
      if (normalized !== "") {
        const existing = await findExistingSourcePublications(
          ctx,
          ctx.projectId,
          normalized,
        );
        const onPlatform = existing.filter(
          (e) => e.publication.plateforme === args.targetPlateforme,
        );
        if (onPlatform.length > 0) {
          const e = onPlatform[0].publication;
          if (args.targetPlateforme === "TikTok") {
            throw new ConvexError(
              `Ce short a déjà été posté sur TikTok (compte ${e.compte} le ${formatDateFr(e.datePubli)}). Risque shadowban.`,
            );
          }
          if (args.confirmDuplicateOverride !== true) {
            throw new ConvexError(
              `Ce short est déjà posté sur ${args.targetPlateforme} (compte ${e.compte} le ${formatDateFr(e.datePubli)}). Confirmer l'override.`,
            );
          }
        }
      }
    }

    // 🔴 Bug fix ID-prefix : le préfixe d'ID doit suivre le mediaType source
    // (S### pour un Short, SR### pour un SR), pas un "C" hardcodé. On réutilise
    // computeNextPublicationId (déjà ancré par préfixe + filtré par mediaType),
    // identique à getNextPublicationId. TD-004 (race condition) inchangé.
    const all = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const nextCarouselId = computeNextPublicationId(all, sourceMediaType);

    await ctx.db.insert("publications", {
      projectId: ctx.projectId,
      carouselId: nextCarouselId,
      hookId: source.hookId,
      hookText: source.hookText,
      mecanique: source.mecanique,
      niveau: source.niveau,
      // Propagation explicite mediaType + champs format-spécifiques.
      // Carousel → format/nbSlides/slides ; Short → script. Les champs non
      // pertinents au format restent undefined (omis du spread).
      mediaType: sourceMediaType,
      format: source.format,
      nbSlides: source.nbSlides,
      slides: source.slides,
      script: source.script,
      // Batch D — ScreenRecorder uniquement. Décision tranchée : on PARTAGE
      // le storageId (économique, simple). Les 2 publications référencent
      // le même blob. Conséquence documentée : supprimer l'image d'une pub
      // orphelinerait le partage côté Convex storage. Pas de cascade
      // implémentée dans deletePublication (TD-011).
      titre: source.titre,
      image: source.image,
      // Refinement SR — propagation des nouveaux champs SR vers le duplicat.
      // Cohérent avec décision : la duplication conserve le mediaType source
      // et ses champs spécifiques.
      recordingDevice: source.recordingDevice,
      isRepackaging: source.isRepackaging,
      angleTonal: source.angleTonal,
      langue: source.langue,
      // Refinement Shorts — propage l'ICP source au duplicat (un duplicat de
      // Short conserve son ICP ; undefined pour carousel/SR).
      icpId: source.icpId,
      plateforme: args.targetPlateforme,
      compte: args.targetCompte,
      datePubli: Date.now(),
      // TD-016 : vuesJ1/J3/J7 retirés du schéma.
      saves: null,
      commentsTotal: null,
      commentsAudit: null,
      profileVisits: null,
      // Métriques Shorts également remises à null (pas d'héritage des chiffres
      // source — un duplicat est un nouveau test).
      likes: null,
      subsGained: null,
      notes: "",
      // postUrl undefined → draft (cf isPublished). Volontairement omis.
      parentCarouselId: parentAncre,
      // Anti-shadowban — propage le sourceId (override ou hérité), normalisé.
      sourceId:
        sourceIdToUse !== undefined
          ? normalizeSourceId(sourceIdToUse) || undefined
          : undefined,
    });

    return { carouselId: nextCarouselId };
  },
});

/**
 * Édition d'un brouillon au niveau CARROUSEL : patch toutes les rows
 * partageant le même carouselId. Refuse l'opération si AU MOINS UNE row a
 * postUrl renseigné (= déjà publiée) — on n'autorise pas la réécriture
 * partielle d'un carrousel à moitié publié.
 *
 * Note multi-plateformes : tous les champs du patch (slides, datePubli,
 * compte, plateforme) sont appliqués uniformément à toutes les rows. Si
 * le carrousel a 2 rows (TikTok + IG) et que l'utilisateur change
 * plateforme→TikTok, les 2 rows deviennent TikTok (data redundant mais
 * cohérent avec « édition au niveau carrousel »). Le UI ouvre le dialog
 * depuis une row spécifique mais propage à tout le carrousel.
 */
export const updateDraft = adminMutation({
  args: {
    carouselId: v.string(),
    patch: v.object({
      slides: v.optional(
        v.array(v.object({ position: v.number(), texte: v.string() })),
      ),
      // Batch 1 Shorts — script éditable au niveau carrousel pour les Shorts.
      // Les Carrousels n'utilisent pas ce champ ; l'UI Batch 2 affichera l'un
      // ou l'autre selon mediaType. Réutilisé par ScreenRecorder (Batch D).
      script: v.optional(v.string()),
      // Batch D — ScreenRecorder uniquement. Le DraftEditView du dialog
      // détail expose Input titre + ImageUploader. titre vide = "" pour
      // distinguer absent (undefined côté DB) vs reset explicite.
      titre: v.optional(v.string()),
      // Note : v.union pour permettre setter à null = retirer l'image.
      // L'UI passera null sur "Supprimer", undefined sur "non touché".
      image: v.optional(v.union(v.id("_storage"), v.null())),
      // Refinement SR — recordingDevice + isRepackaging éditables au niveau
      // draft. Pas de validation stricte ici (l'utilisateur peut rester
      // temporairement undefined ; la validation stricte est au create).
      recordingDevice: v.optional(
        v.union(v.literal("phone"), v.literal("desktop")),
      ),
      isRepackaging: v.optional(v.boolean()),
      // Refinement Shorts — ICP éditable au niveau draft (édition progressive
      // des Shorts pré-existants). null = désassigner, Id = assigner, absent =
      // ne pas toucher. Pas de validation required ici (uniquement au create).
      icpId: v.optional(v.union(v.id("icps"), v.null())),
      datePubli: v.optional(v.number()),
      compte: v.optional(v.string()),
      plateforme: v.optional(plateformeValidator),
    }),
    // Anti-shadowban Shorts — sourceId éditable a posteriori (top-level, hors
    // patch car couplé à confirmDuplicateOverride). undefined = ne pas toucher ;
    // null = désassigner (unset) ; string = (re)définir + valider si Short.
    sourceId: v.optional(v.union(v.string(), v.null())),
    confirmDuplicateOverride: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("publications")
      .withIndex("by_project_carouselId", (q) =>
        q.eq("projectId", ctx.projectId).eq("carouselId", args.carouselId),
      )
      .collect();

    if (rows.length === 0) {
      throw new Error(`Carrousel ${args.carouselId} introuvable.`);
    }

    for (const r of rows) {
      const isPub = typeof r.postUrl === "string" && r.postUrl.length > 0;
      if (isPub) {
        throw new ConvexError(
          "Carrousel partiellement publié, édition impossible. Vide d'abord les liens de publication ou supprime les rows publiées.",
        );
      }
    }

    // Validation cross-table : si la plateforme cible change, le compte (s'il
    // est aussi patché) doit exister sur cette plateforme côté table comptes.
    if (args.patch.plateforme && args.patch.compte) {
      const allComptes = await ctx.db
        .query("comptes")
        .withIndex("by_project_plateforme", (q) =>
          q
            .eq("projectId", ctx.projectId)
            .eq("plateforme", args.patch.plateforme!),
        )
        .collect();
      const matching = allComptes.find(
        (c) => c.handle === args.patch.compte,
      );
      if (!matching) {
        throw new Error(
          `Le compte ${args.patch.compte} n'existe pas sur ${args.patch.plateforme}.`,
        );
      }
    }

    // Si la plateforme cible change, vérifier la cohérence avec le mediaType
    // de la row (toutes les rows partagent le même mediaType — cf modèle
    // 1 carouselId = N rows). Carrousel → YouTube est rejeté ici.
    if (args.patch.plateforme !== undefined) {
      const rowMediaType: MediaTypeServer = rows[0].mediaType ?? "carousel";
      if (!isFormatAllowedOnPlatform(rowMediaType, args.patch.plateforme)) {
        throw new ConvexError(
          `Format ${rowMediaType} non autorisé sur ${args.patch.plateforme}.`,
        );
      }
    }

    const update: Record<string, unknown> = {};
    if (args.patch.slides !== undefined) {
      update.slides = args.patch.slides;
      // nbSlides est dérivé : on le synchronise systématiquement avec
      // slides.length pour qu'aucun appelant n'oublie. No-op pour les
      // Shorts (l'UI ne pousse pas slides pour un Short).
      update.nbSlides = args.patch.slides.length;
    }
    if (args.patch.script !== undefined) update.script = args.patch.script;
    if (args.patch.titre !== undefined) update.titre = args.patch.titre;
    if (args.patch.image !== undefined) update.image = args.patch.image;
    if (args.patch.recordingDevice !== undefined) {
      update.recordingDevice = args.patch.recordingDevice;
    }
    if (args.patch.isRepackaging !== undefined) {
      update.isRepackaging = args.patch.isRepackaging;
    }
    if (args.patch.icpId !== undefined) {
      update.icpId = args.patch.icpId === null ? undefined : args.patch.icpId;
    }
    if (args.patch.datePubli !== undefined) update.datePubli = args.patch.datePubli;
    if (args.patch.compte !== undefined) update.compte = args.patch.compte;
    if (args.patch.plateforme !== undefined) update.plateforme = args.patch.plateforme;

    // Anti-shadowban Shorts — édition du sourceId (a posteriori, ex: backfill
    // S007/S008). null = unset ; string = (re)définir. Validation × plateforme
    // courante uniquement pour les Shorts, en excluant le groupe lui-même.
    if (args.sourceId !== undefined) {
      if (args.sourceId === null) {
        update.sourceId = undefined;
      } else {
        const rowMediaType = rows[0].mediaType ?? "carousel";
        const normalized = normalizeSourceId(args.sourceId);
        if (rowMediaType === "short") {
          if (normalized === "") {
            throw new ConvexError("SourceId vide ou invalide.");
          }
          const existing = await findExistingSourcePublications(
            ctx,
            ctx.projectId,
            normalized,
            args.carouselId,
          );
          for (const r of rows) {
            const onPlatform = existing.filter(
              (e) => e.publication.plateforme === r.plateforme,
            );
            if (onPlatform.length === 0) continue;
            const e = onPlatform[0].publication;
            if (r.plateforme === "TikTok") {
              throw new ConvexError(
                `Ce short a déjà été posté sur TikTok (compte ${e.compte} le ${formatDateFr(e.datePubli)}). Risque shadowban.`,
              );
            }
            if (args.confirmDuplicateOverride !== true) {
              throw new ConvexError(
                `Ce short est déjà posté sur ${r.plateforme} (compte ${e.compte} le ${formatDateFr(e.datePubli)}). Confirmer l'override.`,
              );
            }
          }
        }
        update.sourceId = normalized || undefined;
      }
    }

    for (const r of rows) {
      await ctx.db.patch(r._id, update);
    }

    return { ok: true, rowsPatched: rows.length };
  },
});

// NB (P2) : migrateLegacyCarouselIds (renumérotation one-shot des préfixes
// d'ID par mediaType) a été SUPPRIMÉE — elle a déjà tourné en prod, et sa
// logique de numérotation GLOBALE est incompatible avec le compteur PAR PROJET
// (A2). Toute renumérotation future devra être scopée projet.

/**
 * Anti-shadowban Shorts — bibliothèque des sources (/shorts/sources) du projet.
 * 1 entrée par sourceId normalisé distinct, avec la matrice de couverture par
 * plateforme. Shorts only, scopé projet (by_project).
 */
export const listSources = adminQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const shorts = all.filter(
      (p) =>
        (p.mediaType ?? "carousel") === "short" &&
        p.sourceId !== undefined &&
        p.sourceId !== "",
    );
    const groups = new Map<
      string,
      {
        displaySourceId: string;
        latestAt: number;
        pubs: Doc<"publications">[];
      }
    >();
    for (const p of shorts) {
      if (p.sourceId === undefined) continue;
      const norm = normalizeSourceId(p.sourceId);
      if (norm === "") continue;
      const g = groups.get(norm);
      if (g) {
        g.pubs.push(p);
        if (p._creationTime > g.latestAt) {
          g.latestAt = p._creationTime;
          g.displaySourceId = p.sourceId;
        }
      } else {
        groups.set(norm, {
          displaySourceId: p.sourceId,
          latestAt: p._creationTime,
          pubs: [p],
        });
      }
    }
    const result = Array.from(groups.entries()).map(([sourceId, g]) => {
      const publications = g.pubs.map((p) => ({
        publicationId: p._id,
        carouselId: p.carouselId,
        plateforme: p.plateforme,
        compte: p.compte,
        datePubli: p.datePubli,
        status: sourceStatusOf(p),
      }));
      const tiktok = publications.some((x) => x.plateforme === "TikTok");
      const instagram = publications.some((x) => x.plateforme === "Instagram");
      const youtube = publications.some((x) => x.plateforme === "YouTube");
      return {
        sourceId,
        displaySourceId: g.displaySourceId,
        publications,
        coverage: {
          tiktok,
          instagram,
          youtube,
          total: [tiktok, instagram, youtube].filter(Boolean).length,
        },
      };
    });
    result.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    return result;
  },
});

/**
 * Anti-shadowban Shorts — statut d'un sourceId pour le pré-gate UI (modal
 * étape Hook + Publication). Retourne les plateformes bloquées (TikTok déjà
 * posté), à confirmer (IG/YT déjà posté, override possible) et disponibles.
 * Source unique de vérité de l'UX ; la validation mutation reste le filet
 * defense-in-depth. sourceId vide/inédit → exists=false, tout disponible.
 */
export const getSourceStatus = adminQuery({
  args: { sourceId: v.string() },
  handler: async (ctx, args) => {
    const normalized = normalizeSourceId(args.sourceId);
    const existing = await findExistingSourcePublications(
      ctx,
      ctx.projectId,
      normalized,
    );
    const publications = existing.map((e) => ({
      plateforme: e.publication.plateforme,
      compte: e.publication.compte,
      datePubli: e.publication.datePubli,
      status: sourceStatusOf(e.publication),
      carouselId: e.publication.carouselId,
    }));
    const onTikTok = publications.some((x) => x.plateforme === "TikTok");
    const onInstagram = publications.some((x) => x.plateforme === "Instagram");
    const onYouTube = publications.some((x) => x.plateforme === "YouTube");
    const blockedPlatforms: string[] = onTikTok ? ["TikTok"] : [];
    const warningPlatforms: string[] = [
      ...(onInstagram ? ["Instagram"] : []),
      ...(onYouTube ? ["YouTube"] : []),
    ];
    const availablePlatforms: string[] = [
      ...(onTikTok ? [] : ["TikTok"]),
      ...(onInstagram ? [] : ["Instagram"]),
      ...(onYouTube ? [] : ["YouTube"]),
    ];
    return {
      exists: publications.length > 0,
      publications,
      blockedPlatforms,
      warningPlatforms,
      availablePlatforms,
    };
  },
});

/**
 * Anti-shadowban Shorts — renomme un sourceId EN CASCADE (toutes les Shorts qui
 * le partagent, depuis /shorts/sources). Différent du create/update : toute
 * collision plateforme bloque (PAS d'override possible), car un rename qui
 * fusionnerait deux sources sur une même plateforme produirait un état
 * incohérent (2 Shorts du même fichier source sur la même plateforme = le
 * risque shadowban qu'on combat). Shorts uniquement, normalisation systématique.
 */
export const renameSourceId = adminMutation({
  args: { oldSourceId: v.string(), newSourceId: v.string() },
  handler: async (ctx, args) => {
    const normalizedOld = normalizeSourceId(args.oldSourceId);
    const normalizedNew = normalizeSourceId(args.newSourceId);
    if (normalizedOld === "") {
      throw new ConvexError("Ancien sourceId vide ou invalide.");
    }
    if (normalizedNew === "") {
      throw new ConvexError("Nouveau sourceId vide ou invalide.");
    }
    if (normalizedOld === normalizedNew) {
      return {
        renamed: 0,
        oldSourceId: normalizedOld,
        newSourceId: normalizedNew,
        message: "No-op (même valeur)",
      };
    }

    // Cascade scopée projet (A3).
    const all = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const isShort = (p: Doc<"publications">) =>
      (p.mediaType ?? "carousel") === "short";

    const publicationsOld = all.filter(
      (p) => isShort(p) && normalizeSourceId(p.sourceId ?? "") === normalizedOld,
    );
    if (publicationsOld.length === 0) {
      throw new ConvexError("Aucune publication trouvée avec ce sourceId.");
    }

    // Exclut les rows déjà sur l'ancien sourceId (on ne se compare pas à
    // soi-même). Reste les rows qui portent DÉJÀ le nouveau sourceId ailleurs.
    const oldCarouselIds = new Set(publicationsOld.map((p) => p.carouselId));
    const publicationsNew = all.filter(
      (p) =>
        isShort(p) &&
        normalizeSourceId(p.sourceId ?? "") === normalizedNew &&
        !oldCarouselIds.has(p.carouselId),
    );

    // Validation collision : si une row à renommer partage une plateforme avec
    // une row portant déjà le nouveau sourceId → bloquant (aucun override).
    for (const pub of publicationsOld) {
      const onPlatform = publicationsNew.filter(
        (e) => e.plateforme === pub.plateforme,
      );
      if (onPlatform.length > 0) {
        const collision = onPlatform[0];
        throw new ConvexError(
          `Renommage impossible : ${normalizedNew} est déjà utilisé sur ${pub.plateforme} (compte ${collision.compte} le ${formatDateFr(collision.datePubli)}). Risque de conflit.`,
        );
      }
    }

    // Patch en cascade (sourceId stocké normalisé, cohérent avec les écritures).
    for (const pub of publicationsOld) {
      await ctx.db.patch(pub._id, { sourceId: normalizedNew });
    }

    return {
      renamed: publicationsOld.length,
      oldSourceId: normalizedOld,
      newSourceId: normalizedNew,
    };
  },
});

/**
 * Remédiation sécurité — cleanup e2e server-side. Porte la boucle historique
 * de e2e/helpers/cleanup.ts (listPublications anonyme + deletePublication row
 * par row) côté serveur : le global-setup Playwright tourne AVANT toute
 * session (fenêtre bootstrap pas forcément franchie), il ne peut donc pas
 * appeler les fonctions authed*. Gated E2E_SECRET (cf functions.ts).
 */
export const cleanupTestPublications = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("publications").collect();
    let deleted = 0;
    for (const p of all) {
      if (p.notes.startsWith("[E2E_TEST]")) {
        await ctx.db.delete(p._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

/**
 * Outillage dev (scripts/wipe-publications.ts) — vide TOUTES les publications
 * ET leurs snapshots (l'ancien script laissait les snapshots orphelins).
 * Inutilisable en prod par design : E2E_SECRET n'y est jamais défini.
 */
export const wipeAllPublications = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const snaps = await ctx.db.query("metricSnapshots").collect();
    for (const s of snaps) {
      await ctx.db.delete(s._id);
    }
    const pubs = await ctx.db.query("publications").collect();
    for (const p of pubs) {
      await ctx.db.delete(p._id);
    }
    return {
      deletedPublications: pubs.length,
      deletedSnapshots: snaps.length,
    };
  },
});
