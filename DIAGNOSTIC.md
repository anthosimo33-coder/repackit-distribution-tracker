# DIAGNOSTIC — RepackIt Distribution Tracker

> Audit en lecture seule réalisé le 11/06/2026, en préparation de la transformation
> en **plateforme multi-projets avec rôles admin/créateur**.
> Aucun fichier modifié hors ce rapport.

---

## 1. Stack exacte

| Brique | Choix | Version | Notes |
|---|---|---|---|
| Framework | **Next.js (App Router)** | `16.2.4` (pin exact) | Quasi tout est en Client Components (`"use client"`) ; aucun Server Action, aucun route handler |
| UI runtime | **React** | `19.2.4` (pin exact) | |
| Base de données | **Convex** | `^1.37.0` | DB temps réel + file storage + fonctions serveur. Deployment dev dans `.env.local` (`CONVEX_DEPLOYMENT`), prod = `fiery-wolf-460` (cf `TECH_DEBT.md` TD-006) |
| Styling | **Tailwind CSS v4** | `^4` via `@tailwindcss/postcss` | Config CSS-first dans `app/globals.css` (`@theme inline`) — **pas de `tailwind.config`** |
| Composants | **shadcn/ui**, style `base-nova` | CLI `shadcn ^4.6.0` | Primitives **`@base-ui/react` `^1.4.1`** (PAS Radix). 22 composants dans `components/ui/` |
| Icônes | lucide-react | `^1.14.0` | |
| Charts | recharts | `^3.8.1` | `MetricChart` (LineChart) |
| Toasts | sonner | `^2.0.7` | `<Toaster richColors position="top-right" />` dans le layout |
| Divers | date-fns, react-day-picker, cmdk, next-themes, cva, tailwind-merge, tw-animate-css | | `next-themes` est **installé mais aucun `ThemeProvider` n'est monté** → app light-only de facto |
| Package manager | pnpm | workspace minimal (`ignoredBuiltDependencies`) | |
| Tests | Playwright `^1.59.1` (≈50 specs e2e) + Vitest `^4.1.5` (helpers purs `lib/**/*.test.ts`) | | CI GitHub Actions `.github/workflows/e2e.yml` (build + e2e contre `secrets.CONVEX_TEST_URL`) |

### Auth existante : **AUCUNE**

- Aucun provider d'auth : `app/ConvexClientProvider.tsx` = `ConvexProvider` nu (pas de `ConvexProviderWithClerk`, pas de Convex Auth).
- Aucun `middleware.ts`, aucune route protégée, aucune table `users`.
- **Toutes** les fonctions Convex publiques (queries ET mutations destructives) sont appelables sans identité par quiconque possède `NEXT_PUBLIC_CONVEX_URL` — qui est, par définition, exposée dans le bundle client.
- C'est assumé et documenté dans `convex/storage.ts:9-11` : *« Pas d'auth dans ce repo (cohérent avec les autres mutations) ; si un jour on ajoute une couche auth, gating à insérer ici »*.
- Seule « protection » : `robots: "noindex, nofollow"` dans `app/layout.tsx`.

### Environnement / deploy

- Variables : `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` (`.env.local`) ; `NEXT_PUBLIC_CONVEX_URL` (`.env.prod.local`).
- ⚠️ Le build Vercel ne pousse PAS le schéma Convex : `convex deploy` est manuel (TD-006, marqué priorité haute). Tout chantier de schéma multi-projets devra d'abord régler ce point pour éviter les mismatchs code/schéma en prod.

---

## 2. Schéma de données actuel (`convex/schema.ts`)

9 tables. Convention du repo : les nouveaux champs sont ajoutés en `v.optional` (rétro-compat sans migration bloquante), l'exigence réelle est imposée dans les handlers, puis backfill par `internalMutation` one-shot — pattern déjà rodé (`mediaType`, `status`, `migrateLegacyCarouselIds`, `migrateMetricsToSnapshots`).

### `publications` — table centrale (≈40 champs)

**Modèle clé : 1 « carrousel » logique = N rows, une par plateforme, partageant le même `carouselId` (string libre `C###` / `S###` / `SR###`).** Pas de table `carousels` dédiée, pas de FK (TD-004).

