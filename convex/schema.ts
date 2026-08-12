import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { countryValidator } from "./countries";

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
    // Branding configurable PAR PROJET (aucun hardcode slug). Tout optionnel →
    // 0 migration ; un projet sans ces champs garde le comportement actuel
    // (initiale colorée dans le switcher, aucune section "Outils").
    //
    // logoUrl : image affichée à la place de l'initiale+accent dans le
    // ProjectSwitcher (URL publique, ex. /brand/snytch-logo.jpeg ou une URL
    // externe). Absent ⇒ fallback initiale + accentColor.
    logoUrl: v.optional(v.string()),
    // sidebarLinks : liens externes propres au projet, rendus dans la sidebar
    // (section "Outils") et ouverts dans un nouvel onglet. icon = nom optionnel
    // d'icône lucide (cf lib/sidebar-link-icon.ts), fallback "lien externe".
    sidebarLinks: v.optional(
      v.array(
        v.object({
          label: v.string(),
          url: v.string(),
          icon: v.optional(v.string()),
        }),
      ),
    ),
    // ─── Dépôt de fichiers (Drive) — ouvert sur ce projet ? ───────────────────
    // Remplace le gate `slug === "snytch"` en dur du chemin Drive. ABSENT ⇒
    // repli EXACT sur le comportement d'avant : Snytch ouvert, tout le reste
    // fermé (cf convex/fileDrop.isFileDropEnabled) → 0 migration, Snytch
    // inchangé. Un booléen explicite l'emporte dans les deux sens.
    //
    // ⚠️ NE COMMANDE QUE LE DÉPÔT. Le régime STRICT de disponibilité des comptes
    // (isAccountAvailable({strict}), appelé par validateTargets et
    // confirmPublicationCore) reste sur `projects.isSnytchProject` et n'est PAS
    // concerné : les fusionner ferait cesser silencieusement d'être vrai
    // l'invariant « un compte non validé ne peut rien publier » (risque 8 du
    // diagnostic). Posé via projects.setTalentSettings (adminMutation).
    //
    // NB : la nav du portail PARTENAIRE (« Mes fichiers ») reste gatée sur le
    // slug côté client — le chantier talent ne change rien à l'écran partenaire.
    fileDropEnabled: v.optional(v.boolean()),
    // ─── BRIEF PERMANENT du talent — quel format lui sert de consigne ─────────
    // Le talent n'a pas d'assignation : son brief est PERMANENT, le même à chaque
    // dépôt (« voilà comment on filme un hook chez nous »). Plutôt qu'un champ
    // texte de plus, il pointe un `formats` existant — l'admin l'édite avec
    // l'outil qu'il connaît déjà, exemples vidéo compris.
    // ⚠️ Seuls `brief` et `exampleVideos` de ce format sortent côté talent (cf
    // convex/talentBriefFields.ts) : les `hooks` sont des textes de SCRIPT et
    // `rateModel` est de la paie. Absent = aucun brief affiché (état honnête,
    // jamais un écran vide inexpliqué). Posé via projects.setTalentSettings.
    talentBriefFormatId: v.optional(v.id("formats")),
    // ─── Grille de bonus par DÉFAUT du projet (paliers cumul de vues) ──────────
    // Grille (pricings) héritée par toute créatrice SANS grille perso
    // (creators.bonusPricingId). Sert l'AFFICHAGE (progression) ET la PAIE
    // (déblocages) via effectiveBonusPricing → cohérence garantie. La grille
    // perso PRIME. undefined = pas de défaut (comportement historique : une
    // créatrice sans grille perso n'a aucun palier). Optional → 0 migration.
    defaultBonusPricingId: v.optional(v.id("pricings")),
    // ─── Ingestion revenu Whop (rentabilité P2) — mapping projet ↔ compte Whop ─
    // Chaque projet Jarvia peut être relié à UN compte Whop (company) et,
    // optionnellement, à des plans/produits précis. La CLÉ API Whop n'est JAMAIS
    // stockée ici (secret) : `apiKeyEnvVar` NOMME la variable d'environnement
    // (Convex env) qui la porte — la clé vit uniquement dans l'env, jamais en base
    // ni en dur. companyId (ex. Snytch "biz_e1zcXWKzcgHgt9") et planIds ne sont
    // pas secrets. Absent = pas d'ingestion Whop pour ce projet. Posé via
    // whopSync.setWhopConfigBySlug (interne, `npx convex run`).
    whop: v.optional(
      v.object({
        companyId: v.string(),
        // Restreint l'import à ces plans/produits (anti-mélange si une même
        // company sert plusieurs projets). Vide/absent = tous les paiements.
        planIds: v.optional(v.array(v.string())),
        // NOM de la variable d'env portant la clé API (jamais la clé elle-même).
        apiKeyEnvVar: v.string(),
      }),
    ),
    // ─── Ingestion PostHog (hub Analytics) — mapping projet ↔ projet PostHog ──
    // MÊME contrat de secret que `whop` ci-dessus : la clé API personnelle
    // PostHog n'est JAMAIS stockée ici — `apiKeyEnvVar` NOMME la variable d'env
    // (Convex env) qui la porte. `posthogProjectId` (numérique côté PostHog,
    // conservé en string) et `host` ne sont pas secrets. Absent = AUCUN appel
    // PostHog pour ce projet et section Analytics en état « non configuré ».
    // Posé via posthogSync.setPosthogConfigBySlug (interne, `npx convex run`).
    posthog: v.optional(
      v.object({
        posthogProjectId: v.string(),
        // Région d'hébergement du projet PostHog → base d'URL de l'API.
        host: v.union(v.literal("eu"), v.literal("us")),
        apiKeyEnvVar: v.string(),
      }),
    ),
    // ─── Devises — le produit en a DEUX (jamais un défaut) ──────────────────
    // La PAIE créatrices (fixe, CPM, bonus, paliers, dû, cycles) est en DOLLARS ;
    // le REVENU Whop est en euros (sa devise vient de whopPayments.currency).
    // `payCurrency` code ISO de la paie (ex. "usd"). ABSENT ⇒ les montants de paie
    // s'affichent SANS symbole (jamais inventer une devise). Posé via
    // projects.setProjectCurrencyBySlug (interne, `npx convex run`).
    payCurrency: v.optional(v.string()),
    // Taux de change pour EXPRIMER la paie dans la devise du revenu, UNIQUEMENT
    // pour les métriques qui croisent les deux (marge = revenu − coût, marge %).
    // 1 unité de payCurrency = fxRateToRevenue unités de la devise du revenu (ex.
    // 1 $ = 0,92 €). ABSENT ⇒ la marge combinée n'est PAS calculée (ni inventée).
    fxRateToRevenue: v.optional(v.number()),
    // ─── Notifications hors-app (Telegram) — canal PAR PROJET ─────────────────
    // MÊME contrat de secret que `whop` et `posthog` ci-dessus : le JETON du bot
    // n'est JAMAIS stocké ici — `tokenEnvVar` NOMME la variable d'env (Convex env)
    // qui le porte. `chatId` (destinataire : conversation ou groupe, négatif pour
    // un groupe) n'est pas un secret et vit en base — c'est précisément ce qui
    // rend le destinataire modifiable depuis l'écran admin SANS redéploiement.
    // Absent = AUCUNE notification pour ce projet. Édité par
    // notifications.setNotifySettings (adminMutation, écran /notifications).
    notify: v.optional(
      v.object({
        // Union d'un seul membre AUJOURD'HUI : le transport est isolé dans
        // convex/notifyApi.ts, ajouter "slack" = un second sendX, pas une refonte.
        channel: v.literal("telegram"),
        chatId: v.string(),
        tokenEnvVar: v.string(),
        // LISTE D'AUTORISATION des événements actifs (clés de
        // convex/notificationEvents.ts). Ce qui n'y figure pas est ÉTEINT.
        // Un tableau plutôt qu'un objet de 7 booléens : ajouter un 8e événement
        // plus tard ne demande alors aucune migration, et il arrive éteint.
        enabledEvents: v.array(v.string()),
      }),
    ),
  }).index("by_slug", ["slug"]),

  // Appartenance d'un user à un projet, avec rôle par-projet. Le superadmin
  // (users.role) a accès implicite à TOUS les projets sans membership (cf
  // requireProjectAccess dans convex/functions.ts). La séparation admin vs
  // creator par fonction arrive en P4+ ; ici tout membre du projet passe.
  memberships: defineTable({
    userId: v.id("users"),
    // Requis (greenfield, pas de migration) — NE PAS rendre optional.
    projectId: v.id("projects"),
    // "creator" = créateur PARTENAIRE historique (flux inchangé). "talent" et
    // "clipper" sont deux populations AJOUTÉES À CÔTÉ, avec des littéraux
    // DISTINCTS — et c'est précisément ce qui rend l'ajout sûr : requireCreator
    // (convex/functions.ts) exige role === "creator", donc un talent ou un
    // clippeur est rejeté MÉCANIQUEMENT de toutes les fonctions créateur
    // existantes, sans qu'aucune d'elles soit modifiée. Le littéral dérive de
    // `creators.kind` au signup (cf convex/roles.roleForKind + convex/auth.ts).
    role: v.union(
      v.literal("admin"),
      v.literal("creator"),
      v.literal("talent"),
      v.literal("clipper"),
    ),
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
    // ─── Warmup — post EXCLU de la rémunération (rentabilité P1) ────────────
    // Un post "warmup" est publié et TRACKÉ normalement (ses vues restent
    // relevées + affichées dans le tracker et « Mes vidéos ») mais EXCLU de
    // TOUTE paie : ni fixe/vidéo, ni CPM sur ses vues, ni cumul de vues pour
    // les paliers bonus (cf convex/pricing.assignmentViewsAndMetrics →
    // payableViews / hasPayablePost). Posé/retiré par l'ADMIN seul
    // (setPublicationWarmup), VERROUILLÉ dès que le CYCLE du post est payé — le
    // gel de paie garde alors sa valeur historique (garde serveur, pas juste
    // l'UI). N'AGIT que sur le calcul en cours / futur (les cycles déjà payés
    // lisent leurs lineItems gelées, jamais recalculées → inchangés).
    // ⚠️ DISTINCT du warmup COMPTE (comptes.status "warmup" / warmupProtocol,
    // rodage d'un compte) : ici c'est un flag PAR POST, aucune parenté.
    // Optional → 0 migration ; absent/undefined = false (post payant normal).
    isWarmup: v.optional(v.boolean()),
    // ─── Rémunéré — post PAYÉ (fait FINANCIER), INDÉPENDANT de isWarmup ──────
    // LOT 2 (séparation des flags). `isWarmup` = fait ÉDITORIAL (le contenu ne
    // mentionne pas l'app) ; `remunere` = fait FINANCIER (ce post est payé).
    // Le moteur de paie lit `remunere` (via isRemunerated → payableViews /
    // hasPayablePost). Optional → 0 migration ; absent/undefined retombe sur
    // l'ancienne règle « payé ssi pas warmup » (isRemunerated) → paie
    // STRICTEMENT inchangée tant que le champ n'est pas backfillé. Cas Kelly :
    // isWarmup=true + remunere=true → PAYÉ (remunere) mais HORS promo (isWarmup,
    // cf vues_promo LOT 3/4). Posé par l'ADMIN ; même verrou de paie que isWarmup.
    remunere: v.optional(v.boolean()),
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
        // Refonte 3 briques — corpsBrickId LEGACY, optional : présent sur les
        // pubs figées AVANT la refonte (combo 4 kinds), absent après (combo
        // hook/flux/cta). Conservé en lecture pour ne pas casser l'historique
        // (les analytics ne le lisent plus). Resserrage = suppression ultérieure.
        corpsBrickId: v.optional(v.id("scriptBricks")),
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
    // daysSincePublication STOCKÉ du snapshot latest (copie verbatim, pas
    // recalculé) → permet de servir la vue "latest" sans lire les snapshots
    // tout en restant EXACTEMENT égal à l'ancien calcul, y compris si datePubli
    // a été édité a posteriori (updatePublication ne recalcule pas le daysSince
    // des snapshots existants). undefined = aucun snapshot OU row pas encore
    // reprocessée (fallback recalcul depuis datePubli côté lecture).
    latestSnapshotDaysSince: v.optional(v.number()),
    // Tracking auto YouTube — horodatage du dernier relevé réussi par le cron
    // (API Data v3). Présent ⇒ publication YouTube synchronisée automatiquement
    // (indicateur admin "vues synchronisées auto"). undefined pour TikTok/Insta
    // et les pubs YouTube jamais encore relevées.
    lastYouTubeSyncAt: v.optional(v.number()),
    // Tracking auto TikTok/Instagram — horodatage du dernier relevé réussi par le
    // cron Apify. Pendant Apify de lastYouTubeSyncAt. undefined tant qu'aucun
    // relevé Apify n'a abouti (post non rapprochable, image Insta, token absent).
    lastApifySyncAt: v.optional(v.number()),
    // Titre du POST tel que sur la plateforme, capturé/rafraîchi par les syncs
    // (YouTube : snippet.title ; TikTok/Instagram : la LÉGENDE, qui tient lieu de
    // titre). Propriété du post (pas une série temporelle) → patchée à chaque
    // relevé, pas stockée dans les snapshots. undefined tant qu'aucun relevé n'a
    // abouti → l'affichage retombe sur hookText/titre puis « (sans titre) ».
    postTitle: v.optional(v.string()),
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
      // Relevé AUTO via le cron YouTube (API Data v3). Distingue les snapshots
      // synchronisés des saisies manuelles. Cf convex/youtubeSync.
      v.literal("youtube"),
      // Relevés AUTO via le cron Apify (TikTok/Instagram). Un par plateforme
      // pour distinguer/dédupliquer le snapshot du jour. Cf convex/apifySync.
      v.literal("tiktok"),
      v.literal("instagram"),
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
    // ─── ANCRE de la phase des comptes de CLIPPEUR ───────────────────────────
    // Timestamp ms de la VALIDATION par l'admin (entrée en "actif"). C'est
    // l'origine du compteur de jours dont dérivent la phase et le quota de posts
    // (cf convex/accountPhase.ts) — jusqu'ici la transition warmup → actif
    // n'écrivait AUCUNE date.
    //
    // FIGÉE À LA PREMIÈRE VALIDATION, jamais réécrite — sauf par `restartWarmup`
    // qui l'EFFACE. Les deux moitiés de cette règle protègent contre un bug
    // opposé : sans le gel, un simple aller-retour d'archivage remettrait un
    // clippeur en phase de chauffe et lui couperait toute publication ; sans
    // l'effacement, un compte remis en chauffe puis revalidé repartirait
    // directement à 2 posts/jour sur un compte fraîchement réchauffé.
    // `restartWarmup` est le SEUL événement qui signifie « ce compte repart de
    // zéro », donc le seul qui remet le compteur à zéro.
    //
    // ABSENT ⇒ compte non validé ⇒ quota 0 (fermé par défaut). N'a AUCUN effet
    // sur les comptes de créateurs partenaires : la garde de quota ne s'applique
    // qu'aux comptes dont le propriétaire est un clippeur (D3 — coexistence, pas
    // remplacement : leur warmup par checks réels reste intact).
    validatedAt: v.optional(v.number()),
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
    // ─── Bio à mettre (par compte) ───────────────────────────────────────
    // L'admin définit la bio que le CRÉATEUR propriétaire doit recopier sur son
    // vrai compte social. Le créateur ne fait que LIRE (copier) puis CONFIRMER
    // l'application. Tous optional → aucune migration (absent = pas de bio).
    // Pertinent uniquement pour les comptes liés à un créateur (creatorId).
    // bioToApply = texte courant à appliquer (absent/"" = pas de bio définie).
    bioToApply: v.optional(v.string()),
    // État courant : "to_apply" (admin a posé/modifié → le créateur doit
    // (re)confirmer) ; "applied" (le créateur a confirmé). Absent = pas de bio.
    bioStatus: v.optional(
      v.union(v.literal("to_apply"), v.literal("applied")),
    ),
    // Quand l'admin a défini/modifié la bio (ms). Sert à dater le « modifiée le ».
    bioUpdatedAt: v.optional(v.number()),
    // Quand le créateur a confirmé l'avoir appliquée (ms). Pour l'affichage admin
    // « Appliquée le … ». Réinitialisé (unset) à chaque retour en "to_apply".
    bioAppliedAt: v.optional(v.number()),
    // ─── Compte GÉRÉ PAR L'ADMIN (SOURCE DE VÉRITÉ) ──────────────────────────
    // true = compte tenu PHYSIQUEMENT par l'équipe (l'admin coche le warmup,
    // soumet, publie, met le lien) MAIS rattaché à une créatrice (creatorId) qui
    // voit scripts + posts publiés + perfs SANS jamais publier ni déposer.
    // NE change PAS l'appartenance : creatorId reste la créatrice assignée (c'est
    // ce qui lui donne Mes comptes / Mes vidéos / perfs). N'ajoute qu'un MODE
    // opératoire. absent/false = compte créateur classique (elle gère et publie).
    // Dénormalisé sur assignments.managedByAdmin à la création de l'assignment.
    // Optional → 0 migration.
    managedByAdmin: v.optional(v.boolean()),
    // ─── Pays CIBLÉ (label INFORMATIF, admin only) ───────────────────────────
    // Code pays de la liste FERMÉE partagée (convex/countries.countryValidator,
    // même liste que le sélecteur Radar Tendances). PUREMENT descriptif : ne
    // pilote RIEN (ni scraping, ni proxy, ni filtre, ni affichage créatrice).
    // Édité uniquement par l'admin (updateCompte). Optional → 0 migration ;
    // absent = « non défini ».
    targetCountry: v.optional(countryValidator),
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
    // Vignette AUTO récupérée à la création (YouTube img.* / TikTok oEmbed /
    // Insta oEmbed) et mise en CACHE ici — URL externe, pas un blob storage.
    // Le `thumbnail` (upload manuel) prime à l'affichage ; autoThumbnailUrl
    // sert de fallback. Status évite de re-fetcher en boucle un échec.
    autoThumbnailUrl: v.optional(v.string()),
    thumbnailFetchedAt: v.optional(v.number()),
    thumbnailStatus: v.optional(
      v.union(v.literal("ok"), v.literal("failed")),
    ),
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
        // Provenance RADAR (ajout depuis l'onglet Outliers) — ratio de
        // surperformance et handle du compte source. Optionnels : nuls pour
        // toute inspiration saisie hors Radar, n'invalident rien d'existant.
        outlierRatio: v.optional(v.number()),
        authorHandle: v.optional(v.string()),
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
    // ─── POPULATION de la fiche — partenaire / talent / clippeur ───────────────
    // ABSENT = "partner" (créateur partenaire historique) ⇒ 0 migration : toutes
    // les fiches existantes restent des partenaires, au comportement inchangé.
    // Cette fiche est la SOURCE DE VÉRITÉ du rôle : le littéral `memberships.role`
    // en DÉRIVE au signup (convex/roles.roleForKind, appelé dans convex/auth.ts)
    // plutôt que d'être recopié sur l'invitation — régénérer un lien d'invitation
    // ne peut donc pas dériver du rôle réel de la personne.
    kind: v.optional(
      v.union(
        v.literal("partner"),
        v.literal("talent"),
        v.literal("clipper"),
      ),
    ),
    // ─── TALENT uniquement — le clippeur qui exploite ses rushes ───────────────
    // Q3 : 1 talent → 1 clippeur, 1 clippeur → 1..N talents. Un champ sur la fiche
    // du TALENT suffit donc (pas de table de jointure). Absent = pas encore
    // apparié ⇒ ses rushes ne sont visibles d'AUCUN clippeur. Posé par l'écran
    // d'appariement admin (chantier C2). Ignoré pour les autres populations.
    clipperId: v.optional(v.id("creators")),
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
    // Pricing v2 — grille de paliers de bonus du créateur (son "deal"). Les
    // paliers (tiers du pricing désigné) s'évaluent sur le CUMUL de ses vues.
    // FIXE/CPM restent par vidéo (pricingSnapshot par assignment) ; les paliers
    // sont créateur-niveau. undefined = aucun palier pour ce créateur.
    bonusPricingId: v.optional(v.id("pricings")),
    // ─── @ (handles) à CRÉER par réseau — consigne d'onboarding/warmup ─────────
    // Définis LIBREMENT par l'admin, PAR CRÉATEUR : le ou les @ que ce créateur
    // doit créer sur ses réseaux (en complément des mots-clés de warmup, par
    // compte). Saisie libre, chaque réseau optionnel (un réseau sans @ n'affiche
    // rien). Affichés au créateur dans « Mes comptes ». undefined/absent = aucune
    // consigne (onboarding inchangé). 0 migration (optional).
    handlesToCreate: v.optional(
      v.object({
        tiktok: v.optional(v.string()),
        youtube: v.optional(v.string()),
        instagram: v.optional(v.string()),
      }),
    ),
    // ─── Dépôt de fichiers Snytch — dossier Google Drive du créateur ──────────
    // SNYTCH UNIQUEMENT. Id du sous-dossier Drive (dans le dossier racine
    // "Snytch Créateurs", cf SNYTCH_DRIVE_ROOT_FOLDER_ID) créé par l'app à la
    // création du créateur (ou par le backfill). Le service account gère ce
    // dossier ; le créateur y dépose ses vidéos/photos (upload direct
    // navigateur → Drive). undefined = pas encore créé (créateur pré-feature,
    // env Drive absent au moment de la création, ou projet ≠ Snytch). Optional
    // → 0 migration. Cf convex/snytchDrive.ts (ensureCreatorFolder, idempotent).
    driveFolderId: v.optional(v.string()),
    // ─── ANCRE du cycle de paie J+30 GLISSANT ─────────────────────────────────
    // Date (ms) du TOUT PREMIER post publié du créateur. FIGÉE une seule fois (à
    // la 1re transition `published`, cf confirmPublicationCore + backfill), JAMAIS
    // réécrite → ancre stable. Le cycle courant = [firstPostAt + 30j·k, +30j·(k+1)),
    // k = floor((now − firstPostAt)/30j) (cf lib/pay-cycle.calcCycle). undefined =
    // aucun post publié → pas de cycle (« prochaine paie » non applicable). Optional
    // → 0 migration. N'affecte AUCUN montant (regroupement seulement).
    firstPostAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"]),

  // ─── Dépôt de fichiers Snytch — métadonnées des fichiers déposés ──────────
  // SNYTCH UNIQUEMENT. 1 row = 1 fichier (vidéo ou photo) déposé par un créateur
  // dans SON dossier Google Drive. Le FICHIER lui-même vit sur Drive (jamais
  // dans Convex/Vercel) : cette table ne stocke QUE des métadonnées légères pour
  // afficher la liste « ce que tu as déposé » sans rescanner Drive. Écrite par
  // snytchDrive.confirmUpload (creatorMutation) après un upload direct
  // navigateur → Drive réussi. Scopée par creatorId (un créateur ne voit que ses
  // fichiers, cf listMyDriveFiles). Aucune vue admin in-app (le fondateur accède
  // aux fichiers directement via son Google Drive). driveFileId = id Drive du
  // fichier (clé de dédup idempotente de confirmUpload). webViewLink/
  // thumbnailLink = liens éventuels renvoyés par Drive (non requis).
  snytchDriveFiles: defineTable({
    creatorId: v.id("creators"),
    projectId: v.id("projects"),
    driveFileId: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    uploadedAt: v.number(),
    webViewLink: v.optional(v.string()),
    thumbnailLink: v.optional(v.string()),
  }).index("by_creator", ["creatorId"]),

  // ─── RUSHES — les prises brutes déposées par un TALENT ─────────────────────
  // 1 row = 1 fichier vidéo brut. Le BINAIRE vit sur Google Drive (jamais dans
  // Convex, cf risque de quota) ; cette table porte les métadonnées ET la
  // MACHINE À ÉTATS, ce qui la distingue de `snytchDriveFiles` (liste plate du
  // créateur partenaire, sans cycle de vie). Les deux tables ne se mélangent
  // jamais : un dépôt de talent n'écrit QUE ici.
  //
  // ÉTATS (cf convex/rushStatus.ts, source unique des transitions) :
  //   deposited → assigned → published, plus rejected et expired (terminaux).
  //   `assigned` = un script a été monté dessus (chantier PR 4) ; le talent, lui,
  //   lit « Validé » — il ne connaît ni script, ni clippeur, ni appariement.
  //
  // BINAIRE : purgé au rejet et à l'expiration (60 j sans être retenu), les
  // métadonnées restant en base pour l'historique. `binaryPurgedAt` n'est posé
  // QUE si la suppression Drive a réellement eu lieu — un faux « purgé » sur un
  // fichier encore présent serait pire que pas de champ du tout.
  //
  // `sizeBytes` est une donnée OPÉRATIONNELLE (savoir si un talent filme en 4K60
  // quand 1080p suffirait), jamais une variable de décision : rien n'arbitre
  // dessus.
  rushes: defineTable({
    projectId: v.id("projects"),
    // Fiche `creators` du talent (kind "talent"). Le portail filtre TOUJOURS
    // dessus côté serveur : un talent ne voit jamais le rush d'un autre.
    talentId: v.id("creators"),
    // Référence Drive du binaire. Clé de dédup idempotente de confirmDeposit.
    driveFileId: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    status: v.union(
      v.literal("deposited"),
      v.literal("assigned"),
      v.literal("published"),
      v.literal("rejected"),
      v.literal("expired"),
    ),
    depositedAt: v.number(),
    webViewLink: v.optional(v.string()),
    thumbnailLink: v.optional(v.string()),
    // ─── Jalons du cycle de vie (posés à la transition, jamais réécrits) ──────
    // L'assignation script→rush est le chantier PR 4 : ces deux champs sont
    // écrits là-bas, jamais ici.
    assignmentId: v.optional(v.id("assignments")),
    assignedAt: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    rejectedAt: v.optional(v.number()),
    // ⚠️ CE TEXTE EST LU PAR LE TALENT (allowlist convex/talentRushFields.ts).
    // Écrit par un admin, affiché tel quel dans l'espace du talent : ce n'est PAS
    // un champ de note interne, et il est rendu en TEXTE BRUT côté écran (jamais
    // en markdown — c'est de la saisie libre répétée qui franchit une frontière
    // de rôle, pas du contenu éditorial). Borné serveur, cf rushes.rejectRush.
    rejectionReason: v.optional(v.string()),
    expiredAt: v.optional(v.number()),
    // Horodatage de la suppression EFFECTIVE du binaire sur Drive. Absent = le
    // fichier est (ou peut être) encore là — y compris sur un déploiement sans
    // env Drive, où la purge no-ope et ne ment pas.
    binaryPurgedAt: v.optional(v.number()),
  })
    .index("by_talent", ["talentId"])
    .index("by_project_status", ["projectId", "status"]),

  // ─── Reset mot de passe admin (Voie B) — lien à usage unique sans email ────
  // Un admin génère un lien /reset-password/<token> qu'il transmet au créateur
  // (WhatsApp). Pas de flux self-service "mot de passe oublié" (aucun service
  // email). Token aléatoire long, à usage unique (usedAt), expiration courte.
  // Lié au userId (compte déjà finalisé) + projectId (scope + branding page).
  // Stratégie : générer un nouveau lien SUPPRIME les anciens du même user
  // (un seul lien actif à la fois). Cf convex/passwordReset.ts.
  passwordResetTokens: defineTable({
    token: v.string(),
    userId: v.id("users"),
    projectId: v.id("projects"),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
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
    // Approche C — nom du créateur FIGÉ sur les assignments CONSERVÉS
    // (published/paid) au moment de la suppression du créateur (deleteCreator).
    // Le creatorId reste (référence morte mais utile pour regrouper l'historique)
    // ; ce snapshot rend la vue historique lisible quand la fiche n'existe plus.
    // undefined tant que le créateur existe (on lit son nom vivant).
    creatorNameSnapshot: v.optional(v.string()),
    // P7 : assignment "format". S2 : optional — un assignment a SOIT un formatId
    // SOIT un scriptCombo (assignment "script"). Champ assoupli → 0 migration.
    formatId: v.optional(v.id("formats")),
    // S2 — combo de script CAPTURÉ à l'assignation. assembledScript FIGÉ (comme
    // rateSnapshot) : ne bouge pas si une brick est éditée ensuite.
    scriptCombo: v.optional(
      v.object({
        campaignId: v.id("scriptCampaigns"),
        hookBrickId: v.id("scriptBricks"),
        // Refonte 3 briques — corpsBrickId LEGACY, optional : présent sur les
        // assignments figés AVANT la refonte (combo 4 kinds), absent après.
        // assembledScript reste du TEXTE autonome (corps + démo déjà cuits
        // dedans) → l'historique livré aux créateurs est intact.
        corpsBrickId: v.optional(v.id("scriptBricks")),
        fluxBrickId: v.id("scriptBricks"),
        ctaBrickId: v.id("scriptBricks"),
        assembledScript: v.string(),
        // TRACEUR « corrigé au moins une fois » : posé (true) par editScriptCombo/
        // editScriptBrickText à chaque correction. N'EST PLUS UN VERROU depuis
        // « éditer jusqu'à la publication » (le seul verrou est la publication,
        // cf representativePostedAt) — conservé pour l'historique. Optional →
        // 0 migration (absent = jamais corrigé).
        editedOnce: v.optional(v.boolean()),
      }),
    ),
    // S2 — signature top-level du combo. Refonte : "hook:flux:cta" (3 segments)
    // pour les nouveaux ; "hook:corps:flux:cta" (4 segments) pour l'historique.
    // Espaces de clés DISJOINTS → index by_creator_combo pour l'anti-coordination
    // (un créateur ne reçoit jamais deux fois le même combo).
    comboKey: v.optional(v.string()),
    // Rejeu — combinaison IMPOSÉE à l'assignation (« Rejouer ce script » ou mode
    // « Combinaison choisie »), au lieu du tirage auto anti-coordination. true
    // UNIQUEMENT dans ce cas ; absent = combo auto (0 bruit sur les lignes
    // existantes). Analytics : compté SANS distinction (perfByCombo/perfByBrick
    // lisent comboKey/brickIds, jamais ce flag). Anti-coordination : les lignes
    // imposées sont IGNORÉES du set usedKeys → le triplet reste piochable en auto
    // (« un choix manuel ne retire rien de la rotation »).
    comboImposed: v.optional(v.boolean()),
    // Lignage de rejeu — assignation SOURCE d'où ce combo a été rejoué. Posé pour
    // les entrées tracker/détail ; absent depuis l'entrée analytics (agrégat, pas
    // de source unique) et en mode « from scratch ». Relie même une VARIANTE
    // (comboKey différent après changement d'une brique) à son origine → permet de
    // comparer plus tard les reprises d'une même combinaison. (Carte de comparaison
    // = plus tard ; ici on POSE juste le champ.)
    replayedFrom: v.optional(v.id("assignments")),
    // Rejeu À L'IDENTIQUE — l'assignation porte le texte FIGÉ de la source
    // (`replayedFrom`), PAS une reconstruction depuis les briques vivantes. true =
    // « le texte qui a réellement marché » ; absent = texte actuel (reconstruction)
    // OU pas un rejeu. Posé pour comparer plus tard les deux modes de reprise à
    // combinaison égale (même comboKey). Cf assignScriptCampaign (branche verbatim).
    replayVerbatim: v.optional(v.boolean()),
    accountId: v.optional(v.id("comptes")),
    dueDate: v.number(),
    // ─── Date de PUBLICATION planifiée (« poste-la ce jour-là ») ───────────────
    // DISTINCTE de dueDate (échéance de PRODUCTION = « la vidéo doit être prête »).
    // Les deux coexistent. Optionnelle → additif, 0 migration : les assignments
    // existants restent sans date de post. Stockée en ms (minuit local du jour
    // choisi) ; le statut calendrier (à l'heure/en retard/manqué/prévu, brique B)
    // se calcule en la comparant à la date de publication réelle. NE remplace PAS
    // le statut de production (deux notions séparées).
    postDate: v.optional(v.number()),
    // ─── Compte GÉRÉ PAR L'ADMIN — flag DÉNORMALISÉ (copié du compte cible) ────
    // Posé à la CRÉATION de l'assignment (assignFormat) en copiant
    // comptes.managedByAdmin de la/les cible(s). FIGÉ ensuite (snapshot, comme
    // rateSnapshot/creatorNameSnapshot) : retoucher le compte ne réécrit pas les
    // assignments déjà créés. Permet aux surfaces ACTIONNABLES créatrice de lire
    // le mode SANS jointure vers le compte. true → l'admin soumet/publie
    // (confirmPublicationAsAdmin) et l'assignment est créé DIRECT en to_publish ;
    // la créatrice ne le voit qu'en LECTURE (script + post + perfs). Optional →
    // 0 migration (absent/false = mission créatrice classique).
    managedByAdmin: v.optional(v.boolean()),
    // Machine à états WORKFLOW MP4 (chantier vidéo-avant-publication) :
    //   todo → in_progress → video_submitted → [reject] video_rejected →
    //   (re-upload) video_submitted → [approve] to_publish → published → paid.
    // Le paiement + la matérialisation se déclenchent à `published` (pas à la
    // revue vidéo). Les littéraux LEGACY (submitted/validated/rejected) sont
    // conservés UNIQUEMENT pour que le déploiement valide les rows antérieures ;
    // migrateAssignmentStatuses les réécrit. Retrait = resserrage ultérieur.
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("video_submitted"),
      v.literal("video_rejected"),
      v.literal("to_publish"),
      v.literal("published"),
      v.literal("paid"),
      // LEGACY (migrés) :
      v.literal("submitted"),
      v.literal("validated"),
      v.literal("rejected"),
    ),
    // MP4 soumis (NON publié) : présent de video_submitted à published, PURGÉ du
    // storage à published. mimeType pour le <source type> de <VideoExample>.
    submittedVideoStorageId: v.optional(v.id("_storage")),
    submittedVideoMimeType: v.optional(v.string()),
    // ─── Cloudflare Stream — transcoding HEVC de la vidéo soumise ──────────────
    // La soumission Convex (submittedVideoStorageId, ci-dessus) reste la SOURCE
    // et le fallback (bouton télécharger #56). En plus, on copie la vidéo vers
    // Cloudflare Stream qui la TRANSCODE → un player lisible partout (.mov HEVC
    // iPhone inclus). UID Cloudflare + état du transcoding, posés HORS du chemin
    // critique (scheduler) par convex/cloudflareStream.ts. Optional → 0 migration
    // de schéma ; absent = pas de Stream (env Cloudflare manquant, copie échouée,
    // ou ancienne vidéo non migrée) → l'UI retombe sur le <video> Convex.
    submittedVideoStreamUid: v.optional(v.string()),
    submittedVideoStreamStatus: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("ready"),
        v.literal("error"),
      ),
    ),
    // Feedback admin au REFUS d'une vidéo (visible créateur). Remplace le rôle de
    // l'ancien adminFeedback (migré).
    videoReviewFeedback: v.optional(v.string()),
    // Anti-spam du rappel de deadline par email (cf convex/emails.ts) : posé au
    // 1er rappel ENVOYÉ, jamais réécrit → une mission ne génère qu'un rappel.
    // Optional : aucune migration, les assignments existants valent "jamais relancé".
    deadlineReminderSentAt: v.optional(v.number()),
    // Horodatage du REFUS vidéo (posé par reviewVideoReject). Sert à repérer les
    // refus qui STAGNENT (créateur qui n'a pas re-soumis depuis X jours) dans la
    // file « à traiter ». Optional : les refus antérieurs n'en ont pas et ne
    // remontent donc pas tant qu'ils ne sont pas re-refusés (dégradation assumée,
    // aucune migration).
    videoRejectedAt: v.optional(v.number()),
    // Anti-spam des relances MANUELLES admin (bouton « Relancer ») : 1 relance
    // par mission et par fenêtre de 24 h. Même approche que deadlineReminderSentAt.
    lastNudgeAt: v.optional(v.number()),
    // URL du post publié, fournie à l'étape `published` (= ancien submittedUrl,
    // migré). datePubli de la publication matérialisée = publishedAt.
    publishedUrl: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    // Traçabilité : QUI a saisi le lien de publication — "creator" (geste normal
    // depuis son espace) ou "admin" (secours, l'admin colle à sa place). ABSENT sur
    // tout l'historique d'avant ce champ → l'UI affiche « inconnu » (tiret), JAMAIS
    // "créatrice" par défaut (inventerait une info). Posé par confirmPublicationCore.
    publishedBy: v.optional(
      v.union(v.literal("creator"), v.literal("admin")),
    ),
    // submittedPlatform RÉUTILISÉ : plateforme du post publié (détectée à
    // publish). submittedUrl/submittedAt/adminFeedback = LEGACY (migrés).
    submittedUrl: v.optional(v.string()),
    submittedAt: v.optional(v.number()),
    submittedPlatform: v.optional(
      v.union(
        v.literal("TikTok"),
        v.literal("Instagram"),
        v.literal("YouTube"),
      ),
    ),
    // Posé à `published` (matérialisation publication).
    publicationId: v.optional(v.id("publications")),
    // ─── Chantier C — CIBLES multi-plateformes (1 vidéo → N posts) ───────────
    // 1 à 3 cibles FIGÉES à la création : 1 compte par plateforme, choisi parmi
    // les comptes DISPONIBLES (warmup terminé) du créateur. Chaque cible reçoit
    // son URL + sa publication à la publication (confirmPublication, le même
    // jour pour toutes). Les champs legacy ci-dessus
    // (accountId/publishedUrl/publishedAt/submittedPlatform/publicationId) sont
    // CONSERVÉS le temps de la migration migrateAssignmentsToTargets (resserrage
    // ultérieur documenté). `targets` optional → 0 crash de déploiement.
    // accountId de cible optional UNIQUEMENT pour les rows legacy migrées ; la
    // création neuve le pose toujours.
    targets: v.optional(
      v.array(
        v.object({
          platform: v.union(
            v.literal("TikTok"),
            v.literal("Instagram"),
            v.literal("YouTube"),
          ),
          accountId: v.optional(v.id("comptes")),
          publishedUrl: v.optional(v.string()),
          publishedAt: v.optional(v.number()),
          publicationId: v.optional(v.id("publications")),
        }),
      ),
    ),
    adminFeedback: v.optional(v.string()),
    // ─── Vidéos MODÈLES (liens) à reproduire ──────────────────────────────────
    // Liste de LIENS (pas de fichiers — l'hébergement d'assets est un autre
    // chantier) vers des vidéos existantes (TikTok/YouTube/Instagram) que le
    // créateur doit reproduire avec le script donné. Ajoutables/supprimables à
    // l'unité APRÈS l'assignation (addModelVideoToAssignment/removeModel…).
    // Array embarqué (pas de table dédiée) : petite liste bornée appartenant à
    // UN assignment, comme `targets` — patch unique, 0 jointure, exposée telle
    // quelle au créateur. `id` = clé stable (crypto.randomUUID) pour le retrait
    // à l'unité. La plateforme est dérivée de l'URL CÔTÉ UI (lib/inspiration-url)
    // → pas stockée. Optional → 0 migration.
    modelVideos: v.optional(
      v.array(
        v.object({
          id: v.string(),
          url: v.string(),
          title: v.optional(v.string()),
          note: v.optional(v.string()),
          addedAt: v.number(),
        }),
      ),
    ),
    // ─── Assets — N dossiers d'images/vidéos liés (à télécharger par le créateur)
    // assetFolderIds = lien MULTI (≠ modelVideos = liens vidéo à reproduire).
    // Modifiable/retirable (pas de verrou). Les fichiers vivent en Convex file
    // storage. Lecture DUAL : assetFolderIds prime ; sinon fallback sur le legacy
    // assetFolderId (single) tant que migrateAssetFolderToArray n'a pas tourné.
    assetFolderIds: v.optional(v.array(v.id("assetFolders"))),
    // LEGACY (single) — conservé optional le temps de la migration single→array
    // (deploy atomique : le schéma vit avant la migration data). Unset par
    // migrateAssetFolderToArray + setAssetFolders. Retrait = resserrage ultérieur.
    assetFolderId: v.optional(v.id("assetFolders")),
    // ─── Texte OVERLAY à incruster en haut de la vidéo (consigne visuelle) ─────
    // Une phrase OPTIONNELLE, saisie par l'admin AU NIVEAU DE L'ASSIGNMENT (peut
    // varier d'un créateur à l'autre pour un même script/format). Affichée au
    // créateur AU-DESSUS du hook comme « à incruster en haut de la vidéo » (pas un
    // texte à lire). S'applique à tous les mediaTypes. undefined/absent = aucun
    // overlay (comportement inchangé). 0 migration (optional).
    overlayText: v.optional(v.string()),
    // ─── INSTRUCTIONS libres de l'admin POUR la créatrice (par assignment) ─────
    // Consigne multi-ligne OPTIONNELLE, PROPRE À CETTE assignation (deux
    // créatrices sur le même script peuvent recevoir des instructions
    // différentes). DISTINCTE de overlayText (texte à incruster À L'ÉCRAN) et du
    // script (texte à publier) : ici c'est du « comment faire » — ex. « filme en
    // extérieur », « accent sur le hook les 2 premières secondes ». Affichée au
    // créateur dans son brief, encart distinct près du script/des vidéos modèles.
    // undefined/absent = aucun bloc (comme overlayText). 0 migration (optional).
    instructions: v.optional(v.string()),
    rateSnapshot: v.object({
      basePerPost: v.number(),
      viewBonusPer1k: v.optional(v.number()),
      bounties: v.optional(
        v.array(v.object({ thresholdViews: v.number(), amount: v.number() })),
      ),
    }),
    // ─── Pricing — barème FIGÉ à l'attribution (snapshot, jamais réécrit) ─────
    // Présent ⇔ l'assignment relève du NOUVEAU modèle de paie (fixe mensuel/vidéo
    // unique + CPM multi-plateforme + bonus seuil, cf lib/pricing-engine.ts).
    // Absent ⇔ legacy (rateSnapshot + lineItems base/bonus accruées à l'écriture).
    // Les deux populations sont DISJOINTES (Guard A/B/C) → 0 double paiement.
    // Optionnel → 0 migration. Modifier un pricing n'affecte QUE les futures
    // attributions ; supprimer/archiver un pricing ne casse pas les vidéos déjà
    // attribuées (elles ont leur snapshot).
    pricingSnapshot: v.optional(
      v.object({
        pricingId: v.id("pricings"),
        montantFixe: v.number(),
        nbVideosCible: v.number(),
        tauxCPM: v.number(),
        seuilBonusVues: v.number(),
        montantBonus: v.number(),
      }),
    ),
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
  // LEGACY : conservé comme FALLBACK du nouveau système de modules (guideModules)
  // tant qu'aucun module published n'existe — la page « Comment ça marche » n'est
  // jamais vide pendant la transition (cf convex/guideModules.ts).
  projectGuide: defineTable({
    projectId: v.id("projects"),
    content: v.string(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  // ─── « Comment ça marche » v2 — modules markdown par projet ───────────────
  // Base de connaissance / centre de formation : liste PLATE de modules par
  // projet (pas de hiérarchie). L'admin crée/édite/réordonne/supprime des
  // modules (markdown) ; le créateur lit les modules `published` rendus,
  // triés par `order`. Les `draft` ne sont JAMAIS visibles côté créateur.
  // Strictement scopé projet (un module ∈ un seul projet). Tri en mémoire par
  // (order, createdAt) — pas d'index composite (≤ qq dizaines de modules/projet).
  guideModules: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    contentMarkdown: v.string(),
    order: v.number(),
    status: v.union(v.literal("published"), v.literal("draft")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  // ─── Pricing — barèmes de rémunération réutilisables (scopés projet) ───────
  // Un pricing = un barème nommé attribuable à des vidéos (assignments). Modèle
  // à 3 composantes (cf lib/pricing-engine.ts) : FIXE mensuel (montantFixe pour
  // nbVideosCible vidéos uniques publiées, proratisé/plafonné), CPM (tauxCPM $
  // par 1000 vues, toutes plateformes sommées), BONUS (montantBonus au-delà de
  // seuilBonusVues, par vidéo). À l'attribution les valeurs sont FIGÉES sur
  // l'assignment (pricingSnapshot) → modifier/archiver un pricing n'affecte que
  // les futures attributions. deletePricing si non utilisé, sinon archivePricing.
  pricings: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    montantFixe: v.number(),
    nbVideosCible: v.number(), // >= 1 (imposé serveur, anti division par zéro)
    tauxCPM: v.number(), // $ par 1000 vues
    // LEGACY (pricing v1, seuil de bonus UNIQUE par vidéo) — conservés en
    // lecture pour les pricings/snapshots existants ; `tiersOf()` les convertit
    // en 1 palier cash. 0 migration.
    seuilBonusVues: v.optional(v.number()),
    montantBonus: v.optional(v.number()),
    // Pricing v2 — PALIERS de bonus (0..N), évalués sur le CUMUL TOTAL À VIE des
    // vues du créateur (cf lib/pricing-engine.ts). Chaque palier récompense en
    // CASH (montant $, compté dans le total) ou en NATURE (libelle, ex.
    // "iPhone" — hors total $, suivi comme récompense due).
    bonusTiers: v.optional(
      v.array(
        v.object({
          seuilVues: v.number(),
          rewardType: v.union(v.literal("cash"), v.literal("nature")),
          montant: v.optional(v.number()),
          libelle: v.optional(v.string()),
          // NATURE uniquement — ce que l'objet nous COÛTE (prix d'achat négocié),
          // jamais son prix public. Fait entrer les récompenses en nature dans le
          // coût complet du moteur. Absent ⇒ la valeur s'affiche en tiret, jamais
          // à 0 (un 0 se lirait comme « gratuit »). JAMAIS montré à la créatrice.
          coutReel: v.optional(v.number()),
        }),
      ),
    ),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
  }).index("by_project", ["projectId"]),

  // ─── Pricing v2 — paliers de bonus DÉBLOQUÉS (cumul de vues créateur) ───────
  // 1 row = UN palier débloqué par UN créateur, IMMUABLE. La récompense est
  // FIGÉE au déblocage (rewardType/montant/libelle) → éditer la grille n'altère
  // pas les unlocks passés. `attributionPeriod` est figée à la sync (avec
  // rollover si la période d'origine est déjà payée → la récompense cash n'est
  // jamais perdue). Idempotence : (creatorId, pricingId, seuilVues) unique.
  bonusUnlocks: defineTable({
    projectId: v.id("projects"),
    creatorId: v.id("creators"),
    pricingId: v.id("pricings"),
    seuilVues: v.number(),
    rewardType: v.union(v.literal("cash"), v.literal("nature")),
    montant: v.optional(v.number()),
    libelle: v.optional(v.string()),
    // Coût réel FIGÉ au déblocage, comme le reste de la récompense : renégocier
    // le prix d'un iPhone ne doit pas réécrire ce qu'a coûté celui déjà dû.
    coutReel: v.optional(v.number()),
    unlockedAt: v.number(),
    cumulAtUnlock: v.number(),
    // "YYYY-MM" — période où la récompense cash compte (cf periodOf). Jamais une
    // période déjà payée (rollover sur la période ouverte courante).
    attributionPeriod: v.string(),
    // ─── Marqueur "célébration vue" (progression créateur) ────────────────────
    // UI SEULE : timestamp (ms) où la créatrice a vu l'overlay de célébration de
    // CE palier. N'entre dans AUCUN calcul $ (ni totalDue, ni breakdown) — seul
    // le portail progression le lit. undefined = pas encore vu → candidat à la
    // célébration (borné à CELEBRATION_MAX_AGE_MS pour ne pas rejouer l'historique
    // au 1er déploiement). Optional → 0 migration. Cf convex/progression.ts.
    celebrationSeenAt: v.optional(v.number()),
  })
    .index("by_creator", ["creatorId"])
    .index("by_project", ["projectId"])
    .index("by_creator_pricing_seuil", ["creatorId", "pricingId", "seuilVues"]),

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
    // Approche C — nom du créateur FIGÉ au moment de la suppression du créateur
    // (deleteCreator). Le paiement est CONSERVÉ (historique financier) ; ce
    // snapshot rend la liste paiements/CSV lisible quand la fiche n'existe plus.
    // undefined tant que le créateur existe (on lit son nom vivant).
    creatorNameSnapshot: v.optional(v.string()),
    // Période d'accrual, "YYYY-MM" (UTC, cf periodOf dans convex/payments.ts).
    period: v.string(),
    lineItems: v.array(
      v.object({
        // Optionnel : un palier de bonus CUMULÉ (bonus_tier) n'est lié à aucun
        // assignment précis (récompense créateur-niveau).
        assignmentId: v.optional(v.id("assignments")),
        label: v.string(),
        amount: v.number(),
        // base/bonus = LEGACY (accrual à l'écriture ; bonus = bonus PAR VIDÉO v1).
        // fixed/cpm = pricing par vidéo, GELÉS au paiement. bonus_tier = palier
        // de bonus CASH sur cumul (v2), GELÉ au paiement — DISJOINT de `bonus`
        // (aucune période ne peut double-compter les deux).
        kind: v.union(
          v.literal("base"),
          v.literal("bonus"),
          v.literal("fixed"),
          v.literal("cpm"),
          v.literal("bonus_tier"),
        ),
        // Chantier C — plateforme du post (paiement PAR POST : N lineItems base
        // par assignment, 1 par cible). Optional : le bonus (1/assignment) et
        // les lineItems legacy n'en portent pas.
        platform: v.optional(
          v.union(
            v.literal("TikTok"),
            v.literal("Instagram"),
            v.literal("YouTube"),
          ),
        ),
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

  // ─── Revenu Whop importé (rentabilité P2) — 1 row = 1 paiement Whop ─────────
  // Alimentée par le cron horaire (convex/whopSync) qui interroge l'API Whop du
  // compte rattaché au projet (projects.whop). DÉDUPLIQUÉE par whopId (idempotent :
  // re-synchroniser MET À JOUR statut/montants — ex. paid→refunded — sans jamais
  // créer de doublon). Rattachée au bon projet via le mapping (jamais de mélange).
  // Le NET (montant qui arrive réellement sur le solde après frais Whop) est le
  // champ de PILOTAGE ; brut + frais conservés pour la transparence. Un
  // remboursement (statut "refunded" et/ou refundedAmount > 0) FAIT BAISSER le net
  // effectif ; un paiement échoué/pending ne compte pas (cf lib/whop-revenue).
  whopPayments: defineTable({
    projectId: v.id("projects"),
    // ID Whop du paiement — clé de DÉDUP (unique côté Whop).
    whopId: v.string(),
    // Statut NORMALISÉ (cf lib/whop-revenue.normalizeWhopStatus) ; rawStatus garde
    // la valeur brute de l'API pour l'audit/debug.
    status: v.union(
      v.literal("paid"),
      v.literal("refunded"),
      v.literal("failed"),
      v.literal("pending"),
      v.literal("disputed"),
      v.literal("other"),
    ),
    rawStatus: v.string(),
    currency: v.string(),
    // Montants dans l'unité de la devise (nombre décimal, ex. USD). grossAmount =
    // brut encaissé ; feeAmount = frais Whop ; netAmount = net réellement settlé
    // (brut − frais) ; refundedAmount = montant remboursé (0 si aucun) → diminue
    // le net EFFECTIF (netContribution). Le net est le chiffre de pilotage.
    grossAmount: v.number(),
    feeAmount: v.number(),
    netAmount: v.number(),
    refundedAmount: v.number(),
    // Date du paiement (ms epoch) — quand l'argent est entré (ou a été tenté).
    paidAt: v.number(),
    // Produit/plan + membership Whop (rattachement fin + affichage) si l'API les
    // fournit. planId sert AUSSI au filtrage anti-mélange (projects.whop.planIds).
    planId: v.optional(v.string()),
    membershipId: v.optional(v.string()),
    // MOTIF de facturation Whop : `subscription_create` = premier paiement d'un
    // abonnement (client NOUVEAU), `subscription_cycle` = échéance suivante
    // (RENOUVELLEMENT). C'est le SEUL champ qui sépare acquisition et rétention
    // dans le revenu : sans lui, une journée entièrement faite de
    // renouvellements affiche « 0 client payant » sans rien pour l'expliquer.
    // Valeur BRUTE (pas un booléen) : une valeur future inconnue reste lisible.
    // Optionnel : absent des rows importées avant sa capture.
    billingReason: v.optional(v.string()),
    // CAUSE de l'échec (`failure_message` Whop) : « fonds insuffisants », « carte
    // expirée »… Un renouvellement raté pour fonds insuffisants se relance ; un
    // désabonnement, non. Sans la cause, les deux se lisent pareil.
    failureMessage: v.optional(v.string()),
    // Whop RELANCERA-T-IL ce paiement ? Sépare une échéance ENCORE EN JEU
    // (retryable) d'un échec DÉFINITIF (relances épuisées) — c'est ce qui permet
    // au taux de renouvellement de trancher au lieu de tout ranger « en attente ».
    retryable: v.optional(v.boolean()),
    // Pseudo Whop du client (username) — pour identifier un litige à traiter.
    // Optionnel : peuplé à partir de la re-synchro (rows anciennes = absent).
    memberName: v.optional(v.string()),
    // LITIGE (chargeback) EN COURS : échéance de réponse (needs_response_by, ms) et
    // motif. Le délai restant est URGENT (frais de litige > abonnement). Optionnels :
    // présents seulement sur un paiement en litige, dès que la synchro les a lus.
    disputeDueAt: v.optional(v.number()),
    disputeReason: v.optional(v.string()),
    importedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_whopId", ["whopId"])
    .index("by_project_paidAt", ["projectId", "paidAt"]),

  // Libellés des offres Whop (cache d'un appel /plans). L'ID `plan_22OfkN5xAE13m`
  // ne dit rien ; « Hebdo 3 cibles » oui. Récupéré au cron whopSync, tolérant à
  // l'échec (on garde le prix, dérivé des paiements, si l'appel échoue). Champs
  // optionnels : l'API Whop ne fournit pas toujours un nom.
  whopPlans: defineTable({
    projectId: v.id("projects"),
    // ID Whop du plan (clé de jointure avec whopPayments.planId).
    planId: v.string(),
    // Libellé lisible fourni par Whop (title/name/internal_notes) si présent.
    name: v.optional(v.string()),
    // Prix et cadence si l'API les fournit (jamais fabriqués).
    price: v.optional(v.number()),
    currency: v.optional(v.string()),
    interval: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_planId", ["projectId", "planId"]),

  // État des ABONNEMENTS Whop (memberships) — source qui FAIT FOI pour le churn.
  // whopPayments dit qui a payé ; whopMemberships dit qui a encore accès, qui a
  // résilié (annulé mais accès valide) et qui a expiré (accès perdu = vrai churn).
  // Alimenté par le cron whopSync (fetchWhopMemberships), dédup par whopMembershipId.
  whopMemberships: defineTable({
    projectId: v.id("projects"),
    whopMembershipId: v.string(),
    // ID de l'UTILISATEUR Whop — une personne peut avoir PLUSIEURS memberships
    // (contrôle de cohérence « N abonnements pour M personnes »).
    whopUserId: v.optional(v.string()),
    planId: v.optional(v.string()),
    // Statut brut Whop (active/canceled/expired/trialing/past_due…) — normalisé au calcul.
    status: v.string(),
    // L'utilisateur a-t-il ENCORE accès (résilié ≠ expiré tant que valid = true).
    valid: v.optional(v.boolean()),
    // Début de l'abonnement (ms). canceledAt = annulation (ms) si résilié.
    createdAt: v.number(),
    canceledAt: v.optional(v.number()),
    // Fin d'accès / de la période courante (ms) — passée = expiré si non renouvelé.
    accessEndsAt: v.optional(v.number()),
    // ─── Test A/B : la metadata Whop RATTACHE le revenu à un bras ────────────
    // Posée par l'app au checkout, donc avant tout dénouement de paiement — un
    // litige ultérieur ne la modifie pas. ⚠️ L'app emploie le camelCase ici
    // (`abVariant`) et le snake_case côté PostHog (`experiment_variant`) :
    // chercher l'un dans l'autre ne rend rien. Cf convex/whopApi.
    abVariant: v.optional(v.string()),
    abExperiment: v.optional(v.string()),
    // Bras FORCÉ en QA : à écarter du revenu comme il l'est déjà des events.
    abForced: v.optional(v.boolean()),
    // Personne PostHog — voie de REPLI si abVariant manque sur un abonnement.
    distinctId: v.optional(v.string()),
    importedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_whopMembershipId", ["whopMembershipId"]),

  // Journal des CHANGEMENTS D'OFFRE — horodaté, saisi par l'admin. Sans lui, deux
  // cohortes ne sont pas comparables (un prix change, le plan gratuit apparaît, un
  // webhook tombe…). Alimenté via analyticsHub.addOfferChange.
  offerChanges: defineTable({
    projectId: v.id("projects"),
    // Horodatage du changement (ms epoch).
    at: v.number(),
    title: v.string(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_project", ["projectId"]),

  // ─── Cache des agrégats PostHog (hub Analytics) ────────────────────────────
  // L'API PostHog est LENTE et limitée en débit → elle n'est JAMAIS appelée dans
  // le chemin de rendu. Le cron horaire (posthogSync.runHourlySync) écrit ici un
  // agrégat par `key` ; les queries admin lisent UNIQUEMENT ce cache. `json` =
  // payload sérialisé : les formes sont hétérogènes d'une key à l'autre, un
  // validator par métrique figerait le schéma à chaque nouvelle carte.
  // `error` porte le DERNIER échec pour cette key SANS effacer la dernière
  // valeur connue → l'UI peut servir la donnée périmée en l'horodatant.
  posthogCache: defineTable({
    projectId: v.id("projects"),
    // Identifiant de l'agrégat (cf POSTHOG_CACHE_KEYS dans convex/posthogSync).
    key: v.string(),
    json: v.string(),
    computedAt: v.number(),
    error: v.optional(v.string()),
  }).index("by_project_key", ["projectId", "key"]),

  // ─── S1 — Système de scripts combinatoire ─────────────────────────────────
  // Refonte 3 briques — une vidéo = 1 hook + 1 flux + 1 cta. Une "campagne de
  // scripts" regroupe la banque de bricks (hooks par tier + flux + cta) d'un
  // angle de test. Le kind "corps" et le socle DÉMO ont été retirés du montage
  // (corps reclassés en hooks ; démo = répétition du flux). Tables neuves.
  scriptCampaigns: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    // LEGACY (refonte 3 briques) — socle démo, plus monté ni édité côté UI.
    // Conservé (required, défaut "") pour 0 migration sur scriptCampaigns ;
    // suppression = resserrage ultérieur.
    demoBlock: v.string(),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  // Une brique = un fragment combinable, discriminé par `kind`. Refonte : les
  // kinds COMBINABLES sont hook/flux/cta. "corps" est LEGACY — gardé dans
  // l'union pour que les rows pré-migration valident le schéma ; la mutation
  // migrateCorpsToHooks les reclasse en hook (tier A) et le CRUD ne crée plus
  // de corps. Resserrage (retrait de "corps") une fois la migration confirmée.
  // `tier` (S/A/B) UNIQUEMENT pour les hooks (undefined sinon). `active` : une
  // brique désactivée ne sera pas combinée. Les hooks importés depuis la
  // bibliothèque sont COPIÉS ici (bricks indépendants), la biblio reste intacte.
  scriptBricks: defineTable({
    projectId: v.id("projects"),
    campaignId: v.id("scriptCampaigns"),
    kind: v.union(
      v.literal("hook"),
      v.literal("corps"), // LEGACY — reclassé en "hook" par migrateCorpsToHooks
      v.literal("flux"),
      v.literal("cta"),
    ),
    label: v.string(),
    content: v.string(),
    // Tier de hook. Affichage : "S" → « Argent », "A" → « Autre » (cf
    // lib/script-tier). "B" = LEGACY toléré dans l'union : migré en "A" par
    // migrateTierBToA, plus jamais proposé par l'UI. Conservé ici pour que le
    // deploy ne casse pas tant que des "B" subsistent (migration post-deploy).
    tier: v.optional(v.union(v.literal("S"), v.literal("A"), v.literal("B"))),
    // SNYTCH — mode d'usage du texte DANS LA VIDÉO (zone 🎬), PAR BRIQUE (hook /
    // flux) : "dire" = à dire à l'oral ; "afficher" = à afficher en texte à
    // l'écran ; "les_deux" = les deux. Optional → défaut "les_deux" au READ
    // (rétrocompat : briques existantes rendues à l'identique, 0 migration).
    // Ignoré pour cta (zone description) et corps (legacy). Lu LIVE par
    // splitScriptZones — ORTHOGONAL à assembledScript (la garde anti-divergence,
    // fondée sur le contenu, reste inchangée : changer le mode ne casse pas le
    // découpage d'un combo déjà assigné).
    mode: v.optional(
      v.union(v.literal("dire"), v.literal("afficher"), v.literal("les_deux")),
    ),
    active: v.boolean(),
    order: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_campaign_kind", ["campaignId", "kind"])
    // S2 — résumé combo côté admin (charge les bricks du projet pour les labels).
    .index("by_project", ["projectId"]),

  // ─── Assets — bibliothèque de FICHIERS en dossiers (matériel à télécharger) ──
  // IMAGES (jpg/png/webp) + VIDÉOS courtes (mp4/mov/webm), hébergées en Convex
  // file storage. Un dossier (assetFolders) regroupe des fichiers (assets) ; on
  // lie UN OU PLUSIEURS dossiers à un assignment (assignments.assetFolderIds)
  // pour que le créateur les télécharge. Scopé projet. ≠ inspirations (veille) et
  // ≠ modelVideos (liens vidéo à reproduire) : ici ce sont de VRAIS FICHIERS.
  assetFolders: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    createdAt: v.number(),
    /**
     * « Contenu à publier » : les IMAGES déposées dans ce dossier sont
     * post-traitées à l'ingestion (retrait C2PA/EXIF/XMP + ré-encodage, cf.
     * lib/image-postprocess.ts).
     *
     * OPT-IN, absent = false. Assets mélange deux natures de fichiers : du
     * matériel de campagne final (à traiter) et du matériel SOURCE que les
     * créatrices retravaillent — le pipeline est destructif (recompression
     * JPEG irréversible), il ne doit jamais s'appliquer par défaut. Un dossier
     * non marqué reste donc intact, y compris tout le stock antérieur au flag.
     */
    postprocessImages: v.optional(v.boolean()),
  }).index("by_project", ["projectId"]),

  assets: defineTable({
    projectId: v.id("projects"),
    folderId: v.id("assetFolders"),
    // Référence Convex file storage (le blob image). Résolu en URL signée
    // SERVEUR (ctx.storage.getUrl) — le client ne manipule jamais le storageId.
    storageId: v.id("_storage"),
    fileName: v.string(),
    // contentType/size validés (image jpg/png/webp, ≤ max) à la création.
    contentType: v.string(),
    size: v.number(),
    createdAt: v.number(),
    /**
     * Horodatage du post-traitement, posé par la route d'ingestion ET par le
     * script de migration. Marqueur PERSISTÉ, et pas une détection : le
     * pipeline corrigé n'écrit AUCUNE métadonnée (c'est tout l'intérêt d'avoir
     * supprimé `withMetadata`), il ne reste donc rien d'intrinsèque à
     * reconnaître — et l'absence d'EXIF ne prouve rien (un PNG exporté n'en a
     * jamais eu). Sans ce champ, une 2ᵉ passe de migration recompresserait une
     * image déjà recompressée.
     */
    postprocessedAt: v.optional(v.number()),
    /**
     * SAUVEGARDE de l'original, posée UNIQUEMENT par le script de rattrapage du
     * stock (scripts/postprocess-existing-assets.ts) : le blob d'origine n'est
     * pas purgé mais mis de côté, avec ses métadonnées de row, pour permettre un
     * retour arrière (`--restore`) tant que le rendu n'est pas validé.
     *
     * ⚠️ Ces blobs CONSERVENT les métadonnées de provenance qu'on cherche à
     * retirer — c'est une rétention TEMPORAIRE, à purger (`--purge-backups`) une
     * fois le rendu validé. Ils doublent aussi l'espace de stockage occupé.
     *
     * L'ingestion normale, elle, ne sauvegarde RIEN : l'admin a encore le
     * fichier en local, et garder l'original annulerait l'intérêt du nettoyage.
     */
    postprocessBackup: v.optional(
      v.object({
        storageId: v.id("_storage"),
        fileName: v.string(),
        contentType: v.string(),
        size: v.number(),
      }),
    ),
  })
    .index("by_folder", ["folderId"])
    .index("by_project", ["projectId"]),

  // ─── Embed des vidéos MODÈLES (cache résolution shortlink + vignette) ───────
  // Les « vidéos à reproduire » (assignments.modelVideos) sont des LIENS. Pour
  // les afficher en lecteur intégré (VideoExample) on doit : résoudre les
  // shortlinks TikTok (vm./vt.tiktok.com → URL canonique /@user/video/ID, requis
  // par l'oEmbed) et récupérer une vignette (oEmbed TikTok/IG, vignette YouTube
  // directe). Ces deux opérations sont des I/O réseau (action). CACHE read-through
  // keyé par l'URL D'ORIGINE → on ne re-résout jamais le même lien. Aucune donnée
  // sensible (URL publique). Découplé de modelVideos (le modèle « liens » et le
  // flux admin d'ajout sont inchangés) ; partagé entre missions citant la même URL.
  modelVideoEmbeds: defineTable({
    url: v.string(), // URL d'origine (clé de cache)
    canonicalUrl: v.optional(v.string()), // shortlink résolu, sinon = url
    thumbnailUrl: v.optional(v.string()),
    status: v.union(v.literal("ok"), v.literal("failed")),
    fetchedAt: v.number(),
  }).index("by_url", ["url"]),

  // ─── RADAR — veille TikTok (Brique 1 : comptes favoris + leurs vidéos) ───────
  // Module ADMIN UNIQUEMENT, SILO séparé : aucun lien avec creators/publications/
  // comptes (le tracking créateurs est un autre module). Scopé projet via
  // adminQuery/adminMutation (un créateur n'atteint AUCUNE fonction Radar). Source
  // de données : Apify (clockworks/tiktok-scraper) avec un COMPTE Apify DISTINCT
  // (clé APIFY_RADAR_TOKEN) pour isoler les quotas du tracking créateurs.

  // Comptes TikTok mis en favori et suivis. Unicité (projet, handle) via
  // by_project_handle (refus des doublons à l'ajout).
  radarAccounts: defineTable({
    projectId: v.id("projects"),
    handle: v.string(), // @ normalisé, SANS le « @ » (ex. "khaby.lame")
    platform: v.literal("tiktok"), // extensible plus tard (IG/YT)
    note: v.optional(v.string()), // tag/note libre du fondateur
    authorFansSnapshot: v.optional(v.number()), // abonnés au dernier sync
    lastSyncAt: v.optional(v.number()), // dernier sync RÉUSSI (même si 0 vidéo)
    addedAt: v.number(),
  })
    .index("by_handle", ["handle"])
    .index("by_project", ["projectId"])
    .index("by_project_handle", ["projectId", "handle"]),

  // Vidéos récupérées d'un compte favori. Upsert idempotent par
  // (radarAccountId, tiktokId) : une vidéo déjà connue est MISE À JOUR (stats
  // fraîches), jamais dupliquée.
  radarVideos: defineTable({
    projectId: v.id("projects"),
    radarAccountId: v.id("radarAccounts"),
    tiktokId: v.string(), // id numérique de la vidéo (clé d'upsert)
    url: v.string(), // webVideoUrl canonique (/@user/video/<id>)
    publishedAt: v.number(), // createTimeISO → ms
    caption: v.optional(v.string()),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    shares: v.number(),
    saves: v.number(),
    durationSec: v.optional(v.number()),
    coverUrl: v.optional(v.string()), // miniature TikTok (peut expirer → fallback UI)
    musicName: v.optional(v.string()),
    hashtags: v.array(v.string()),
    authorHandle: v.optional(v.string()),
    isAd: v.boolean(),
    isPinned: v.boolean(),
    isSlideshow: v.boolean(),
    // Bucket d'affichage : true = dans le top vues (sorting "popular") au dernier
    // sync ; false/absent = candidate « dernières vidéos ». Règle de dédup :
    // populaire prioritaire (une vidéo récente ET populaire est marquée populaire).
    // Optional → 0 migration (anciennes lignes = non populaires).
    isPopular: v.optional(v.boolean()),
    lastSeenAt: v.number(), // dernier sync où la vidéo est réapparue
  })
    .index("by_radarAccount", ["radarAccountId"])
    .index("by_account_tiktok", ["radarAccountId", "tiktokId"])
    .index("by_project", ["projectId"]),

  // ─── RADAR Brique 2 — Tendances (hashtags qui montent par pays → vidéos) ─────
  // Silo séparé, ADMIN ONLY, cache GLOBAL (cross-projet : la veille tendances est
  // partagée par tous les projets, clé = pays seul). Source : data_xplorer/tiktok-
  // trends (hashtags tendance par pays, Creative Center) puis clockworks (vidéos
  // d'un hashtag, filtrées < 14 j côté serveur). Chargement À LA DEMANDE (pas de
  // cron) : le cache d'un pays est REMPLACÉ à chaque actualisation.
  // `projectId` est VESTIGIAL (optional, plus écrit) — voir TD-RADAR-projectId-drop.

  // Cache des hashtags tendance d'un pays. `videosFetchedAt`/`videosError` portent
  // l'état du fetch des vidéos de CE hashtag (chargement paresseux au clic).
  radarTrendHashtags: defineTable({
    projectId: v.optional(v.id("projects")), // VESTIGIAL — cache global, plus écrit
    countryCode: v.string(), // "US","FR",...
    hashtag: v.string(), // tel que renvoyé, ex. "#nbadraft"
    hashtagId: v.optional(v.string()),
    rank: v.number(),
    posts: v.optional(v.number()),
    videoViews: v.optional(v.number()),
    trendDirection: v.optional(v.string()), // "up" | "down" | "stable"
    topCreators: v.optional(
      v.array(
        v.object({
          handle: v.string(),
          nickname: v.optional(v.string()),
          country: v.optional(v.string()),
          followers: v.optional(v.number()),
        }),
      ),
    ),
    tiktokUrl: v.optional(v.string()),
    period: v.optional(v.string()),
    fetchedAt: v.number(), // dernier fetch des hashtags du pays
    videosFetchedAt: v.optional(v.number()), // dernier fetch RÉUSSI des vidéos (null=jamais)
    videosError: v.optional(v.boolean()), // dernier fetch vidéos en échec ?
  })
    .index("by_country", ["countryCode"])
    .index("by_country_hashtag", ["countryCode", "hashtag"]),

  // Vidéos d'un hashtag tendance (rattachées à hashtag+pays, PAS à un compte
  // favori → table séparée de radarVideos). Déjà filtrées < 14 j. Remplacées à
  // chaque fetch (les vues bougent). Même shape vidéo que radarVideos.
  radarTrendVideos: defineTable({
    projectId: v.optional(v.id("projects")), // VESTIGIAL — cache global, plus écrit
    countryCode: v.string(),
    hashtag: v.string(),
    tiktokId: v.string(),
    url: v.string(),
    publishedAt: v.number(),
    caption: v.optional(v.string()),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    shares: v.number(),
    saves: v.number(),
    durationSec: v.optional(v.number()),
    coverUrl: v.optional(v.string()),
    musicName: v.optional(v.string()),
    hashtags: v.array(v.string()),
    authorHandle: v.optional(v.string()),
    isAd: v.boolean(),
    isPinned: v.boolean(),
    isSlideshow: v.boolean(),
    fetchedAt: v.number(),
  }).index("by_country_hashtag", ["countryCode", "hashtag"]),

  // ─── RADAR Brique 3 — Recherche d'outliers (mot-clé → vidéos scorées) ────────
  // Silo séparé, ADMIN ONLY, cache GLOBAL (cross-projet : la même recherche depuis
  // n'importe quel projet partage l'entrée, clé = mot-clé seul). Source :
  // clockworks/tiktok-scraper en mode RECHERCHE par mot-clé (proxy US). Le lot
  // récupéré est filtré (anglophone), scoré (outlierRatio = vues/abonnés) et trié
  // côté serveur, puis MIS EN CACHE par mot-clé normalisé. CACHE 24 H (garde-fou
  // budget : l'appel est pay-per-result + add-ons) : une même recherche dans la
  // fenêtre resert le cache, AUCUN appel Apify. Une ligne = un mot-clé ; les vidéos
  // scorées sont stockées inline (lot borné). Remplacée au rafraîchissement.
  // `projectId` est VESTIGIAL (optional, plus écrit) — voir TD-RADAR-projectId-drop.
  radarSearches: defineTable({
    projectId: v.optional(v.id("projects")), // VESTIGIAL — cache global, plus écrit
    keyword: v.string(), // mot-clé NORMALISÉ (trim + lowercase) — clé de cache
    rawKeyword: v.string(), // saisie d'origine (affichage)
    fetchedAt: v.number(), // dernier run Apify RÉUSSI (base de la fraîcheur cache)
    totalFetched: v.number(), // taille du lot brut Apify (avant filtre/scoring)
    // Vidéos déjà filtrées (anglophone), scorées (outlierRatio) et triées
    // décroissant, avec les flags de récurrence par compte (calculés au fetch).
    videos: v.array(
      v.object({
        tiktokId: v.string(),
        url: v.string(),
        authorId: v.union(v.string(), v.null()), // id numérique stable (groupage)
        authorHandle: v.union(v.string(), v.null()),
        publishedAt: v.number(),
        caption: v.union(v.string(), v.null()),
        coverUrl: v.union(v.string(), v.null()),
        views: v.number(),
        fans: v.union(v.number(), v.null()), // abonnés du compte
        likes: v.number(),
        comments: v.number(),
        shares: v.number(),
        durationSec: v.union(v.number(), v.null()),
        outlierRatio: v.number(), // vues / abonnés
        accountOutlierCount: v.number(), // nb de vidéos outlier de ce compte
        isRecurringAccount: v.boolean(), // ≥ 2 vidéos outlier du même compte
      }),
    ),
  }).index("by_keyword", ["keyword"]),

  // ─── Garde-fou ANTI-FLOOD des notifications ────────────────────────────────
  // Une fenêtre de groupage OUVERTE, par (projet, type d'événement). Table de
  // TRAVAIL, pas d'historique : un document naît au front montant et est
  // SUPPRIMÉ par son flush.
  //
  // C'est l'EXISTENCE du document qui fait foi, jamais une comparaison de temps :
  // le flush lit et supprime dans la MÊME transaction (notifications.claimWindow),
  // donc une soumission qui arrive pile à la fermeture est soit incluse dans le
  // message groupé, soit à l'origine d'une nouvelle fenêtre — jamais perdue entre
  // les deux. La démonstration des deux ordonnancements est dans
  // lib/notification-window.test.ts. Logique pure : convex/notificationWindow.ts.
  notificationWindows: defineTable({
    projectId: v.id("projects"),
    // Type d'événement groupé. "submission" couvre soumission ET re-soumission :
    // c'est le même geste côté lecteur (une vidéo entre dans la file de validation).
    kind: v.string(),
    openedAt: v.number(),
    // ÉCHANTILLON des lignes tamponnées (plafonné, cf PENDING_CAP)…
    pending: v.array(v.string()),
    // …et le total RÉEL, jamais plafonné : le message annonce le vrai nombre et
    // n'affiche qu'un échantillon. Un décompte tronqué se lirait comme un total.
    pendingCount: v.number(),
  }).index("by_project_kind", ["projectId", "kind"]),
});
