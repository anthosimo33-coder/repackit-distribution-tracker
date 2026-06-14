import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

/**
 * P2 Multi-tenant — rollout terminé (2 phases, à cause du deploy atomique
 * TD-006 qui pousse le schéma AVANT toute migration data) :
 *
 *  Phase 1 (commit feat(multi-tenant)) — projectId v.optional + tables
 *  projects/memberships + indexes ; migration setupRepackitProject backfille
 *  projectId partout et unset vuesJ1/J3/J7. Exécutée en prod le 2026-06-12.
 *
 *  Phase 2 (CE commit) — la prod étant backfillée, on RESSERRE projectId en
 *  v.id("projects") (non-optional) sur les 9 tables métier et on RETIRE
 *  vuesJ1/J3/J7 du schéma. Le succès du push (build npx convex deploy) prouve
 *  qu'aucun doc prod ne viole ce schéma resserré.
 *
 *  Reste différé : TD-017 (comptes.actif) — encore lu par lib/compte-status.ts
 *  et ~12 specs e2e.
 */
export default defineSchema({
  // ─── Remédiation sécurité — tables Convex Auth ───────────────────────────
  // authSessions / authAccounts / authRefreshTokens / authVerificationCodes /
  // authVerifiers / authRateLimits viennent du spread. `users` est redéfinie
  // ci-dessous (champs standard de authTables.users À L'IDENTIQUE + extension
  // `role`) — pattern documenté Convex Auth pour étendre la table users.
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // Extension RepackIt : rôle global. "superadmin" = créé via la fenêtre
    // bootstrap (1er compte) ; "member" = futurs comptes invités (P4).
    // Optional par sécurité (un user créé par un chemin librairie sans rôle
    // reste valide) — traiter undefined comme "member" côté checks.
    role: v.optional(v.union(v.literal("superadmin"), v.literal("member"))),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  // ─── P2 Multi-tenant — projets ───────────────────────────────────────────
  // Un projet = un espace de distribution isolé (RepackIt, et futures apps).
  // TOUTES les tables métier sont scopées par projectId. slug unique (imposé
  // côté mutation). accentColor = hex pour le theming P10. payoutDay 1-28.
  projects: defineTable({
    name: v.string(),
    slug: v.string(),
    accentColor: v.string(),
    payoutDay: v.number(),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  // Appartenance d'un user à un projet, avec rôle par-projet. Le superadmin
  // (users.role) a accès implicite à TOUS les projets sans membership (cf
  // requireProjectAccess dans convex/functions.ts). La séparation admin vs
  // creator par fonction arrive en P4+ ; ici tout membre du projet passe.
  memberships: defineTable({
    userId: v.id("users"),
    // Requis (greenfield, pas de migration) — NE PAS rendre optional.
    projectId: v.id("projects"),
    role: v.union(v.literal("admin"), v.literal("creator")),
  })
    .index("by_user", ["userId"])
    .index("by_project", ["projectId"])
    .index("by_user_project", ["userId", "projectId"]),

  hooks: defineTable({
    // P2 — projectId optional (phase migration) → resserré en required après
    // backfill. La biblio hooks est PAR PROJET (une autre app a ses hooks).
    projectId: v.id("projects"),
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
    .index("by_niveau", ["niveau"])
    .index("by_project", ["projectId"])
    .index("by_project_langue", ["projectId", "langue"]),

  publications: defineTable({
    // P2 — scope projet (optional pendant migration, resserré ensuite).
    projectId: v.id("projects"),
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
    // Refinement ScreenRecorder — recordingDevice et isRepackaging sont
    // required pour les nouveaux SR (validation handler createPublication),
    // mais restent optional côté schéma pour ne pas casser les SR pré-
    // existants potentiels (créés en Batch D sans ces champs). UI gère le
    // case undefined gracieusement (afficher "—"). Édition draft permet de
    // les renseigner rétroactivement.
    recordingDevice: v.optional(
      v.union(v.literal("phone"), v.literal("desktop")),
    ),
    isRepackaging: v.optional(v.boolean()),
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
    // TD-016 — vuesJ1/J3/J7 SUPPRIMÉS (phase 2). Les métriques temporelles
    // vivent en metricSnapshots ; le backfill les a unset sur tous les docs.
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
    // Refinement Shorts — ICP ciblé (audience). Required à la création d'un
    // Short (validé dans createPublication), optional côté schéma pour la
    // rétro-compat des Shorts pré-existants + des carousel/SR qui l'ignorent.
    // Unset via patch { icpId: undefined } (cascade deleteIcp).
    icpId: v.optional(v.id("icps")),
    // Anti-shadowban Shorts — identifiant de la vidéo source (ex: nom de
    // fichier Drive "short_042"). Cross-format au schéma (v.optional) mais la
    // contrainte d'unicité (sourceId, plateforme) n'est imposée QUE pour les
    // Shorts côté serveur (createPublication / updateDraft / duplicateCarousel).
    // Stocké NORMALISÉ (trim + strip extension vidéo + lowercase, cf
    // normalizeSourceId). undefined = pas de source (S007/S008 pré-fix +
    // carousel/SR). AUCUN index : collect()+filter trivial au volume (TD).
    sourceId: v.optional(v.string()),
    // Modification compte post-publication : undefined/false = jamais modifié
    // (modification possible 1 fois), true = déjà modifié une fois (lecture
    // seule désormais). Cf updatePublishedAccount.
    accountModified: v.optional(v.boolean()),
    // ─── S3 — Raccord combo de script ↔ publication ────────────────────────
    // Copié depuis assignment.scriptCombo + comboKey À LA MATÉRIALISATION d'un
    // post de SCRIPT validé (validateAssignment, branche script). C'EST le lien
    // qui permet de joindre les vues (metricSnapshots de cette publication) aux
    // briques du combo → analytics par variable (convex/scriptAnalytics.ts).
    // Absent sur toute publication NON issue d'un script (interne, format) →
    // champ optionnel, 0 migration. Pas d'assembledScript ici (il reste figé
    // sur l'assignment) : seules les ids + comboKey + campaignId servent au join.
    // Convex n'indexe pas les champs imbriqués → le filtrage par campagne se
    // fait en mémoire après collect by_project (cf scriptAnalytics, idiome
    // identique à dashboard/aggregateTimeseries).
    scriptCombo: v.optional(
      v.object({
        campaignId: v.id("scriptCampaigns"),
        hookBrickId: v.id("scriptBricks"),
        corpsBrickId: v.id("scriptBricks"),
        fluxBrickId: v.id("scriptBricks"),
        ctaBrickId: v.id("scriptBricks"),
        comboKey: v.string(),
      }),
    ),
    // ─── Refactor multi-snapshots — valeurs dénormalisées "latest known" ───
    // Copie du snapshot le plus récent (capturedAt max) maintenue par
    // recomputeLatestMetrics à chaque create/update/delete de metricSnapshot.
    // Optional : une publication sans aucun snapshot n'a pas de latest.
    // L'UI affiche `displayMetrics` (résolu par snapshotAge dans les queries) ;
    // ces champs servent de défaut "Latest" + lecture rapide sans join.
    vuesLatest: v.optional(v.number()),
    likesLatest: v.optional(v.number()),
    savesLatest: v.optional(v.number()),
    subsGainedLatest: v.optional(v.number()),
    commentsLatest: v.optional(v.number()),
    latestSnapshotId: v.optional(v.id("metricSnapshots")),
    latestSnapshotAt: v.optional(v.number()),
    // LEGACY (vuesJ1/J3/J7 ci-dessus + saves/likes/subsGained/commentsTotal/
    // commentsAudit/profileVisits) : conservés temporairement. Les vues J1/J3/J7
    // sont migrées en metricSnapshots puis supprimées dans un commit séparé
    // (TD-016) après validation prod. commentsAudit/profileVisits restent
    // publication-level (hors modèle snapshot).
  })
    .index("by_carouselId", ["carouselId"])
    .index("by_plateforme", ["plateforme"])
    .index("by_datePubli", ["datePubli"])
    .index("by_hookId", ["hookId"])
    .index("by_parentCarouselId", ["parentCarouselId"])
    // P2 — index scopés projet (A1/A2/A3). carouselId n'est plus unique
    // globalement → résolution (projectId, carouselId).
    .index("by_project", ["projectId"])
    .index("by_project_datePubli", ["projectId", "datePubli"])
    .index("by_project_carouselId", ["projectId", "carouselId"])
    .index("by_project_plateforme", ["projectId", "plateforme"])
    .index("by_project_hookId", ["projectId", "hookId"])
    .index("by_project_parentCarouselId", ["projectId", "parentCarouselId"]),

  // ─── Refactor métriques temporelles — historique de mesures par row ──────
  // Greenfield. 1 metricSnapshot = une relève de métriques à une date donnée
  // pour UNE publication (= 1 row = 1 plateforme). `daysSincePublication` est
  // dénormalisé (floor((capturedAt - datePubli)/jour)) pour le matching par
  // période côté query/UI. `vues` et `likes` requis ; saves (carousel) /
  // subsGained (short/SR) / comments optionnels selon le format. `source`
  // distingue saisie manuelle, import, et migration one-shot (legacy J1/J3/J7).
  metricSnapshots: defineTable({
    // P2 — scope projet dénormalisé (= projectId de la publication parente).
    // Permet aggregateTimeseries / le chargement "tous les snapshots du projet"
    // sans charger d'abord les publications. by_publication reste valable.
    projectId: v.id("projects"),
    publicationId: v.id("publications"),
    capturedAt: v.number(),
    daysSincePublication: v.number(),
    vues: v.number(),
    likes: v.number(),
    saves: v.optional(v.number()),
    subsGained: v.optional(v.number()),
    comments: v.optional(v.number()),
    createdAt: v.number(),
    source: v.union(
      v.literal("manual"),
      v.literal("import"),
      v.literal("migration"),
    ),
  })
    .index("by_publication", ["publicationId"])
    .index("by_publication_and_capturedAt", ["publicationId", "capturedAt"])
    .index("by_capturedAt", ["capturedAt"])
    .index("by_project", ["projectId"])
    .index("by_project_capturedAt", ["projectId", "capturedAt"]),

  comptes: defineTable({
    // P2 — scope projet.
    projectId: v.id("projects"),
    handle: v.string(),
    plateforme: v.union(
      v.literal("TikTok"),
      v.literal("Instagram"),
      v.literal("YouTube"),
    ),
    notes: v.string(),
    // Statut opérationnel (4 états). Optional au schéma + exigence imposée
    // côté handler (createCompte défaut "actif" ; updateCompte mappe le legacy
    // `actif`), pattern repo (mediaType/sourceId/icpId/postUrl) : on peut
    // pousser le schéma sans casser les rows existantes dépourvues de `status`,
    // puis backfill via migrateComptesStatus. Resserrage en requis = TD futur.
    status: v.optional(
      v.union(
        v.literal("warmup"),
        v.literal("actif"),
        v.literal("shadowban"),
        v.literal("archived"),
      ),
    ),
    // Timestamp ms du début de warmup. Requis (côté handler) si status ===
    // "warmup", unset sinon (transition warmup → autre). Décompte adaptatif
    // par plateforme côté UI (lib/compte-status, WARMUP_DURATION_BY_PLATFORM).
    warmupStartedAt: v.optional(v.number()),
    // LEGACY rétro-compat : passé en optional (était v.boolean()). Maintenu
    // synchronisé par les mutations (actif === (status === "actif")) le temps
    // que les callers e2e/UI migrent vers `status`. Suppression = TD-017.
    actif: v.optional(v.boolean()),
    // Gestionnaire optionnel (1-to-1 vers personnes). Absent = aucun
    // gestionnaire. Unset via patch { personneId: undefined } (cf
    // updateCompte + cascade deletePersonne) — pattern folderId d'inspirations.
    personneId: v.optional(v.id("personnes")),
    // ─── P5 Comptes créateurs + protocole de warmup ──────────────────────
    // Propriétaire créateur. absent = compte INTERNE (équipe RepackIt). Posé
    // à la déclaration par le créateur (creatorMutation declareCompte). NE
    // remplace PAS personneId (gestionnaire interne) : deux axes distincts.
    creatorId: v.optional(v.id("creators")),
    // URL publique du compte, saisie à la déclaration (plateforme/handle/URL).
    url: v.optional(v.string()),
    // Protocole de warmup défini par l'admin + checks quotidiens du créateur.
    // Complète status/warmupStartedAt (décompte) : keywords UNIQUES par compte
    // (imposé serveur), instructions markdown, targetDays (surcharge la durée
    // plateforme par défaut, cf lib/warmup), dailyChecks = dates "YYYY-MM-DD"
    // (1 max/jour, imposé serveur). Optional → aucune migration.
    warmupProtocol: v.optional(
      v.object({
        keywords: v.array(v.string()),
        instructions: v.string(),
        targetDays: v.number(),
        dailyChecks: v.array(v.string()),
        updatedAt: v.number(),
      }),
    ),
  })
    .index("by_plateforme", ["plateforme"])
    .index("by_actif", ["actif"])
    .index("by_project", ["projectId"])
    .index("by_project_plateforme", ["projectId", "plateforme"])
    .index("by_project_creator", ["projectId", "creatorId"]),

  // Gestionnaires de comptes (greenfield). Lien 1-to-1 optionnel depuis
  // comptes.personneId. Dedupe insensible à la casse sur le couple
  // (prenom, nom) imposé côté mutations.
  personnes: defineTable({
    // P2 — scope projet (l'équipe peut différer d'un projet à l'autre).
    projectId: v.id("projects"),
    prenom: v.string(),
    nom: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_nom", ["nom"])
    .index("by_project", ["projectId"])
    .index("by_project_nom", ["projectId", "nom"]),

  // ICPs (Ideal Customer Profiles) — audiences ciblées par les Shorts.
  // Greenfield, admin via /comptes?view=icps. Lien Short → ICP via
  // publications.icpId (required à la création d'un Short). color = clé
  // palette FOLDER_COLORS (lib/folder-colors), pas un hex direct.
  icps: defineTable({
    // P2 — scope projet.
    projectId: v.id("projects"),
    nom: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_nom", ["nom"])
    .index("by_project", ["projectId"])
    .index("by_project_nom", ["projectId", "nom"]),

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
    // P2 — scope projet (les presets de tracker sont propres à un projet).
    projectId: v.id("projects"),
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
    .index("by_mediaTypeScope", ["mediaTypeScope"])
    .index("by_project", ["projectId"])
    .index("by_project_name", ["projectId", "name"])
    .index("by_project_mediaTypeScope", ["projectId", "mediaTypeScope"]),

  // Batch F — pilier VEILLE / Inspirations. Bibliothèque manuelle d'URLs
  // (vidéos ou comptes) sur TikTok / Instagram / YouTube, organisée par
  // dossiers + tags + favoris. Greenfield, pas de migration data.
  //
  // type est détecté côté client via lib/inspiration-url.ts mais l'override
  // manuel reste possible (fallback Selects si l'autodétection échoue).
  // thumbnail réutilise le pattern Convex storage du Batch D
  // (generateUploadUrl + getPreviewUrl).
  inspirations: defineTable({
    // P2 — scope projet (la veille est propre à chaque app).
    projectId: v.id("projects"),
    url: v.string(),
    type: v.union(v.literal("video"), v.literal("account")),
    plateforme: v.union(
      v.literal("TikTok"),
      v.literal("Instagram"),
      v.literal("YouTube"),
    ),
    thumbnail: v.optional(v.id("_storage")),
    titre: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Stats manuelles capturées au moment de la saisie. Toutes optional —
    // l'utilisateur peut skipper l'accordéon entièrement. capturedAt est
    // utile pour Produit A futur (timeseries) si on décide d'élargir.
    stats: v.optional(
      v.object({
        views: v.optional(v.number()),
        likes: v.optional(v.number()),
        followers: v.optional(v.number()),
        comments: v.optional(v.number()),
        capturedAt: v.optional(v.number()),
      }),
    ),
    folderId: v.optional(v.id("folders")),
    isFavorite: v.boolean(),
    tags: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_folder", ["folderId"])
    .index("by_plateforme", ["plateforme"])
    .index("by_favorite", ["isFavorite"])
    .index("by_createdAt", ["createdAt"])
    .index("by_project", ["projectId"])
    .index("by_project_createdAt", ["projectId", "createdAt"]),

  // ─── P1 Créateurs — gestion des créateurs + onboarding par invitation ─────
  // Un créateur = une personne externe à qui on confie la publication. NE PAS
  // confondre avec `personnes` (annuaire interne des gestionnaires de comptes).
  // userId est optional tant que l'invitation n'est pas acceptée (le créateur
  // n'a pas encore de compte). Posé + status "onboarding" à l'acceptation du
  // lien d'invitation (cf convex/auth.ts createOrUpdateUser, branche token).
  creators: defineTable({
    projectId: v.id("projects"),
    // Lien vers le compte de connexion. undefined = invité, pas encore inscrit.
    userId: v.optional(v.id("users")),
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    status: v.union(
      v.literal("invited"),
      v.literal("onboarding"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("churned"),
    ),
    paymentMethod: v.optional(
      v.union(
        v.literal("sepa"),
        v.literal("paypal"),
        v.literal("usdt"),
        v.literal("autre"),
      ),
    ),
    paymentDetails: v.optional(v.string()),
    adminNotes: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"]),

  // Invitations à token (uuid). Une invitation = un lien /join/<token> à usage
  // unique, lié à un créateur. expiresAt défaut +14 j ; usedAt posé à la
  // consommation (la mutation de signup la marque). by_token = résolution du
  // lien public (pré-session, cf creators.getInvitationPreview / auth.ts).
  invitations: defineTable({
    token: v.string(),
    creatorId: v.id("creators"),
    projectId: v.id("projects"),
    email: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_creator", ["creatorId"]),

  // Dossiers de classement pour les inspirations. color = clé palette
  // (lib/folder-colors.ts à créer en Batch G), pas un hex direct.
  folders: defineTable({
    // P2 — scope projet.
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_project", ["projectId"])
    .index("by_project_name", ["projectId", "name"]),

  // ─── P6 Formats — bibliothèque de briefs par projet ──────────────────────
  // Un format = brief auto-suffisant consommé par le créateur (chantier
  // suivant) : description (markdown), hooks EMBARQUÉS (textes copiés depuis la
  // biblio — le créateur ne voit jamais la biblio complète), do/don't, vidéos
  // exemples regardables in-app (fichier storage NON publié OU lien embed) et
  // grille de rémunération. Table neuve → 0 migration.
  formats: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    // Aligné sur les mediaType publications ; "custom" = format sans
    // matérialisation publication (géré au chantier validation).
    type: v.union(
      v.literal("carousel"),
      v.literal("short"),
      v.literal("screenrecorder"),
      v.literal("custom"),
    ),
    brief: v.string(), // markdown
    // Hooks embarqués = TEXTES (auto-suffisant : pas de jointure vers `hooks`).
    hooks: v.array(v.string()),
    guidelines: v.object({
      do: v.array(v.string()),
      dont: v.array(v.string()),
    }),
    // Exemples vidéo : fichier (storage, jamais téléchargeable) OU lien embed.
    // L'URL publique d'un fichier est résolue SERVEUR dans les queries (jamais
    // exposée brute en DB), cf pattern publications → imageUrl.
    exampleVideos: v.array(
      v.union(
        v.object({
          kind: v.literal("file"),
          storageId: v.id("_storage"),
          title: v.string(),
          mimeType: v.string(),
        }),
        v.object({
          kind: v.literal("url"),
          url: v.string(),
          platform: v.union(
            v.literal("tiktok"),
            v.literal("youtube"),
            v.literal("instagram"),
          ),
          title: v.string(),
        }),
      ),
    ),
    rateModel: v.object({
      basePerPost: v.number(),
      viewBonusPer1k: v.optional(v.number()),
      bounties: v.optional(
        v.array(
          v.object({
            thresholdViews: v.number(),
            amount: v.number(),
          }),
        ),
      ),
    }),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  // ─── P7 Portail créateur — assignments (1 row = 1 livrable) ───────────────
  // « 3 posts » = 3 rows (suivi + payé à l'unité, pas de qty). rateSnapshot =
  // COPIE du rateModel du format au moment de l'assignation (les tarifs du
  // format peuvent changer, pas ceux d'un assignment déjà donné). Table neuve.
  assignments: defineTable({
    projectId: v.id("projects"),
    creatorId: v.id("creators"),
    // P7 : assignment "format". S2 : optional — un assignment a SOIT un formatId
    // SOIT un scriptCombo (assignment "script"). Champ assoupli → 0 migration.
    formatId: v.optional(v.id("formats")),
    // S2 — combo de script CAPTURÉ à l'assignation. assembledScript FIGÉ (comme
    // rateSnapshot) : ne bouge pas si une brick est éditée ensuite.
    scriptCombo: v.optional(
      v.object({
        campaignId: v.id("scriptCampaigns"),
        hookBrickId: v.id("scriptBricks"),
        corpsBrickId: v.id("scriptBricks"),
        fluxBrickId: v.id("scriptBricks"),
        ctaBrickId: v.id("scriptBricks"),
        assembledScript: v.string(),
      }),
    ),
    // S2 — signature top-level du combo "hook:corps:flux:cta" (Convex n'indexe
    // pas les champs imbriqués) → index by_creator_combo pour l'anti-coordination
    // (un créateur ne reçoit jamais deux fois le même combo).
    comboKey: v.optional(v.string()),
    accountId: v.optional(v.id("comptes")),
    dueDate: v.number(),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("submitted"),
      v.literal("validated"),
      v.literal("rejected"),
      v.literal("paid"),
    ),
    submittedUrl: v.optional(v.string()),
    submittedAt: v.optional(v.number()),
    submittedPlatform: v.optional(
      v.union(
        v.literal("TikTok"),
        v.literal("Instagram"),
        v.literal("YouTube"),
      ),
    ),
    // Posé au chantier validation (matérialisation publication).
    publicationId: v.optional(v.id("publications")),
    adminFeedback: v.optional(v.string()),
    rateSnapshot: v.object({
      basePerPost: v.number(),
      viewBonusPer1k: v.optional(v.number()),
      bounties: v.optional(
        v.array(v.object({ thresholdViews: v.number(), amount: v.number() })),
      ),
    }),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_creator", ["creatorId"])
    .index("by_format", ["formatId"])
    .index("by_project_status", ["projectId", "status"])
    // S2 — anti-coordination : (créateur, signature de combo).
    .index("by_creator_combo", ["creatorId", "comboKey"]),

  // ─── P7 — « Comment ça marche » (guide projet, éditable admin) ────────────
  // Un seul guide markdown par projet (le SYSTÈME, pas un format). Lu par les
  // créateurs (creatorQuery), édité par l'admin. Upsert (≤ 1 row/projet).
  projectGuide: defineTable({
    projectId: v.id("projects"),
    content: v.string(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  // ─── P8 — Paiements (accrual par période) ─────────────────────────────────
  // 1 row = la rémunération d'UN créateur pour UNE période "YYYY-MM". Alimentée
  // par la validation admin (lineItem "base" figé sur rateSnapshot.basePerPost)
  // et par le calcul de bonus de vues (lineItem "bonus", 1 max/assignment,
  // recalcul = remplacement). totalDue = somme des lineItems (recalculée à
  // chaque écriture). Table neuve → 0 migration. La vue paiements complète +
  // le portail gains créateur sont P9 (hors scope ici).
  payments: defineTable({
    projectId: v.id("projects"),
    creatorId: v.id("creators"),
    // Période d'accrual, "YYYY-MM" (UTC, cf periodOf dans convex/payments.ts).
    period: v.string(),
    lineItems: v.array(
      v.object({
        assignmentId: v.id("assignments"),
        label: v.string(),
        amount: v.number(),
        kind: v.union(v.literal("base"), v.literal("bonus")),
      }),
    ),
    totalDue: v.number(),
    status: v.union(
      v.literal("accruing"),
      v.literal("scheduled"),
      v.literal("paid"),
    ),
    scheduledDate: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_project_period", ["projectId", "period"])
    .index("by_creator", ["creatorId"]),

  // ─── S1 — Système de scripts combinatoire ─────────────────────────────────
  // Une vidéo = 1 hook + 1 corps + 1 flux + 1 cta, posés sur un SOCLE DÉMO fixe
  // (demoBlock). Une "campagne de scripts" regroupe la banque de bricks (hooks
  // par tier + corps + flux + cta) + le socle démo d'un angle de test. Tables
  // neuves → 0 migration. S1 = fondation (modèle + CRUD + assemblage) ; pas
  // d'assignation/affichage créateur/analytics (chantiers suivants).
  scriptCampaigns: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    // Socle démo fixe (markdown) : la partie de la vidéo qui ne change jamais.
    demoBlock: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  // Une brique = un fragment combinable. Un seul modèle pour les 4 kinds
  // (hook/corps/flux/cta), discriminé par `kind`. `tier` (S/A/B) UNIQUEMENT
  // pour les hooks (undefined sinon). `active` : une brique désactivée ne sera
  // pas combinée (préparation S2). Les hooks importés depuis la bibliothèque
  // sont COPIÉS ici (bricks indépendants), la biblio d'origine reste intacte.
  scriptBricks: defineTable({
    projectId: v.id("projects"),
    campaignId: v.id("scriptCampaigns"),
    kind: v.union(
      v.literal("hook"),
      v.literal("corps"),
      v.literal("flux"),
      v.literal("cta"),
    ),
    label: v.string(),
    content: v.string(),
    tier: v.optional(v.union(v.literal("S"), v.literal("A"), v.literal("B"))),
    active: v.boolean(),
    order: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_campaign_kind", ["campaignId", "kind"])
    // S2 — résumé combo côté admin (charge les bricks du projet pour les labels).
    .index("by_project", ["projectId"]),
});
