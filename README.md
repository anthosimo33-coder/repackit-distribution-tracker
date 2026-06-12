# RepackIt Distribution Tracker

Tracker de distribution pour les carrousels TikTok et Instagram de RepackIt. Permet de centraliser, suivre et orchestrer la diffusion de contenus carrousel sur les deux plateformes.

## Stack

- **Next.js 16** (App Router) — `next@latest` (équivalent fonctionnel à Next.js 15 demandé : App Router, Server Components, Server Actions)
- **TypeScript** (strict)
- **Tailwind CSS v4** (`@tailwindcss/postcss`)
- **shadcn/ui** — base color slate, CSS variables, preset `base-nova`
- **React 19**
- **pnpm** comme package manager

### Composants shadcn/ui installés

`button`, `input`, `select`, `dropdown-menu`, `dialog`, `table`, `card`, `badge`, `tabs`, `label`, `textarea`, `sonner` (remplace `toast`, déprécié dans le registry shadcn), `calendar`, `popover`.

## Contexte

Ce projet est l'outil interne de RepackIt pour suivre la distribution des carrousels (TikTok + Instagram) : programmation, statut de publication, métriques par plateforme, et reporting cross-canal.

## Commandes

```bash
pnpm dev      # Lance le dev server sur http://localhost:3000
pnpm build    # Build production
pnpm start    # Lance le build en mode production
pnpm lint     # Lint le code (ESLint + config Next.js)
```

## Structure

```
app/            # App Router (pages, layouts, route handlers)
components/ui/  # Composants shadcn/ui
lib/            # Utilitaires (cn, etc.)
public/         # Assets statiques
```

## Déploiement Vercel + Convex (TD-006)

Le build Vercel pousse le backend Convex **avant** le build Next, atomiquement :
`vercel.json` (commité) définit `buildCommand: "npx convex deploy --cmd 'pnpm build'"`.
Plus jamais de mismatch code Vercel / schéma Convex.

Configuration une seule fois :

1. Dashboard Convex → projet `repackit-distribution-tracker` → deployment prod
   `fiery-wolf-460` → Settings → **Generate Production Deploy Key**.
2. Vercel → Project → Settings → Environment Variables → ajouter
   `CONVEX_DEPLOY_KEY` (scope **Production**) avec la clé générée.

Sans `CONVEX_DEPLOY_KEY`, le build Vercel échoue — c'est voulu : on ne peut
plus shipper du code sans son schéma.

## Multi-tenant (P2) — rollout de la migration projectId

Toutes les tables métier sont scopées par `projectId` (tables `projects` +
`memberships`). Numérotation `C###`/`S###`/`SR###` **par projet**.

À cause du déploiement atomique (le `convex deploy` du build pousse le schéma
AVANT toute migration data), le rollout a été fait en **2 phases** (prod
backfillée le 2026-06-12) :

1. **Phase 1** (`feat(multi-tenant)`) — `projectId` en `v.optional` + tables
   `projects`/`memberships` + indexes. Après déploiement, lancé **une fois**
   sur prod :

   ```bash
   ./node_modules/.bin/convex run migrations:setupRepackitProject --prod
   ```

   → projet `repackit`, membership admin du superadmin, backfill `projectId`
   partout, unset `vuesJ1/J3/J7` (TD-016). Comptages des 9 tables inchangés
   (64 publications, 490 hooks, etc.), KPIs dashboard identiques.

2. **Phase 2** (`chore(multi-tenant)`) — la prod étant backfillée, `projectId`
   resserré en `v.id("projects")` (non-optional) sur les 9 tables et
   `vuesJ1/J3/J7` retirés du schéma. Le succès du `convex deploy` au build
   prouve qu'aucun doc prod ne viole le schéma resserré.

TD-017 (`comptes.actif`) reste différé : `lib/compte-status.ts` + ~12 specs e2e
le lisent encore.

Pour amorcer un **nouveau deployment** (dev/test/prod neuf), lancer
`setupRepackitProject` après le 1er provisioning auth (crée le projet repackit
+ membership superadmin ; idempotent).

### P3 — routes `/admin/[projectSlug]` + switcher + création de projet

L'app interne vit sous `/admin/[projectSlug]/…` (dashboard, comptes, carrousels,
shorts, screenrecorder, biblio-hooks, inspirations). **L'URL est la source de
vérité du projet actif** : `ProjectProvider` lit le segment `[projectSlug]` et
le résout via `api.projects.getProjectForCurrentUser` (vérif superadmin ou
membership ; 404 propre si slug inexistant, accès refusé sinon). Plus aucun
projet implicite ni stocké en localStorage.

- `/` résout le projet par défaut de l'utilisateur (`getCurrentProject`) puis
  redirige vers `/admin/<slug>/dashboard`. Les anciennes routes (`/dashboard`,
  `/carrousels?carouselId=…`, `/nouveau`, `/tracker`…) redirigent vers
  `/admin/repackit/…` (slug par défaut). `/p/[carouselId]` est un resolver
  cross-projet : il cherche le carouselId dans les projets accessibles puis
  redirige vers la route scopée (404 sinon).
- **Switcher de projet** en tête de sidebar (`api.projects.listMyProjects` :
  superadmin → tous, sinon memberships). **« Créer un projet »** (superadmin,
  `api.projects.createProject`) : modal nom + slug + couleur d'accent (#FF5200)
  + jour de paie (5) → projet vierge → bascule dessus. Footer sidebar : email
  (`api.projects.getMe`) + déconnexion.
