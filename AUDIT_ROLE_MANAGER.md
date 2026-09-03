# Audit — ajout d'un rôle « manager » (admin restreint)

> Diagnostic only. Aucun fichier applicatif modifié, aucune migration créée.
> Périmètre lu : `convex/` (144 modules), `app/`, `components/`, `lib/`, `proxy.ts`, `e2e/`.

---

## Résumé (10 lignes, sans jargon)

1. Aujourd'hui il n'existe que **deux niveaux dans l'app interne** : « admin d'un projet » et « superadmin ». Il n'y a **aucune graduation entre les deux**.
2. Un admin voit **tout** : créateurs, scripts, comptes… mais aussi paie, marges, chiffre d'affaires Whop et analytics business.
3. La bonne nouvelle : la sécurité est **très propre et centralisée**. Toutes les fonctions serveur passent par une poignée de « portiers » écrits dans un seul fichier (`convex/functions.ts`). Aucune fonction ne triche.
4. La mauvaise : ces portiers ne connaissent qu'**une seule question** — « es-tu admin de ce projet ? ». **211 fonctions** répondent à cette question unique, sans distinction de sujet.
5. Donc ajouter un « manager » n'est pas un réglage : c'est **trier ces 211 fonctions** une par une entre « créateurs » et « argent ».
6. Le vrai piège n'est pas les écrans « Paiements » ou « Analytics » (faciles à cacher). Ce sont **trois écrans de gestion créateurs qui transportent déjà de l'argent sans le montrer** : le Dashboard, la liste des Créateurs et la liste des Assignations.
7. Exemple concret : le Dashboard affiche une carte « total dû » et un bloc « Ce que ça a rapporté » (ventes Whop par créatrice). Cacher la carte ne suffit pas : **la donnée est déjà partie côté navigateur**, elle est lisible par n'importe qui sait ouvrir la console.
8. La liste des créateurs renvoie la fiche **entière** de chaque créatrice — y compris ses coordonnées de paiement et son tarif. La liste des assignations renvoie le **tarif figé de chaque vidéo**.
9. Il **n'existe aujourd'hui aucun écran de gestion des utilisateurs**. Les admins sont créés à la main en ligne de commande. Le modèle est « **un rôle par personne et par projet** », sans permissions fines.
10. Recommandation : **Option B** ci-dessous (un rôle `manager` + un portier `financeQuery` explicite), en traitant d'abord les 3 fuites du point 6 — sinon le rôle serait cosmétique.

---

## 1. Système de rôles actuel

### 1.1 Où les rôles sont définis

| Élément | Emplacement | Valeurs | Nature |
|---|---|---|---|
| Rôle **global** | `convex/schema.ts:41` — `users.role` | `"superadmin"` \| `"member"` (optionnel ⇒ traité comme `member`) | Colonne DB |
| Rôle **par projet** | `convex/schema.ts:268` — `memberships.role` | `"admin"` \| `"creator"` \| `"talent"` \| `"clipper"` | Colonne DB, **requis** |
| Population de fiche | `convex/schema.ts` — `creators.kind` | `"partner"` \| `"talent"` \| `"clipper"` (absent ⇒ `partner`) | Colonne DB |
| Mapping fiche ↔ rôle | `convex/roles.ts` | `roleForKind`, `kindForRole`, `isPortalRole` | Module pur, testé (`lib/roles.test.ts`) |

**Il n'y a ni table de permissions, ni claim de rôle dans le JWT, ni metadata de provider.** Le rôle est lu en base à **chaque requête**, jamais mis en cache dans le token. C'est un point fort : changer un rôle prend effet immédiatement, sans attendre l'expiration d'une session.

### 1.2 Liste exhaustive des rôles et usages réels

| Rôle | Portée | Ce qu'il ouvre | Portier serveur |
|---|---|---|---|
| `superadmin` (`users.role`) | Globale, tous projets | Accès implicite à **tous** les projets sans membership + création de projet | `convex/functions.ts:63`, `:93`, `:142` |
| `member` (`users.role`) | Globale | Rien par lui-même — c'est le membership qui décide | — |
| `admin` (`memberships.role`) | Un projet | **Toute** l'app interne (211 fonctions) + observation des espaces créateurs | `requireProjectAdmin` (`convex/functions.ts:83`) |
| `creator` (`memberships.role`) | Un projet | Portail `/app` — ses missions, ses comptes, sa paie | `requireCreator` (`:229`) |
| `talent` (`memberships.role`) | Un projet | Portail `/talent` — dépôt de rushes uniquement | `requireTalent` (`:290`) |
| `clipper` (`memberships.role`) | Un projet | Portail `/clip` — ses comptes, montage, publication | `requireClipper` (`:299`) |

**Constat central pour ce chantier : il n'existe aucune granularité à l'intérieur de `admin`.** Les rôles `talent`/`clipper` ont été ajoutés en 2026 selon un principe explicite (`convex/roles.ts`, en-tête) : *des littéraux distincts, donc un oubli de gating ferme la porte au lieu de l'ouvrir*. Ce principe est réutilisable pour `manager` — voir Option B.

### 1.3 Provider d'auth et propagation de session

