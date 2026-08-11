# Diagnostic — espaces Créatrice vidéo & Clippeur

> **INSTANTANÉ daté du 2026-08-11, AVANT la PR 1 du chantier.** Conservé tel quel
> — c'est un état des lieux, pas un document vivant. Les décisions prises depuis,
> et l'état courant, vivent dans [`ARBITRAGES-ROLES.md`](./ARBITRAGES-ROLES.md).
>
> Trois points de ce document ont déjà bougé :
> - la fuite de configuration de `getProjectForCurrentUser` (risque 5) est
>   **corrigée** — projection whitelistée depuis la PR 1 (#25) ;
> - le vocabulaire a été fixé : « créatrice vidéo » se dit **talent** ;
> - le **risque n°1 est surestimé d'un facteur ~5**. Il calculait des lots de
>   6,25 Go sur une hypothèse de 250 Mo par rush. Mesure du 2026-08-11 :
>   `snytchDriveFiles` est vide (aucun rush n'a jamais été déposé), et les seules
>   vidéos téléphone réelles du système pèsent 19 Mo (soumission en vol) et 80 à
>   138 Mo (6 montages finis). Le lot réel est attendu autour de **1,25 Go** →
>   le chemin séquentiel existant suffit en phase 1. Détail dans D4 des arbitrages.

Lecture seule. Chaque affirmation cite un chemin. Ce qui n'a pas été vérifié est
marqué **[NON VÉRIFIÉ]**.

**Périmètre lu** : `convex/schema.ts` (intégral), `convex/functions.ts`,
`convex/auth.ts`, `proxy.ts`, `convex/assignments.ts` (zones clés),
`convex/comptes.ts`, `convex/publications.ts`, `convex/snytchDrive.ts`,
`convex/crons.ts`, `convex/apifySync.ts`, `convex/cloudflareStreamApi.ts`,
`convex/creators.ts`, `convex/formats.ts`, `convex/notificationEvents.ts`,
`convex/emails.ts`, `lib/warmup.ts`, `lib/compte-status.ts`,
`lib/script-combo-uniqueness.ts`, `lib/onboarding.ts`,
`convex/creatorAssignmentFields.ts`, `components/portal/DriveUploader.tsx`,
`components/VideoUploader.tsx`, `app/app/layout.tsx`,
`app/admin/[projectSlug]/validation/page.tsx`, `components/project/ProjectProvider.tsx`.

**Pas lu** : le détail de `app/admin/[projectSlug]/assignments/page.tsx` (980 l.),
`convex/scripts.ts` au-delà de la signature d'`assignScriptCampaign`,
`convex/payments.ts`, `convex/pricing.ts`, les 126 specs e2e (seules
`security.spec.ts` et `creator-role-guard.spec.ts` ont été ouvertes).

---

## 1. Carte de l'existant

### 1.1 Stack et conventions

| Couche | Choix | Fichier de référence |
|---|---|---|
| Framework | Next **16.2.4**, App Router, React 19.2.4 | `package.json` |
| Proxy/middleware | `proxy.ts` (Next 16 : `middleware.ts` déprécié) | `proxy.ts:1-11` |
| Backend + DB | **Convex 1.37** (document DB, index explicites, crons intégrés) | `convex/schema.ts` |
| ORM | aucun — `ctx.db` typé généré, pas de SQL | `convex/_generated/` |
| Auth | Convex Auth 0.0.94, provider **Password** seul | `convex/auth.ts:50-71` |
| État client | aucun store — `useQuery`/`useMutation` réactifs + contexts | `components/project/ProjectProvider.tsx` |
| UI | shadcn style `base-nova` + `@base-ui/react`, Tailwind v4, lucide, sonner | `components.json` |
| Tests | vitest (~70 `lib/*.test.ts`) + Playwright (**126 specs**) | `vitest.config.ts`, `e2e/` |
| Déploiement | Vercel, `npx convex deploy --cmd 'pnpm build'` | `vercel.json` |

Conventions structurantes, à respecter par tout code neuf :

1. **Aucune fonction publique brute.** Tout passe par un wrapper de
   `convex/functions.ts` : `authedQuery/Mutation`, `projectQuery/Mutation`,
   `adminQuery/Mutation`, `creatorQuery/Mutation`, `adminViewAsQuery`,
   `superadminMutation`, `e2eMutation`, `publicQuery`. La règle est écrite en
   tête du fichier (`convex/functions.ts:13-32`).
2. **Multi-tenant par `projectId`** sur toutes les tables métier ; les wrappers
   l'exigent en arg public et l'injectent dans `ctx`.
3. **Règle A6** : un module `convex/` ne peut pas importer `lib/`. La logique
   pure est donc **dupliquée** (`lib/warmup.ts` ↔ `convex/warmup.ts`,
   `lib/warmup-mode.ts` ↔ `convex/warmupMode.ts`, etc.) et la parité est
   verrouillée par un test qui importe les deux (`lib/warmup-mode.test.ts:1-8`).
4. **Snapshots figés** : `rateSnapshot`, `pricingSnapshot`,
   `scriptCombo.assembledScript`, `creatorNameSnapshot` — modifier une source ne
   réécrit jamais une ligne déjà attribuée (`convex/schema.ts:1136-1160`).
5. **Champs additifs `v.optional` → 0 migration** ; le resserrage est un TD
   ultérieur. C'est le mode opératoire par défaut du repo
   (`convex/schema.ts:6-21`).
6. Vocabulaire métier en **français** en base et en UI (`comptes`,
   `publications`, `créateurs`), anglais pour l'infra.

### 1.2 Modèle utilisateur et rôles — réutilisable, gates 100 % serveur

Deux niveaux de rôle, aucun autre :

- `users.role` : `"superadmin" | "member"`, optionnel (`convex/schema.ts:29-44`).
- `memberships.role` : `"admin" | "creator"` par couple (user, projet)
  (`convex/schema.ts:157-165`).

Trois gardes serveur, source de vérité unique :

- `requireProjectAccess` — superadmin ou membership quelconque (`convex/functions.ts:51-71`)
- `requireProjectAdmin` — rôle `admin` exigé, `creator` rejeté (`convex/functions.ts:81-104`)
- `requireCreator` — rôle `creator` **+ résolution de sa fiche `creators`**, dont
  le `creatorId` est injecté dans `ctx` : toute donnée servie par un
  `creatorQuery` est filtrée serveur par CE creatorId (`convex/functions.ts:227-268`)

**L'autorisation des DONNÉES est intégralement serveur et par fonction.**
Preuve dans le repo : `e2e/security.spec.ts` (client anonyme rejeté sur lecture
et écriture) et `e2e/creator-role-guard.spec.ts` (session `creator` réelle,
obtenue via signUp par token, rejetée de `adminQuery`/`adminMutation`).

**L'autorisation des PAGES est côté client uniquement**, et c'est assumé :

- `proxy.ts:49-59` ne vérifie que « authentifié », jamais le rôle. Le commentaire
  le dit (`proxy.ts:12-15`) : « Ce gating est du confort UX. La vraie barrière
  est dans les fonctions Convex ».
- Le routage par rôle est un `useQuery(api.creators.getMyPortal)` dans
  `app/page.tsx:20`, `app/app/layout.tsx:39`, et
  `components/project/ProjectProvider.tsx:52,78-80`.

Conséquence mesurée : un `creator` qui tape `/admin/<slug>/comptes` charge le
shell admin puis se fait rejeter query par query. **Aucune donnée ne traverse la
frontière de rôle** (vérifié : les 3 gardes ci-dessus sont dans le chemin de
chaque fonction), mais l'écran est cassé. Ce n'est pas bloquant pour la sécurité ;
c'en est un pour l'UX à 3 espaces (§3, D6).

**Le motif à réutiliser tel quel** : `convex/creatorAssignmentFields.ts`. Une
**allowlist inversée** des champs d'assignment exposés à la créatrice, avec un
invariant testé (`lib/creator-assignment-fields.test.ts`) qui exige que *chaque*
champ top-level du schéma soit classé dans `CREATOR` ou `NON_CREATOR` — sinon le
test casse. L'en-tête documente les deux fuites qu'a produites l'ancienne
denylist (`replayVerbatim` #167, `publishedBy` #169). C'est la mécanique qui rend
tenable la promesse « la créatrice n'accède jamais aux scripts » ; il faut un
module équivalent par nouvelle entité exposée.

### 1.3 Onboarding

- Mot de passe uniquement. **Pas d'OAuth, pas de magic link** — décision écrite
  (`convex/auth.ts:6-9`).
- **Signup fermé.** Fenêtre bootstrap : table `users` vide → 1er compte =
  superadmin. Ensuite, invitation à token obligatoire (`convex/auth.ts:81-100`).
- Le flux d'invitation est **atomique** : `users` + `memberships(creator)` +
  `creators.userId` + `status: "onboarding"` + `invitations.usedAt`, dans la
  transaction du signup (`convex/auth.ts:104-143`). Page publique
  `app/join/[token]/page.tsx`, un seul champ (mot de passe), email pré-rempli non
  modifiable et re-vérifié serveur contre l'invitation (`convex/auth.ts:121-126`).
- Reset mot de passe : lien à usage unique généré par l'admin, pas de
  self-service (`convex/schema.ts:788-803`, `app/reset-password/[token]/`).
- Session **90 jours** (`convex/auth.ts:48-55` + cookie `maxAge` aligné
  `proxy.ts:47`), JWT 1 h.

**Point d'insertion de la question de rôle** : `convex/auth.ts:132-137`, où le
rôle est écrit **en dur** :

```ts
const userId = await db.insert("users", { email, role: "member" });
await db.insert("memberships", { userId, projectId: invitation.projectId, role: "creator" });
```

Le rôle doit venir de l'invitation (champ sur `invitations`), pas d'un choix de
l'inscrit : le flux est déjà « l'admin invite », et laisser l'inscrit choisir son
rôle serait une élévation de privilège auto-servie.

### 1.4 Stockage de fichiers — deux chemins, capacités très inégales

**Chemin A — Convex file storage** (petits fichiers).
`convex/storage.ts:24-29` → `generateUploadUrl` est un **`authedMutation`** : tout
utilisateur authentifié peut obtenir une URL d'upload, sans scope projet ni rôle
ni quota. POST navigateur direct, progression via XHR
(`components/VideoUploader.tsx:48-75`). Plafond client **300 Mo**, types
`mp4/quicktime/webm` (`components/VideoUploader.tsx:13-14`). Un fichier à la
fois, **aucune reprise**, aucun parallélisme. Utilisé par `ImageUploader`,
`AssetUploader`, et la soumission MP4 d'assignment
(`assignments.submitVideo`, `convex/assignments.ts:2204-2265`), purgée à la
publication (`convex/assignments.ts:2448`). Filet : cron de purge des blobs
orphelins à 04:15 UTC (`convex/crons.ts:115-120`).

**Chemin B — Google Drive resumable via proxy same-origin** (gros fichiers). Le
seul chemin qui tienne la charge décrite :

1. `convex/snytchDrive.getUploadSession` (`authedAction`, `convex/snytchDrive.ts:242`)
   — le service account crée une session resumable **épinglée au dossier Drive du
   créateur** ; gate `slug === "snytch"` en dur (`convex/snytchDrive.ts:257`).
2. `components/portal/DriveUploader.tsx:59` découpe en chunks de **4 Mo**
   (multiple de 256 Ko exigé par Drive, et < 4,5 Mo = limite de body des
   fonctions Vercel).
3. `app/api/assets/…` non — `app/api/snytch-drive/upload/route.ts` relaie chaque
   chunk en PUT avec `Content-Range`, **sans jamais bufferiser le fichier
   entier** ; `maxDuration = 60` ; allowlist anti-SSRF `*.googleapis.com` +
   path `/upload/` (`route.ts:33-49`).
4. `snytchDrive.confirmUpload` (`creatorMutation`) écrit les métadonnées dans
   `snytchDriveFiles`, dédupliquées par `driveFileId`.

Plafond 5 Go/fichier (`DriveUploader.tsx:38`), `.mov`/`.heic` acceptés,
mobile-first assumé. **Aucune vue admin in-app** : le schéma le dit explicitement
(`convex/schema.ts:769-775`) et il n'existe aucun `adminQuery` dans
`convex/snytchDrive.ts` (vérifié : toutes les fonctions sont `internal*`,
`authedAction`, `creatorMutation`, `creatorQuery`).

**Ce que ce chemin ne fait PAS, et qui compte pour des rushes :**

- **Séquentiel de bout en bout.** Le lot boucle en série :
  `for (const it of batch) await uploadOne(it)` (`DriveUploader.tsx:208-210`).
  Aucun upload parallèle.
- **Aucune reprise après coupure.** Le bouton « Réessayer » rappelle `uploadOne`,
  qui rappelle `getUploadSession` → **nouvelle session, redémarrage à l'octet 0**
  (`DriveUploader.tsx:137-155`). Drive expose bien le `Range` déjà commité
  (le proxy le renvoie même : `route.ts:83`, `status:"incomplete"` + `range`),
  mais le client ne l'exploite pas — il incrémente `start` en mémoire
  (`DriveUploader.tsx:110`).
- **Aucune persistance** de la file : reload de la page ou passage de l'app en
  arrière-plan sur iOS = tout est perdu (état en `useState`,
  `DriveUploader.tsx:125`).
- **Chaque octet transite par une fonction Vercel** (le relais existe pour
  contourner le CORS du PUT navigateur → googleapis, `route.ts:3-9`).

**Miniatures / preview.** Aucune génération de vignette vidéo dans le repo.
Ce qui existe :
- post-traitement d'**images** (sharp hors Convex, route Next) :
  `app/api/assets/postprocess`, `lib/image-postprocess.ts` ;
- **cache** de vignettes externes (oEmbed TikTok/IG, `img.youtube.com`) :
  `lib/thumbnail.ts`, `convex/inspirationThumbnails.ts`, table `modelVideoEmbeds` ;
- **lecture inline d'une vidéo lourde** : Cloudflare Stream transcode le MP4
  soumis et sert un player lisible partout, HEVC iPhone inclus
  (`convex/cloudflareStream.ts`, `components/formats/StreamPlayer.tsx`), avec
  repli `<video>` Convex + bouton télécharger
  (`app/admin/[projectSlug]/validation/page.tsx`, `VideoReviewCard`).
  ⚠️ Le mode d'upload utilisé est **`/stream/copy` (copie depuis une URL)** —
  `convex/cloudflareStreamApi.ts:129-146`. Il n'y a **pas** d'intégration
  `direct_upload`/tus dans le repo.

### 1.5 Lien de publication — priorité haute

**Oui, le mécanisme existe et il est complet.** Chaîne exacte :

| # | Étape | Où |
|---|---|---|
| 1 | Saisie du lien | `assignments.confirmPublication` (créatrice, `creatorMutation`) ou `confirmPublicationAsAdmin` (admin, secours) — `convex/assignments.ts:2487`, `:2523` |
| 2 | Cœur partagé | `confirmPublicationCore` — `convex/assignments.ts:2277-2479` |
| 3 | Validation d'URL | `^https?://` **+** plateforme **détectée depuis l'URL** et comparée à la cible déclarée — `convex/assignments.ts:2337-2352`, détecteur `:66-79` |
| 4 | Gardes | 1 URL par cible et **toutes** obligatoires (`:2354-2371`) ; re-contrôle warmup du compte au moment de publier (`:2317-2335`) ; compat format×plateforme |
| 5 | Matérialisation | 1 ligne `publications` **par cible** via `publications.createFromAssignment` (`internalMutation`, `convex/publications.ts:413-489`) : `postUrl` stocké, `carouselId` incrémenté par projet, `scriptCombo` recopié pour l'analytics |
| 6 | Shortlink TikTok | action planifiée `postUrlResolution.resolvePublicationShortlink` (vm./vt. → canonique), sinon la sync ne rapproche pas le post — `convex/publications.ts:481-488` |
| 7 | Scraping des vues | cron **08:00 UTC** `daily-tiktok-insta-views` → `apifySync.runDailySync` ; sélection = `publications` du projet où `postUrl` non vide **et** `datePubli >= now − 90 j` (`convex/apifySync.ts:173-202`) → Apify → **1 snapshot/jour/publication** dans `metricSnapshots` (upsert idempotent par jour+source) → `recomputeLatestMetrics` (dénormalise `vuesLatest`…) → `syncBonusForPublication`. YouTube : même chose à 07:00 UTC (`convex/youtubeSync.ts`) |
| 8 | Rémunération | modèle legacy → `lineItem` base par post ; modèle pricing → calcul live + gel au paiement, `payments` garantie pour la période, `syncBonusUnlocks` — `convex/assignments.ts:2404-2444` |
| 9 | Ancre de cycle | `creators.firstPostAt` figée au **tout premier** post publié, jamais réécrite — `convex/assignments.ts:2468-2476` |
| 10 | Traçabilité | `publishedBy: "creator" \| "admin"`, `targets[].publishedUrl/publishedAt/publicationId`, statut `published` → `paid` |

**Verdict de réutilisabilité : réutilisable, avec un couplage dur, et il n'est
pas là où on l'attend.**

Tout l'aval (étapes 6→9) ne connaît **que** `publications.postUrl`,
`plateforme` et `datePubli`. Rien dans le scraping, les snapshots, l'analytics ou
le calcul de vues ne sait qui possède le compte. **Cette moitié est réutilisable
telle quelle.**

Le couplage est en **amont** : entrer dans le pipeline exige une ligne
`assignments` où

- `creatorId` est **simultanément** le payé (`accrueBaseLineItem`,
  `payments.creatorId`, `bonusUnlocks.creatorId`, `firstPostAt`), le
  propriétaire des comptes cibles, et la clé de filtrage du portail ;
- chaque cible satisfait `compte.creatorId === assignment.creatorId` —
  garde explicite dans `validateTargets` (`convex/assignments.ts:101-108`).

Autrement dit : le pipeline **n'est pas** couplé à « le créateur poste sur son
propre compte » côté métriques ; il l'est côté **écriture**, par une garde
d'appartenance. Un clippeur peut donc alimenter *exactement* le même pipeline —
à condition qu'il soit le `creatorId` de l'assignment (il possède les comptes,
c'est lui qu'on paie). Il ne peut pas si l'on veut que le `creatorId` reste la
créatrice qui a tourné le rush. → décision D1.

Second couplage, plus insidieux : `publications.compte` est le **handle en
string**, pas un `Id<"comptes">` (TD-001, `TECH_DEBT.md:9`). Comptes et
publications sont donc joints par handle (`convex/comptes.ts` `buildPerfMap`), ce
qui est la raison pour laquelle la réassignation d'un compte est documentée comme
**purement prospective** (`convex/comptes.ts`, commentaire de `updateCompte`,
champ `creatorId`) et pourquoi le rename d'un handle est **bloqué** dès qu'une
publication l'utilise (garde dans `updateCompte`).

### 1.6 Compte social — l'entité la plus riche, et elle existe déjà

`comptes` (`convex/schema.ts:457-552`) porte déjà : `projectId`, `handle`,
`plateforme`, `status` (`warmup|actif|shadowban|archived`), `warmupStartedAt`,
`warmupProtocol{keywords, instructions, targetDays, dailyChecks, updatedAt}`,
`creatorId` (**propriétaire**), `personneId` (gestionnaire interne, axe distinct),
`managedByAdmin` (l'équipe tient le compte physiquement), `url`, bloc bio
(`bioToApply/bioStatus/bioUpdatedAt/bioAppliedAt`), `targetCountry`, `actif`
(legacy TD-017). Index `by_project_creator`.

Ce qui existe **déjà** et couvre le cahier des charges :

- **Le propriétaire déclare son propre compte** :
  `comptes.declareCompte` (`creatorMutation`, `convex/comptes.ts:891-940`) — créé
  en `"warmup"`, `warmupStartedAt = now`, protocole initialisé, dédup
  (handle, plateforme) dans le projet.
- **La validation admin est déjà bloquante**, en régime strict : `isAccountAvailable`
  avec `strict` n'accepte que `"actif"` (`lib/warmup.ts:174-182` + réplique
  `convex/warmup.ts`), et ce gate est appelé aux **deux** endroits qui compte —
  à l'assignation (`validateTargets`, `convex/assignments.ts:114-118`) et **à la
  publication** (`convex/assignments.ts:2317-2335`). Le régime strict est
  activé par… `slug === "snytch"` en dur (voir Risque 8).
- Checklist d'onboarding dérivée : `lib/onboarding.ts` +
  `comptes.getMyOnboardingState`.
- Perf par compte, badges de statut, décompte : `convex/comptes.ts` `buildPerfMap`,
  `lib/compte-status.ts` `getStatusBadge` (dont un état **« À valider »** quand le
  warmup est terminé — `lib/compte-status.ts:69-72`).

Ce qui **n'existe pas** :

- **Aucun `validatedAt`.** La transition `warmup → actif` (`updateCompte`,
  `unarchiveCompte`) n'écrit **aucune date**. Or la spec fait de la date de
  validation l'origine de tout le compteur.
- **Aucune notion de phase** au-delà des 4 statuts. Chauffe / warmup / démo /
  croisière n'existent pas.
- **Aucun quota de posts par jour, nulle part.** Vérifié par recherche sur
  `quota|postsPerDay|maxPosts` dans `lib/ convex/ components/ app/` : zéro
  occurrence métier (seules des mentions de quotas d'API tierces).
- **Aucune détection « compte sorti de chauffe sans créatrice assignée »** — le
  concept clippeur↔créatrice n'existe pas.
- Le warmup existant est **compté en checks réels, pas en jours calendaires**, par
  décision explicite : `lib/warmup.ts:12-17` et `:149-161`. Rater un jour ne fait
  jamais avancer le compteur. C'est l'inverse de la règle demandée. → D3.

### 1.7 Scripts — réutilisables, mais l'axe d'unicité est le mauvais

- `scriptCampaigns` + `scriptBricks` (kinds `hook|flux|cta`, tier `S|A`, et un
  champ **`mode: "dire" | "afficher" | "les_deux"` par brique**) —
  `convex/schema.ts:1495-1549`.
- Un assignment porte le texte **figé** (`scriptCombo.assembledScript`) + la
  signature `comboKey`, jamais reconstruit depuis les briques vivantes.
- Rendu créatrice en 2 zones (🎬 vidéo / 📝 description) avec garde
  anti-divergence à l'octet près (`convex/assignments.ts:1785-1815`).
- **Anti-répétition = (créateur, plateforme)**, pas (compte) :
  `lib/script-combo-uniqueness.ts:35-69`, index `by_creator_combo`
  (`convex/schema.ts:1168`), réplique serveur
  `convex/scripts.usedComboKeysForPlatforms`. La spec demande
  « jamais deux fois le même script sur le même **compte social** ». → D5.
- Un script est déjà réutilisable sur plusieurs créateurs, et le rejeu imposé
  (`comboImposed`) est volontairement exclu du set consommé.

### 1.8 Mobile

**Portail créateur : réellement mobile-first, réutilisable tel quel.**
`app/app/layout.tsx:118-160` — header mobile collant + `CreatorBottomNav`
(< md, style app native, safe-area iOS gérée), `CreatorSidebar` (≥ md),
`pb-24` pour ne pas passer sous la tab bar. Cibles tactiles élargies dans les
uploaders (`h-11 w-full` mobile → `sm:h-9 sm:w-auto`,
`DriveUploader.tsx:250`). Badges dérivés de compteurs serveur
(`countMyActionable`, `countMyWarmupDue`).

**Admin : desktop en pratique.** `container mx-auto px-6 py-8`
(`app/admin/[projectSlug]/layout.tsx`), tables larges en `overflow-x-auto`.
Comptage des classes responsive (`sm:|md:|lg:`) par page admin :
`assignments/page.tsx` **0** pour 980 lignes ; `dashboard` 0 ; `carrousels` 0 ;
`shorts` 0 ; `screenrecorder` 0 ; `notifications` 0 ; `guide` 0 ; les mieux
dotées plafonnent à 7 (`analytics`). L'écran `validation` (le plus proche de la
revue de rushes) : 2 pour 760 lignes.

Conclusion : l'espace créatrice se construit sur un shell mobile déjà éprouvé ;
l'espace clippeur aussi (il est du même type d'usage). L'écran admin de revue de
rushes sera desktop-only comme le reste de l'admin — à assumer explicitement.

### 1.9 Notifications

Trois canaux existent :

1. **Telegram, par projet** — `projects.notify{channel, chatId, tokenEnvVar, enabledEvents}`
   (`convex/schema.ts:137-150`), catalogue de 7 événements dont 4 immédiats et 3
   sections de digest à 06:00 UTC (`convex/notificationEvents.ts:18-79`),
   anti-flood par fenêtre à claim atomique (`convex/schema.ts:1810-1821`).
   ⚠️ **Un seul `chatId` par projet** : c'est un canal *ops*, adressé au
   fondateur, **pas adressable par utilisateur**.
2. **Email (Resend)** — 5 événements, dont **4 dirigés vers le créateur** :
   invitation, vidéo validée, vidéo refusée, paiement effectué, rappel de
   deadline (`convex/emails.ts:20-38`). Envois hors transaction via
   `ctx.scheduler`, jamais bloquants ; no-op complet sans les 3 variables d'env
   (`convex/emailApi.ts:1-14`). **C'est le seul canal sortant par personne.**
3. **Badges in-app** — `countMyActionable`, `countMyToPublish`,
   `countMyWarmupDue` (`creatorQuery`) rendus dans `CreatorBottomNav`.

Pour « prévenir un clippeur qu'un rush est disponible » : **l'email est
réutilisable immédiatement** (ajouter un événement dans `convex/emails.ts` suit
un patron établi). Telegram par personne exigerait un `chatId` par utilisateur
(changement de schéma) **et** que chaque clippeur démarre le bot lui-même.
Pas de push web dans le repo (vérifié : aucune dépendance ni service worker).

---

## 2. Delta à construire

### Module A — Rôles et routage → **extension**, rien de structurellement neuf

| À faire | Nature |
|---|---|
| `memberships.role` : ajouter les littéraux manquants | extension (union, additif) |
| `requireClipper` / `requireVideoCreator` + wrappers `clipperQuery/Mutation`, `videoCreatorQuery/Mutation` | extension — copie exacte de `requireCreator` + `creatorQuery` (`convex/functions.ts:227-268`) |
| Rôle porté par l'invitation au lieu du littéral en dur `convex/auth.ts:133-137` | extension |
| `getMyPortal` → 3 rôles ; matrice de redirection dans `app/page.tsx`, un layout par espace, `ProjectProvider` | extension |
| Un module d'allowlist par entité exposée (sur le modèle de `creatorAssignmentFields.ts`) + son test d'invariant | **nouveau** (mais patron existant) |
| Specs de garde par rôle, sur le modèle de `e2e/creator-role-guard.spec.ts` | extension |

### Module B — Espace créatrice vidéo → **UI neuve, plomberie existante**

| À faire | Nature |
|---|---|
| Table `rushes` (Déposé → Assigné → Publié + Rejeté) | **nouveau** — `snytchDriveFiles` est une liste de métadonnées plate, sans machine à états (`convex/schema.ts:776-786`) |
| Dépôt de rushes : reprise après coupure, upload parallèle, file persistée | **nouveau** — les 3 manquent (§1.4). Le squelette d'UI (`DriveUploader.tsx` + `FichiersScreen.tsx`) couvre le reste |
| Dégater le dépôt du `slug === "snytch"` → config par projet | extension (`convex/snytchDrive.ts:257`, `lib/snytch-drive.ts:19`) |
| Brief permanent + vidéos d'exemple | **quasi-nouveau côté exposition** : `formats` porte déjà brief markdown + `exampleVideos` (file \| url) + `guidelines` + hooks embarqués (`convex/schema.ts:841-897`), **mais `convex/formats.ts` est 100 % `adminQuery`/`adminMutation`** — aujourd'hui la créatrice ne voit un brief *qu'à travers un assignment* (`convex/assignments.ts:2151-2152`). Il faut une query dédiée. Alternative déjà exposée créatrice : `guideModules.listMyModules` (`convex/guideModules.ts:66`) |
| Écran unique (brief + exemples + uploader + « mes dépôts ») | UI neuve, shell mobile existant |

### Module C — Espace admin → **écrans neufs sur patrons existants**

| À faire | Nature |
|---|---|
| File de revue des rushes (player + valider/rejeter avec motif obligatoire) | extension — `VideoReviewCard` de `app/admin/[projectSlug]/validation/page.tsx` est le patron exact, avec `StreamPlayer`/`VideoExample`, repli téléchargement et lien profond `?soumission=` |
| Rendre les rushes visionnables sans téléchargement | **nouveau** — la source est Drive, or le player existant tire d'une URL signée **Convex** (`cloudflareStreamApi.ts:129`, mode `copy`). → D4 |
| Assigner un script existant à un rush existant | **nouveau** — `assignScriptCampaign` (`convex/scripts.ts:671`) fait autre chose : il *tire* des combos pour un créateur + cibles et crée N assignments. La lecture (campagnes, briques, combos) est réutilisable |
| File de validation des comptes | extension — le badge « À valider » existe déjà (`lib/compte-status.ts:69`), la query de file non |
| Signal « sorti de chauffe sans créatrice assignée » | **nouveau** — le plus proche est la section digest `digest_warmup_late` |
| Écran d'assignation clippeur ↔ créatrice | **nouveau** — la relation n'existe pas |

### Module D — Espace clippeur → **espace neuf, réutilisation maximale**

| À faire | Nature |
|---|---|
| Ses comptes + déclaration | extension — `declareCompte` est copiable quasi verbatim (changer le wrapper et le champ propriétaire) |
| Chauffe 3 j / phases / quota dérivé | **nouveau** — le protocole de checks quotidiens existe mais implémente une **autre règle** (§1.6). → D3 |
| Moteur de phase + quota (module pur `lib/` + réplique `convex/` selon A6) | **nouveau** |
| Garde serveur de quota au moment de publier | **nouveau** — à poser dans `confirmPublicationCore`, sinon la règle sera violée dès la 1re semaine |
| File des rushes qui lui sont attribués | **nouveau** (query dérivée : clippeur → ses créatrices → leurs rushes avec script) |
| Publier + coller le lien | **réutilisation directe de `confirmPublicationCore`** si D1 = option 1. Sinon le cœur doit être scindé (payé ≠ publieur) |

---

## 3. Décisions bloquantes

### D1 — Qui est le `creatorId` d'une publication quand la créatrice tourne et le clippeur publie ?

**Constat.** `assignments.creatorId` cumule trois rôles aujourd'hui : le **payé**
(`accrueBaseLineItem`, `payments.creatorId`, `bonusUnlocks.creatorId`,
`creators.firstPostAt`), le **propriétaire des comptes cibles** (garde
`compte.creatorId === assignment.creatorId`, `convex/assignments.ts:101-108`), et
la **clé de filtrage du portail** (`ctx.creatorId` injecté par `creatorQuery`).
Le nouveau flux sépare ces trois personnes.

**Options.** (1) `assignment.creatorId` = le **clippeur** ; le rush porte
`videoCreatorId` ; la créatrice est rémunérée hors du modèle assignment.
(2) Garder `creatorId` = créatrice, ajouter `publisherId` = clippeur et relâcher
`validateTargets`. (3) Nouveau pipeline au niveau `publications`, hors assignments.

**Recommandation : option 1.** Elle laisse intacts `validateTargets`, le moteur
de paie, le `pricingSnapshot`, le cycle J+30 et `confirmPublicationCore` — le
clippeur possède les comptes et c'est lui qui publie, il *est* le `creatorId`
naturel au sens du code existant. L'option 2 relâche une garde d'appartenance
qui protège aujourd'hui contre la publication croisée entre créatrices, et
l'option 3 duplique 10 étapes de pipeline testées.
**Conséquence à trancher côté produit, pas côté code** : la rémunération de la
créatrice vidéo devient un objet distinct, accroché au rush (cf. Questions).

### D2 — Étendre `memberships.role` ou créer une table par métier ?

**Constat.** `memberships.role` est une union de 2 littéraux lue par 3 gardes.
La table `creators` fait double emploi : rôle *et* fiche métier (méthode de
paiement, `bonusPricingId`, `firstPostAt`, `driveFolderId`,
`handlesToCreate`). Un clippeur a besoin d'une fiche équivalente ; une créatrice
vidéo de presque rien.

**Options.** (1) Étendre l'union + réutiliser `creators` comme fiche pour les
deux, avec un discriminant `kind`. (2) Deux nouvelles tables `clippers` /
`videoCreators`. (3) Porter le rôle sur `users` plutôt que `memberships`.

**Recommandation : option 1, avec un champ `kind` sur `creators`.** `creators`
porte déjà tout ce dont un clippeur a besoin et tout ce sur quoi le portail
filtre (`requireCreator` résout par `userId` + `projectId`). Deux tables
dupliqueraient toute la couche de gating **et** les clés étrangères du moteur de
paie (`payments.creatorId`, `bonusUnlocks.creatorId`, `assignments.creatorId`).
L'option 3 casse le multi-tenant (un même humain peut être admin sur un projet et
clippeur sur un autre).
**Coût assumé** : `kind` doit être contrôlé partout où le code dit « creator »
aujourd'hui — balayage large mais mécanique. À sécuriser par un test d'invariant
sur le modèle de `creatorAssignmentFields`, pas par de la relecture.

### D3 — Réécrire le warmup existant, ou poser un modèle de phase à côté ?

**Constat.** Modèle en place = **compteur de checks réellement posés** (7 jours
TikTok/YouTube, 14 Instagram), délibérément découplé du calendrier
(`lib/warmup.ts:12-17`), 1 check/jour imposé serveur. Spec = phase **dérivée
d'une date de validation** (chauffe J1-3, warmup J4-6, démo J7-13, croisière
J14+), quota dérivé de la phase. Deux règles incompatibles sur le même champ. Et
il n'y a **aucun `validatedAt`** : la transition vers `"actif"` n'écrit pas de
date.