| Champ | Type | Rôle |
|---|---|---|
| `carouselId` | `string` | ID métier `C###`/`S###`/`SR###`, compteur global par mediaType (`computeNextPublicationId`) |
| `hookId` | `Id<"hooks"> \| null` | Lien vers la biblio hooks |
| `hookText`, `mecanique`, `niveau`, `langue`, `angleTonal` | string / unions | **Snapshot dénormalisé** du hook au moment de la création (TD-002) |
| `mediaType` | `optional("carousel"\|"short"\|"screenrecorder")` | `undefined` = carousel (rows pré-Shorts) ; coercion via `lib/media-type.ts getMediaType()` |
| `format`, `nbSlides`, `slides[{position, texte}]` | optional | Carousel-only (formats A–H) |
| `script` | `optional(string)` | Short + ScreenRecorder |
| `titre`, `image (Id<"_storage">)`, `recordingDevice ("phone"\|"desktop")`, `isRepackaging` | optional | ScreenRecorder-only (requis au create, validé handler) |
| `icpId` | `optional(Id<"icps">)` | Short-only, requis au create |
| `plateforme` | `"TikTok"\|"Instagram"\|"YouTube"` | 1 row = 1 plateforme ; carousel interdit sur YouTube (`isFormatAllowedOnPlatform`) |
| `compte` | `string` | ⚠️ **handle en clair, pas `Id<"comptes">`** (TD-001) — pas de contrainte référentielle |
| `datePubli` | `number` (ms) | |
| `postUrl` | `optional(string)` | non-vide = « publié » (`lib/publication-status.ts isPublished`) |
| `parentCarouselId` | `optional(string)` | Ancre du groupe de variantes — pointe TOUJOURS vers le carouselId ORIGINAL |
| `sourceId` | `optional(string)` | Anti-shadowban Shorts : nom de fichier vidéo source, stocké normalisé (trim + strip `.mp4/.mov/.webm/.avi` + lowercase). Unicité (sourceId, plateforme) imposée côté handlers, pas d'index |
| `accountModified` | `optional(boolean)` | Le compte d'une pub publiée n'est modifiable qu'1 fois (`updatePublishedAccount`) |
| `vuesJ1`, `vuesJ3`, `vuesJ7`, `saves`, `commentsTotal`, `commentsAudit`, `profileVisits`, `likes`, `subsGained` | `number \| null` | **LEGACY** — vues J1/J3/J7 migrées vers `metricSnapshots`, suppression prévue (TD-016). `commentsAudit`/`profileVisits` restent publication-level |
| `vuesLatest`, `likesLatest`, `savesLatest`, `subsGainedLatest`, `commentsLatest`, `latestSnapshotId`, `latestSnapshotAt` | optional | **Dénormalisation « latest known »** maintenue par `recomputeLatestMetrics` à chaque create/update/delete de snapshot |

Indexes : `by_carouselId`, `by_plateforme`, `by_datePubli`, `by_hookId`, `by_parentCarouselId`.

### `metricSnapshots` — historique de mesures (cf §4)

`publicationId (Id)`, `capturedAt (ms)`, `daysSincePublication (number, dénormalisé floor((capturedAt−datePubli)/jour))`, `vues` (requis), `likes` (requis), `saves?`, `subsGained?`, `comments?`, `createdAt`, `source ("manual"|"import"|"migration")`.
Indexes : `by_publication`, `by_publication_and_capturedAt`, `by_capturedAt`.

### `comptes`

`handle (string)`, `plateforme (TikTok|Instagram|YouTube)`, `notes`, `status optional("warmup"|"actif"|"shadowban"|"archived")`, `warmupStartedAt optional(number)` (décompte warmup par plateforme, `lib/compte-status.ts`), `actif optional(boolean)` (LEGACY, sync avec status, suppression TD-017), `personneId optional(Id<"personnes">)` (gestionnaire 1-to-1).
Indexes : `by_plateforme`, `by_actif` (legacy).

### `personnes`

`prenom`, `nom`, `createdAt`, `updatedAt`. Index `by_nom`. Dédup case-insensitive (prenom, nom) côté mutations. **NB : c'est la seule notion de « personne » du repo — aucun lien avec une identité d'auth.**

### `icps` (audiences Shorts)

`nom`, `description?`, `color?` (clé palette `FOLDER_COLORS`, pas un hex), `createdAt`, `updatedAt`. Index `by_nom`.

### `hooks` (biblio)

`text`, `mecanique (Erreur|Volume|Comparaison|Contradiction|Universalité|Question)`, `niveau (Broad-A|Broad-B|Niché)`, `langue (FR|EN)`. Indexes `by_langue`, `by_mecanique`, `by_niveau`.

### `filterPresets`

