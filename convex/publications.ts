import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

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
);

// Defense in depth — dupliqué côté serveur (Convex) car on ne peut pas
// importer lib/media-type.ts depuis un module Convex (tsconfig séparé).
// Logique alignée avec ALLOWED_PLATFORMS_FOR_CAROUSEL/SHORT côté client.
function isFormatAllowedOnPlatform(
  mediaType: "carousel" | "short",
  plateforme: "TikTok" | "Instagram" | "YouTube",
): boolean {
  if (mediaType === "carousel") {
    return plateforme === "TikTok" || plateforme === "Instagram";
  }
  return true; // Shorts autorisés sur les 3 plateformes
}

export const createPublication = mutation({
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
    // Short-only : script continu remplaçant les slides découpées.
    script: v.optional(v.string()),
    angleTonal: angleValidator,
    langue: langueValidator,
    plateformes: v.array(plateformeValidator),
    compte: v.string(),
    datePubli: v.number(),
    notes: v.string(),
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
        angleTonal: args.angleTonal,
        langue: args.langue,
        plateforme,
        compte: args.compte,
        datePubli: args.datePubli,
        vuesJ1: null,
        vuesJ3: null,
        vuesJ7: null,
        saves: null,
        commentsTotal: null,
        commentsAudit: null,
        profileVisits: null,
        likes: null,
        subsGained: null,
        notes: args.notes,
      });
      ids.push(id);
    }
    return { ids };
  },
});

export const getNextCarouselId = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("publications").collect();
    if (all.length === 0) return "C001";

    const numbers = all
      .map((p) => p.carouselId)
      .map((id) => parseInt(id.replace(/^C/, ""), 10))
      .filter((n) => !isNaN(n));

    const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
    return `C${String(maxNumber + 1).padStart(3, "0")}`;
  },
});

export const listPublications = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("publications")
      .withIndex("by_datePubli")
      .order("desc")
      .collect();
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
export const getByCarouselId = query({
  args: { carouselId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("publications")
      .withIndex("by_carouselId", (q) => q.eq("carouselId", args.carouselId))
      .first();
    if (!row) return null;
    return {
      _id: row._id,
      carouselId: row.carouselId,
      mediaType: (row.mediaType ?? "carousel") as "carousel" | "short",
    };
  },
});

export const updateMetrics = mutation({
  args: {
    id: v.id("publications"),
    vuesJ1: v.optional(v.union(v.number(), v.null())),
    vuesJ3: v.optional(v.union(v.number(), v.null())),
    vuesJ7: v.optional(v.union(v.number(), v.null())),
    saves: v.optional(v.union(v.number(), v.null())),
    commentsTotal: v.optional(v.union(v.number(), v.null())),
    commentsAudit: v.optional(v.union(v.number(), v.null())),
    profileVisits: v.optional(v.union(v.number(), v.null())),
    // Batch 1 Shorts — métriques short-only, nullable comme les autres.
    // L'UI carrousel ne les saisit pas (les laisse undefined → ne patch pas).
    likes: v.optional(v.union(v.number(), v.null())),
    subsGained: v.optional(v.union(v.number(), v.null())),
    notes: v.optional(v.string()),
    // postUrl est volontairement intégré ici plutôt que dans une mutation
    // dédiée setPublishedUrl : l'utilisateur saisit le lien dans le même
    // dialog que les métriques (PublicationEditDialog), donc 1 seul appel
    // mutation au save. Passer "" remet la publication en "à venir".
    postUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Publication not found");

    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) update[key] = value;
    }

    await ctx.db.patch(id, update);
    return { ok: true };
  },
});

export const deletePublication = mutation({
  args: { id: v.id("publications") },
  handler: async (ctx, args) => {
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
export const duplicateCarousel = mutation({
  args: {
    sourceCarouselId: v.string(),
    targetCompte: v.string(),
    targetPlateforme: plateformeValidator,
  },
  handler: async (ctx, args) => {
    const sourceRows = await ctx.db
      .query("publications")
      .withIndex("by_carouselId", (q) =>
        q.eq("carouselId", args.sourceCarouselId),
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
    const sourceMediaType: "carousel" | "short" =
      source.mediaType ?? "carousel";

    if (!isFormatAllowedOnPlatform(sourceMediaType, args.targetPlateforme)) {
      throw new ConvexError(
        `Format ${sourceMediaType} non autorisé sur ${args.targetPlateforme}.`,
      );
    }

    // Validation cross-table compte/plateforme : refuse un compte qui n'existe
    // pas sur la plateforme cible. Évite des rows incohérentes côté DB.
    const allComptes = await ctx.db.query("comptes").collect();
    const matchingCompte = allComptes.find(
      (c) =>
        c.handle === args.targetCompte &&
        c.plateforme === args.targetPlateforme,
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

    // Génération inline du prochain carouselId. Logique alignée avec
    // getNextCarouselId — duplication assumée (mutation transactionnelle ne
    // peut pas appeler une query). TD-004 (race condition) inchangé.
    const all = await ctx.db.query("publications").collect();
    const numbers = all
      .map((p) => p.carouselId)
      .map((id) => parseInt(id.replace(/^C/, ""), 10))
      .filter((n) => !isNaN(n));
    const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
    const nextCarouselId = `C${String(maxNumber + 1).padStart(3, "0")}`;

    await ctx.db.insert("publications", {
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
      angleTonal: source.angleTonal,
      langue: source.langue,
      plateforme: args.targetPlateforme,
      compte: args.targetCompte,
      datePubli: Date.now(),
      vuesJ1: null,
      vuesJ3: null,
      vuesJ7: null,
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
export const updateDraft = mutation({
  args: {
    carouselId: v.string(),
    patch: v.object({
      slides: v.optional(
        v.array(v.object({ position: v.number(), texte: v.string() })),
      ),
      // Batch 1 Shorts — script éditable au niveau carrousel pour les Shorts.
      // Les Carrousels n'utilisent pas ce champ ; l'UI Batch 2 affichera l'un
      // ou l'autre selon mediaType.
      script: v.optional(v.string()),
      datePubli: v.optional(v.number()),
      compte: v.optional(v.string()),
      plateforme: v.optional(plateformeValidator),
    }),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("publications")
      .withIndex("by_carouselId", (q) =>
        q.eq("carouselId", args.carouselId),
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
      const allComptes = await ctx.db.query("comptes").collect();
      const matching = allComptes.find(
        (c) =>
          c.handle === args.patch.compte &&
          c.plateforme === args.patch.plateforme,
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
      const rowMediaType: "carousel" | "short" =
        rows[0].mediaType ?? "carousel";
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
    if (args.patch.datePubli !== undefined) update.datePubli = args.patch.datePubli;
    if (args.patch.compte !== undefined) update.compte = args.patch.compte;
    if (args.patch.plateforme !== undefined) update.plateforme = args.patch.plateforme;

    for (const r of rows) {
      await ctx.db.patch(r._id, update);
    }

    return { ok: true, rowsPatched: rows.length };
  },
});
