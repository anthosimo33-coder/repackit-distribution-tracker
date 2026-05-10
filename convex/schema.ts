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
    // Batch 1 Shorts — mediaType discriminant. Optional pour rétro-compat :
    // les rows pré-Shorts ont mediaType undefined (= "carousel" via helper
    // getMediaType dans lib/media-type.ts). Aucun composant ne doit faire la
    // coercion inline.
    // Batch D — ajout "screenrecorder" (capture d'écran avec titre + image).
    mediaType: v.optional(
      v.union(
        v.literal("carousel"),
        v.literal("short"),
        v.literal("screenrecorder"),
      ),
    ),
    // Batch D — ScreenRecorder uniquement (carousel/short ignorent ces
    // champs). titre et image sont optional au schéma ; leur exigence est
    // imposée serveur dans createPublication selon le mediaType.
    titre: v.optional(v.string()),
    image: v.optional(v.id("_storage")),
    // Carousel-only. Passé en optional avec ajout des Shorts (concept non
    // applicable aux vidéos verticales). Rows pré-Shorts ont la valeur set
    // (A-H), elles continuent de fonctionner identiquement. v.string() au
    // lieu d'union literal pour préparer une éventuelle évolution des
    // formats sans migration.
    format: v.optional(v.string()),
    nbSlides: v.optional(v.number()),
    slides: v.optional(
      v.array(
        v.object({
          position: v.number(),
          texte: v.string(),
        }),
      ),
    ),
    // Short-only. Texte continu (pas slides découpées). Le hook reste
    // pré-rempli en haut du script côté UI (cf Batch 2 /nouveau).
    script: v.optional(v.string()),
    angleTonal: v.union(
      v.literal("Psycho"),
      v.literal("Accusatoire"),
      v.literal("Pédagogique"),
      v.literal("Observation"),
      v.literal("Provocant"),
    ),
    langue: v.union(v.literal("FR"), v.literal("EN")),
    // Plateforme étendue à YouTube pour les Shorts. La cohérence
    // mediaType/plateforme (carousel ne peut pas vivre sur YouTube) est
    // validée serveur via isFormatAllowedOnPlatform — pas via le schéma.
    plateforme: v.union(
      v.literal("TikTok"),
      v.literal("Instagram"),
      v.literal("YouTube"),
    ),
    compte: v.string(),
    datePubli: v.number(),
    vuesJ1: v.union(v.number(), v.null()),
    vuesJ3: v.union(v.number(), v.null()),
    vuesJ7: v.union(v.number(), v.null()),
    saves: v.union(v.number(), v.null()),
    commentsTotal: v.union(v.number(), v.null()),
    commentsAudit: v.union(v.number(), v.null()),
    profileVisits: v.union(v.number(), v.null()),
    // Métriques Shorts (likes, abonnés gagnés). Nullable comme les autres
    // métriques (n/a pour les Carrousels existants ; null tant que pas
    // saisi pour les Shorts).
    likes: v.optional(v.union(v.number(), v.null())),
    subsGained: v.optional(v.union(v.number(), v.null())),
    notes: v.string(),
    // Lien public TikTok ou Instagram du post une fois publié.
    // Définit l'état "publié" via lib/publication-status.ts → isPublished().
    // Optional pour permettre les rows existantes de coexister sans migration.
    postUrl: v.optional(v.string()),
    // Modif 2 : ancre du groupe de variantes. Pointe TOUJOURS vers le carrousel
    // ORIGINAL (pas vers un duplicat intermédiaire). Permet à un groupe de
    // duplicats de partager un seul point d'ancrage. undefined = carrousel
    // original (pas de parent). Optional pour les rows pré-Modif 2.
    parentCarouselId: v.optional(v.string()),
  })
    .index("by_carouselId", ["carouselId"])
    .index("by_plateforme", ["plateforme"])
    .index("by_datePubli", ["datePubli"])
    // by_hookId : prévu pour des lookups directs « toutes les publications
    // d'un hook donné » (ex: depuis la fiche hook). listHooksWithUsage utilise
    // un seul collect+groupBy en mémoire — l'index est là pour le futur.
    .index("by_hookId", ["hookId"])
    // by_parentCarouselId : utilisé par Modif 3 (variantsCount par hook) et
    // Modif 5 (liste des variantes d'un carrousel). Lookup direct des
    // descendants d'un parent ancré.
    .index("by_parentCarouselId", ["parentCarouselId"]),

  comptes: defineTable({
    handle: v.string(),
    plateforme: v.union(
      v.literal("TikTok"),
      v.literal("Instagram"),
      v.literal("YouTube"),
    ),
    notes: v.string(),
    actif: v.boolean(),
  })
    .index("by_plateforme", ["plateforme"])
    .index("by_actif", ["actif"]),

  // Presets de filtres pour le tracker. schemaVersion permet de strip les
  // anciens presets si la struct des filtres évolue (cf décision MVP : strip
  // silencieux côté client). filters dupliquent volontairement le shape des
  // useState de TrackerListSection — toute évolution de filtres tracker
  // demande de bumper schemaVersion + d'updater le shape ici.
  //
  // Batch B (v4) : split tracker en pages /carrousels et /shorts. Le champ
  // top-level filters.mediaType disparaît (devient implicite par la page).
  // Ajout de mediaTypeScope au niveau preset : chaque preset appartient à
  // un format unique et n'est listé que sur sa page de référence.
  filterPresets: defineTable({
    name: v.string(),
    schemaVersion: v.number(),
    mediaTypeScope: v.union(
      v.literal("carousel"),
      v.literal("short"),
      v.literal("screenrecorder"),
    ),
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
      // Batch 2 Modif 7 (v3) — sort.key étendu aux 6 axes. Inchangé en v4.
      key: v.union(
        v.literal("date"),
        v.literal("saveRate"),
        v.literal("vues"),
        v.literal("likes"),
        v.literal("comments"),
        v.literal("subsGained"),
      ),
      dir: v.union(v.literal("asc"), v.literal("desc")),
    }),
  })
    .index("by_name", ["name"])
    .index("by_mediaTypeScope", ["mediaTypeScope"]),
});