- État local scopé : `tracker.snapshot-age:<slug>` (période J+X par projet) ;
  `sidebar-collapsed` et le schéma des `filterPresets` restent globaux.
- Les e2e naviguent dans `/admin/e2e-test/…` (helper `adminPath`) sur un projet
  dédié `e2e-test` (créé par `auth.setup.ts`).

Reste différé (hors P3) : rôle `creator` + portail `/app`, theming par
`accentColor`.

## Authentification (Convex Auth)

L'app est protégée de bout en bout :

- **Fonctions Convex** : toutes les queries/mutations publiques passent par
  les wrappers de `convex/functions.ts`. C'est LA barrière de sécurité —
  `NEXT_PUBLIC_CONVEX_URL` est publique dans le bundle, protéger les pages ne
  suffit pas. Couches (de la plus large à la plus stricte) :
  - `authedQuery` / `authedMutation` : session requise (`ctx.userId`) ;
  - `superadminMutation` : rôle global `superadmin` ;
  - `projectQuery` / `projectMutation` : accès au projet (membership ou
    superadmin), tout rôle — `ctx.projectId` injecté ;
  - `adminQuery` / `adminMutation` : membership `admin` (ou superadmin) sur le
    projet. **Toute l'app interne** passe dessus → le rôle `creator` n'y a
    aucun accès ;
  - `creatorQuery` / `creatorMutation` : membership `creator`, résout SA fiche
    `creators` et injecte `ctx.creatorId` ; la donnée servie est filtrée par
    ce `creatorId` (portail `/app`) ;
  - `publicQuery` : pré-session, réservé à l'aperçu d'invitation (`/join`).
- **Pages Next** : `proxy.ts` (middleware Next 16) redirige tout visiteur
  sans session vers `/login` (sauf routes publiques `/login` et `/join/...`).
  Routage par rôle : un `creator` sur `/admin/*` est renvoyé vers `/app`, un
  `admin`/`superadmin` sur `/app` vers son `/admin`.
- **Inscription fermée, comptes par invitation** : le premier compte d'un
  deployment s'inscrit via la fenêtre bootstrap (table `users` vide → rôle
  `superadmin`). Ensuite, création de comptes **uniquement par invitation** :
  un admin invite un créateur (`/admin/[slug]/createurs`) → lien `/join/<token>`
  (uuid, +14 j, usage unique). Le `signUp` n'est autorisé que par un token
  valide (`convex/auth.ts` `createOrUpdateUser`) : il crée le `user` (rôle
  `member`), le `membership` `creator`, lie la fiche et marque l'invitation
  consommée — le tout atomiquement. Token absent/expiré/réutilisé → rejet sans
  leak.
- **Mutations e2e** (`seedHooks`, `clearHooks`, `cleanupTest*`,
  `wipeAllPublications`) : gated par un arg `secret` égal à la variable
  d'environnement `E2E_SECRET` du deployment. Si la variable n'est pas
  définie (cas de la prod, toujours) → rejet systématique.

### Provisionner un deployment (dev / test / prod)

```bash
# 1. Clés JWT (affiche les deux commandes `convex env set` à exécuter)
pnpm tsx scripts/generate-jwt-keys.ts

# 2. URL du site (redirections auth)
./node_modules/.bin/convex env set SITE_URL http://localhost:3000   # prod : URL Vercel, avec --prod

# 3. Secret e2e — deployments de DEV/TEST UNIQUEMENT, JAMAIS en prod
./node_modules/.bin/convex env set E2E_SECRET <valeur ≥ 8 caractères>

# 3 bis. JWT longue durée — DEV/TEST UNIQUEMENT, JAMAIS en prod (prod = 1h).
# Défense en profondeur du fixture d'auth e2e : évite tout refresh de token
# pendant un test (les refresh tokens sont single-use → races sinon). 30 jours.
./node_modules/.bin/convex env set JWT_DURATION_MS 2592000000

# 4. Pousser schéma + fonctions, puis créer le compte initial sur /login
./node_modules/.bin/convex dev --once   # prod : convex deploy (ou push Vercel)
```

Premier compte : ouvrir `/login` → « Créer le compte initial » → superadmin.
Compte perdu ou `E2E_SECRET` changé après création du user e2e :
`./node_modules/.bin/convex run maintenance:wipeAuthTables` rouvre la fenêtre
bootstrap (purge users + sessions).

### E2E et CI

- Le user e2e (`e2e@repackit.test`, mot de passe = `E2E_SECRET`) est créé au
  premier run par `e2e/auth.setup.ts` via la fenêtre bootstrap ; sa session
  (storageState) est partagée par toutes les specs.
- En local : `E2E_SECRET` doit être dans `.env.local` ET sur le deployment
  Convex visé par `NEXT_PUBLIC_CONVEX_URL`.
- En CI : secrets GitHub `CONVEX_TEST_URL` (existant) + **`E2E_SECRET`**
  (même valeur que la variable du deployment de test). Le deployment de test
  doit être provisionné (étapes ci-dessus) avec les fonctions à jour.
- Re-seed des hooks en prod (exceptionnel) : définir temporairement
  `E2E_SECRET` sur la prod via `convex env set --prod`, lancer
  `pnpm tsx scripts/run-seed.ts --env prod`, puis retirer la variable.
- Smoke prod (`scripts/smoke-prod-presets.ts`) : s'authentifie avec un vrai
  compte prod via `PROD_SMOKE_EMAIL` / `PROD_SMOKE_PASSWORD`
  (`.env.prod.local`).