`name`, `schemaVersion (number)` (v4 actuelle — strip silencieux côté client si version obsolète), `mediaTypeScope ("carousel"|"short"|"screenrecorder")`, `filters {search, plateforme, statut, compte[], mecanique[], format[], verdict[]}`, `sort {key: date|saveRate|vues|likes|comments|subsGained, dir}`. Indexes `by_name`, `by_mediaTypeScope`.

### `inspirations` (pilier Veille)

`url`, `type ("video"|"account")`, `plateforme`, `thumbnail optional(Id<"_storage">)`, `titre?`, `notes?`, `stats? {views?, likes?, followers?, comments?, capturedAt?}`, `folderId optional(Id<"folders">)`, `isFavorite (boolean)`, `tags (string[])`, `createdAt`, `updatedAt`. Indexes `by_folder`, `by_plateforme`, `by_favorite`, `by_createdAt`.

### `folders`

`name`, `description?`, `color?` (clé `FOLDER_COLORS`), `createdAt`, `updatedAt`. Index `by_name`.

### Inventaire des fonctions Convex (toutes **publiques** sauf mention)

| Fichier | Queries | Mutations | Internal |
|---|---|---|---|
| `publications.ts` | `getNextPublicationId`, `getNextCarouselId` (alias legacy), `listPublications`, `getByCarouselId`, `listSources`, `getSourceStatus` | `createPublication`, `updateMetrics`, `updatePublishedAccount`, `deletePublication`, `duplicateCarousel`, `updateDraft`, `renameSourceId` | `migrateLegacyCarouselIds` |
| `metricSnapshots.ts` | `aggregateTimeseries`, `listSnapshotsByPublication` | `createSnapshot`, `updateSnapshot`, `deleteSnapshot`, `cleanupTestSnapshots` | `migrateMetricsToSnapshots` |
| `comptes.ts` | `listComptes` | `createCompte`, `updateCompte`, `deleteCompte` | `migrateComptesStatus` |
| `dashboard.ts` | `dashboardKpis` | — | — |
| `hooks.ts` | `countHooks`, `listHooks`, `listHooksWithUsage`, `getHookVariants` | ⚠️ `seedHooks`, `clearHooks` | — |
| `icps.ts` / `folders.ts` / `personnes.ts` / `inspirations.ts` | `list*`, `getInspirationById` | CRUD + ⚠️ `cleanupTest*` | — |
| `filterPresets.ts` | `listPresets` | `createPreset`, `deletePreset` | — |
| `storage.ts` | `getPreviewUrl` | `generateUploadUrl` | — |

⚠️ = mutations destructives/de seed **publiques** aujourd'hui (utilisées par les e2e via `ConvexHttpClient` non authentifié — `e2e/helpers/cleanup.ts`).

Pattern d'agrégation dominant : `ctx.db.query(...).collect()` **table entière** puis filtre/group-by en mémoire (`listPublications`, `dashboardKpis`, `listSources`, `findExistingSourcePublications`, `listHooksWithUsage`, `aggregateTimeseries`…). Acceptable au volume actuel, documenté TD-003/TD-009.

---

## 3. Routes / pages & construction de la sidebar

### Arborescence `app/`

| Route | Fichier | Contenu |
|---|---|---|
| `/` | — | redirect 308 → `/dashboard` (`next.config.ts`) |
| `/dashboard` | `app/dashboard/page.tsx` | KPIs serveur (`dashboardKpis`) + `SnapshotAgeSelector` + top hooks (carrousels & shorts, `lib/dashboard-stats.ts`) |
| `/comptes` | `app/comptes/page.tsx` | CRUD comptes + sections Personnes & ICPs (`?view=icps`) |
| `/comptes/[compteId]` | `app/comptes/[compteId]/page.tsx` | Fiche compte (`CompteDetailView` : header, stats, calendrier, listes par format) |
| `/carrousels` | `app/carrousels/page.tsx` | Wrapper mince → `TrackerListSection mediaType="carousel"` |
| `/shorts` | `app/shorts/page.tsx` | Idem `mediaType="short"` + lien « Bibliothèque sources » |
| `/shorts/sources` | `app/shorts/sources/page.tsx` | Matrice anti-shadowban sourceId × plateformes (`listSources`) |
| `/screenrecorder` | `app/screenrecorder/page.tsx` | Idem `mediaType="screenrecorder"` (colonnes image + titre) |
| `/biblio-hooks` | `app/biblio-hooks/page.tsx` | Biblio hooks + usage + variantes |
| `/inspirations` | `app/inspirations/page.tsx` | Veille : grid/list, dossiers, tags, favoris, filtres deeplinkables |
| `/p/[carouselId]` | `app/p/[carouselId]/page.tsx` | Resolver deeplink : résout le mediaType via Convex → redirige `/carrousels?carouselId=X` ou `/shorts?carouselId=X` (client component + `useQuery`, choix documenté : éviter le data-fetching serveur) |
| `/nouveau` | `app/nouveau/page.tsx` | **Page legacy (865 lignes) encore sur disque** mais inaccessible : redirect 308 → `/dashboard?nouveau=open&format=carousel`. La création passe par `NouveauModal` (5 steps : Format → Hook → Contenu → Publication → Récap) piloté par l'URL `?nouveau=open&format=…&hookId=…&sourceId=…` |
| `/not-found` | `app/not-found.tsx` | 404 |