**Options.** (1) Remplacer : ajouter `comptes.validatedAt`, dériver la phase,
garder `dailyChecks` comme conformité. (2) Coexister : conserver le warmup par
checks pour les créateurs partenaires existants, ajouter un modèle de phase par
date pour les comptes de clippeur (discriminé par le `kind` du propriétaire).
(3) Encoder les nouvelles phases dans `warmupProtocol.targetDays`.

**Recommandation : option 2.** Les comptes en production portent un état
`warmupProtocol` vivant dont **deux gates dépendent** (éligibilité à
l'assignation *et* garde de publication, §1.6). Changer la règle
rétroactivement modifie la publiabilité de chaque compte en prod du jour au
lendemain — un compte à 5/7 checks devient publiable ou non selon la nouvelle
arithmétique, sans qu'aucun humain n'ait rien fait. Un modèle de phase par
`kind` de propriétaire confine le changement aux comptes neufs, et
`comptes.validatedAt` est additif (`v.optional` → 0 migration, convention du
repo). L'option 3 détourne un champ dont le nom mentira.

### D4 — Où vivent les rushes, et comment l'admin les visionne ?

**Constat.** Convex storage est plafonné à 300 Mo côté client dans le seul
uploader vidéo (`VideoUploader.tsx:13`) et le déploiement de prod est déjà
observé à **471 Mo sur 789** (`convex/storageCleanup.ts:12`, chiffre relevé sur
`giddy-bass-969`). Drive tient le volume mais n'a ni player inline ni vue admin.
Le player inline existant (Cloudflare Stream) tire d'une URL signée **Convex**,
en mode `/stream/copy` (`convex/cloudflareStreamApi.ts:129-146`).

**Options.** (1) Drive comme aujourd'hui + preview admin via
`webViewLink`/`thumbnailLink` (déjà stockés, `convex/schema.ts:784-785`).
(2) Drive comme stockage durable + une copie Cloudflare Stream par rush pour la
revue inline. (3) Upload des rushes **directement vers Cloudflare Stream**
(URL d'upload direct à usage unique), et abandon de Drive pour les rushes.

**Recommandation : option 3 pour les rushes neufs.** Cloudflare Stream est déjà
une dépendance du projet avec un chemin transcoding + player qui fonctionne, il
donne miniature et lecture HEVC-proof — exactement l'exigence « l'admin doit
pouvoir visionner sans télécharger » — et l'upload direct fait que **les octets
ne transitent plus par Vercel**, ce qui supprime d'un coup le coût du relais, la
limite de 4,5 Mo de body et le contournement CORS.
⚠️ **[NON VÉRIFIÉ]** : le repo n'implémente que `/stream/copy` ; je n'ai pas
vérifié que le jeton Cloudflare en place a la portée `direct_upload`/tus, ni les
plafonds de durée/taille du plan Stream souscrit. À confirmer **avant** de
s'engager. Si la vérification échoue, replier sur l'option 2.

### D5 — Unicité du script : par créateur ou par compte social ?

**Constat.** Clé actuelle = (créateur, plateforme)
(`lib/script-combo-uniqueness.ts:35-48`). Un clippeur avec 2 comptes TikTok ne
pourrait donc **pas** utiliser le même script une fois par compte : même
créateur, même plateforme → bloqué. La spec demande l'inverse.

**Options.** (1) Passer la clé à (`accountId`, `comboKey`). (2) Ajouter une
seconde dimension et conserver les deux.

**Recommandation : option 1.** L'ancienne clé est un cas particulier de la
nouvelle quand le créateur n'a qu'un compte par plateforme, et les deux modules
purs prennent déjà `platforms: string[]` par assignment — le passage à des
`accountId` est contenu : `lib/script-combo-uniqueness.ts`,
`convex/scripts.usedComboKeysForPlatforms`, et l'index `by_creator_combo`
(`convex/schema.ts:1168`) à remplacer ou à doubler d'un filtre en mémoire.
Ne pas conserver les deux règles : deux verrous sur le même geste produisent des
refus inexplicables côté admin.

### D6 — Laisser l'autorisation des pages côté client ?

**Constat.** `proxy.ts` ne vérifie que « authentifié » ; le routage par rôle est
client (`app/page.tsx`, `app/app/layout.tsx`, `ProjectProvider.tsx`), documenté
comme du confort UX ; la vraie barrière est par fonction et prouvée par e2e. À 3
espaces, la matrice de redirection grossit et tout oubli montre à une créatrice
un shell admin criblé d'erreurs.

**Options.** (1) Garder l'architecture, étendre la matrice client. (2) Décider du
rôle dans `proxy.ts`. (3) Rendre le rôle côté serveur dans un layout.

**Recommandation : option 1.** C'est l'architecture documentée du repo, et
l'invariant qui compte (aucune donnée ne franchit une frontière de rôle) est
tenu par les wrappers, pas par le routage. Mettre une décision d'autorisation
dans `proxy.ts` la placerait là où on ne peut pas lire la base à bon compte et
dupliquerait la source de vérité. **La mitigation est un test, pas une
redirection** : étendre `e2e/creator-role-guard.spec.ts` avec une spec par
nouveau rôle × par wrapper interdit.

### D7 — Type de rush : **non tranché, comme demandé**

Impact schéma dans les deux cas, sans recommandation.

**Cas A — tout rush va avec tout script** (le hook arrive à l'écran, au montage).
`rushes` n'a besoin d'aucun type : `{ videoCreatorId, ref de stockage, status,
scriptId?, rejectionReason? }`. L'assignation est un choix libre de l'admin :
aucune contrainte à modéliser, aucune query de compatibilité, aucun risque de
rush inassignable.

**Cas B — certains formats exigent qu'elle parle.** Trois changements en cascade :
1. `rushes` porte un type (ex. `speakingKind: "silent" | "voiced"`), et pour un
   rush parlé, **l'id du script prononcé** ;
2. le script porte l'exigence symétrique. **Le vocabulaire existe déjà à 80 %** :
   `scriptBricks.mode` vaut `"dire" | "afficher" | "les_deux"`
   (`convex/schema.ts:1539-1541`) — l'exigence « elle doit parler » est
   dérivable de la présence d'une brique en `dire`/`les_deux` ;
3. l'écriture d'assignation a besoin d'une garde de compatibilité, et l'UI admin
   d'un filtre.

**Le vrai coût du cas B n'est pas le schéma, c'est le flux.** Un rush « parlé »
est lié à UN script **dès le tournage** : le script doit donc être assigné
**avant** la prise de vue, ce qui inverse l'ordre décrit
(`Admin assigne un script au rush` devient `Admin assigne un script à la
créatrice, qui tourne ensuite`). Le stock de rushes réassignables — qui est
l'intérêt économique du modèle — disparaît pour cette catégorie.

---

## 4. Chiffrage

**Hypothèses explicites**, à corriger si fausses :

- 1 développeur déjà familier de ce repo ; 1 j = 6-7 h effectives.
- Validation locale = `tsc` + `eslint` + `vitest` + les seules specs e2e du
  chantier (règle du projet, `CLAUDE.md`) ; la suite complète est le job de la CI.
- **Chaque module livre ses specs.** Le repo a 126 specs e2e et un gate CI
  `test` : une fonctionnalité sans specs n'est pas au standard du dépôt. Compté
  dans les chiffres (~25 % de chaque poste).
- Changements de schéma **additifs** (`v.optional`) → aucune migration de données
  chiffrée, sauf mention contraire.
- Réutilisation des primitives shadcn `base-nova` existantes : **aucune phase de
  design** au chiffrage.
- Décisions D1, D3, D4, D5 tranchées comme recommandé. D7 en **cas A** (cas B :
  +2 à 3 j, plus un arbitrage produit sur l'ordre du flux).

| Module | Jours | Ce qui pèse |
|---|---|---|
| A — Rôles & routage | **3-4** | wrappers, rôle porté par l'invitation, `getMyPortal` à 3 rôles, 3 layouts, modules d'allowlist + invariants, specs de garde par rôle |
| B — Espace créatrice vidéo | **5-7** | table `rushes` + machine à états (1 j) ; **dépôt robuste : reprise + parallélisme + file persistée (2-3 j à lui seul)** ; brief permanent exposé (1 j) ; écran + passes mobile (1-1,5 j) ; specs |
| C — Espace admin | **6-8** | file de revue avec player (1,5 j) ; assignation script → rush (1,5 j) ; file de validation des comptes (1 j) ; signal « chauffe sans créatrice » (0,5 j) ; assignation clippeur ↔ créatrice (1,5 j) ; specs |
| D — Espace clippeur | **6-8** | ses comptes + déclaration (1 j) ; file de rushes (1,5 j) ; publication branchée sur `confirmPublicationCore` (1 j) ; écrans + mobile (1,5 j) ; specs |
| Transverse — moteur phase/quota | **1,5-2** | module pur + réplique `convex/` (A6) + tests de parité + garde serveur au publish |
| Transverse — notification « rush dispo » | **1-2** | 1 j en email (patron existant) ; 2 j si Telegram par personne (schéma + enrôlement du bot) |
| Transverse — e2e du flux complet | **2** | déclaration → validation → assignation créatrice → dépôt → script → publication → lien |
| **Total** | **~25-33 j** | |

**Hors chiffrage** (et non chiffrable en l'état) : la rémunération de la
créatrice vidéo (modèle non défini, cf. D1 et Questions) ; le cas B de D7 ; la
vérification du contrat Cloudflare Stream (D4) ; toute reprise responsive de
l'admin ; la migration éventuelle du stock Drive existant.

---

## 5. Risques

1. **Le dépôt de rushes est le risque n°1, et il est produit, pas technique.**
   25 fichiers × 250 Mo = **6,25 Go par lot**. Le chemin actuel les envoie **en
   série**, en chunks de 4 Mo, chacun relayé par une fonction Vercel, et **toute
   coupure redémarre le fichier courant à l'octet 0** (`DriveUploader.tsx:110`,
   `:137-155`), écran allumé. Sur un lien 4G montant, un lot représente des
   heures pendant lesquelles rien ne doit tomber. Ça échouera sur le terrain, et
   c'est la seule raison d'être du rôle créatrice. **La reprise et le
   parallélisme ne sont pas du confort : ils sont la fonctionnalité.**

2. **Ne pas router les rushes par Convex file storage.** La prod est déjà à
   ~471 Mo sur 789 (`convex/storageCleanup.ts:12`) ; un seul lot de rushes fait
   sauter le quota. Et `storage.generateUploadUrl` est un `authedMutation` sans
   scope projet, sans rôle et **sans quota** (`convex/storage.ts:24-29`) : le
   seul filet est le cron de purge des orphelins, à 04:15 UTC, avec 24 h de
   grâce.

3. **Comptes ↔ publications joints par le HANDLE (string), pas par id** (TD-001).
   La spec veut que les comptes et l'historique de posts survivent au retrait
   d'un clippeur et soient réassignables. Ça tient — mais seulement parce que le
   rename de handle est **bloqué** dès qu'une publication existe (garde dans
   `updateCompte`) et que la réassignation est **prospective**, sans réécriture
   de l'historique ni de la paie (commentaire du champ `creatorId`,
   `convex/comptes.ts`). Corollaire à écrire noir sur blanc dans le produit :
   retirer un clippeur = **changer le propriétaire**, jamais renommer le compte.

4. **Collision de règle sur le warmup (D3).** Changer la règle de disponibilité
   des comptes modifie *ce qui est publiable aujourd'hui* en prod, sans geste
   humain. Deux gates en dépendent (assignation et publication).

5. **Routage de page côté client.** Une créatrice qui atterrit sur `/admin/...`
   voit le shell admin et une cascade d'erreurs. Cosmétique, mais pour un
   utilisateur non technique ça *se lit* comme une fuite.
   Point connexe, factuel : `projects.getProjectForCurrentUser` est un
   `authedQuery` qui renvoie le **document projet complet** à tout membre — donc
   à un `creator` (`convex/projects.ts:109-135`). Cela inclut
   `whop.companyId`, `notify.chatId`, `posthog.posthogProjectId`,
   `fxRateToRevenue`. **Aucun secret** (le schéma est explicite : les clés vivent
   en env, jamais en base), mais c'est de la configuration interne sur le
   téléphone d'une créatrice. Le portail créateur, lui, projette une forme
   whitelistée (`creators.getMyCreatorProjects:721-731`) — c'est le bon modèle,
   et c'est l'écart à corriger côté `getProjectForCurrentUser` quand un
   troisième rôle arrive.

6. **Aucun mécanisme de quota n'existe** (vérifié par recherche exhaustive). La
   règle « le quota est dérivé de la phase, jamais saisi à la main » doit être
   gardée **serveur, dans `confirmPublicationCore`**. Une garde d'UI seule sera
   contournée dans la semaine, et le seul endroit qui compte est celui où le lien
   entre en base.

7. **TD-020 pollue déjà les dates de publication** : le statut calendrier
   s'appuie sur la date de *confirmation*, pas sur le go-live réel
   (`TECH_DEBT.md:101`). La date d'un post est celle où le lien est collé, sauf
   correction admin (`publishedAt` optionnel de `confirmPublicationAsAdmin`,
   `convex/assignments.ts:2529`). Le suivi « 1 post/jour puis 2 » du clippeur
   héritera exactement du même artefact : des faux retards et des faux
   dépassements de quota.

8. **Deux gates critiques sont câblés sur un slug en dur.**
   `SNYTCH_SLUG = "snytch"` (`lib/snytch-drive.ts:16`, `convex/projects.ts`)
   commande **à la fois** le dépôt de fichiers Drive **et** le régime strict de
   disponibilité des comptes (`convex/assignments.ts:2322`,
   `convex/assignments.ts:92`). Si les nouveaux rôles vivent dans un autre
   projet, ils tombent en régime **lenient** : « un compte non validé ne peut
   rien publier » **cesse silencieusement d'être vrai** (un warmup terminé mais
   non validé par l'admin devient publiable). C'est un piège d'une ligne, avec
   une conséquence produit maximale.

9. **Charge de lecture.** Plusieurs queries chargent la collection entière du
   projet avant de filtrer en mémoire — `createFromAssignment` collecte **toutes**
   les publications du projet juste pour calculer le prochain `carouselId`
   (`convex/publications.ts:443-447`), `listActiveApifyPublications` collecte
   tout par plateforme (`convex/apifySync.ts:184-201`) ; TD-003 et TD-005 pointent
   le même motif ailleurs. Ajouter des rushes et des posts de clippeurs
   augmente ces collections sans qu'aucun index nouveau soit prévu. Pas bloquant
   à court terme, mais chaque publication de clippeur paiera ce scan.

---

## 6. Questions à trancher (info manquante — pas de choix à l'aveugle)

1. **La créatrice vidéo est-elle rémunérée, et sur quoi ?** Rien dans le repo ne
   permet de le deviner : tout le moteur de paie est indexé sur `creatorId` =
   celui qui publie (§1.5). Si elle est payée au rush, à la sélection, ou aux
   vues des posts issus de ses rushes, ce sont trois modèles de données
   différents. Ce choix conditionne D1 et le chiffrage du module B.
2. **D7** : les rushes sont-ils tous muets (cas A) ou certains parlés (cas B) ?
   Le cas B inverse l'ordre du flux, pas seulement le schéma.
3. **Un clippeur peut-il avoir plusieurs créatrices, et une créatrice servir
   plusieurs clippeurs ?** Le tableau dit « ses comptes et les rushes de **sa**
   créatrice » (singulier) mais le flux dit « l'admin assigne une créatrice ».
   1-N, N-1 ou N-N change la query de file et l'écran d'assignation.
4. **Les nouveaux rôles vivent-ils dans le projet `snytch` existant ou dans un
   projet neuf ?** Réponse indispensable avant d'écrire quoi que ce soit, à cause
   du risque 8.
5. **Que devient un rush jamais assigné ?** La machine à états spécifiée
   (Déposé → Assigné → Publié + Rejeté) n'a pas d'état d'expiration ni de purge,
   alors que ce sont des objets de 100 à 300 Mo qui s'accumulent.
6. **D4** : le jeton Cloudflare Stream en place autorise-t-il l'upload direct, et
   quels sont les plafonds du plan souscrit ?
