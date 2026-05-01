import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  hooks: defineTable({
    text: v.string(),
    mecanique: v.union(
      v.literal("Erreur"),
      v.literal("Volume"),
      v.literal("Comparaison"),
      v.literal("Contradiction"),
      v.literal("Universalité"),
      v.literal("Question"),
    ),
    niveau: v.union(
      v.literal("Broad-A"),
      v.literal("Broad-B"),
      v.literal("Niché"),
    ),
    langue: v.union(v.literal("FR"), v.literal("EN")),
  })
    .index("by_langue", ["langue"])
    .index("by_mecanique", ["mecanique"])
    .index("by_niveau", ["niveau"]),

  publications: defineTable({
    carouselId: v.string(),
    hookId: v.union(v.id("hooks"), v.null()),
    hookText: v.string(),
    mecanique: v.union(
      v.literal("Erreur"),
      v.literal("Volume"),
      v.literal("Comparaison"),
      v.literal("Contradiction"),
      v.literal("Universalité"),
      v.literal("Question"),
    ),
    niveau: v.union(
      v.literal("Broad-A"),
      v.literal("Broad-B"),
      v.literal("Niché"),
    ),
    format: v.union(
      v.literal("A"),
      v.literal("B"),
      v.literal("C"),
      v.literal("D"),
      v.literal("E"),
      v.literal("F"),
      v.literal("G"),
      v.literal("H"),
    ),
    nbSlides: v.number(),
    slides: v.array(
      v.object({
        position: v.number(),
        texte: v.string(),
      }),
    ),
    angleTonal: v.union(
      v.literal("Psycho"),
      v.literal("Accusatoire"),
      v.literal("Pédagogique"),
      v.literal("Observation"),
      v.literal("Provocant"),
    ),
    langue: v.union(v.literal("FR"), v.literal("EN")),
    plateforme: v.union(v.literal("TikTok"), v.literal("Instagram")),
    compte: v.string(),
    datePubli: v.number(),
    vuesJ1: v.union(v.number(), v.null()),
    vuesJ3: v.union(v.number(), v.null()),
    vuesJ7: v.union(v.number(), v.null()),
    saves: v.union(v.number(), v.null()),
    commentsTotal: v.union(v.number(), v.null()),
    commentsAudit: v.union(v.number(), v.null()),
    profileVisits: v.union(v.number(), v.null()),
    notes: v.string(),
    // Lien public TikTok ou Instagram du post une fois publié.
    // Définit l'état "publié" via lib/publication-status.ts → isPublished().
    // Optional pour permettre les rows existantes de coexister sans migration.
    postUrl: v.optional(v.string()),
  })
    .index("by_carouselId", ["carouselId"])
    .index("by_plateforme", ["plateforme"])
    .index("by_datePubli", ["datePubli"])
    // by_hookId : prévu pour des lookups directs « toutes les publications
    // d'un hook donné » (ex: depuis la fiche hook). listHooksWithUsage utilise
    // un seul collect+groupBy en mémoire — l'index est là pour le futur.
    .index("by_hookId", ["hookId"]),

  comptes: defineTable({
    handle: v.string(),
    plateforme: v.union(v.literal("TikTok"), v.literal("Instagram")),
    notes: v.string(),
    actif: v.boolean(),
  })
    .index("by_plateforme", ["plateforme"])
    .index("by_actif", ["actif"]),

  // Presets de filtres pour le tracker. schemaVersion permet de strip les
  // anciens presets si la struct des filtres évolue (cf décision MVP : strip
  // silencieux côté client). filters dupliquent volontairement le shape des
  // useState de app/tracker/page.tsx — toute évolution de filtres tracker
  // demande de bumper schemaVersion + d'updater le shape ici.
  filterPresets: defineTable({
    name: v.string(),
    schemaVersion: v.number(),
    filters: v.object({
      search: v.string(),
      plateforme: v.string(),
      statut: v.string(),
      // Multi-select v2 : 4 champs en array (Set vide = "tous").
      compte: v.array(v.string()),
      mecanique: v.array(v.string()),
      format: v.array(v.string()),
      verdict: v.array(v.string()),
    }),
    sort: v.object({
      key: v.union(v.literal("date"), v.literal("saveRate")),
      dir: v.union(v.literal("asc"), v.literal("desc")),
    }),
  }).index("by_name", ["name"]),
});