Redirects legacy (`next.config.ts`) : `/hooks(/*)` → `/biblio-hooks(/*)`, `/tracker?carouselId=X` → `/p/X` (307), `/tracker` → `/carrousels`.

### Hiérarchie de providers (`app/layout.tsx`)

```
<html lang="fr"> (fonts Inter + Geist Mono, body bg-slate-50)
└─ ConvexClientProvider (ConvexProvider nu, sans auth)
   └─ SnapshotAgeProvider (période J+X globale, localStorage)
      └─ TooltipProvider
         └─ SidebarLayout
            └─ <div class="container mx-auto px-6 py-8">{children}</div>
         + Toaster (sonner)
```

### Sidebar — `components/layout/`

- **`SidebarLayout.tsx`** : flex root. Desktop ≥ lg : sidebar fixe (240px / 64px collapsed, persisté `localStorage["sidebar-collapsed"]`). Mobile < lg : header sticky + hamburger ouvrant un `Sheet` (drawer gauche) contenant la même `Sidebar`. Monte aussi globalement `NouveauModalController` (lit `?nouveau=open`).
- **`Sidebar.tsx`** : items **hardcodés dans le composant** en 3 tableaux constants, rendus par `SidebarSection` :
  - **Général** : Dashboard (`LayoutDashboardIcon`), Comptes (`Users2Icon`)
  - **Contenu** : Carrousels (`GalleryHorizontalIcon`), Shorts (`PlaySquareIcon`), ScreenRecorder (`MonitorIcon`), Biblio Hooks (`BookOpenIcon`)
  - **Veille** : Inspirations (`BookmarkIcon`)
  - État actif = `pathname.startsWith(href)`. Header marque « R / RepackIt Distribution ». Footer toggle collapse.
  - Aucune notion de projet, d'utilisateur ni de rôle nulle part — il n'y a ni sélecteur de contexte ni avatar/menu user.
- **`SidebarItem.tsx`** : `Link` + icône + label (+ prop `badge` prête mais non câblée) ; tooltip en mode collapsed.
- **`NewButton.tsx`** : bouton « + Nouveau » → ajoute `?nouveau=open` à l'URL courante (flux générique sans format pré-sélectionné).

---

## 4. Vues J+1 → J+90 : stockage et affichage (structure exacte)

### Stockage : table `metricSnapshots`, PAS de colonnes J+X

Il n'y a **plus** de champ par fenêtre (les `vuesJ1/J3/J7` de `publications` sont legacy, migrés et voués à suppression — TD-016). Le modèle actuel :

1 relève de métriques = 1 row `metricSnapshots` :

```ts
{
  publicationId: Id<"publications">,
  capturedAt: number,              // ms epoch de la relève
  daysSincePublication: number,    // DÉNORMALISÉ : floor((capturedAt - datePubli) / 86 400 000)
  vues: number,                    // requis
  likes: number,                   // requis
  saves?: number,                  // carousel
  subsGained?: number,             // short / SR
  comments?: number,
  createdAt: number,
  source: "manual" | "import" | "migration",
}
```

Les fenêtres J+1→J+90 sont donc **résolues à la lecture** par matching, pas stockées.

### Matching par période (`lib/snapshot-matching.ts`, dupliqué dans `convex/snapshotMatching.ts`)

```ts
type SnapshotAge = "j1"|"j3"|"j7"|"j14"|"j30"|"j60"|"j90"|"latest"|"custom";

TARGET_DAYS    = { j1: 1, j3: 3, j7: 7, j14: 14, j30: 30, j60: 60, j90: 90 };
TOLERANCE_DAYS = { j1: 0, j3: 1, j7: 2, j14: 3,  j30: 5,  j60: 7,  j90: 10 };  // tolérance proportionnelle
// custom : target = customDay, tolérance = max(2, customDay * 0.1)
// latest : snapshot au capturedAt max
```

