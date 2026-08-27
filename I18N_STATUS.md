# I18N_STATUS — parcours créateur en anglais US

**Chantier TERMINÉ.** Branche `feat/i18n-2b-ecrans-createur`,
[PR #94](https://github.com/anthosimo33-coder/repackit-distribution-tracker/pull/94).
`tsc`, `pnpm build`, 2 064 tests unitaires et `node scripts/check-i18n.mjs`
verts après chaque lot.

> **L'objectif n'était pas de traduire l'app** : c'était qu'un **créateur US
> voie 100 % d'anglais US sur son parcours**. L'admin et l'analytics hub
> **restent en français**, volontairement (lot `A7`, hors scope).
>
> Le périmètre est la **clôture d'imports** des routes créateur, calculée et
> régénérable (§3). Le critère de fin est un **parcours coché** (§10), pas un
> pourcentage.

| | avant | après |
|---|---:|---:|
| Fichiers du périmètre extraits | 30/56 (liste dérivée) | **146/146** |
| Chaînes françaises dans le périmètre | ~325 | **0** |
| Complétion du catalogue anglais | 33 % | **100 %** — 0 hors liste blanche (744 clés) |
| Rejets Convex du parcours en français | 80 | **0** |
| E-mails créateur en anglais | 1/7 | **7/7** |

**Les sections 1 à 9 sont l'audit initial**, conservé tel quel : il documente
l'état de départ et les décisions qui ont cadré le chantier. Les chiffres qu'il
contient sont ceux du 2026-08-25 **avant** exécution. L'état final est en §10.

---

## 1. Stack i18n

| Point | Valeur | Source |
|---|---|---|
| Librairie | **next-intl 4.13.7** sur Next 16.2.4 | `package.json` |
| Init | `createNextIntlPlugin("./i18n/request.ts")` | `next.config.ts` |
| Provider | `NextIntlClientProvider` + `getLocale`/`getMessages` | `app/layout.tsx:3-4,50-51` |
| Routage | **aucun préfixe de locale** — pas de `/fr`, pas de `/en` | décision, `ARBITRAGES-I18N.md` §1 |
| Locales | `fr`, `en` | `convex/locales.ts` (source unique), réexporté par `i18n/locales.ts` |
| Défaut | **`fr`** — le français reste la langue du produit, l'anglais est *ajouté* | `DEFAULT_LOCALE` |
| Fuseau | **épinglé `Europe/Paris`** dans la config next-intl | `i18n/request.ts` |
| Typage des clés | `global.d.ts` dérive `Messages` de `messages/fr.json` — une faute dans `t()` est une **erreur TypeScript** | `global.d.ts` |

**Pourquoi pas de préfixe d'URL** : le segment dynamique racine est déjà pris par
`app/[projectSlug]` (login brandé). Un `app/[locale]` casserait les 13 redirects
de `next.config.ts` pour zéro bénéfice sur une app entièrement authentifiée
(`robots: noindex, nofollow`).

### Résolution de la locale — 5 maillons, côté serveur, avant le premier rendu

`i18n/request.ts:resolveLocale()`, du plus autoritaire au plus large :

1. `users.locale` — préférence explicite du compte
2. `creators.locale` — langue posée par l'admin sur la fiche
3. cookie `NEXT_LOCALE` (1 an) — survit **avant** toute session
4. header `Accept-Language` (avec facteurs `q=`)
5. `"fr"`

Maillons 1-2 = **une seule** query Convex (`convex/i18n.ts:getMyLocale`, via
l'index `by_user` — le scan de table signalé dans `CARTOGRAPHIE-CREATEUR.md` §5 a
été corrigé). L'appel est encapsulé dans un `try/catch` : toute panne retombe sur
le cookie. Sélecteur UI : `components/layout/LanguageSelector.tsx`, cookie posé
par `i18n/locale-cookie.ts`.

**La plomberie est complète et vérifiée bout en bout.** Les trois trous listés
dans `CARTOGRAPHIE-CREATEUR.md` §4 sont **bouchés** : `inviteCreator` prend
l'argument `locale` (`convex/creators.ts:186`), `updateCreator` aussi (`:350`),
`InviteCreatorDialog` a son `<Select>` « Langue * » (`:160-177`), et
`getInvitationPreview` expose la locale (`:743`).

---

## 2. État des catalogues — chiffré

`messages/fr.json` (17 704 o) et `messages/en.json` (17 364 o), plats après
aplatissement : **252 clés chacun**.

| Contrôle | Résultat |
|---|---|
| Clés FR absentes de EN | **0** |
| Clés EN absentes de FR | **0** |
| Valeurs EN vides | **0** |
| Valeurs EN en TODO/FIXME | **0** |
| Valeurs EN **identiques au FR** | **205 / 252 (81,3 %)** |

Sur ces 205 identiques, **28** le sont légitimement (marques et jargon déjà
anglais : `Dashboard`, `Analytics`, `Assets`, `Radar`, `Rushes`, `Assignments`,
`Pricings`, `CPM`, `Promo`, `Scale`, `Saves`, `Save rate`, `Distribution`,
`PayPal`, `Email`, `Total`, `Base`, `Bonus`…). Les **177 autres sont du français
servi à un utilisateur anglophone**.

### Complétion EN réelle : **29,8 %**

| | clés | % |
|---|---:|---:|
| Réellement traduites (valeur EN ≠ FR) | 47 | 18,7 % |
| Identiques mais correctes | 28 | 11,1 % |
| **Encore en français dans `en.json`** | **177** | **70,2 %** |

### Par namespace

| Namespace | clés | traduites | légitimes | **françaises** | complétion |
|---|---:|---:|---:|---:|---:|
| `portal` | 135 | 0 | 8 | **127** | **6 %** |
| `tracker` | 54 | 47 | 7 | 0 | **100 %** |
| `auth` | 31 | 0 | 1 | **30** | **3 %** |
| `nav` | 26 | 0 | 11 | **15** | 42 % |
| `settings` | 4 | 0 | 0 | **4** | **0 %** |
| `layout` | 2 | 0 | 1 | **1** | 50 % |

**Un seul namespace est traduit** : `tracker.quadrant`, et il ne vient **pas** du
chantier i18n — il est arrivé par les PRs produit #84/#86/#87, où les libellés ont
été écrits bilingues dès l'origine. Le chantier i18n, lui, n'a traduit **aucune
clé** : c'est conforme à sa doctrine.

`settings.language.*` est à **0 %** — mais le vrai problème est ailleurs :
**le sélecteur de langue n'est pas atteignable par un créateur** (§3.3). Ces
4 clés ne servent aujourd'hui qu'à l'admin.

⚠️ **Ce tableau compte le dépôt entier.** Une fois ramené au périmètre créateur
(§3.3), ce n'est plus 177 clés à traduire mais **~163** — et le seul namespace
déjà traduit à 100 %, `tracker.quadrant`, en sort intégralement.

---

## 3. Périmètre créateur — définition et volumétrie

**Objectif du chantier (corrigé le 2026-08-25)** : un créateur US voit **100 %
d'anglais US sur son parcours**. Traduire l'app entière n'est pas l'objectif.
**L'admin et l'analytics hub restent en français.**

### 3.1 Définition — calculée, pas estimée

Le périmètre est la **clôture d'imports** des routes qu'une session authentifiée
en rôle créateur peut atteindre, plus les e-mails qu'elle reçoit, les fonctions
Convex qu'elle appelle et les valeurs de base qu'elle lit. Calcul mécanique
depuis 24 entrées de route → **146 fichiers** (140 au moment de l'audit ; six modules créés par le chantier ont rejoint la clôture depuis).

« Créateur » désigne ici les **trois rôles de portail** — partenaire (`/app`),
talent (`/talent`), clippeur (`/clip`) — plus les écrans **pré-session**.

#### Routes — 24 entrées

| Population | Routes |
|---|---|
| **Pré-session (5)** | `/login`, `/:slug/login`, `/join/:token`, `/reset-password/:token`, `/` |
| **Partenaire (10)** | `/app`, `/app/comptes`, `/app/paiements`, `/app/profil`, `/app/guide`, `/app/progression`, `/app/assignments/:id`, `/app/videos`, `/app/fichiers`, `/app/outils` |
| **Clippeur (2)** | `/clip`, `/clip/clips/:id` |
| **Talent (1)** | `/talent` |
| **Layouts / racine (6)** | `app/layout.tsx`, `app/not-found.tsx`, `app/ConvexClientProvider.tsx`, + les layouts `/app`, `/clip`, `/talent` |

#### Fichiers atteints — 140

| Dossier | fichiers |
|---|---:|
| `components/` | 70 |
| `lib/` | 35 |
| `app/` | 24 |
| `convex/` (modules purs importés côté client) | 9 |
| `i18n/` | 2 |

#### Composants partagés admin ↔ créateur — **INCLUS**

Les extraire est neutre pour l'admin, qui continue de lire `fr.json`. Principaux :
`WarmupGuideAccordion` (91 chaînes, rendu aussi sur `/admin/:slug/comptes`),
`CreatorLeaderboard`, `VideoExample`, `FormatBriefPreview`, `VerdictBadge`,
`calendar-status-meta`, `StreamPlayer`, `ModelVideoEmbed`, `CopyButton`,
`BrandMark`, et `components/ui/*`.

> ⚠️ **Piège de cadrage.** `components/admin/leaderboard/CreatorLeaderboard.tsx`
> vit sous `components/admin/` et il est **atteignable par un créateur**. Une
> règle de périmètre par **préfixe de chemin** l'exclurait à tort. Le périmètre
> doit être une **liste de fichiers issue de la clôture**, jamais un motif de
> chemin.

#### Fonctions Convex — 71, sur 17 modules

`assignments` (16), `comptes` (14), `creators` (6), `payments` (4),
`creatorVideos` (4), `rushes` (4), `projects` (3), `progression` (3),
`snytchDrive` (3), `passwordReset` (2), `pricing` (2), `guide` (2),
`guideModules` (2), `clipQuota` (2), `formats` (2), `modelVideoEmbeds` (1),
`storage` (1).

#### E-mails — 7, tous dans le périmètre

Les 7 e-mails transactionnels partent **tous** vers un créateur. Aucun n'est
admin-only.

#### Valeurs de base lues par un créateur — 4 seulement

| Valeur | Où | Traitement |
|---|---|---|
| `payments.lineItems[].label` | `PaiementsScreen.tsx:265` | **phrases FR figées en base** — cf. §6 lot A9, c'est le point dur |
| `lib/verdict.ts` → `MOYEN` | `VerdictBadge` | mapping valeur → clé |
| `PHASE_LABELS` | écran clippeur | mapping valeur → clé |
| `plateforme` (`TikTok`/`Instagram`/`YouTube`) | `DeclareCompteDialog` | **marques — exemptées**, le texte EST la valeur d'enum envoyée au serveur |

**Sortent du périmètre** : `angleTonal`, `mecanique`, `niveau`, `interval`
(protocole Whop), `filterPresets.statut` — **tous admin-only**, vérifié sur la
clôture.

#### Explicitement EXCLU

Tout ce qui n'est atteignable qu'en rôle admin : `app/admin/**`,
`components/analytics/**`, `components/tracker/**`, `components/admin/**` (sauf
`CreatorLeaderboard`), `components/comptes/**`, `components/creators/**` (sauf
`creators/portal/**`), `components/inspirations/**`, `components/nouveau/**`,
`components/rushes/**`, `components/icps/**`, `components/shorts/**`,
`components/guides/**`, `components/project/**` (sauf `ProjectProvider`),
`components/whop/**`, `components/formats/**` (sauf les deux ci-dessus).
Plus les seeds et Telegram, déjà hors périmètre par décision.

### 3.2 Volumétrie — le chantier réel

Détecteur **strict** du dépôt, restreint à la clôture.

| | fichiers | chaînes |
|---|---:|---:|
| **Périmètre créateur — RESTANT** | **46** | **279** |
| `components/` | 31 | 205 |
| `lib/` | 8 | 44 |
| `convex/` | 6 | 25 |
| `app/` | 2 | 4 |
| `i18n/` | 1 | 1 |
| **Hors périmètre (admin)** — `app/` + `components/` | 138 | 1 807 |
| **Hors périmètre (admin)** — `lib/` + `convex/` | 82 | 781 |

> **Marge de sous-comptage : +~45.** Le détecteur strict rate les **tables de
> libellés** (un mot minuscule sans accent ne déclenche pas `isProse`).
> Recomptés à la main : `convex/accountPhase.ts` **27 chaînes réelles, pas 6**
> (`JOURS_FR` 7 + `MOIS_FR` 12 + ordinal « 1er » + `PHASE_LABELS` 4 + 3
> gabarits) ; `calendarStatus` 15 au lieu de 4 ; `roles` 7 au lieu de 2 ;
> `compte-status` 9 au lieu de 5.
>
> **Chiffre de travail retenu : ~325 chaînes sur 46 fichiers.**

**Le chantier passe de ~2 900 à ~325 chaînes — une division par 9.**
Les ~2 588 chaînes restantes sont admin et **le restent** (lot A7, §6).

### 3.3 Ce que les catalogues deviennent sur ce périmètre

Sur les **177 clés françaises** de `en.json`, toutes ne sont pas côté créateur :

| Namespace | clés FR | dans le périmètre ? |
|---|---:|---|
| `portal.*` | 127 | **oui**, intégralement |
| `auth.*` | 30 | **oui** (pré-session) |
| `settings.*` | 4 | **oui** — mais voir le trou ci-dessous |
| `layout.*` | 1 | **oui** (titre d'onglet) |
| `nav.action.logout` | 1 | **oui** — seule clé `nav` lue par le portail (`app/app/layout.tsx:118`) |
| `nav.*` (reste) | 14 | **non** — sidebar admin |

**B1 se réduit donc à ~163 clés**, pas 177.

Deux constats qui tombent de ce découpage :

1. **Le seul namespace intégralement traduit est hors périmètre.**
   `tracker.quadrant.*` (54 clés, 100 % EN) n'est rendu que par
   `components/tracker/QuadrantChart.tsx`, **admin-only**. L'effort de traduction
   déjà fourni ne sert pas le créateur.

2. **🔴 Un créateur ne peut pas changer sa propre langue.**
   `LanguageSelector` n'est monté qu'à un seul endroit,
   `components/layout/Sidebar.tsx:278` — **la sidebar admin**. La mutation
   `api.i18n.setMyLocale` fonctionne pourtant pour tout compte authentifié.
   Conséquence : la langue d'un créateur est celle que l'admin a posée à
   l'invitation, et lui seul peut la corriger. Nouveau lot **A10**.

## 4. Zones oubliées — les onze, vérifiées une par une

> **Lecture après recadrage (§3).** Ce tableau a été établi sur le **dépôt
> entier**. Les volumes cités restent exacts, mais seule la **part périmètre
> créateur** est au programme. Report par zone : e-mails **7/7 dans le
> périmètre** ; erreurs Convex **80 sites sur 352** ; `"fr-FR"` **11 sur 57** ;
> pluriels **12 sur 141** ; valeurs de base **4 sur 9**. Les zones 2, 7, 10 et 11
> sont closes ou vides quel que soit le périmètre.

| # | Zone | État | Détail |
|---|---|---|---|
| 1 | **E-mails transactionnels** | 🟡 **1/7** | Catalogue serveur `convex/emailMessages.ts` en place ; **seule l'invitation est traduite** (FR+EN, vraies traductions). Plomberie de locale **complète** : `getCreatorContact`, `getAssignmentNotifyData`, `listDeadlineReminderTargets` transportent tous `locale`. Les 6 autres (vidéo validée / refusée / paiement / nouvelle mission / relance / rappel deadline) sont des **littéraux FR** dans `convex/emails.ts` (36 chaînes). Signature « Anthony » = endonyme, ne pas traduire. |
| 2 | **SEO / OG / title** | 🟢 **clos** | `app/layout.tsx:23-30` : `generateMetadata()` passe par `getTranslations`, clés `layout.metadata.*`. Aucun `openGraph`, `twitter`, `manifest` ailleurs. `robots: noindex, nofollow` — app 100 % authentifiée, **pas d'enjeu SEO**. Seul reste : `alt="Jarvis Creator Studio"` en dur dans `components/brand/BrandMark.tsx:28`. |
| 3 | **Erreurs & validations** | 🔴 **non démarré** | **352 `throw new ConvexError`** dans `convex/` (61 dans `assignments.ts`, 53 `scripts.ts`, 35 `comptes.ts`, 33 `publications.ts`…). **Aucun code `ERR_*` n'existe dans le dépôt** — la frontière Convex prévue par `ARBITRAGES-I18N.md` §5 n'est pas commencée. `lib/convex-error.ts` ne fait que surfacer `error.data` brut, avec un fallback FR en dur (`"Une erreur est survenue."`). ⚠️ **La mine est toujours armée** : `components/admin/AdminPublishForm.tsx:141` branche sur `/précède la\s+création/i` contre le texte de `convex/assignments.ts:2940`. Traduire ce message casse la régularisation de date **en silence, sans erreur de compilation**. |
| 4 | **Texte venant de la base** | 🟡 **cadré, non fait** | Enums FR **stockés** et affichés : `angleTonal` (`Psycho`/`Accusatoire`/`Pédagogique`, `convex/schema.ts:309-311`), `mecanique`, `niveau` ; `filterPresets.filters.statut` (« Publié », « À venir ») ; `interval` produit en FR par `convex/whopApi.ts:231` et relu par un `switch` FR — **c'est un protocole serveur↔client**, pas un libellé. `payments.lineItems[].label` = phrases FR **figées au paiement**, aucune migration. Doctrine actée : **couche de mapping `valeur_db → clé i18n` à l'affichage**, jamais de renommage. Contenu saisi par l'utilisateur (briefs, notes, `sidebarLinks`) = **donnée, jamais extraite**. |
| 5 | **États vides & toasts** | 🔴 | **323 sites `toast.*`**, dont **113 avec un littéral direct**. Les états vides sont dans la masse des 2 016 (le détecteur strict les attrape via le ternaire JSX). |
| 6 | **Exports générés** | 🟡 | **Pas de PDF** dans le dépôt. CSV seulement : `lib/csv.ts`, `app/admin/[projectSlug]/paiements/page.tsx`, `convex/payments.ts`. En-têtes de colonnes monétaires déjà corrigés (#77, `moneyColumnHeader` rend le **code ISO**, pas le symbole). **Noms de fichiers figés par décision**, non traduits. |
| 7 | **Texte dans images / SVG** | 🟢 **clos** | Aucun `<text>`/`<tspan>` dans `public/`. Les labels du quadrant sont des `<text>` recharts alimentés **par props**, déjà extraits (`tracker.quadrant.*`). Reste le seul `alt` de `BrandMark.tsx` (cf. zone 2). |
| 8 | **Dates / nombres / devises** | 🔴 | **57 occurrences de `"fr-FR"` en dur** sur 20 fichiers (`lib/format.ts`, `lib/pay-cycle.ts`, `lib/currency.ts`, `lib/format-rate.ts`, `CreatorDetailView`, `OffresTab`, `PublicationDetailDialog`, `AssignmentDetailSheet`…). `formatMoney(n, currency, locale)` **a déjà son paramètre de langue**, défaut `fr-FR` — **~120 points d'appel** à migrer écran par écran. ⚠️ `convex/accountPhase.ts` : `JOURS_FR` (7) + `MOIS_FR` (12) + l'ordinal « 1er » + `PHASE_LABELS` + `quotaRefusalMessage` ≈ **24 chaînes** qu'**aucun grep sur `ConvexError` ne trouve** — un clippeur US les lit à **chaque refus de quota**. Invariants à ne pas casser : la devise ne dérive **jamais** de la langue ; le fuseau reste épinglé Paris ; **le libellé de paie persisté ne change pas de format**. |
| 9 | **Pluralisation** | 🔴 | **16 pluriels ICU** dans les catalogues, contre **141 sites `? "s" : ""` en dur** (`ProgressionCelebration`, `PaiementsScreen:376`, `ComptesScreen:142,156`, `ClipperSpaceScreen`, `ClipPublishForm`, `WhopRevenueCard`, `ChosenComboPicker`…). Chacun est une phrase concaténée, donc **intraduisible en l'état** — à convertir en clé ICU complète, pas en fragment. |
| 10 | **CGU / mentions / confidentialité** | ⚪ **inexistant** | Aucune page légale nulle part dans le dépôt. Ce n'est pas un manque i18n, c'est un **manque produit** qui devient visible si des créateurs US sont onboardés sous contrat. Hors périmètre de ce chantier — signalé, pas traité. |
| 11 | **Landing / marketing** | ⚪ **inexistant** | Aucune page publique. `/` (`app/page.tsx`) est un **routeur de rôle**, pas une landing. `robots: noindex, nofollow`. Zone vide, rien à traduire. |

---

## 5. Historique et conventions

### 5.1 Où la session précédente s'est arrêtée

| Commit | Contenu |
|---|---|
| `0f4f79d` (#78) | Infra next-intl + layout/nav extraits, rendu FR inchangé |
| `ab5f8d3` (#80) | **PR 2a** — plomberie locale, de l'invitation à l'espace créateur |
| `f5e4773` (#88) | 3 bugs de capture du détecteur + garde des entités HTML |
| `13783fd` | Découplage famille A + le marqueur d'exemption fonctionne enfin en JSX |
| `222754a` | **lot 1** — pré-session (join, deux logins, reset) |
| `4b1600c` | **lot 2 (1/2)** — portail partenaire, 19 fichiers sur 41 |
| `8fe4960` | doc : une clé appartient à UN namespace, jamais de réutilisation |
| `22e6352` | **lot 2 (2/2)** — les six gros écrans du portail partenaire |

**Progression : écran par écran, en partant de ce que voit un créateur US en
premier** (invitation → join → login → portail). Les 4 derniers commits ne sont
**pas encore poussés ni ouverts en PR**.

### 5.2 Conventions adoptées — toutes vérifiées dans le code

- **Nommage** : `module.composant.element`, strict. Interdiction absolue de clés
  générées depuis le texte français.
- **Un texte identique dans deux namespaces = deux clés.** Jamais de réutilisation
  sans avoir relu la valeur exacte dans `fr.json`. Régression réelle qui a produit
  la règle : `nav.item.guide` (= « Comment ça marche », sidebar admin) réutilisée
  pour le lien « Guide » du portail → `e2e/creator-portal-nav.spec.ts` est tombé.
  Les deux clés coexistent **volontairement**.
- **ICU MessageFormat** pour pluriels et interpolations, **jamais** de
  concaténation.
- **Exemption ligne à ligne**, raison **obligatoire** : `// i18n-exempt: <raison>`
  ou `{/* i18n-exempt: … */}` (les deux formes, depuis `13783fd`).
- **Cliquet** : `scripts/i18n-baseline.json` ne peut que **rétrécir**. Un fichier
  hors baseline contenant du français casse la CI ; un fichier de la baseline
  devenu propre casse la CI aussi (il faut le retirer).
- **Le FR est la source**, `en.json` en est la copie de clés (`global.d.ts`
  n'inclut volontairement pas `en.json` dans l'union de types).
- **Méthode** : « un test vert ne prouve rien tant qu'il n'a pas été vu rouge » ;
  une rupture côté Convex n'a d'effet **qu'après redéploiement**.
- **Ton FR** : tutoiement systématique côté créateur (« Ton espace », « Choisis un
  mot de passe », « Colle l'URL »). Vouvoiement nulle part.
- **Ton EN observé** (les 2 seuls endroits traduits) : informel et direct, « you »,
  contractions (« you'll find », « don't fix the wrong thing »), orthographe
  **US** (`traveled`… mais `travelled` apparaît une fois — voir §5.3).

### 5.3 Incohérences relevées

1. **Deux plans de lots qui se contredisent.** `ARBITRAGES-I18N.md` §11 décrit
   7 PRs (B, 1 infra, 2 frontière Convex, 3 analytics, 4 admin, 5 rôles,
   6 e-mails, 7 reste). Le travail réel a été **reséquencé** en 2a (plomberie) /
   2b (écrans créateur, la branche actuelle) / 2c (erreurs), et le tableau §11
   **n'a jamais été mis à jour**. Il annonce notamment « frontière Convex doit
   précéder les écrans » — l'inverse de ce qui a été fait. À réconcilier avant de
   continuer, sinon la prochaine session repartira du mauvais plan.

2. **Le produit a deux noms, tous deux dans les catalogues traduits.**
   « **Jarvis** Creator Studio » (`messages/{fr,en}.json` → `layout.metadata.*`,
   `BrandMark.tsx:28`, `app/login/page.tsx:71`, `app/join/[token]/page.tsx:128`)
   contre « **Jarvia** » (`convex/emailMessages.ts` FR **et** EN,
   `tracker.quadrant.info.autre` FR **et** EN, pages analytics et notifications).
   Un créateur US reçoit un e-mail « Welcome to Jarvia » puis atterrit sur
   « Jarvis Creator Studio ». **À trancher avant toute traduction de masse** —
   c'est le genre de terme qui se fige dans 200 clés.

3. **La doctrine « traduction hors scope » est déjà enfreinte deux fois**, et pas
   par accident : `tracker.quadrant` (47 clés, arrivées par les PRs produit
   #84/#86/#87) et `convex/emailMessages.ts` (invitation FR+EN, avec un
   commentaire qui assume explicitement l'exception). `en.json` est donc
   aujourd'hui mi-doctrine, mi-exception. Ce n'est pas tenable comme état stable.

4. **La garde ne couvre que 58 % du code concerné** (`app/` + `components/`).
   `lib/` et `convex/` — 850 littéraux, dont la totalité des e-mails et des
   352 `ConvexError` — n'ont **aucun cliquet**. Rien n'empêche une régression là.

5. **Trois documents d'audit ne sont pas versionnés** :
   `I18N-CLASSEMENT-CREATEUR.json` (103 ko), `I18N-TEXTE-AUSSI-DONNEE.md`,
   plus `AB_RETENTION_CROSS.md` et `RETENTION_AUDIT.md` (hors i18n). Le travail
   d'analyse qu'ils portent disparaît au prochain `clone`.

6. **Convention de nommage des fichiers de doc** : l'existant utilise le tiret
   (`I18N-AUDIT.md`, `I18N-DEFAUTS-CROISES.md`, `ARBITRAGES-I18N.md`) ; ce fichier
   utilise l'underscore (`I18N_STATUS.md`) parce que le brief le demande
   nommément. À renommer en `I18N-STATUS.md` si tu veux l'homogénéité.

---

## 6. Plan de finition — recadré sur le périmètre créateur

Tous les chiffres ci-dessous sont **le périmètre créateur uniquement**. Le
comptage repo-entier de la version précédente de ce fichier est périmé.

### Chantier A — EXTRACTION

| Lot | Contenu | Fichiers | Chaînes | Effort | Risque |
|---|---|---:|---:|---|---|
| **A0** | Push tel quel → rebase sur `main` (3 commits de retard) → **PR draft** | — | — | 15 min | **nul** ; le risque est de *perdre* le travail (arbre partagé entre sessions, incident #77) |
| **A1** | Écrans créateur — les 31 fichiers `components/` + 2 `app/` restants | 33 | **209** | **2-3 sessions** ; `WarmupGuideAccordion` (91) = une demi-session à lui seul | **moyen** — famille A (`DeclareCompteDialog` : l'enfant JSX **est** la valeur d'enum), famille B (`.toLowerCase()` sur libellé, 3 sites), et 8 composants partagés avec l'admin |
| **A2** | Frontière Convex — codes `ERR_*` + mapping unique | 8 | **80 sites → 61 messages distincts** | **1 session** (au lieu de 2) | **ÉLEVÉ** — `AdminPublishForm.tsx:141` branche sur `/précède la\s+création/i` contre `convex/assignments.ts:2940`. À corriger **dans le même commit** |
| **A3** | `convex/accountPhase.ts` — `JOURS_FR`, `MOIS_FR`, ordinal, `PHASE_LABELS`, `quotaRefusalMessage` | 1 | **27** | 1/2 session | **moyen** — le message de refus doit rester aligné mot pour mot avec `ClipPublishForm.tsx:187` |
| **A4** | Les 6 e-mails restants → `convex/emailMessages.ts` | 2 | ~36 | 1 session | **faible** — plomberie de locale déjà en place et vérifiée |
| **A5** | **Formats US** — dates, nombres, montants | ~15 | **11 `"fr-FR"` + 43 sites de formatage** | **1 session** | **ÉLEVÉ sur les montants** — voir §6 bis, chaque changement touchant un montant est signalé **avant** application |
| **A6** | Pluriels concaténés → clés ICU | 6 | **12** | 1/2 session | **faible** |
| **A9** | Mapping `valeur_db → clé` (4 valeurs) + **`lineItems[].label`** | ~5 | ~25 | 1 session | **moyen** — cf. §6 ter, c'est le seul lot qui peut faire échouer le critère de fin |
| **A10** | **Monter le sélecteur de langue dans le portail créateur** (`CreatorSidebar` ou `ProfilScreen`) | 2 | ~2 | 1/4 session | **faible** — `api.i18n.setMyLocale` existe déjà et fonctionne |
| **A7** | ~~Admin + analytics hub~~ | ~220 | ~2 588 | — | **🚫 HORS SCOPE — l'admin reste en FR.** Conservé ici pour mémoire : si le périmètre rouvre un jour, c'est le reste du chantier. Ne pas le planifier, ne pas le compter dans l'avancement |
| **A8** | **Garde CI consciente du périmètre** — cf. §6 quater | 2 | — | 1/2 session | **nul** ; **à faire avant A2/A4** |

**Total chantier A : ~7-9 sessions** (contre ~15-20 avant recadrage).

### Chantier B — TRADUCTION

| Lot | Contenu | Effort | Risque |
|---|---|---|---|
| **B1** | Traduire les **~163 clés** du périmètre créateur (`portal` 127, `auth` 30, `settings` 4, `layout` 1, `nav.action.logout` 1) + `travelled → traveled` | 1 session | **faible** — seul `en.json` change |
| **B2** | Garde CI « `en.json` ne recopie plus `fr.json` » **sur le périmètre** | 1/2 session | **nul** |
| **B3** | Traduire au fil de l'eau à chaque lot de A | +20 % par lot | **faible** |

Les **14 clés `nav.*` admin** restent volontairement en français dans `en.json` :
elles alimentent la liste blanche de B2.

---

## 6 bis. A5 — formats US, et ce qui touche un montant

**Anglais US (D3) implique** : dates `MM/DD/YYYY`, nombres `1,234.56`
(virgule = milliers, point = décimales), et la position du symbole monétaire
(`$1,234.56` et non `1 234,56 $`).

**Invariants qui ne bougent pas**, quelle que soit la langue :

- **La devise ne dérive JAMAIS de la langue.** Elle vient de la transaction. Un
  payout en dollars reste en dollars dans une interface française, et
  réciproquement. `formatMoney(n, currency, locale)` — la langue ne pilote que la
  **mise en forme**.
- **Aucune conversion, aucun taux, aucun backfill.** Un montant sans champ
  `currency` reste sans symbole.
- **Le fuseau reste épinglé `Europe/Paris`.** `en` ne veut pas dire UTC.
- **`fxRateToRevenue` = 0,86, on n'y touche pas** (rétroactif sur les cycles
  déjà payés).

**Les 8 sites qui touchent un montant** — chacun sera signalé **avant**
application, avec le rendu FR actuel et le rendu EN proposé :

| Fichier | sites | ce qui change |
|---|---:|---|
| `components/portal/screens/PaiementsScreen.tsx` | 10 | écran de paie du créateur — le plus sensible |
| `lib/format-rate.ts` (`formatMoney`) | 6 | le formateur lui-même — défaut `fr-FR` à conserver, langue passée par l'appelant |
| `components/portal/EarningsCalculator.tsx` | 5 | simulation de gains |
| `components/portal/PricingEstimator.tsx` | 4 | estimation de barème |
| `components/portal/screens/DashboardScreen.tsx` | 4 | « Mes gains » |
| `components/portal/screens/ProgressionScreen.tsx` | 2 | paliers de bonus |
| `components/admin/leaderboard/CreatorLeaderboard.tsx` | 2 | classement (partagé) |
| `lib/format.ts`, `lib/pay-cycle.ts` | 4 | vues compactes + libellé de cycle |

**Vérifié : `formatCycleRange` est de l'affichage pur**, recalculé depuis
`cycleStart`/`cycleEnd` à chaque rendu — le localiser ne réécrit aucune donnée.
**`lineItems[].label`, lui, est écrit en base** (`convex/payments.ts:386`, `:395`,
`:404`, `:477`) : il ne doit **jamais** être reformaté rétroactivement.

---

## 6 ter. A9 — `lineItems[].label`, le seul vrai obstacle au critère de fin

L'écran de paie du créateur affiche `{li.label}` (`PaiementsScreen.tsx:265`),
c'est-à-dire des **phrases françaises figées en base au moment du paiement** :
`Fixe — 3 vidéos publiées`, `CPM — 12 400 vues`, `Bonus paliers (cumul de vues)`,
`Forfait — cycle 2`.

Un créateur US lira donc du français sur son écran de paie **même quand tout le
reste sera traduit**, et aucune extraction ne peut le corriger : la chaîne est
une donnée, pas de l'interface.

**Traitement retenu** (déjà la doctrine, `ARBITRAGES-I18N.md` §6) :

- **l'historique reste figé** — aucune migration, aucune réécriture (D6) ;
- les **nouveaux** `lineItems` reçoivent des **champs structurés**
  (`type`, `quantity`, `period`) à la génération ;
- l'affichage **lit la structure si présente, sinon retombe sur `label`**.

**Conséquence sur le critère de fin** : un créateur US **nouvellement onboardé**
verra un écran de paie 100 % anglais dès son premier cycle. Un créateur avec de
l'historique FR gardera ses anciennes lignes en français. **C'est acceptable et
c'est un choix, pas un oubli** — mais il faut le dire, sinon le critère de fin
échoue sur un point qu'on croyait clos.

---

## 6 quater. A8 + B2 — la garde doit connaître le périmètre

Sans ça la garde est ingérable et sera désactivée sous trois jours. Le
comportement cible :

| Fichier | Comportement |
|---|---|
| **dans le périmètre créateur** | **STRICT et BLOQUANT** — aucun littéral en position d'affichage, accent ou pas |
| **hors périmètre** | **totalement ignoré** — aucun message, aucun compteur, pas de baseline |

**Trois changements concrets :**

1. **`scripts/i18n-creator-scope.json` devient la source unique du périmètre**, et
   il est **régénéré par la clôture d'imports**, pas maintenu à la main. Il passe
   de 56 à **140 fichiers** (`components/ui/*`, `lib/*`, `convex/*` purs et
   `BrandMark` y entrent, ils manquaient).
   ⚠️ **Jamais de règle par préfixe de chemin** : `CreatorLeaderboard` vit sous
   `components/admin/` et est dans le périmètre.
2. **`scripts/i18n-baseline.json` rétrécit de 169 à 46 fichiers** — uniquement les
   fichiers du périmètre pas encore extraits. Les 123 autres sortent de la
   baseline non pas parce qu'ils sont propres, mais parce qu'ils sont **hors
   scope**. Les deux notions doivent être **distinctes dans le fichier**, sinon la
   prochaine session croira le travail fait.
3. **`SCANNED_DIRS` passe de `["app","components"]` à la liste de la clôture**,
   ce qui fait enfin entrer `lib/` et `convex/` sous garde — 69 chaînes du
   périmètre y vivent aujourd'hui **sans aucun cliquet**.

**B2** ajoute une quatrième règle : une valeur de `en.json` **identique** à sa
valeur `fr.json` fait échouer la CI, **sauf** si sa clé est dans une liste
blanche explicite (les 28 termes légitimes du §2 + les 14 clés `nav.*` admin).

## 7. Ordre d'exécution

```
A0   push tel quel → rebase sur main → PR draft
B1   traduire les ~163 clés du périmètre créateur
B2   garde CI anti-recopie en.json (périmètre + liste blanche)
A8   garde CI consciente du périmètre (clôture, baseline 46, lib/ + convex/ sous garde)
A5   formats US — dates, nombres, montants        ← remonté, chaque montant signalé AVANT
A10  sélecteur de langue dans le portail créateur
A4   les 6 e-mails restants
A1   écrans créateur — 33 fichiers, 209 chaînes
A3   accountPhase — 27 chaînes (refus de quota clippeur)
A6   pluriels concaténés → ICU — 12 sites
A2   frontière Convex ERR_* — 80 sites / 61 messages   ← LOT DANGEREUX, seul dans sa PR
A9   mapping valeur_db + lineItems structurés
──── critère de fin : parcours EN complet (§10) ────
A7   🚫 HORS SCOPE — l'admin reste en FR
```

**Les trois choix non évidents :**

- **`A5` remonté juste après les gardes, et il se scinde en deux.** Les écrans qui
  portent le plus de montants — `PaiementsScreen`, `DashboardScreen`,
  `ProgressionScreen`, `TodayPostBanner` — sont **déjà extraits**. Les passer en
  format US produit un effet visible immédiatement, sans attendre `A1`. Les trois
  qui ne le sont pas (`EarningsCalculator`, `PricingEstimator`,
  `CreatorLeaderboard`) sont traités **dans `A1`**, en un seul passage par
  fichier au lieu de deux.
- **`A8` avant `A2` et `A4`.** 69 des 325 chaînes du périmètre vivent dans `lib/`
  et `convex/`, aujourd'hui **sans aucun cliquet**. Sans la garde, chaque
  correctif ultérieur peut y réintroduire du français sans que personne ne le
  voie.
- **`A2` seul dans sa PR, et tard.** C'est le lot qui peut casser la
  régularisation de date en silence. Il ne doit partager sa PR avec rien.

**`A9` en dernier des lots créateur** : c'est lui qui décide si le critère de fin
est atteint ou seulement approché (cf. §6 ter).

## 8. Glossaire produit — à valider

Établi depuis les traductions **déjà présentes** (`tracker.quadrant`,
`convex/emailMessages.ts`), donc déjà en usage. Les cases vides sont les
arbitrages qui restent.

| FR | EN retenu | Source / statut |
|---|---|---|
| warmup | **warm-up** | `tracker.quadrant.legend.warmup` (déjà traduit) |
| promo | **promo** | inchangé, déjà traduit |
| hook | **hook** | inchangé (terme déjà anglais côté FR) |
| intent | **intent** | inchangé |
| save / save rate | **save / save rate** | inchangé |
| breakout | **breakout** | inchangé |
| scale | **scale** | inchangé |
| créateur / créatrice | **creator** | `emailMessages` : « Your creator space » |
| espace créateur | **creator space** | idem |
| mission / assignment | **assignment** | `emailMessages` : « your assignments » |
| gains | **earnings** | `emailMessages` : « your earnings » |
| compte (réseau social) | **account** | `tracker.quadrant.tooltip.*` |
| vues | **views** | déjà traduit |
| médiane du compte | **account median** | déjà traduit |
| relevé nocturne | **nightly sync** | déjà traduit |
| non qualifié | **unqualified** | déjà traduit |
| en attente | **pending** | déjà traduit |
| palier (de bonus) | **tier** | D5, tranché |
| forfait (talent) | **retainer** | D5, tranché |
| clippeur | **clipper** | D5, tranché — terme maison, non gardé en FR |
| talent | **talent** | D5, tranché |
| cycle (de paie) | **pay cycle** | D5, tranché |
| dû ce cycle | **due this cycle** | D5, tranché |
| barème / pricing | **pricing** | D5, tranché |
| rushes | **rushes** | déjà anglais dans la nav |
| veille | **radar** | D5, tranché — déjà le nom de l'item de nav |
| bio | **bio** | inchangé |
| **la marque / l'expéditeur** | **Jarvia** | D2 — e-mails et communications sortantes |
| **le nom de l'outil** | **Jarvis Creator Studio** | D2 — interface, metadata, login. **Les deux coexistent, ne pas unifier** |

**Orthographe : anglais US** (D3). Seule correction à porter :
`tracker.quadrant.subtitle` → `travelled` devient `traveled`.

---

## 9. Décisions

### Tranchées le 2026-08-25

**D1 — La traduction ENTRE dans le chantier. ✅ TRANCHÉ**
`B1` (traduire les 177 clés françaises) + `B2` (garde CI anti-recopie) passent
**avant** la reprise de l'extraction. `ARBITRAGES-I18N.md` §4 (« la traduction est
hors scope ») devient faux et **doit être amendé dans le commit de B1**.

**D2 — Les deux noms coexistent, volontairement. ✅ TRANCHÉ**
« **Jarvia** » = la marque et l'expéditeur (e-mails, communications sortantes).
« **Jarvis Creator Studio** » = le nom de l'outil (interface, metadata, login).
Règle à porter au glossaire ; **ne pas unifier**, ne pas « corriger » l'un vers
l'autre au fil des extractions.

**D3 — Anglais **US**. ✅ TRANCHÉ**
`travelled` → `traveled` dans `tracker.quadrant.subtitle` (seule occurrence UK du
dépôt, vérifiée).

**D5 — Glossaire confirmé en entier. ✅ TRANCHÉ**
`clippeur → clipper`, `talent → talent`, `palier → tier`, `forfait → retainer`,
`barème → pricing`, `veille → radar`, `cycle de paie → pay cycle`. Le reste
(`warm-up`, `hook`, `intent`, `save rate`, `creator`, `assignment`, `earnings`)
était déjà en usage dans les traductions existantes. **Aucun terme maison n'est
gardé en français côté anglais.**

**D10 — Périmètre = parcours créateur uniquement. ✅ TRANCHÉ**
L'admin et l'analytics hub restent en français. Le périmètre est la **clôture
d'imports** des routes créateur (§3), composants partagés **inclus** (les
extraire est neutre : l'admin continue de lire `fr.json`). Lot `A7`
**hors scope**, conservé dans ce fichier pour mémoire.

**D11 — Le critère de fin est un parcours, pas un pourcentage. ✅ TRANCHÉ**
17 étapes cochables (§10), vérifiées en session réelle en locale `en`.

**D12 — La garde CI connaît le périmètre. ✅ TRANCHÉ**
Bloquante sur le périmètre, **silencieuse ailleurs** (§6 quater). Sans ça elle
est ingérable et sera désactivée.

**D13 — `A5` est prioritaire, pas terminal. ✅ TRANCHÉ**
Anglais US = `MM/DD/YYYY`, `1,234.56`, `$1,234.56`. **Chaque changement touchant
un montant est signalé avant application** (les 8 sites sont listés en §6 bis).

### Restant à trancher

**D4 — Ton en anglais : INFORMEL. ✅ TRANCHÉ (2026-08-26)**
« you », contractions, registre direct — le pendant du tutoiement français.
Confirmé définitivement : c'est le ton des 653 valeurs livrées, et il ne se
rediscute plus.

**D6 — Contenu en base : jusqu'où ?** La doctrine (mapping à l'affichage, jamais
de renommage) couvre `angleTonal`, `statut`, `interval`, `VerdictBadge`.
Question ouverte : les **anciens** `payments.lineItems[].label` (phrases FR
figées) restent-ils en français pour un créateur US qui consulte son historique ?
*Recommandation : oui, l'historique reste figé* (c'est déjà la doctrine), et les
**nouveaux** lineItems passent aux champs structurés.

**D7 — View-as : quelle langue ?** Quand un admin observe l'espace d'une
créatrice (`/admin/voir/...`), il voit aujourd'hui l'écran dans **sa** langue à
lui, pas celle de la créatrice observée. Signalé dans
`CARTOGRAPHIE-CREATEUR.md` §2, jamais tranché.

**D8 — Réconcilier `ARBITRAGES-I18N.md` §11 ?** Le tableau des 7 PRs contredit
le séquencement réel. *Recommandation : le remplacer par le §6/§7 de ce fichier.*

**D9 — Versionner les 3 documents d'audit non suivis par git ?**

---

## 10. Critère de fin — le parcours créateur en anglais

**Ce critère remplace le pourcentage d'avancement.** Le chantier est fini quand
un créateur invité en `en` traverse ce parcours sans voir une seule chaîne
française.

| # | Étape | Ce qui est en anglais | Livré par | ✓ |
|---:|---|---|---|:-:|
| 1 | **E-mail d'invitation** | sujet, corps, CTA, mention du lien à usage unique | #80 | ☑ |
| 2 | **`/join/:token`** | accueil, choix du mot de passe, lien invalide ou expiré | lot 1 + B1 | ☑ |
| 3 | **Activation du compte** | « mot de passe trop court », échec de création | B1 + A2 | ☑ |
| 4 | **`/:slug/login`** | libellés, identifiants invalides, projet introuvable | lot 1 + B1 + A2 | ☑ |
| 5 | **Dashboard `/app`** | cartes d'action, étapes d'onboarding, « Mes gains », **montants `$1,234.56`** | A1f + A5 | ☑ |
| 6 | **Déclaration de compte** | dialogue, « ce compte existe déjà sur TikTok », plateforme invalide | A1e + A2 | ☑ |
| 7 | **Warmup** | guide (98 chaînes), check du jour, « check déjà fait » | A1b + A1c + A2 | ☑ |
| 8 | **Mission `/app/assignments/:id`** | brief, upload, erreurs de soumission | A1e + A2 | ☑ |
| 9 | **Publication** | collage d'URL, « ce lien n'est pas un lien TikTok », date dans le futur | A1e + A2 | ☑ |
| 10 | **Refus de quota clippeur** | message complet, **y compris la date et la phase** | A3 + A2 | ☑ |
| 11 | **Écran de paie `/app/paiements`** | libellés, **`$1,234.56`**, **`MM/DD/YY`**, cycle, lignes de paie | A5 + A9 | ☑ |
| 12 | **`/app/videos`** | statuts, filtres, **vues `12,345`** | A1e + A5 | ☑ |
| 13 | **`/app/profil`** | identité, paiement, **+ le sélecteur de langue** | A1f + A10 | ☑ |
| 14 | **Les 6 autres e-mails** | vidéo validée / refusée, paiement, mission, relance, deadline | A4 | ☑ |

**Réserve assumée** (§6 ter) : un créateur avec de l'**historique de paie
français** garde ses anciennes lignes en français — `lineItems[].label` est figé
en base. Le critère porte sur un créateur **US nouvellement onboardé**, dont le
premier cycle est intégralement anglais dès A9.

---

## 10 bis. Suivi des lots

| Lot | Contenu | État |
|---|---|:-:|
| **A0** | rebase, push, PR draft | ☑ |
| **B1** | 178 clés traduites (33 % → 98 %) | ☑ |
| **B2** | garde « en.json ne recopie plus fr.json » | ☑ |
| **A8** | garde pilotée par le périmètre (clôture d'imports) | ☑ |
| **A8b** | correctif : le texte JSX multi-ligne était invisible | ☑ |
| **A5** | formats US — dates, nombres, montants | ☑ |
| **A10** | sélecteur de langue côté créateur | ☑ |
| **A4** | les 6 e-mails restants | ☑ |
| **A1** | 146/146 fichiers du périmètre extraits | ☑ |
| **A3** | `accountPhase` — phases, dates en toutes lettres | ☑ |
| **A6** | pluriels concaténés → ICU | ☑ |
| **A2** | 80 rejets Convex → codes `ERR_*` | ☑ |
| **A9** | lignes de paie structurées (chemin d'écriture) | ☑ |
| **A7** | ~~admin + analytics~~ | 🚫 hors scope |

**Chiffres finaux, re-vérifiés au scan complet** : 691 clés — **653 réellement
traduites** et **38 identiques au français**, toutes sur la liste blanche
explicite (`scripts/i18n-same-in-en.json`), **aucune hors liste**. Le catalogue
est donc entièrement traité.

**146/146 fichiers**, **0 occurrence** — comptage indépendant de la baseline,
avec le détecteur corrigé (multi-ligne JSX + point-virgule + `lib/` + `convex/`).
tsc, build et 2 064 tests verts.

⚠️ **Le périmètre est passé de 140 à 146 en fin de chantier**, et c'est la CI qui
l'a signalé : `i18n-scope-gen.mjs --check` a refusé un
`scripts/i18n-creator-scope.json` périmé. Six fichiers avaient rejoint la
clôture d'imports sans que je régénère la liste — les cinq modules créés pendant
le chantier (`use-label`, `use-intl-locale`, `intl-locale`, `use-convex-error`,
`errorCodes`) et `LanguageSelector`, tiré dans le portail par A10. Ils sont
propres, mais un scan annoncé « complet » sur une liste périmée ne l'était pas.
C'est exactement ce que la garde de fraîcheur du périmètre existe pour attraper.

### Les 38 clés identiques, ventilées

Elles vivent toutes dans `scripts/i18n-same-in-en.json` ; **aucune n'est hors
liste** (la CI échouerait). 15 + 11 + 7 + 4 + 1 = **38**.

| Catégorie | n | Exemples |
|---|---:|---|
| Mots communs aux deux langues | **15** | `Email` ×2, `Base` ×2, `Guide` ×2, `Brief`, `Handle *`, `Photo`, `Bonus`, `Clip`, `CPM`, `Total`, `Shadowban`, `Signal` |
| Items de nav déjà anglais | **11** | `Dashboard`, `Analytics`, `Assets`, `Assignments`, `Pricings`, `Radar`, `Rushes`, `Scripts`, `Inspirations`, `Notifications`, `Validation` |
| Jargon tracker (admin) | **7** | `Saves`, `Save rate`, `Distribution`, `Scale`, `Promo`, `Qualification`, `Intent — save rate` |
| Marques et formats | **4** | `PayPal`, `USDT (crypto)`, `IBAN, email, wallet…`, `Jarvis Creator Studio` |
| Signe typographique | **1** | `—` (phase inconnue) |

⚠️ Un chiffre de « 97,5 % / 17 clés françaises » a circulé en cours de chantier :
il venait d'un script d'audit jetable dont la liste de termes acceptables était
codée en dur et périmée. Le nombre qui fait foi est celui de la garde, qui lit
la liste blanche du dépôt.

---

## 10 ter. Les 8 sites de montants — rendu avant / après

Le français est **inchangé à l'octet près** partout. Seule la colonne EN est
nouvelle.

| # | Site | Fichier | FR (inchangé) | EN (nouveau) |
|---:|---|---|---|---|
| 1 | Écran de paie — montants (10) + dates (3) | `portal/screens/PaiementsScreen.tsx` | `1 234,56 $` · `03/09/26` | `$1,234.56` · **`09/03/2026`** |
| 2 | `formatMoney` — le formateur (6 appels) | `lib/format-rate.ts` | `1 234,56 €` | `€1,234.56` |
| 3 | Simulateur de gains (5) | `portal/EarningsCalculator.tsx` | `1 234,56 $` | `$1,234.56` |
| 4 | Estimateur de barème (4) | `portal/PricingEstimator.tsx` | `1 234,56 $` | `$1,234.56` |
| 5 | Dashboard « Mes gains » (4) | `portal/screens/DashboardScreen.tsx` | `03/09/26` · `1 234,56 $` | **`09/03/2026`** · `$1,234.56` |
| 6 | Paliers de bonus (2) | `portal/screens/ProgressionScreen.tsx` | `1,5 k` · `1 234,56 $` | `1.5k` · `$1,234.56` |
| 7 | Classement, partagé admin (2) | `admin/leaderboard/CreatorLeaderboard.tsx` | `5 juil. – 3 août 2026` | `Jul 5 – Aug 3, 2026` |
| 8 | Vues compactes + libellé de cycle (4) | `lib/format.ts`, `lib/pay-cycle.ts` | `12 345` · `0,56 %` | `12,345` · `0.56%` |

**Bonus, hors des 8** : `formatBytes` traduit aussi ses unités (`1,2 Mo` →
`1.2 MB`) — « 340 Mo » ne veut rien dire pour un anglophone.

**Année sur 4 chiffres, mais seulement là où il y a de l'argent.** `formatMoneyDate`
rend `09/03/2026` en anglais sur l'écran de paie et sur « Mes gains », `09/03/26`
partout ailleurs. `09/03/26` reste ambigu pour qui n'a pas encore intégré que
l'ordre des champs a changé, et sur un écran qui annonce un versement une date
non ambiguë vaut plus que deux caractères de largeur. Le **français garde
2 chiffres des deux côtés** : son ordre n'a jamais bougé, il ne gagne rien à
s'allonger.

**Invariants tenus, vérifiés :**
- la **devise ne dérive jamais de la langue** : elle vient de la transaction
  (`projects.payCurrency` pour la paie, `whopPayments.currency` pour le revenu) ;
- **aucune conversion, aucun taux, aucun backfill** — `fxRateToRevenue` n'est pas
  touché ;
- **fuseau épinglé `Europe/Paris`** ; `en` ne veut pas dire UTC ;
- **`lineItems[].label` n'est jamais réécrit** : A9 ajoute un champ, il ne
  modifie pas l'historique ;
- **`formatCycleRange` est de l'affichage pur** (recalculé depuis les timestamps),
  vérifié avant de le localiser.

**Un piège évité, qui aurait cassé la CI en silence** : `formatPercent` en
`style: "percent"` insère en français une **espace fine insécable** (U+202F) là
où le rendu historique met une espace ordinaire. Le caractère est invisible et
il aurait fait tomber `e2e/verdict-follows-periode.spec.ts`, qui attend
« 0,50 % ». Le nombre passe par `Intl`, le signe est posé à la main.

## 11. À arbitrer après coup

Rien de bloquant : le parcours est complet. Ces points ont été tranchés dans le
sens le plus **conservateur** pendant la traversée, et méritent ton avis.

### 11.1 Décisions produit prises par défaut

| # | Point | Choix conservateur retenu | Alternative |
|---:|---|---|---|
| 1 | ~~**Ton en anglais**~~ | ✅ **TRANCHÉ** : informel, définitivement (D4) | — |
| 2 | ~~**Année sur 2 chiffres**~~ | ✅ **TRANCHÉ** : `MM/DD/YYYY` sur l'écran de paie et « Mes gains », `MM/DD/YY` partout ailleurs. Le français garde 2 chiffres des deux côtés — son ordre n'a jamais bougé, il ne gagne rien à s'allonger | — |
| 3 | **`nav.section.veille` → « Radar »** | applique le glossaire (D5) | crée un doublon visuel : la section « Radar » contient l'item « Radar ». Admin-only, faible enjeu |
| 4 | **Langue en mode view-as** (D7) | le sélecteur de langue est **masqué** en observation | la mutation écrit sur `users.locale` de l'ADMIN : le bouton aurait changé SA langue en paraissant agir sur celle de la créatrice |
| 5 | **`« Mes vidéos »` dans les guillemets français** | conservés en français, `“My videos”` en anglais | cohérent avec la typographie de chaque langue |

### 11.2 Trous fonctionnels rencontrés, non comblés

| # | Trou | Conséquence | Effort |
|---:|---|---|---|
| 1 | ~~L'admin ne peut pas changer la langue d'une fiche existante~~ | ✅ **COMBLÉ** : champ « Langue » ajouté à la fiche créateur (`CreatorDetailView`), à côté de Statut. C'est le filet si une invitation part dans la mauvaise langue. | — |
| 2 | **Aucune page légale** (CGU, mentions, confidentialité) dans le dépôt. | Ce n'est pas un manque i18n, mais il devient visible dès qu'on onboarde des créateurs US sous contrat. | produit |

### 11.3 Dettes assumées

| # | Dette | Pourquoi elle est acceptable |
|---:|---|---|
| 1 | **Migration des anciens libellés de paie** — les `lineItems` écrits avant A9 n'ont pas de `detail` et restent affichés en français. | **Non chiffrée, non planifiée, sur ta décision.** Tes créateurs US sont nouveaux : leur premier cycle est intégralement anglais. Réécrire le passé reviendrait à falsifier un grand livre. |
| 5 | **Écriture croisée `creators.locale` → `users.locale`, non faite.** `updateCreator` n'écrit que la fiche. Dès que `users.locale` est posé, la fiche ne pilote plus l'espace du créateur. Deux séquences y mènent : passer une fiche de EN à FR sur un compte activé (la normalisation SUPPRIME `creators.locale`, `users.locale` reste `"en"`), ou un créateur qui choisit sa langue dans son Profil puis un admin qui change la fiche. | **Vérifié en prod le 2026-08-26 : 0 divergence** sur 14 fiches liées à un compte. Le mécanisme n'a jamais mordu — `/join` recopie déjà `creators.locale` sur `users.locale` (`convex/auth.ts:140`), donc les deux restent alignés tant que personne n'intervient après coup. Le corriger demanderait de n'écrire QUE sur changement réel (le formulaire renvoie la langue à chaque save, une modification de téléphone écraserait sinon le choix du créateur) et une migration du stock. **Décision : ne pas coder, garder en dette.** |
| 2 | **~2 588 chaînes admin/analytics restent en français.** | C'est le périmètre, pas un reste. La garde les ignore explicitement (`A7` marqué hors scope). |
| 3 | **Les ~55 specs e2e assertent des libellés français.** | Elles tournent en locale `fr`, qui est le défaut du produit : rien à changer. Les deux qui branchaient sur le TEXTE d'une erreur serveur ont été passées au **code** en A2. |
| 4 | **La garde ne voit pas les phrases assemblées dans une expression `{}`.** | Limite connue et documentée : elle attrape les littéraux, pas les phrases reconstruites. Les 5 cas du périmètre ont été traités à la main en A6. |

### 11.7 Ce que la garde ne voit TOUJOURS pas — limites connues

> **Une garde verte ne prouve pas qu'un écran est traduit.** Elle prouve
> qu'aucun motif CONNU n'a été réintroduit. Les deux fois où du français est
> réapparu à l'écran, c'est **l'e2e ou l'œil** qui l'ont vu — jamais la garde.
>
> **Contre-mesure, à appliquer et pas à ranger** : après TOUT lot touchant le
> parcours créateur, passage **à l'œil** sur les écrans concernés **en locale
> EN**. Pas un survol du diff — l'écran rendu.
>
> ```bash
> document.cookie = "NEXT_LOCALE=en; path=/"; location.reload()
> ```
>
> Le coût est de quelques minutes ; le coût de l'inverse est un créateur US qui
> tombe sur du français et n'en dit rien.

Le détecteur a menti trois fois. Cette liste dit où il est aveugle **par
construction**, pour que la prochaine session ne reparte pas de « 0 chaîne » en
croyant que c'est fini. Chaque ligne a été **vérifiée**, pas supposée : sonde
posée dans le périmètre, garde exécutée, résultat observé.

Les deux prédicats qui décident :

| | `isProse` (littéral NU) | `isDisplayText` (attribut, `label:`, texte JSX) |
|---|---|---|
| `"Publier"` — mot seul, capitale, sans accent | ❌ rejeté | ✓ accepté |
| `"jours"` — mot seul, minuscule, sans accent | ❌ rejeté | ❌ rejeté |
| `"deuxième"` — accent | ✓ | ✓ |
| `"Mes comptes"` — espace + capitale | ✓ | ✓ |

#### Angles morts vérifiés

| # | Motif | Exemple | Pourquoi |
|---:|---|---|---|
| 1 | **Mot seul sans accent en littéral NU** | `const A = ["Publier", "Annuler"]` | `isProse` exige un accent, ou un espace ET une capitale. Un tableau de libellés courts passe entier. |
| 2 | **Mot minuscule sans accent, partout** | `n > 1 ? "jours" : "jour"` | rejeté par les DEUX prédicats. C'est le pluriel concaténé, précisément ce que le lot A6 traquait à la main. |
| 3 | **Fragment de concaténation d'un seul mot** | `"Aucun " + n + " compte"` | chaque littéral est jugé SÉPARÉMENT ; `"Aucun "` seul ne passe pas. Un fragment de deux mots, lui, est vu. |
| 4 | **Template MULTI-LIGNE** | `` `Bienvenue\nsur la plateforme` `` | la passe template travaille ligne par ligne. |

#### Ce qui est HORS PÉRIMÈTRE par décision (pas un trou)

| Motif | Statut |
|---|---|
| Seeds, Telegram, tests, fixtures | exclus explicitement (`SKIP_FILE`, décision `ARBITRAGES-I18N.md` §7) |
| `app/admin/**`, analytics | hors périmètre — l'admin reste en FR |

#### ⚠️ Les e-mails — le seul point du parcours créateur que RIEN ne surveille

C'est un **risque**, pas une note technique.

Un e-mail est le **premier contact** d'un créateur US avec la plateforme —
l'invitation arrive **avant sa première connexion**, donc avant tout écran, avant
tout `NEXT_LOCALE`, avant toute chance de se rattraper. S'il arrive en français,
le parcours est perdu au premier geste et la personne ne dira rien : elle ne
reviendra pas.

**État réel au 2026-08-27** : les **sept** catalogues (`INVITE`, `APPROVED`,
`REJECTED`, `PAID`, `ASSIGNED`, `NUDGE`, `REMINDER`) ont bien leurs deux
branches `fr` / `en`, avec du **vrai** anglais. Rien n'est cassé aujourd'hui.

**Ce qui n'existe pas, c'est le filet.** `convex/emailMessages.ts` est hors de
la clôture d'imports : le runtime Convex n'est jamais importé côté client
(règle A6), donc le périmètre généré ne peut pas l'atteindre. Ajouter demain un
huitième e-mail avec la seule branche `fr`, ou laisser une valeur `en` recopiée
du français, **ne casse aucun test et n'allume aucune garde**.

**L'option qu'on n'a PAS prise, et pourquoi.**

| Option | Verdict |
|---|---|
| Étendre le périmètre du détecteur à `emailMessages.ts` | **Écartée, et il faut le dire clairement : ce serait une faute.** Le détecteur cherche du français qui aurait dû être extrait dans un catalogue. Or ce fichier **EST** le catalogue : son français y est légitime et cohabite avec son anglais. Le pointer dessus signalerait chaque valeur `fr:` — ~100 % de faux positifs. La garde deviendrait du bruit, et quelqu'un la désactiverait au bout de trois jours. |
| Étendre les **règles de catalogue** (parité des clés, `en` ≠ `fr`, parité ICU) aux objets `Record<Locale, …>` de `emailMessages.ts` | **La bonne réponse — pas faite, faute de temps, pas d'obstacle.** C'est exactement ce que la garde applique déjà à `messages/*.json`. Le seul travail est la forme : lire des littéraux objet TypeScript au lieu de JSON. **Dette assumée, à reprendre en premier si un e-mail part en anglais bancal.** |

**En attendant le filet** : toute PR qui touche `convex/emailMessages.ts` se
relit branche `en` par branche `en`, à la main. C'est la seule barrière.

#### Ce qu'aucune garde statique ne peut voir

| Motif | Pourquoi |
|---|---|
| **Texte en BASE** — `guideModules`, `lineItems[].label`, briefs, notes | la garde lit du code, pas des données |
| **Texte dans une image ou un SVG** | aucun `<text>` aujourd'hui, mais rien ne l'empêche |
| **Clé i18n fautive dans une TABLE** (`useLabel`) | typée `string` : la clé s'affiche brute à l'exécution. C'est ce qui a fait lire `status.rush.deposited` à un talent — attrapé par l'e2e, jamais par la garde ni par tsc. |
| **Valeur `en.json` qui n'est pas de l'anglais** | la garde B2 vérifie qu'elle DIFFÈRE du français, pas qu'elle soit anglaise. Une phrase reformulée en français y passerait. |

**La conséquence pratique** est en tête de section : elle s'y lit avant la
liste, pas après — c'est la seule ligne de ce document qui change une habitude.

### 11.6 Le détecteur avait trois trous de plus — et le guide est de la donnée

Testé à l'écran, le portail d'une créatrice EN montrait encore du français que
la garde ne voyait pas. Diagnostic avant correctif : le périmètre était bon, les
fichiers concernés étaient tous dans les 146. C'est le DÉTECTEUR qui était aveugle.

| Trou | Motif | Pourquoi |
|---|---|---|
| **1** | texte JSX voisin d'une interpolation — `Bonjour{name}`, `{fmt(x)} vues cumulées` | la capture `>[^<>{}]*<` EXCLUAIT les accolades ; c'est la forme **dominante** du dépôt |
| **2** | prose ouvrant par un emoji — `🏆 Paliers de récompense` | mon propre garde-fou anti-fragment, trop strict |
| **3** | littéraux template — `` `Upload échoué (HTTP ${s}).` `` | `STRICT_LITERAL` n'appariait que `"` et `'` |

**54 chaînes** rendues visibles, extraites en clés ICU **complètes** — jamais des
fragments recollés : `Plus que {views} vues avant {reward}.` et non
« Plus que » + valeur + « vues avant ». Un fragment recollé donne une phrase
anglaise à syntaxe française.

**Faux positifs mesurés, pas supposés** : autoriser les accolades a d'abord donné
65 détections dont **10 fausses (15 %)**. Un filtre de jetons de code les
élimine — 54 détections, **0 fausse**, revues une par une. Une garde qui crie à
tort finit désactivée.

Les primitives du détecteur vivent maintenant dans `scripts/i18n-detect.mjs`,
avec **11 tests** — dont la contre-épreuve que le desserrage du trou 2 n'a pas
rouvert la porte aux fragments qu'il écartait à raison.

**Le guide « How it works » n'est PAS un lot d'extraction.** Son contenu vit dans
la table `guideModules` : 11 modules, 16 060 caractères de Markdown, écrits et
édités par l'admin, scopés par projet. C'est de la DONNÉE, au même titre que
`payments.lineItems[].label`. Décision prise : **un jeu de modules par langue**
(champ `locale`, repli FR), livré comme lot séparé — repli et bandeau
« disponible en français seulement » d'abord, rédaction ensuite.

### 11.8 LOT B — le guide « Comment ça marche » bilingue (étape 1 : la mécanique)

**Étape 1 livrée : la mécanique, sans une ligne de contenu anglais.** La
rédaction des 11 modules est l'étape 2, sur feu vert explicite.

Le guide est de la **DONNÉE** (table `guideModules`), pas des chaînes extraites :
la garde i18n ne peut rien en dire, et un module ne peut pas être « à moitié
traduit ». Le modèle retenu — décision de §11.6 — est donc **un jeu de modules
par langue** (champ `locale`), sélectionné à la lecture, **jamais** des champs
bilingues par module.

| Pièce | Où |
|---|---|
| Choix du jeu + repli (module PUR, 10 tests) | `convex/guideModuleLocale.ts`, `lib/guide-module-locale.test.ts` |
| Lecture filtrée, écriture, ordre par jeu | `convex/guideModules.ts` |
| Bandeau de repli | `components/portal/screens/GuideScreen.tsx` |
| Éditeur admin, un bloc par langue | `components/guides/GuideModulesManager.tsx` |
| Migration `locale = fr` | `migrations:setGuideModuleLocaleFr` |
| Les trois cas de lecture | `e2e/guide-modules-locale.spec.ts` |

**Le repli va TOUJOURS vers le français, jamais l'inverse.** Un lecteur anglais
sans jeu anglais lit le français ; un lecteur français ne se voit **jamais**
servir de l'anglais faute de mieux, même quand le jeu anglais existe. C'est
l'asymétrie voulue : « fr » est le défaut du produit, pas un pis-aller.

**Le signal du repli est un écart, pas un drapeau.** La lecture rend
`servedLocale` à côté de `requestedLocale` ; leur inégalité déclenche le
bandeau, et redevient fausse **toute seule** dès qu'un module existe dans la
langue demandée. Personne n'a de case à décocher le jour de la traduction — un
e2e le prouve sur une page **ouverte**, en créant le module anglais pendant que
la page est affichée.

**La langue vient de l'ÉCRAN, pas d'une relecture serveur.** La résolution
complète tient en cinq maillons (§1) dont trois n'existent que côté Next.
Servir le guide sur une résolution plus courte que celle qui a choisi tous les
autres mots de la page donnerait l'incohérence exacte qu'on veut éviter : un
écran anglais avec un guide français « parce que le compte n'a pas de
préférence ». En observation, c'est donc la langue de la personne **observée**
(provider imbriqué de §11.5) qui décide.

**Le bandeau ne surplombe que du français RÉEL.** Au-dessus de l'état vide
(« The guide is coming soon », déjà anglais) il annoncerait un guide français
qui n'existe pas. Le guide mono-bloc legacy, lui, est bien du français : il
compte.

**Chaque jeu a son ordre.** Création, changement de langue et réordonnancement
se font entre pairs de même langue. Sans ce filtre, « monter » un module anglais
irait échanger son rang avec un module français : un clic sans effet visible, et
un guide français réordonné dans le dos de l'admin.

**L'éditeur admin GROUPE au lieu de filtrer** — deux blocs affichés en même
temps. Le seul moyen de voir d'un coup d'œil ce qui manque en anglais, c'est
d'avoir les deux sous les yeux ; un sélecteur aurait caché la moitié de l'état à
celui qui traduit. L'admin reste en français (lot A7 inchangé).

**Ce que la migration écrit** (`dryRun` par défaut, la liste rendue EST ce qui
sera écrit) : les **11 modules** de prod — 5 sur `repackit`, 6 sur `snytch`,
tous `published`, tous sans `locale` — prennent `locale = "fr"`.
**Iso-affichage par construction** : `moduleLocale` traite déjà une locale
absente comme du français. Ce qui change, c'est la lisibilité de la base — après
elle, un module sans langue est un module créé par un chemin qui a oublié de la
poser, pas un vestige. Idempotente.

**La garde ne bronche pas, et c'est attendu** : elle lit du code, pas des
données (§11.7). Le seul texte ajouté au parcours créateur est le bandeau, passé
par le catalogue — `portal.guide.fallbackNotice`, 745 clés, catalogues alignés.
Sa valeur FR est aujourd'hui **inatteignable** (le repli va toujours vers le
français, un lecteur FR ne le déclenche jamais) mais la parité des deux
catalogues est une règle de la garde, et une 3ᵉ langue la rendrait vivante.

**Reste à faire — étape 2** : la traduction des 11 modules en anglais US, créés
dans l'éditeur admin pour relecture module par module. Les passages où la
réalité diffère pour un créateur US (plateformes, fuseaux, mode de paiement) ne
sont pas traduits en aveugle : ils sont signalés avec une version adaptée.

### 11.5 La preview « Voir son espace » rendait dans la langue de l'admin

**Corrigé après coup** (branche `fix/view-as-locale-createur`).

Le provider next-intl racine monte les messages de l'APPELANT. En observation,
l'appelant est l'admin : la preview d'un espace anglophone s'affichait donc en
français — et pas seulement les mots. `useIntlLocale` lit `useLocale()`, donc les
dates et les montants suivaient aussi : `1 234,56` et `03/09/26` là où la
créatrice voit `15.00` et `09/03/2026`.

Une preview qui existe pour montrer ce que la personne voit ne montrait plus
rien. Ce n'était pas un défaut de traduction mais de **périmètre d'application**
de la chaîne de résolution — elle-même reste juste, et n'a pas été touchée.

Un `NextIntlClientProvider` IMBRIQUÉ, alimenté par la langue de la personne
observée (`users.locale` → `creators.locale` → `fr`, résolue serveur avant le
premier rendu), enveloppe la nav et le contenu. Le **bandeau reste dehors** : il
s'adresse à l'admin, pas à l'observée.

**Le sélecteur de langue de l'admin n'est pas rendu en observation**, donc il n'y
a rien à désactiver : il vit dans `Sidebar`, montée par `SidebarLayout`, lui-même
monté par le SEUL layout `/admin/[projectSlug]`. La route view-as est sa SŒUR et
ne l'hérite pas. Une assertion e2e garde ce fait — avec son contrôle positif, le
même locator devant trouver le sélecteur sur une page admin normale.

Deux conséquences qu'il fallait tenir :
- les hooks `useTranslations` doivent être appelés **sous** le provider, donc les
  deux navs sont devenues des composants — appelés dans le corps du shell, elles
  auraient continué à rendre la langue de l'admin ;
- la nav réutilise les clés `portal.sidebar.*` / `portal.bottomNav.*` du portail
  réel. C'est le MÊME élément d'interface : les deux navs ne peuvent pas diverger
  sans que la preview cesse de montrer ce qu'elle prétend.

### 11.4 Ce que la traversée a corrigé au passage

Trois défauts trouvés **pendant** l'exécution, pas prévus au plan :

1. **Le compteur d'avancement mentait.** `STRICT_JSX` ne voyait le texte JSX que
   si les deux chevrons étaient sur la même ligne — or Prettier passe à la ligne
   dès qu'une balise dépasse la largeur. 57 chaînes françaises vivaient dans des
   fichiers comptés comme « extraits », dont `ProfilScreen`, `ComptesScreen`,
   `GuideScreen` et `DashboardScreen`. Corrigé, avec trois garde-fous contre la
   capture de code.
2. **Le point-virgule français.** Le correctif ci-dessus rejetait toute capture
   contenant `;` — ce qui rendait invisible **toute phrase française qui en
   contient** (« un admin la relit ; une fois validée… »). Resserré à
   « point-virgule en fin de ligne ».
3. **`lib/` et `convex/` n'étaient pas scannés du tout**, alors que 69 chaînes du
   parcours créateur y vivent — sans aucun cliquet.

---

## 12. Tester toi-même un compte créateur en anglais

### 12.1 Le plus rapide — forcer la langue sans rien créer (30 s)

La langue est résolue **côté serveur** en 5 maillons ; le cookie est le 3ᵉ, et il
fonctionne **avant même d'être connecté**. C'est le levier le plus direct.

1. Ouvre l'app, **F12 → Console**, colle :

```javascript
document.cookie = "NEXT_LOCALE=en; path=/; max-age=31536000; samesite=lax"; location.reload();
```

2. Toute l'interface passe en anglais, y compris l'écran de login.
3. Pour revenir : rejoue la même ligne avec `NEXT_LOCALE=fr`.

⚠️ Si tu es **connecté**, `users.locale` (maillon 1) **gagne sur le cookie**.
Déconnecte-toi d'abord, ou utilise 12.2.

### 12.2 Depuis un compte créateur — le vrai chemin (nouveau en A10)

1. Connecte-toi en créateur → **Profil** (`/app/profil`).
2. Tout en bas, carte **« Langue de l'interface »** → clique **EN**.
3. La page se recharge en anglais. La préférence est écrite sur `users.locale`
   (elle te suit d'un appareil à l'autre) **et** dans le cookie.

C'est le trou que A10 a bouché : avant, ce sélecteur n'existait que dans la
sidebar **admin**.

### 12.3 Le parcours complet, dans l'ordre (~15 min)

Pour vérifier les 14 étapes du §10, **crée un vrai créateur anglophone** :

1. **Admin → Créateurs → Inviter un créateur.** Renseigne nom + e-mail, et
   surtout le champ **« Langue * » → English**.
2. **L'e-mail d'invitation part en anglais** (« Welcome to Jarvia 👋 »).
   → étape 1 ✓
3. **Clique le lien** de l'e-mail : `/join/<token>` s'affiche **en anglais**
   sans que tu aies rien à régler — la langue vient de la fiche, exposée par
   `getInvitationPreview`. → étapes 2-3 ✓
   *Pour tester l'erreur : saisis un mot de passe de 3 caractères →
   « Your password must be at least 8 characters. »*
4. **Active le compte**, tu arrives sur le **dashboard en anglais**. → étape 5 ✓
5. **Declare an account** (TikTok, `@quelquechose`). Recommence avec le **même
   handle** → « Account @… already exists on TikTok. » → étape 6 ✓
6. **Warm-up** : ouvre le guide (bouton **Warm-up guide**), déroule les
   7 sections. Coche le check du jour, puis re-clique → « Today's check is
   already done. » → étape 7 ✓
7. **Depuis l'admin**, assigne-lui une mission. Le créateur reçoit
   « New assignment for you 🎬 ». Ouvre la mission côté créateur. → étapes 8, 14 ✓
8. **Colle une URL YouTube** dans le champ TikTok → « The URL given for TikTok
   doesn't match that platform. » → étape 9 ✓
9. **`/app/paiements`** : les montants sont en `$1,234.56`, les dates en
   `MM/DD/YY`, le cycle en `Jul 5 – Aug 3, 2026`. → étape 11 ✓
10. **`/app/videos`** : vues en `12,345`, filtres en anglais. → étape 12 ✓

### 12.4 Le refus de quota clippeur (étape 10)

C'est le message le plus difficile à voir, et le seul qui traverse le serveur
avec ses paramètres. Il faut un compte de **clippeur** :

1. Invite un créateur avec **Rôle = Clippeur** et **Langue = English**.
2. Déclare un compte, fais-le **valider par l'admin**.
3. Publie jusqu'au quota du jour, puis tente une publication de plus.
4. Attendu : *« Quota reached for Monday, August 10 on @handle: 2 posts out of 2
   in cruising phase. »* — **la date ET la phase sont en anglais**, alors que le
   serveur les a produites en français. C'est le point de A2 : le serveur envoie
   l'instant brut et la clé de phase, le client les rend dans sa langue.

### 12.5 Ce qui doit RESTER en français (ce n'est pas un bug)

- **Tout `/admin/...`** — dashboard, analytics, validation, comptes, scripts.
- **Les notifications Telegram** — canal partagé, aucun destinataire à résoudre.
- **Les lignes de paie ANTÉRIEURES** au déploiement (§11.3, dette 1).
- **Le nom des langues** dans le sélecteur : « Français » / « English » sont des
  endonymes, ils ne se traduisent jamais.

### 12.6 Vérifier sans lancer l'app

```bash
node scripts/check-i18n.mjs
```

Sortie attendue : `146/146 fichiers extraits`, `~0 chaînes`, catalogues alignés
et anglais traduit. La commande échoue si une chaîne française réapparaît dans le
périmètre, si `en.json` recopie `fr.json` hors liste blanche, ou si une structure
ICU diverge entre les deux catalogues.