- **Provider** : Convex Auth, provider `Password` (email + mot de passe). Pas d'OAuth, pas de magic link. `convex/auth.ts`.
- **Session** : 90 jours (durée absolue **et** fenêtre d'inactivité), JWT d'accès court (1 h en prod). Cookie rendu persistant côté Next dans `proxy.ts` (`maxAge` 90 j).
- **Propagation** : `proxy.ts` (Next 16 — l'ancien `middleware.ts`) gate les **pages** ; les pages publiques sont `/login`, `/:slug/login`, `/join/*`, `/reset-password/*`.
- ⚠️ Le fichier le dit lui-même : **ce gating de pages est du confort UX**, pas une barrière. `NEXT_PUBLIC_CONVEX_URL` est dans le bundle public — la vraie barrière est dans les fonctions Convex.
- **Inscription fermée** : signup uniquement par token d'invitation, sauf la fenêtre « bootstrap » (table `users` vide ⇒ 1er compte = superadmin, `convex/auth.ts:87`).

### 1.4 Vérifications en dur (emails, IDs, variables d'env)

**Aucun contrôle d'accès applicatif ne repose sur un email ou un user_id en dur.** Vérifié par balayage de `convex/`, `lib/`, `components/`, `app/`.

| Fichier:ligne | Contenu | Est-ce un contrôle d'accès ? |
|---|---|---|
| `convex/passwordReset.ts:61` | Commentaire « protège anthosimo972@gmail.com » | **Non** — le code teste `role === "superadmin"`. L'email est illustratif. |
| `convex/adminRecovery.ts:39,105,164` | Emails dans des exemples de commande CLI | **Non** — commentaires. Fonctions `internal*`, non exposées au client. |
| `convex/demoMultiProject.ts:16,35` | Email dans un exemple de seed | **Non** — commentaire, `internalMutation`. |
| `convex/internalAccounts.ts:37` | ID de membership Whop en commentaire | **Non** — note d'analyse. |
| `convex/projects.ts:30,37` | `REPACKIT_SLUG`, `SNYTCH_SLUG` en dur | **Non** — routage/branding par projet, pas de rôle. |
| `E2E_SECRET` (env) | `e2eMutation`, `convex/functions.ts:154` | **Oui, mais fail-closed** : variable absente ⇒ rejet systématique. Jamais définie en prod. |

Il n'existe **pas** de `ADMIN_EMAIL` ni équivalent.

### 1.5 Row Level Security

**Sans objet.** Convex n'a pas de RLS ; le repo n'utilise pas non plus `convex-helpers/server/rowLevelSecurity`. Le seul import de `convex-helpers` est `customFunctions` (les portiers). **Toute l'autorisation vit donc dans `convex/functions.ts`** — ce qui est une chance pour ce chantier : il y a un seul endroit à modifier, et il est déjà bien documenté.

---

## 2. Cartographie des protections

### 2.1 Règle générale mesurée

Balayage automatique des 144 modules `convex/` — **499 fonctions exportées** :

| Portier | Nb | Qui passe |
|---|---:|---|
| `adminMutation` | 116 | admin du projet, ou superadmin |
| `adminQuery` | 95 | admin du projet, ou superadmin |
| `internalMutation` / `internalAction` / `internalQuery` | 156 | personne (CLI / crons uniquement) |
| `e2eMutation` | 48 | tests, si `E2E_SECRET` défini (jamais en prod) |
| `creatorQuery` / `creatorMutation` | 32 | créateur partenaire, filtré sur SA fiche |
| `adminViewAsQuery` (+ Talent/Clipper) | 20 | admin, lecture seule sur une fiche ciblée |
| `clipperQuery` / `clipperMutation` | 8 | clippeur |
| `talentQuery` / `talentMutation` | 3 | talent |
| `authedQuery` / `authedMutation` / `authedAction` | 16 | **tout utilisateur connecté, quel que soit son rôle** |
| `publicQuery` | 3 | non authentifié |
| `superadminMutation` | 1 | superadmin |
| `query` / `mutation` **bruts** | **0** | — |

> **Zéro fonction publique non gardée.** La règle « aucun module ne définit de fonction publique via `query`/`mutation` bruts » est tenue à 100 %. C'est un socle solide.

**Le problème n'est donc pas l'absence de gardes : c'est que 211 fonctions partagent exactement la même.**

### 2.2 Pages — rôle requis et lieu du contrôle

Toutes les pages `/admin/[projectSlug]/*` sont sous le même layout (`app/admin/[projectSlug]/layout.tsx`), qui ne fait **aucun** contrôle de rôle : il monte `ProjectProvider`, qui appelle `projects.getProjectForCurrentUser` et **redirige** un rôle de portail vers son portail. C'est un contrôle **client**. La vraie barrière est le portier de chaque query appelée par la page.

| Route | Rôle requis aujourd'hui | Contrôle SERVEUR | Contrôle CLIENT |
|---|---|---|---|
| `/login`, `/:slug/login`, `/join/*`, `/reset-password/*` | aucun (public) | `publicQuery` | `proxy.ts` (matcher public) |
| `/` (résolveur) | connecté | `creators.getMyPortal` (`authedQuery`) | `app/page.tsx` redirige par rôle |
| `/admin/<slug>/dashboard` | admin | `adminQuery` × N | `ProjectProvider` + sidebar |
| `/admin/<slug>/validation` | admin | `adminQuery`/`adminMutation` | idem |
| `/admin/<slug>/rushes` | admin | idem | idem |
| `/admin/<slug>/assignments` | admin | idem | idem |
| `/admin/<slug>/defis` | admin | idem | idem |
| `/admin/<slug>/pricings` | admin | idem | idem |
| `/admin/<slug>/paiements` | admin | idem | idem |
| `/admin/<slug>/analytics` | admin | idem | idem |
| `/admin/<slug>/notifications` | admin | idem | idem |
| `/admin/<slug>/createurs`, `/createurs/[id]` | admin | idem | idem |
| `/admin/<slug>/comptes`, `/comptes/[compteId]` | admin | idem | idem |
| `/admin/<slug>/scripts`, `/scripts/[id]`, `/scripts/[id]/analytics` | admin | idem | idem |
| `/admin/<slug>/inspirations` | admin | idem | idem |
| `/admin/<slug>/assets`, `/assets/[folderId]` | admin | idem | idem |
| `/admin/<slug>/guide` | admin | idem | idem |
| `/admin/<slug>/radar` | admin | idem | idem |
| `/admin/<slug>/carrousels`, `/shorts`, `/shorts/sources`, `/screenrecorder`, `/biblio-hooks` | admin | idem | **absentes de la sidebar** — accessibles par URL directe (legacy) |
| `/admin/voir/<slug>/<id>/*` (11 routes) | admin | `adminViewAsQuery` + variantes population | layout dédié |
| `/app/*` (portail créateur) | creator | `creatorQuery`/`creatorMutation` | `usePortalGate("creator")` |
| `/talent/*` | talent | `talentQuery`/`talentMutation` | `usePortalGate("talent")` |
| `/clip/*` | clipper | `clipperQuery`/`clipperMutation` | `usePortalGate("clipper")` |
| `/p/[carouselId]` | connecté | `publications.resolveCarouselForUser` (`authedQuery`) | — |

### 2.3 Endpoints API Next

| Route | Contrôle |
|---|---|
| `app/api/assets/postprocess/route.ts` | **Pas d'auth de rôle.** Anti-SSRF : les deux URLs doivent pointer exactement l'origine du déploiement Convex. Ne détient aucun secret ; la création de la row reste derrière `adminMutation`. |
| `app/api/snytch-drive/upload/route.ts` | Relais d'octets. La session resumable est mintée par `snytchDrive.getUploadSession` (`authedAction`) ; la route ne touche pas Convex. |

### 2.4 Surface accessible à TOUT connecté (`authedQuery`/`authedMutation`/`authedAction`)

Ces 16 fonctions ignorent le rôle. Elles sont donc **déjà** ouvertes à un futur manager, sans qu'aucune décision ne soit prise. Revue :

| Fonction | Contenu | Verdict |
|---|---|---|
| `projects.getMe` | `{ email, isSuperadmin }` | OK |
| `projects.getProjectForCurrentUser` / `getCurrentProject` / `listMyProjects` | Projection **whitelistée** `projectForClient` (`convex/projects.ts:132`) : slug, name, accent, logo, `payoutDay`, `payCurrency`, `sidebarLinks`, status. **Ni clés Whop, ni PostHog, ni `fxRateToRevenue`.** | OK — bonne pratique déjà en place |
| `creators.getMyPortal` / `getMyCreatorProjects` / `listAddableProjectsForCreator` | Rôle + projets de la personne | OK |
| `i18n.getMyLocale` / `setMyLocale` / `getCreatorLocale` | Langue | OK |
| `storage.generateUploadUrl` / `getPreviewUrl` | Upload/preview | OK (pas de scope projet) |
| `modelVideoEmbeds.resolveModelVideoEmbed`, `rushes.getDepositSession`, `snytchDrive.getUploadSession` | I/O externe | OK |
| `publications.resolveCarouselForUser` | Résolution carrousel | À revoir en Étape 0 (non bloquant) |

**Aucune fuite financière constatée sur cette surface** — c'est le point rassurant de l'audit.

### 2.5 Écrans protégés UNIQUEMENT côté client

**Aujourd'hui : aucun.** Chaque écran admin dépend de queries `adminQuery`, donc un créateur qui force l'URL obtient une page vide et un rejet serveur (prouvé par `e2e/creator-role-guard.spec.ts` et `e2e/talent-clipper-role-guard.spec.ts`).

**Demain, avec un manager : tous, par défaut.** Si `manager` est accepté par `requireProjectAdmin` sans autre changement, la seule chose qui empêchera un manager d'ouvrir `/admin/<slug>/paiements` sera **le masquage d'un lien dans la sidebar** — c'est-à-dire rien. C'est le risque n°1 de ce chantier.

---

## 3. Classification des fonctionnalités

### (A) Gestion créateurs → manager

| Fonctionnalité | Écran | Module Convex |
|---|---|---|
| Validation des vidéos soumises (approuver / refuser / feedback) | `/validation` | `assignments` |
| Rushes : revue, décision, montage | `/rushes` | `rushes`, `rushStatus` |
| Assignations : créer, éditer, annuler, relancer, pièces jointes | `/assignments` | `assignments` |
| Scripts : campagnes, briques, combos, rejeu, import de hooks | `/scripts`, `/scripts/[id]` | `scripts`, `scriptCombos` |
| Créateurs : fiches, invitation, statut, fuseau, langue, archivage | `/createurs` | `creators` |
| Comptes : déclaration, warmup, validation, réassignation, perf | `/comptes` | `comptes`, `warmup`, `accountPhase` |
| Inspirations, dossiers, ICPs, biblio hooks | `/inspirations`, `/biblio-hooks` | `inspirations`, `folders`, `icps`, `hooks` |
| Assets : dossiers, upload, post-process | `/assets` | `assets`, `assetFolders` |
| Guide / formations : modules, traductions, ajout de contenu | `/guide` | `guideModules`, `guide` |
| Notifications d'ops (réglages non financiers) | `/notifications` | `notifications` |
| Radar / veille TikTok | `/radar` | `radar` |
| Personnes (gestionnaires de comptes) | modale | `personnes` |
| Presets de filtres | transverse | `filterPresets` |
| Observation « voir l'espace d'un créateur » (lecture seule) | `/admin/voir/*` | `adminViewAsQuery` |
| Tracker / publications : métriques, quadrant, calendrier, snapshots | `/dashboard`, `/comptes` | `publications`, `trackerData`, `quadrant`, `metricSnapshots` |
| Vues legacy (carrousels, shorts, screenrecorder) | URL directe | `publications` |

### (B) Business / finance → super admin uniquement

| Fonctionnalité | Écran | Module Convex |
|---|---|---|
| Paiements : cycles, marquage payé, export CSV | `/paiements` | `payments` |
| Barèmes (fixe / CPM / paliers de bonus / récompenses nature) | `/pricings` | `pricing` |
| Rentabilité : marge, coûts, RPM business | carte `/paiements` | `profitability` |
| Revenu Whop (net, synchro) | carte `/paiements` | `whopSync`, `whopRevenue` |
| Hub analytics : CA, churn, MRR, LTV, offres, pays de facturation, fiabilité | `/analytics` | `analyticsHub` |
| Analytics produit PostHog (coût de scan inclus) | `/analytics` | `posthogSync` |
| Attribution de conversion (ventes par ref/créatrice) | `/dashboard` + `/analytics` | `conversionSync`, `conversionAttribution` |
| Création de projet | modale | `projects.createProject` (déjà superadmin) |
| Configuration devises / taux de change / clés Whop | CLI | `projects` (internal) |

### (C) AMBIGU — arbitrage nécessaire

Volontairement large, comme demandé.

| # | Fonctionnalité | Pourquoi c'est ambigu |
|---|---|---|
| C1 | **Défis** (`/defis`) | Animation d'équipe (A), mais un défi **impose un barème et un budget** (`createChallenge` : `budget`, `montantFixe`, `pricingId`) et déclenche des gains. |
| C2 | **Le tarif d'une assignation** (`rateSnapshot`, `pricingSnapshot`) | Le manager assigne des scripts. Doit-il voir « cette vidéo est payée 12 $ » ? Sans ça, il ne peut pas expliquer une mission à une créatrice. |
| C3 | **Choix du barème à l'assignation** (`assignScriptCampaign`, `assignFormat`) | Assigner **est** une action manager, mais l'acte fige un prix. Manager choisit-il, ou hérite-t-il du barème par défaut ? |
| C4 | **Statut de bonus d'une créatrice** (`pricing.getCreatorBonusStatus`, écran `/createurs/[id]`) | Levier de motivation (A) ou donnée de rémunération (B) ? |
| C5 | **Leaderboard créateurs** (`payments.leaderboard`) | Classement par vues ou par gains ? Le module s'appelle `payments`. |
| C6 | **Drapeau « warmup / rémunéré »** (`setPublicationWarmup`, `setPublicationRemuneration`) | Geste opérationnel quotidien, mais **il décide si un post est payé**. Verrou serveur existant si le cycle est déjà payé. |
| C7 | **Carte « total dû »** du Dashboard | Le dashboard est l'écran manager par excellence ; la carte est un montant. |
| C8 | **Bloc « Ce que ça a rapporté »** du Dashboard (ventes Whop par créatrice) | Utile pour piloter les créatrices, mais c'est du CA. |
| C9 | **Coordonnées de paiement** de la créatrice (`paymentMethod`, `paymentDetails`) | Le manager gère les fiches ; ces champs sont des RIB/PayPal. |
| C10 | **`clipRate` / `cycleRetainer`** sur la fiche créatrice | Tarif négocié par personne, sur un écran (A). |
| C11 | **Générer un lien de reset de mot de passe** (`passwordReset.generatePasswordResetLink`) | Support quotidien (A), mais c'est une action sensible sur un compte. |
| C12 | **Notifications Telegram** (`setNotifySettings`) | Les réglages incluent des déclencheurs Whop (`whop_dispute`, `whop_renewal_failed`) et le digest transporte le **total dû**. |
| C13 | **Analytics de script** (`scriptAnalytics`, `/scripts/[id]/analytics`) | Perf éditoriale (A) — à confirmer qu'aucun revenu n'y entre. |
| C14 | **Décisions dashboard** (`dashboardDecisions.decisionDashboard`) | Contient le mot `marge`. |
| C15 | **Radar / veille** | Admin-only aujourd'hui, sans lien avec l'argent. Manager ou pas ? |
| C16 | **Sync manuelles** (`requestWhopSync`, `requestPosthogSync`, `apifySync`) | Boutons « rafraîchir » qui **coûtent de l'argent** (Apify, PostHog) et touchent des sources business. |
| C17 | **Multi-projets** | Un manager est-il manager d'**un** projet ou de plusieurs ? Le modèle actuel est par projet. |
| C18 | **Le manager voit-il les autres managers/admins ?** | Dépend de l'écran de gestion des rôles demandé. |

---

## 4. Points de fuite de données — le cœur du sujet

> Méthode : balayage automatique du corps de chaque fonction gardée à la recherche de ~40 marqueurs financiers (`amount`, `montant`, `net`, `revenue`, `payout`, `pricing`, `bonus`, `marge`, `cpm`, `whop`, `currency`, `coutReel`…), puis lecture manuelle de chaque correspondance sur un écran de catégorie (A).

### 4.1 🔴 CRITIQUE — Fuites dans des écrans « gestion créateurs »

| # | Où | Ce qui fuit | Preuve |
|---|---|---|---|
| **F1** | **Dashboard** — `components/admin/ActionDashboard.tsx:122` | Appelle `api.payments.listPayments` et calcule `dueTotal` = somme de tous les cycles non payés (`:198`). **Le payload complet des cycles de paie arrive dans le navigateur.** | `payments.listPayments` renvoie `totalDue`, `paidAt`, `pricingBreakdown` |
| **F2** | **Dashboard** — `ActionDashboard.tsx:129` | Appelle `api.conversionSync.readConversionAllTime` → section « Ce que ça a rapporté » : **visiteurs, inscriptions, ventes et REVENU Whop par créatrice**, plus « Total attribué » et « Total » (réconciliable avec Whop). | `readConversionAllTime` contient `currency`, `net`, `revenue`, `whopMembershipId` |
| **F3** | **Liste des créateurs** — `convex/creators.ts:128` | `rows.push({ ...c, … })` — **spread de la fiche entière**. Embarque `paymentMethod`, `paymentDetails` (coordonnées bancaires/PayPal), `bonusPricingId`, `clipRate`, `cycleRetainer`, `adminNotes`. | Champs déclarés dans `convex/schema.ts`, table `creators` |
| **F4** | **Liste des assignations** — `convex/assignments.ts:956` | `return { ...a, … }` — spread complet. Embarque `rateSnapshot` (**objet requis**, présent sur chaque ligne), `pricingSnapshot`, `clipRateSnapshot`. **Le tarif de chaque vidéo est dans le payload de l'écran d'assignation.** | Champs déclarés dans `convex/schema.ts`, table `assignments` |
| **F5** | **Liste des comptes** — `convex/comptes.ts:322` et `:1081` | `{ ...c, … }` — spread complet. Moins grave (la table `comptes` n'a pas de champ monétaire direct) mais le motif est le même et fragile à toute évolution du schéma. | — |

> **Pourquoi F1–F4 sont critiques et pas cosmétiques.** Convex sert la query au client ; masquer une carte en React **ne retire pas la donnée du navigateur**. Un manager (ou son extension de navigateur) lit le payload dans l'onglet réseau. Un `hidden` en CSS n'est pas un contrôle d'accès.

### 4.2 🟠 Fuites secondaires

| # | Où | Ce qui fuit |
|---|---|---|
| F6 | `assignments.getAssignmentDetailAsAdmin` (`adminViewAsQuery`) | Panneau de détail d'une mission : `amount`, `bonus`, `cpm`, `fixe`, `montant`, `pricingSnapshot` |
| F7 | `assignments.listValidatedForBonus` (`adminQuery`) | `amount`, `bonus`, `cpm`, `montant`, `bonusByAssignment` |
| F8 | `assignments.computeViewBonus` (`adminMutation`) | Calcule et écrit un montant de bonus |
| F9 | `creators.getCreatorDeletionImpact` (`adminQuery`) | `bonusUnlocks`, `paid` — l'impact d'une suppression cite des paiements |
| F10 | `publications.getPublicationPayFlags` + `setPublicationWarmup` | `cpm`, `fixe`, `paidAt`, `remunere` — le toggle warmup lit et écrit l'état de paie |
| F11 | `pricing.getCreatorBonusStatus` via `components/creators/CreatorDetailView.tsx` | Statut de bonus + `listPricings` (les barèmes complets) sur la **fiche créatrice** |
| F12 | `components/admin/leaderboard/CreatorLeaderboard.tsx` | `api.payments.leaderboard` |
| F13 | `challenges.createChallenge` / `setChallengeParticipants` / `getChallenge` | `budget`, `montantFixe`, `pricingId`, `pricingSnapshot` |
| F14 | `dashboardDecisions.decisionDashboard` | contient `marge` |
| F15 | `notifications.setNotifySettings` | Déclencheurs `whop_dispute`, `whop_renewal_failed` ; nomme `whopPayments` |
| F16 | `projects.setTalentSettings` | `devise`, `montant` |
| F17 | `scripts.assignScriptCampaign` / `assignScriptToRush` / `editScriptBrickText` | `pricingSnapshot`, `pricingId`, `cpm`, `fixe` — l'assignation de script **fige un tarif** |

### 4.3 Exports, logs, e-mails, notifications

| Canal | Constat |
|---|---|
| **Export CSV** | **Un seul** point d'export : `app/admin/[projectSlug]/paiements/page.tsx:267` → `downloadCsv("paiements-cycles.csv", …)`. Il est sur un écran (B). Aucun export CSV sur un écran (A). ✅ |
| **E-mails** | `convex/emails.ts` — l'e-mail « Paiement effectué » (`:320`) contient un montant (`emailAmount`, `:350`). Destinataire = **la créatrice**, pas un admin. Pas de fuite vers le manager. ✅ |
| **Digest Telegram** | `convex/opsDigest.ts:48` — `CycleLike` porte `totalDue` ; `isCycleDue` (`:55`) filtre sur `totalDue > 0`. Le digest est envoyé sur **un canal par projet**, pas par rôle. ⚠️ Si un manager est dans ce canal, il voit les montants dus — **hors de portée de tout contrôle applicatif**. |
| **Logs** | Pas de `console.log` de payload financier identifié. Les `console.error` d'`emails.ts:102` et `assets/postprocess` ne contiennent pas de montant. ✅ |
| **Objet utilisateur complet** | `projects.getMe` renvoie `{ email, isSuperadmin }` — minimal. `projectForClient` (`convex/projects.ts:132`) est une **whitelist explicite** qui exclut Whop/PostHog/`fxRateToRevenue`. ✅ **Ce motif est le modèle à répliquer pour F3/F4/F5.** |

### 4.4 Navigation

| Élément | Constat |
|---|---|
| **Sidebar** (`components/layout/Sidebar.tsx`) | **Aucun conditionnement par rôle.** Elle lit `api.projects.getMe` uniquement pour afficher l'email en pied. Les sections PILOTAGE (dont **Pricings**, **Paiements**, **Analytics**), CRÉATEURS, CONTENU, VEILLE sont rendues inconditionnellement. |
| **Liens externes** | `project.sidebarLinks` — données par projet, pas par rôle. |
| **Routes hors sidebar** | `/carrousels`, `/shorts`, `/shorts/sources`, `/screenrecorder`, `/biblio-hooks` sont **accessibles par URL directe** bien qu'absentes du menu. Rappel utile : *retirer un lien ne ferme pas une route.* |
| **Breadcrumbs** | Aucun composant de fil d'Ariane identifié. |
| **Redirection `/`** | `app/page.tsx` + `lib/portal-path.ts` : `portalPathForRole` ne connaît que `creator`/`talent`/`clipper`. Un rôle `manager` y retournerait `null` ⇒ **il serait traité comme un admin** par `getMyPortal` seulement si `hasAdmin` est vrai ; sinon il tomberait en `role: "none"` (écran vide). **Ce point doit être traité explicitement.** |

---

## 5. Écran de gestion des rôles — ce qui existe aujourd'hui

| Question | Réponse factuelle |
|---|---|
| **Table utilisateurs consultable ?** | La table `users` existe (`convex/schema.ts:29`) mais **n'est exposée par aucune query client**. Aucun endpoint ne liste les utilisateurs. |
| **Écran d'admin des utilisateurs ?** | **Aucun.** Attention au faux ami : l'écran « Personnes » (`convex/personnes.ts`) gère les **gestionnaires de comptes** — de simples étiquettes `{prenom, nom}` attachées à des comptes TikTok. Ce ne sont **pas** des utilisateurs, ils n'ont pas de login. |
| **Comment un CRÉATEUR est-il créé ?** | Dans l'app : `creators.inviteCreator` (`adminMutation`) crée la fiche + un token dans `invitations`. La personne s'inscrit via `/join/<token>`. Le rôle de membership **dérive de `creators.kind`** au signup (`convex/auth.ts`, `roleForKind`) — l'invitation ne porte aucun rôle. |
| **Comment un ADMIN est-il créé ?** | **Uniquement en ligne de commande**, par un opérateur ayant accès au déploiement : `provisionAdmin:provisionAdminAccount` puis `provisionAdmin:grantProjectAdmin` (`internalMutation`, `npx convex run … --prod`). Le fichier se décrit lui-même comme « OUTIL ONE-SHOT … À SUPPRIMER ». |
| **Comment un SUPERADMIN est-il créé ?** | **Uniquement** par la fenêtre bootstrap : premier signup quand la table `users` est vide (`convex/auth.ts:87`). **Il n'existe aucun chemin de promotion vers superadmin** — `provisionAdmin` fige `role: "member"` par conception. |
| **Un rôle par user, ou permissions granulaires ?** | **Un rôle par (utilisateur, projet)** — `memberships` a un champ `role` scalaire, pas un tableau de permissions. Plus un rôle global binaire `superadmin`/`member`. **Aucune notion de permission n'existe dans le schéma.** |
| **Cumul de rôles ?** | Possible en base (plusieurs memberships sur des projets différents). Sur un **même** projet, l'unicité n'est pas imposée par le schéma ; `getMyPortal` gère l'ambiguïté par priorité (admin prime, puis `creator` → `talent` → `clipper`). |
| **Révocation ?** | Supprimer le membership suffit — le rôle est relu à chaque requête. Effet immédiat (le JWT ne porte pas le rôle). |

**Conséquence pour la demande : l'écran de gestion des rôles est du 100 % neuf.** Il n'y a ni query de listing, ni mutation de changement de rôle, ni UI. À construire : `listProjectMembers`, `setMemberRole`, `revokeMember`, `inviteAdmin` — tous en `superadminMutation`/query superadmin.

---

## 6. Risques classés par gravité

### 🔴 Bloquants — le rôle serait cosmétique sans traitement

| # | Risque | Fondement |
|---|---|---|
| R1 | **Le Dashboard livre la paie et le CA au navigateur.** Masquer les cartes ne retire pas la donnée du payload réseau. | F1, F2 |
| R2 | **Les spreads `{...doc}` fuient tout champ ajouté au schéma, pour toujours.** Aujourd'hui : coordonnées de paiement, tarifs, retainer, tarif par vidéo. Demain : tout nouveau champ financier, **silencieusement**. | F3, F4, F5 |
| R3 | **211 fonctions partagent une garde unique.** Ouvrir `requireProjectAdmin` à `manager` ouvre les 211 d'un coup — y compris `payments`, `pricing`, `profitability`, `analyticsHub`. Approche **fail-open**. | §2.1 |
| R4 | **Le seul contrôle envisageable « rapidement » est la sidebar, qui n'est pas un contrôle.** 5 routes sont déjà accessibles par URL directe sans être au menu. | §4.4 |

### 🟠 Majeurs

| # | Risque | Fondement |
|---|---|---|
| R5 | Le tarif figé est **au cœur du geste manager** : assigner un script écrit un `pricingSnapshot`. Séparer paie et assignation demande un arbitrage produit, pas seulement du code. | F17, C2, C3 |
| R6 | Les **défis** mêlent animation et budget dans les mêmes mutations. | F13, C1 |
| R7 | Le **toggle warmup** lit et écrit l'état de paie d'un post. C'est un geste quotidien de manager avec une conséquence monétaire. | F10, C6 |
| R8 | Le **digest Telegram** transporte le total dû sur un canal projet — hors de portée de tout contrôle applicatif. | §4.3 |
| R9 | `portalPathForRole` et `getMyPortal` **ne connaissent pas** `manager` : un manager sans traitement explicite atterrit sur un écran vide ou est traité comme admin. | §4.4 |
| R10 | Les **boutons de synchro manuelle** coûtent de l'argent (Apify/PostHog) et touchent des sources business. | C16, F15 |

### 🟡 Modérés

| # | Risque |
|---|---|
| R11 | Aucun test ne garantit qu'un futur endpoint ne fuite pas de champ financier — pas de garde-fou automatisé de type « une query (A) ne renvoie aucun champ monétaire ». |
| R12 | `provisionAdmin.ts` est documenté « à supprimer » mais reste le **seul** chemin de création d'admin. |
| R13 | Aucun chemin de promotion vers superadmin : si le compte bootstrap est perdu, la reprise passe par un accès direct au déploiement. |
| R14 | Les 5 routes legacy hors sidebar ne sont pas inventoriées ailleurs que dans ce rapport. |
| R15 | Session de 90 j **globale**, non réglable par rôle (limite de Convex Auth) : un manager garde sa session aussi longtemps qu'un superadmin. |

### 🟢 Points forts à préserver

- Zéro fonction publique non gardée (0 `query`/`mutation` brut sur 499).
- Aucun contrôle d'accès basé sur un email ou un ID en dur.
- Le rôle est relu en base à chaque requête (révocation immédiate).
- `projectForClient` : whitelist explicite déjà en place — **le modèle à généraliser**.
- Des specs e2e prouvent les gardes **côté serveur**, pas seulement l'UI (`creator-role-guard`, `talent-clipper-role-guard`, `formats-role-guard`).
- Le principe des « littéraux distincts » de `convex/roles.ts` est **fail-closed** et directement réutilisable.

---

## 7. Options d'architecture

### Option A — `manager` accepté par la garde admin, écrans masqués

`requireProjectAdmin` accepte `admin` **et** `manager` ; on masque les liens et les cartes côté client.

| | |
|---|---|
| **Effort** | ~2 jours |
| **Avantages** | Très rapide ; aucune fonction serveur à toucher ; zéro régression sur les admins. |
| **Limites** | **Rédhibitoire.** Fail-open : les 211 fonctions restent ouvertes. `/paiements` et `/analytics` restent atteignables par URL. Les fuites F1–F4 restent intégralement présentes dans le payload. **Ce n'est pas un contrôle d'accès, c'est une décoration.** |
| **Verdict** | À écarter, sauf si le manager est une personne de confiance et que l'objectif est seulement de désencombrer son écran — auquel cas il faut le dire explicitement. |

### Option B — Rôle `manager` + portier `financeQuery` explicite ✅ recommandée

1. `memberships.role` accepte `"manager"` (littéral distinct, dans l'esprit de `convex/roles.ts`).
2. `requireProjectAdmin` accepte `admin` + `manager` → les écrans (A) fonctionnent sans y toucher.
3. **Nouveaux portiers `financeQuery` / `financeMutation`** = « admin strict ou superadmin, jamais manager ».
4. On **bascule explicitement** les ~60 fonctions de catégorie (B) sur ces portiers : `payments`, `pricing`, `profitability`, `whopSync`, `analyticsHub`, `posthogSync`, `conversionSync`.
5. On **remplace les spreads** `{...doc}` par des projections whitelistées, sur le modèle de `projectForClient`.
6. Sidebar et cartes conditionnées par rôle — **en confort**, la barrière restant serveur.

| | |
|---|---|
| **Effort** | ~5–8 jours (dont ~2 j rien que pour F1–F4) |
| **Avantages** | Suit exactement le patron déjà éprouvé du repo. La classification (B) est **écrite dans le code**, donc relisible et testable. Aucune table nouvelle, aucune migration de données (`memberships.role` est un `v.union`, il suffit d'ajouter un littéral). Les gardes sont prouvables par des specs e2e du même modèle que `creator-role-guard.spec.ts`. |
| **Limites** | **Fail-open par défaut** : une nouvelle fonction financière créée en `adminQuery` sera visible du manager. Mitigation : un test de garde-fou qui échoue si un module de la liste (B) exporte autre chose que `finance*`. Reste « un rôle par personne », donc pas de réglage fin par utilisateur. |

### Option C — Système de permissions granulaires

Table `permissions` (ou champ `permissions: string[]` sur `memberships`), portiers paramétrés par capacité (`requirePermission(ctx, "payments.read")`), écran de gestion cochant les cases.

| | |
|---|---|
| **Effort** | ~3 semaines |
| **Avantages** | Répond directement à « gestion des rôles **et permissions** par utilisateur ». Extensible sans nouveau rôle. Un écran de gestion riche devient naturel. |
| **Limites** | Il faut **attribuer une capacité à chacune des 211 fonctions** — le travail de tri de l'Option B, plus la mécanique. Le risque d'erreur augmente avec le nombre de combinaisons (2^N états possibles, dont la plupart ne seront jamais testés). Le débogage d'un « pourquoi je ne vois pas cet écran » devient un vrai sujet. **Les fuites F1–F4 restent à traiter à l'identique** : aucune option ne les évite. |
| **Verdict** | Justifié si vous prévoyez ≥ 4 profils distincts, ou des exceptions par personne. Pour un seul profil « manager », c'est surdimensionné. |

> **Recommandation : Option B**, avec le schéma de permissions gardé en ligne de mire — passer de B à C plus tard est un refactoring mécanique (remplacer `financeQuery` par `requirePermission`), pas une reprise. L'inverse n'est pas vrai.

---

## 8. Plan de migration par étapes

Chaque étape est **livrable et testable seule**, et laisse l'app fonctionnelle. Aucune ne dépend de la suivante.

### Étape 0 — Colmater les fuites, **avant** tout rôle (~2 j)
Utile **même si le chantier manager s'arrête là** : ce sont des défauts d'hygiène actuels.
- Remplacer `creators.ts:128` `{...c}` par une projection whitelistée (`creatorForAdminList`).
- Idem `assignments.ts:956` et `comptes.ts:322`/`:1081`.
- **Test** : `tsc` casse partout où un écran lit un champ retiré → la liste exhaustive des consommateurs réels sort du compilateur. Spec : la query ne renvoie ni `paymentDetails`, ni `rateSnapshot` (assertion d'**absence** doublée d'une assertion de **présence** des champs légitimes).

### Étape 1 — Le littéral `manager` (~0,5 j)
- Ajouter `"manager"` à `memberships.role` (schéma) et à `convex/roles.ts` (ce **n'est pas** un `PortalRole`).
- Traiter `getMyPortal` et `portalPathForRole` explicitement → un manager route vers `/admin/<slug>/dashboard`.
- **Test** : un manager créé en base se connecte et atterrit au bon endroit. À ce stade il est **rejeté de tout** (fail-closed) — c'est le comportement attendu et c'est ce qu'on vérifie.

### Étape 2 — Les portiers finance (~1 j)
- Créer `financeQuery` / `financeMutation` dans `convex/functions.ts` (admin strict ou superadmin ; `manager` rejeté).
- **Ne basculer aucune fonction encore.** Ajouter une spec qui prouve qu'un manager est rejeté d'une fonction témoin.
- **Test** : contre-épreuve — la spec doit être vue **rouge** avant d'être verte (garde retirée temporairement en local, restaurée depuis une copie faite avant).

### Étape 3 — Basculer la catégorie (B) (~1,5 j)
- `payments`, `pricing`, `profitability`, `whopSync`, `analyticsHub`, `posthogSync`, `conversionSync` → `finance*`.
- **Test** : une spec e2e sur le modèle de `creator-role-guard.spec.ts` — un manager authentifié est rejeté de **chaque** module de la liste, nommément. Les admins continuent de passer (contrôle A/B).

### Étape 4 — Ouvrir la catégorie (A) au manager (~0,5 j)
- `requireProjectAdmin` accepte `manager`.
- **Test** : le manager fait un parcours complet — valider une vidéo, assigner un script, inviter une créatrice, éditer le guide — et reste rejeté de `/paiements` et `/analytics`.

### Étape 5 — Nettoyer le Dashboard (~1 j)
- Retirer `listPayments` et `readConversionAllTime` d'`ActionDashboard` **pour un manager** : soit deux composants distincts, soit une query dédiée qui ne renvoie le bloc financier qu'à un admin.
- **Test** : inspection du payload réseau — pour un manager, `totalDue` et `revenue` sont **absents de la réponse**, pas seulement invisibles à l'écran.

### Étape 6 — Sidebar et navigation (~0,5 j)
- Conditionner les items Pricings / Paiements / Analytics au rôle. **Confort uniquement** — la barrière est acquise aux étapes 3 et 5.
- Décider du sort des 5 routes legacy hors sidebar.

### Étape 7 — Écran de gestion des rôles (~2–3 j)
- Queries/mutations superadmin : `listProjectMembers`, `setMemberRole`, `revokeMember`, `inviteAdminOrManager`.
- Écran `/admin/<slug>/equipe` (ou global), visible du seul superadmin.
- **Test** : un admin ou un manager est rejeté de ces fonctions ; un superadmin change un rôle et l'effet est **immédiat** (pas de reconnexion — le rôle est relu à chaque requête).

### Étape 8 — Garde-fou anti-régression (~0,5 j)
- Test unitaire qui parcourt les modules de la liste (B) et **échoue** si l'un d'eux exporte une fonction en `adminQuery`/`adminMutation`.
- C'est ce qui transforme la classification d'une décision ponctuelle en une **règle tenue par la CI**.

**Total estimé : 9–11 jours**, dont l'Étape 0 (2 j) a de la valeur indépendamment de la suite.

---

## 9. Questions — j'ai besoin de vos réponses

### Bloquantes (elles changent l'architecture)

1. **Le manager doit-il voir le tarif d'une vidéo qu'il assigne ?** (C2, C3) — Si **non**, l'écran d'assignation et le panneau de détail doivent être remaniés, et il faut décider qui choisit le barème. Si **oui**, la frontière « argent » devient « agrégats et CA », pas « tout montant ». C'est la question la plus structurante du chantier.

2. **Le Dashboard reste-t-il l'écran d'accueil du manager ?** (C7, C8) — Sans la carte « total dû » ni le bloc « Ce que ça a rapporté », il perd deux de ses sections. Faut-il un dashboard manager dédié, ou le même amputé ?

3. **Un profil, ou plusieurs à venir ?** — Si « manager » est le seul profil prévu à 12 mois : Option B. Si vous en anticipez 3–4 (ex. « éditorial », « ops comptes », « finance ») : Option C dès maintenant, sinon le refactoring se paie deux fois.

4. **Le manager est-il lié à un projet ou à plusieurs ?** (C17) — Le modèle actuel est strictement par projet. Un manager « transverse » sans être superadmin n'existe pas aujourd'hui et serait un rôle global neuf.

### Arbitrages de périmètre (catégorie C)

5. **Défis** (C1) — animation d'équipe pour le manager, ou réservé au superadmin puisqu'un défi impose un budget ?
6. **Toggle warmup / rémunéré** (C6) — geste quotidien de manager, alors qu'il décide si un post est payé. On l'ouvre ?
7. **Coordonnées de paiement, `clipRate`, `cycleRetainer`** sur la fiche créatrice (C9, C10) — visibles du manager ou non ? Ce sont des données personnelles autant que financières.
8. **Statut de bonus** et **leaderboard** (C4, C5) — levier de motivation à ouvrir, ou donnée de rémunération à fermer ?
9. **Radar / veille** (C15) — dans le périmètre manager ?
10. **Boutons de synchro manuelle** (C16) — le manager peut-il déclencher une synchro Apify/PostHog qui coûte de l'argent ?
11. **Générer un lien de reset de mot de passe** pour une créatrice (C11) — support quotidien à ouvrir, ou action sensible à fermer ?

### Écran de gestion des rôles

12. **Qui peut changer un rôle ?** Superadmin seul, ou un admin peut-il nommer un manager sur son projet ?
13. **Le manager voit-il la liste de l'équipe ?** (C18) — en lecture seule, ou pas du tout ?
14. **Comment invite-t-on un manager ?** Le flux d'invitation actuel (`/join/<token>`) est **entièrement câblé sur les fiches `creators`** — le rôle dérive de `creators.kind`. Un manager n'a pas de fiche créateur. Faut-il :
    - (a) un second flux d'invitation pour l'équipe interne (plus propre, plus de travail) ;
    - (b) étendre `invitations` pour porter un rôle (plus rapide, mais **casse le principe actuel** selon lequel l'invitation ne porte aucun rôle — ce qui garantit qu'un lien régénéré ne peut pas dériver du rôle réel) ?
    Je recommande (a).
15. **Faut-il un chemin de promotion vers superadmin ?** (R13) — aujourd'hui il n'y en a **aucun** hors fenêtre bootstrap. Chantier séparé, mais à décider.

### Opérationnelles

16. **Digest Telegram** (R8) — il transporte le total dû sur un canal par projet. Un manager y sera-t-il présent ? Si oui, aucun contrôle applicatif ne le protège : il faut un second canal, ou retirer les montants du digest.
17. **Combien de managers, et quand ?** — cela conditionne s'il faut livrer l'Étape 7 (écran de gestion) en même temps, ou si créer les premiers managers en ligne de commande suffit pour démarrer.