`findMatchingSnapshot()` : retient le snapshot avec `|daysSincePublication − target| ≤ tolérance` le plus proche du target (tie-break : `capturedAt` le plus récent), sinon `null`.

`buildDisplayMetrics()` (`convex/metricsDisplay.ts`) produit l'objet consommé par toute l'UI :

```ts
type DisplayMetrics = {
  vues, likes, saves, subsGained, comments: number | null,
  snapshotUsed: { id, capturedAt, daysSincePublication } | null,
  matchExact: boolean,   // false si la tolérance a joué → badge "≈" côté UI
}
```

### Sélection globale de la période

- `SnapshotAgeProvider` (`components/snapshot-age-selector/SnapshotAgeContext.tsx`) : état global `{age, customDay}`, défaut `latest`, persisté `localStorage["tracker.snapshot-age"]`, monté au root layout.
- `SnapshotAgeSelector.tsx` : radiogroup `J+1 J+3 J+7 J+14 J+30 J+60 J+90 Latest Custom` (+ input numérique si custom). Affiché sur le Dashboard et dans `TrackerListSection` (donc /carrousels, /shorts, /screenrecorder) ; utilisé aussi par biblio-hooks, fiche compte, dialog détail.
- `snapshotQueryArgs()` sérialise `{snapshotAge, customDay?}` vers les queries.

### Résolution côté serveur (le client ne matche jamais lui-même)

- `listPublications({snapshotAge, customDay})` : charge toutes les pubs + **tous** les snapshots, groupe en mémoire (`groupSnapshotsByPublication`), attache `displayMetrics` à chaque row (+ `imageUrl`, + `icp`).
- `dashboardKpis({snapshotAge, customDay})` : mêmes `displayMetrics` par pub publiée → totaux vues/likes/saves/subs/comments, save rate moyen carrousels, winners (save rate ≥ 3 %), engagement rate.
- `getByCarouselId` : displayMetrics pour le resolver/deeplink.
- Dénormalisation rapide : champs `*Latest` sur `publications`, réécrits systématiquement par `recomputeLatestMetrics()` après chaque mutation de snapshot.

### Affichage

- **Tracker** (`TrackerListSection`, colonne Vues/Likes/Saves…) : valeur de `displayMetrics`, tooltip `title` = « Snapshot J+X capturé le … (proche) », suffixe **`≈`** si `matchExact === false`, cellule vide si aucun snapshot dans la tolérance.
- **Verdict suit la période** (décision C1) : `computeVerdict(displayMetrics)` → save rate = saves/vues ; `WINNER ≥ 3 %`, `MOYEN ≥ 1 %`, `FOLD < 1 %`, `null` = en attente (`lib/verdict.ts`, `VerdictBadge`).
- **Dialog détail publication** (`PublicationDetailDialog`) : bloc métriques résolues + mention « Snapshot J+X » + **liste read-only des snapshots** (`listSnapshotsByPublication`, tri capturedAt desc) + graphe Évolution dès 2 snapshots.
- **CRUD snapshots** : `PublicationEditDialog` (« Modifier les stats ») → `createSnapshot` (garde : `capturedAt ≥ datePubli`, `daysSincePublication` recalculé serveur), `updateSnapshot`, `deleteSnapshot`.
- **Graphe Évolution** (`components/analytics/MetricChart.tsx`, recharts) : 2 modes — `aggregate` (somme par bucket jour/semaine ISO via `aggregateTimeseries`, axe X = `capturedAt`) et `single_publication` (timeseries des snapshots d'une pub, `lib/analytics-stats.ts`). `ChartPeriodToggle` = fenêtre glissante de l'axe X (à ne pas confondre avec la période J+X).

---

## 5. Système de design actuel

### Tokens (Tailwind v4 CSS-first — `app/globals.css`, pas de tailwind.config)

- `@import "tailwindcss"; @import "tw-animate-css"; @import "shadcn/tailwind.css";`
- `@custom-variant dark (&:is(.dark *));` — variant dark défini **mais jamais activé** (pas de ThemeProvider, pas de classe `.dark` posée).
- `@theme inline` mappe les tokens shadcn : `--color-background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring`, `--color-chart-1..5`, `--color-sidebar*`, rayons `--radius-sm..4xl` dérivés de `--radius: 0.625rem`, fonts `--font-sans`/`--font-heading` (Inter) et `--font-mono` (Geist Mono).
- Valeurs `:root` (clair) : **palette 100 % neutre en oklch** — `--background: oklch(1 0 0)` (blanc), `--foreground: oklch(0.145 0 0)` (quasi-noir), `--primary: oklch(0.205 0 0)` (noir), `--destructive` rouge oklch. Bloc `.dark` complet présent (inutilisé).
- `components.json` : style **`base-nova`**, `baseColor: "neutral"`, cssVariables, icônes lucide, alias `@/components`, `@/lib`…

### Couleurs réellement utilisées (classes utilitaires hardcodées)

La réalité du code contourne largement les tokens : **612 occurrences de `slate-*`** en classes directes (`bg-white`, `border-slate-200`, `text-slate-900`, body `bg-slate-50`…), y compris dans la Sidebar qui n'utilise pas les variables `--sidebar-*` pourtant définies.

Accents sémantiques :

| Couleur | Usage |
|---|---|
| `emerald` (51×) | WINNER, publié, badge « Repack » |
| `amber` (62×) | warnings (« ⚠ sans source », MOYEN, warmup) |
| `rose` (51×) | FOLD, actions destructives, en retard |
| `violet`/`sky`/`indigo`/`pink` | palette dossiers/ICP |

- **`lib/folder-colors.ts`** : palette nommée `FOLDER_COLORS` (8 clés : slate, rose, amber, emerald, sky, violet, pink, indigo) — la DB stocke la **clé**, jamais le hex ; chaque entrée expose `badgeClass` + `dotClass`. Réutilisée par folders ET icps.
- **`lib/format-config.ts`** : `METRIC_COLORS` pour recharts (hex en dur : views `#3b82f6` blue-500, likes `#ef4444` red-500, saves `#10b981` emerald-500, subs `#6366f1` indigo-500, comments `#64748b` slate-500) + `FORMAT_CONFIGS` (labels/plateformes par mediaType).
- Typo : titres `text-3xl font-semibold tracking-tight text-slate-900` ; IDs/handles en `font-mono text-xs` ; layout contenu `container mx-auto px-6 py-8` ; cards blanches sur fond `slate-50`.

**Implication pour la refonte** : le theming par variables existe mais n'est pas la pratique du code — un changement de marque/palette par projet impliquerait soit une grosse passe de remplacement `slate-* → tokens`, soit l'acceptation du slate hardcodé comme neutre commun.

---

## 6. Composants existants liés aux vidéos / uploads

### Upload (images uniquement — **aucun upload vidéo**)

- **`components/ImageUploader.tsx`** (seul composant d'upload du repo) : drag & drop + file picker, types `image/jpeg|png|webp`, max **5 MB**, états uploading/preview/remplacer/supprimer.
  Flow Convex documenté : `storage.generateUploadUrl()` (mutation) → `POST` direct du blob sur l'URL signée → `storageId` → passé à `createPublication`/`updateDraft`. Preview via `storage.getPreviewUrl` ; en liste, l'URL publique est résolue **côté serveur** (`listPublications` → `imageUrl`), le client ne manipule jamais le storageId pour l'affichage.
- **`convex/storage.ts`** : `generateUploadUrl` (⚠️ mutation publique, upload anonyme possible — le commentaire du fichier prévoit explicitement d'insérer le gating auth ici) + `getPreviewUrl`.
- Consommateurs du storage : `publications.image` (ScreenRecorder, requis au create) et `inspirations.thumbnail`. Pas de cascade de suppression des blobs (`deletePublication` n'efface pas l'image ; blob partagé entre duplicats — TD-011).

### Composants « vidéo » (les vidéos sont référencées, jamais hébergées)

| Concept | Implémentation |
|---|---|
| Identité du fichier vidéo source (anti-shadowban Shorts) | `sourceId` normalisé (`lib/source-id.ts`, strip `.mp4/.mov/.webm/.avi` — `VIDEO_EXTENSIONS`, dupliqué dans `convex/publications.ts`) ; `SourceIdCombobox`, `SourceStatusBadge`, page `/shorts/sources` (`ShortSourcesTable`, `RenameSourceDialog`) ; unicité (sourceId × plateforme) : TikTok bloquant strict, IG/YT override confirmable |
| Contenu vidéo | `publications.script` (texte continu Short/SR), steps du `NouveauModal` (`StepContenu`) |
| ScreenRecorder | `recordingDevice` (badge Téléphone/Ordinateur), `isRepackaging`, `titre`, `image` (thumbnail via ImageUploader), colonnes dédiées du tracker |
| Lien public du post | `postUrl` (TikTok/IG/YouTube) saisi dans `PublicationEditDialog` |
| Veille | `inspirations.type === "video"`, autodétection plateforme/type par URL (`lib/inspiration-url.ts`), `InspirationCard`/`InspirationDialog` + thumbnail uploadée |

---

## 7. Risques identifiés pour la transformation multi-projets + rôles

### 7.A — Ajout d'un champ `projectId` partout

| # | Risque | Détail / fichiers | Sévérité |
|---|---|---|---|
| A1 | **Queries full-scan non scopées** | Le pattern dominant est `collect()` table entière + agrégat mémoire (`listPublications`, `dashboardKpis`, `listSources`, `listHooksWithUsage`, `aggregateTimeseries`, `findExistingSourcePublications`, `getNextPublicationId`…). Ajouter `projectId` sans réécrire CHAQUE query + index `by_project_*` = fuite de données inter-projets garantie et perfs dégradées (le volume devient N projets × données) | 🔴 |
| A2 | **Compteur d'IDs métier global** | `computeNextPublicationId` calcule `C###/S###/SR###` sur TOUTES les publications. Décision à prendre : numérotation par projet (alors `carouselId` n'est plus unique globalement → tous les lookups `by_carouselId` — `getByCarouselId`, `updateDraft`, `duplicateCarousel`, deeplink `/p/[carouselId]` — doivent devenir `(projectId, carouselId)`) ou numérotation globale (IDs à trous par projet). La race condition existante TD-004 sera amplifiée par le multi-utilisateurs | 🔴 |
| A3 | **Relations par string, pas par FK** | `publications.compte` = handle string (TD-001) : deux projets avec le même handle = collision silencieuse. `deleteCompte` cascade par string-match. `parentCarouselId` = string carouselId. `sourceId` : l'unicité anti-shadowban (sourceId × plateforme) deviendrait inter-projets (faux positifs bloquants) si non scopée | 🔴 |
| A4 | **Rows existantes : schéma Convex strict** | Convex refuse un push de schéma invalide pour les données en place → `projectId` devra être `v.optional` + backfill `internalMutation` one-shot (« projet par défaut ») + resserrage ensuite. Pattern déjà rodé dans le repo (mediaType, status, migrateLegacyCarouselIds) — à répliquer sur **9 tables**. Attention au déploiement manuel Convex (TD-006) : régler le deploy atomique Vercel+Convex AVANT cette migration | 🟠 |
| A5 | **Quelles tables sont par-projet ?** | Évident pour `publications`/`metricSnapshots`/`comptes`/`filterPresets`. À trancher pour `hooks` (biblio partagée inter-projets ?), `icps`, `inspirations`/`folders` (veille commune ?), `personnes` (équipe transverse ?). Une mauvaise décision ici = re-migration douloureuse | 🟠 |
| A6 | **Cross-tsconfig : logique dupliquée lib/ ↔ convex/** | `snapshotMatching`, `isFormatAllowedOnPlatform`, `normalizeSourceId`, `formatDateFr`, `bucketKey` existent en double (convex/ ne peut pas importer lib/). Tout scoping projet qui touche ces logiques doit être répliqué dans les deux fichiers — risque de drift documenté mais réel | 🟠 |
| A7 | **UI monolithique et état global non scopé** | `TrackerListSection` = 1907 lignes partagées par 3 pages ; `SnapshotAgeContext` et `sidebar-collapsed` en localStorage **globaux** (pas par projet) ; presets, combobox comptes/hooks/ICP, `NouveauModal` (5 steps), dashboard : tout doit recevoir le projet actif. Prévoir un `ProjectContext`/segment d'URL (`/p/[projectId]/…` vs query param) — décision structurante pour le routing | 🟠 |
| A8 | **Tests & scripts mono-projet** | ~50 specs Playwright + `e2e/helpers/cleanup.ts` (marqueur `[E2E_TEST]`), `scripts/seed*`/`wipe-publications.ts`, CI e2e : tous supposent une base unique sans scope. Chaque garde projectId cassera des specs | 🟡 |
| A9 | **Champs legacy en attente** | `vuesJ1/J3/J7`, `comptes.actif` (TD-016/017) : faire le ménage avant ou pendant la migration multi-projets pour ne pas backfiller des champs morts | 🟡 |

### 7.B — Ajout d'une auth avec rôles (admin / créateur)

| # | Risque | Détail | Sévérité |
|---|---|---|---|
| B1 | **Sécurité actuelle = zéro, et l'URL Convex est publique** | Toutes les fonctions sont publiques, y compris `deletePublication`, `deleteCompte`, `clearHooks`, `seedHooks`, `cleanupTest*`, `generateUploadUrl`. `NEXT_PUBLIC_CONVEX_URL` est dans le bundle JS servi par `repackit-distribution-tracker.vercel.app` → n'importe qui peut aujourd'hui lire/écrire/vider la base prod sans passer par l'UI. L'ajout d'auth n'est pas une feature : c'est une **remédiation**. Protéger les pages Next ne suffira pas — il faut gater les fonctions Convex elles-mêmes | 🔴 |
| B2 | **~45 fonctions publiques à gater une par une** | Convex n'a pas de middleware global : chaque `query`/`mutation` doit appeler `ctx.auth.getUserIdentity()` + vérif rôle/projet. Recommandé : wrappers `customQuery`/`customMutation` (convex-helpers) pour ne pas dupliquer la garde 45 fois. Reclasser en `internalMutation` (ou gater admin) : `seedHooks`, `clearHooks`, tous les `cleanupTest*` | 🔴 |
| B3 | **Pas de modèle user/membership** | Aucune table `users`. Il faudra : `users` (mappée sur l'identité du provider), `projects`, `memberships {userId, projectId, role: "admin"\|"creator"}` + enforcement **server-side** par fonction (l'UI seule ne protège rien). La table `personnes` existante (gestionnaires de comptes) n'est PAS une base d'identité — décider si on la fusionne ou si elle reste un annuaire métier | 🔴 |
| B4 | **Intégration provider** | `ConvexClientProvider` à remplacer (`ConvexProviderWithClerk` / `ConvexProviderWithAuth` + Convex Auth…) ; ajout `auth.config.ts` côté Convex ; middleware Next pour les redirections login. Tout le data-fetching étant client-side (`useQuery`), les états « loading auth » devront être gérés pour éviter le flash de données / les queries lancées sans token (`Authenticated`/`Unauthenticated` de convex/react) | 🟠 |
| B5 | **E2E cassés par l'auth** | `e2e/helpers/cleanup.ts` et les specs utilisent `ConvexHttpClient` **anonyme** + l'UI sans login. Avec l'auth : prévoir user de test / bypass sur deployment de test / storageState Playwright. CI (`CONVEX_TEST_URL`) à adapter. C'est probablement le plus gros coût caché du chantier auth | 🟠 |
| B6 | **Sémantique des rôles à définir côté données** | « Créateur » voit quoi ? (ses comptes ? les métriques agrégées du projet ? la biblio hooks complète ?) Chaque query scopée par rôle = logique supplémentaire dans des agrégats déjà full-scan (cf A1). Risque de mélanger scoping projet et scoping rôle dans la même passe — les traiter comme deux couches distinctes | 🟠 |
| B7 | **Uploads anonymes** | `generateUploadUrl` doit exiger une session (point d'insertion déjà commenté dans `convex/storage.ts`) ; sinon n'importe qui peut remplir le storage | 🟠 |
| B8 | **Pages « publiques » résiduelles** | `/p/[carouselId]` (deeplink) et les redirects legacy devront passer derrière le mur d'auth sans casser les vieux liens partagés en interne | 🟡 |

### Recommandation d'ordre (vu les dépendances)

1. **TD-006 d'abord** (deploy Convex atomique sur Vercel) — préalable à toute migration de schéma sereine.
2. **Auth + tables `users`/`projects`/`memberships`** avec un seul projet par défaut (remédiation B1 incluse : gating de toutes les fonctions, reclassement des mutations de seed/cleanup).
3. **`projectId` optional + backfill + resserrage** sur les tables tranchées en A5, avec indexes `by_project*` et réécriture des queries full-scan.
4. **UI multi-projets** (sélecteur de projet, scoping du contexte/localStorage, sidebar par rôle).
5. Adapter e2e/scripts au fur et à mesure (chaque étape casse une tranche de specs).

---

## Annexe — chiffres clés

- 14 fichiers Convex (12 modules + schéma + `_generated`), **45 fonctions publiques + 3 internal**.
- 11 routes utilisateur (+ 1 page legacy non routée), sidebar 7 entrées hardcodées en 3 sections.
- ~8 500 lignes de TSX dans les pages/composants principaux ; plus gros fichiers : `TrackerListSection.tsx` (1 907), `PublicationDetailDialog.tsx` (1 196), `app/nouveau/page.tsx` (865, legacy).
- ~50 specs Playwright, 4 suites Vitest (`lib/*.test.ts`).
- Tech debt suivie dans `TECH_DEBT.md` (TD-001 → TD-017 référencés dans le code).
