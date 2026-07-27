# Audit — Dashboard analytics (PostHog × Jarvia × Whop)

> Investigation en **lecture seule** réalisée le 27/07/2026. Aucun fichier source
> modifié (ce rapport est le seul livrable). **Constat uniquement — aucune
> correction proposée.**
>
> Méthode : lecture directe des modules `convex/` + `lib/` + `components/analytics/`
> + `components/whop/`, croisée avec `TECH_DEBT.md` (TD-019, TD-020). Chemins et
> numéros de ligne vérifiés au moment de l'audit.
>
> ⚠️ `DIAGNOSTIC.md` (racine) date de juin 2026 (pré-multi-projets, 9 tables, sans
> auth) : **périmé** pour la surface analytics actuelle. Il n'a servi que pour le
> modèle `metricSnapshots` et le design system, tout le reste vient d'une relecture
> fraîche de `convex/schema.ts`.

---

## Fait transverse qui conditionne tout le reste

**Le contrat d'événements PostHog n'est pas (encore) émis par Snytch.** L'en-tête de
`convex/posthogSync.ts:35-38` avertit que `signup_completed`, `subscription_completed`,
`target_added`, `username_entered`, etc. **ne sont pas émis en production**. La mémoire
projet confirme `username_entered` / `target_added` sous-instrumentés.

Conséquence : **toutes les cartes alimentées par PostHog** (funnel, overview inscrits/
abonnés, time-to-value, paywall, sources, cohortes, prédicteurs, attribution
inscrits/abonnés) sont **vides / `null` en conditions réelles aujourd'hui**. Les
incohérences qui en dépendent sont donc **latentes** (elles se manifesteront dès que
les events couleront) et non observables sur les données actuelles. Les incohérences
qui reposent sur Jarvia (vues, coûts) et Whop (revenu) sont, elles, **actives
aujourd'hui**. Cette distinction latent/actif est reprise à la fin (§ Incohérences).

**Vocabulaire du modèle** (à garder en tête pour tout le rapport) :
- une **« vidéo »** (livrable rémunéré d'une créatrice) = 1 row `assignments` ;
- un **« post »** (parution sur une plateforme) = 1 row `publications` ;
- les **vues** vivent sur `publications` ; la **paie** et les cumuls s'agrègent au
  niveau `assignments` via `targets[].publicationId`. Aucun `creatorId`/`formatId`
  sur `publications` : la jointure passe par `assignments`.
- Règle **A6** : un module `convex/` ne peut pas importer `lib/` → toute logique
  partagée est **répliquée** `lib/` ↔ `convex/` et doit rester identique.

---

## 1. Modèle de données

Tout vit dans **Convex** sauf les utilisateurs finaux Snytch (dans **PostHog**, seuls
des agrégats sont cachés en Convex) et la source Whop (API, mise en cache Convex).

### Créatrices → table `creators` (`convex/schema.ts:657-719`)
`projectId` (:658), `userId?` (:660, absent tant que l'invitation n'est pas acceptée),
`name` (:661), `email` (:662), `phone?` (:663), `status` (`invited|onboarding|active|paused|churned`, :664-670),
`paymentMethod?` (`sepa|paypal|usdt|autre`, :671-678), `paymentDetails?` (:679),
`adminNotes?` (:680), `bonusPricingId?` (:685, grille de paliers perso),
`handlesToCreate?` (:692-698), `driveFolderId?` (:707, Snytch),
**`firstPostAt?`** (:715, **ancre du cycle de paie J+30**, figée au 1er post), `createdAt` (:716).
Index : `by_project`, `by_user` (:718-719).

### Posts → table `publications` (`convex/schema.ts:159-371`)
1 row = 1 post = 1 plateforme. Champs clés : `projectId`, `carouselId`, `hookId`,
snapshot dénormalisé du hook (`hookText`/`mecanique`/`niveau`/`angleTonal`, TD-002),
`mediaType` (`carousel|short|screenrecorder`, :183-189), `format`, `langue` (`FR|EN`, :230),
`plateforme` (`TikTok|Instagram|YouTube`, :234-238), `compte` (**handle string, pas de FK**, TD-001),
`datePubli`, `postUrl?`, `sourceId?`, **`isWarmup?`** (:292, cf §2), `scriptCombo?`,
et la **dénormalisation « latest known »** `vuesLatest` (:324) + `likesLatest`/`savesLatest`/
`subsGainedLatest`/`commentsLatest`/`latestSnapshotId`/`latestSnapshotAt`/`latestSnapshotDaysSince` (:324-337).
Index :359-371. Legacy `vuesJ1/J3/J7` **supprimés** (TD-016, migrés en snapshots).

### Vidéos → table `assignments` (`convex/schema.ts:859-1086`)
Le livrable rémunéré. `creatorId` (:861), `formatId?`/`scriptCombo?`,
`targets[]` (`{platform, accountId?, publishedUrl?, publishedAt?, publicationId?}`, :1000-1014),
`publicationId?` (legacy, :989), `status` (`todo…published→paid` + legacy, :924-936),
`pricingSnapshot?` (:1069-1078, = modèle pricing v2 vs legacy), `rateSnapshot` (:1054-1060),
`managedByAdmin?` (:916). Index `by_project`/`by_creator`/`by_format`/`by_project_status`/`by_creator_combo` (:1081-1086).

### Vues → dénormalisation sur `publications` + historique `metricSnapshots` (`convex/schema.ts:380-411`)
1 row `metricSnapshots` = 1 relevé daté pour 1 post : `projectId`, `publicationId`,
`capturedAt`, `daysSincePublication` (dénormalisé), `vues` (:388, requis), `likes` (requis),
`saves?`, `subsGained?`, `comments?`, `createdAt`, `source` (`manual|import|migration|youtube|tiktok|instagram`).
Index :407-411. Les fenêtres J+1→J+90 sont **résolues à la lecture** (matching par tolérance,
`lib/snapshot-matching.ts` ↔ `convex/snapshotMatching.ts`), jamais stockées. Alimentation :
saisie manuelle + crons Apify (`convex/apifySync.ts`) / YouTube (`convex/youtubeSync.ts`).

### Paiements créatrices → table `payments` (`convex/schema.ts:1192-1243`)
1 row = rému d'un créateur pour 1 `period` (string). `lineItems[]`
(`{assignmentId?, label, amount, kind: base|bonus|fixed|cpm|bonus_tier, platform?}`, :1202-1231),
`totalDue`, `status` (`accruing|scheduled|paid`), `scheduledDate?`, `paidAt?`.
Index `by_project_period`, `by_creator` (:1242-1243). **Montant calculé LIVE à la lecture**,
**gelé** en `lineItems` au paiement (`markCyclePaid`/`markPaymentPaid`, `convex/payments.ts:692-830`).
Re-fenêtré en **cycles J+30 glissants** par créatrice (`cyclePaymentsForCreator`, `convex/payments.ts:402-504`).
Tables liées : `pricings` (barèmes, :1125-1152), `bonusUnlocks` (paliers débloqués immuables, :1160-1183).

### Utilisateurs Snytch → **PostHog** (aucune table Convex d'end-users)
La table `users` (`convex/schema.ts:29-44`) ne contient que les comptes **d'authentification**
Jarvia (superadmin/admins + créatrices connectées via Convex Auth), **pas** les end-users Snytch.
Inscriptions/abonnés Snytch vivent dans PostHog ; seuls des **agrégats** sont cachés dans
`posthogCache` (`schema.ts:1299-1306` : `projectId`, `key`, `json`, `computedAt`, `error?`,
index `by_project_key`), écrit par le cron horaire `convex/posthogSync.ts`.
**Aucune table « funnel » dédiée** : chaque carte PostHog est une `key` sérialisée dans cette
table unique. Clés (`POSTHOG_CACHE_KEYS`, `posthogSync.ts:54-65`) : `overview`, `funnel:global`,
`funnel:source`, `funnel:language`, `timeToValue`, `paywall`, `sources`, `attributionHourly`,
`cohorts`, `predictors`.

### Paiements Whop → table `whopPayments` (`convex/schema.ts:1254-1289`) — détail §6.

---

## 2. Le flag warmup

### Définition, stockage
**`publications.isWarmup: v.optional(v.boolean())`** — `convex/schema.ts:292` (doc :279-292).
Flag **par POST**. `absent/undefined = false` = post payant normal. Un post warmup reste
publié et tracké (vues relevées et affichées) mais est **exclu de toute paie** (fixe/CPM/paliers).

⚠️ **Piège (TD-019) :** à ne PAS confondre avec le **warmup de COMPTE**
(`comptes.status "warmup"` / `warmupProtocol`, `schema.ts:428-468`). Les modules
`lib/warmup.ts` ↔ `convex/warmup.ts` (`isWarmupComplete`, `isAccountAvailable`) concernent
**exclusivement le warmup compte** et n'ont aucun rapport avec `publications.isWarmup`.

### Qui peut le modifier
**Seul writer de tout le code** : `setPublicationWarmup` (`convex/publications.ts:844-865`),
un **`adminMutation`** (admin uniquement, :844 ; créateur rejeté :836). Verrou serveur : si
le cycle du post est déjà payé (`locked`), `ConvexError` (:851-856). `patch(..., {isWarmup})` (:860)
puis `syncBonusForPublication` (:862, re-synchronise les paliers car le cumul payable change).
Lecture : `getPublicationWarmup` (:825-833). UI : toggle admin-only, grisé si `locked`
(`components/PublicationDetailDialog.tsx:164-183`). Aucun seed/migration n'écrit ce champ.

### Qui le LIT (et pourquoi)
1. `convex/pricing.ts:283` (`assignmentViewsAndMetrics`) → alimente `payableAssignmentViews` — **paie**.
2. `convex/pricing.ts:87,103` (`payableAssignmentViews`, `if (p.isWarmup) continue`) — **paie**.
3. `lib/pricing-engine.ts:155` (réplique testée) — **paie**.
4. `convex/trackerData.ts:171-174,245,311` (`matchesWarmupFilter`) — **filtre tracker** (défaut « exclude »).
5. `lib/tracker-data.ts:56-61` (réplique) — **filtre tracker**.
6. `convex/profitability.ts:161` (`if (p.isWarmup === true)`) — **dénominateur du RPM**.
7. `convex/analyticsHub.ts:239` (`isWarmupOnly: !views.hasPayablePost`) — **attribution** (départage/affichage).

### Existe-t-il déjà un autre flag par vidéo ?
**Par post (`publications`)** : `isWarmup` (le SEUL flag « (non-)rémunéré », en négatif),
`mediaType`/`format` (**format**), `langue` (**langue**, `FR|EN`), `angleTonal`, `mecanique`/`niveau`,
`isRepackaging`/`recordingDevice`, `accountModified`. **Par vidéo (`assignments`)** : `managedByAdmin`,
présence de `pricingSnapshot`, `status`.
**Constat : il existe un flag d'exclusion de paie (`isWarmup`), un enum langue, des enums format —
mais AUCUN booléen « promo »/« conversion », ni booléen « rémunéré » distinct de `isWarmup`.**
« Je paie ? » et « ça pouvait convertir ? » sont donc portés par le même flag.

### Pas de helper de filtre unifié
L'exclusion warmup est **ré-implémentée par agrégat**, via deux helpers purs DISTINCTS
(chacun répliqué lib↔convex) plus des inlines : `payableAssignmentViews` (somme item-level,
`lib/pricing-engine.ts:151-163` ↔ `convex/pricing.ts:96-111`), `matchesWarmupFilter` (prédicat
tri-état, `lib/tracker-data.ts:56-61` ↔ `convex/trackerData.ts:171-175`), inline
`if (p.isWarmup === true)` (`convex/profitability.ts:161`), dérivé `hasPayablePost`
(`convex/analyticsHub.ts:239`). **Aucun `excludeWarmup(list)` partagé** → chaque nouvel
agrégat doit re-décider, ce qui a produit TD-019.

---

## 3. Les vues — compteurs distincts

**11 compteurs distincts** recensés. Colonne « Warmup » = le compteur inclut ou exclut les
posts `isWarmup`.

| # | Compteur | Fichier:ligne | Ce qui est sommé | Warmup |
|---|---|---|---|---|
| 1 | `totalViews` (par vidéo) | `convex/pricing.ts:287` | Σ `pub.vuesLatest` de TOUS les posts de l'assignment | **INCLUS** |
| 2 | `payableViews` (par vidéo) | `convex/pricing.ts:288` via :96-111 ; `lib/pricing-engine.ts:151-163` | Σ vues des posts NON-warmup | **EXCLU** |
| 3 | `creatorCumulViews` (par créateur, à vie) | `convex/pricing.ts:307-328` | Σ `payableViews` des assignments `published/paid` à pricing v2 | **EXCLU** |
| 4 | `vuesTotal` (KPI dashboard) | `convex/dashboard.ts:53,66` | Σ `displayMetrics.vues` de toutes les pubs publiées, **sans filtre** | **INCLUS** |
| 5 | vues agrégées tracker | `convex/trackerData.ts:313` | `p.vuesLatest` filtré par `publishedAndMatches` | **EXCLU par défaut** |
| 6 | vues par compte (`vuesCumulees`/`views`) | `convex/comptes.ts:82,186` | Σ `p.vuesLatest` du handle, **sans filtre** | **INCLUS** |
| 7 | `monetizedViews` / `warmupViews` | `convex/profitability.ts:155-168` | split `vuesLatest` selon `isWarmup` | dénominateur RPM (toggle) |
| 8 | `totalViews`/`payableViews` (ligne attribution) | `convex/analyticsHub.ts:237-238` | via `assignmentViewsAndMetrics` | total **INCLUS** (affichage) / payable **EXCLU** (base) |
| 9 | vues créatrice « Mes vidéos » | `convex/creatorVideos.ts:164` (affiché) / :152-162 (gain) | `views = totalViews` / gain sur `payableViews` | affichage **INCLUS** / gain **EXCLU** |
| 10 | `latestViews` (préremplissage bonus admin) | `convex/assignments.ts:1542` | `= payableViews` | **EXCLU** |
| 11 | `cumulViews` (progression) | `convex/progression.ts:68` | `creatorCumulViews` | **EXCLU** |

### Qui alimente la paie
**`payableViews` (warmup EXCLU)**, source unique `assignmentViewsAndMetrics` (`convex/pricing.ts:262-290`) :
CPM (`assignmentCpm`, :75, dans `computeMonthlyPayout` :114 ↔ `lib/pricing-engine.ts:170`), paliers
(`creatorCumulViews` → `evaluateBonusTiers`/`syncBonusUnlocks`, :211,370), legacy `computeEarnings`
(`lib/earnings.ts:32` ↔ `convex/payments.ts:80`). **Toute la paie est warmup-exclue.**

### Qui alimente les taux de conversion / engagement
- **Attribution / conversion PostHog** : `getAttribution` (`convex/analyticsHub.ts:114`), départage et base
  = **`payableViews`** (warmup exclu, :247-256), `totalViews` affiché à côté.
- **RPM business** : `revenu net / (vues/1000)` avec toggle monétisées-seules vs toutes
  (`lib/profitability.ts:6-48`).
- **Engagement / save rate dashboard** : `engagementRate = (likes+comments)/vuesTotal` (`convex/dashboard.ts:90`),
  `saveRateAvg` (:85) — sur `vuesTotal` **warmup INCLUS**.

**Anomalie (§ Incohérences C) :** le traitement du warmup diverge entre agrégats de « performance ».
`dashboardKpis` (`dashboard.ts:53-90`) et vues par compte (`comptes.ts:82,186`) **incluent** le warmup ;
tracker (`trackerData.ts:245`), paie (`pricing.ts:288`) et rentabilité (`profitability.ts:161`) l'**excluent**.
C'est le cœur de TD-019.

---

## 4. Attribution (fenêtre 24 h)

### Implémentation
Constante `ATTRIBUTION_WINDOW_HOURS = 24` (`convex/analyticsHub.ts:39`). Cœur :
`windowCounts(hours, t)` (:86-107) — somme les seaux horaires du cache PostHog `attributionHourly`
dans `[from, to)` avec `to = t + 24 h` (:97). Association conversion→vidéo à
`convex/analyticsHub.ts:221` : `windowCounts(hours, publishedAt)` où
`publishedAt = assignmentPublishedAt(a)` (:180), posé sur la ligne en `attributedSignups`/
`attributedSubs` (:241-242). La série est un cache de **comptes horaires**
`{ ts, signups, subs }[]` (`posthogSync.ts:85-87`), HogQL
`countIf(event='signup_completed')` / `countIf(event='subscription_completed')` par heure sur 120 j
(`posthogSync.ts:271-279`).

### Déduplication : **NON**
Aucune dédup. Chaque assignment appelle `windowCounts` indépendamment dans la boucle
`for (const a of assignments)` (:179-245) ; deux vidéos publiées le même jour ont des fenêtres 24 h
qui se chevauchent et récupèrent **chacune la même somme** de conversions. Dédup structurellement
**impossible** avec ce cache : le payload ne porte que des **comptes** par heure, aucune identité
de personne — impossible de savoir qu'un inscrit a déjà été compté sur une autre vidéo. L'en-tête
l'assume : `convex/analyticsHub.ts:32-35` (« Plusieurs vidéos publiées le même jour se partagent les
mêmes inscriptions […] ORDRES DE GRANDEUR »).

### Nombre de lignes / bornage : **NON borné au nombre réel de clients**
1 ligne par assignment porteur de coût (`filter(isCostBearing)`, statut `published`/`paid`, :43-45,124).
`windowCounts` n'a ni plafond ni ensemble global de conversions : chaque ligne peut recompter les
mêmes conversions. **Le code qui transforme N conversions réelles en un multiple est l'agrégation
par SOMME** :
- « Coût par abonné, par créatrice » : `sumNullable(list, r => r.attributedSubs)` — `AttributionTab.tsx:88`.
- « Format qui convertit » : idem — `AttributionTab.tsx:114`.
- « Économie unitaire » (CAC) : `rows.reduce((s, r) => s + (r.attributedSubs ?? 0), 0)` — `RevenueTab.tsx:48-51`.
Exemple : 15 vidéos dans des fenêtres 24 h chevauchantes couvrant les 7 mêmes conversions ⇒ 15 × 7 = 105
abonnés « attribués » sommés. **Aucune contrainte au total réel Whop.**

> ⚠️ **État actuel** : les colonnes `attributedSignups`/`attributedSubs` sont **`null`** tant que le
> cache `attributionHourly` est vide (events non émis, cf. fait transverse). L'inflation décrite est
> donc **latente** : elle apparaîtra dès que les events couleront. Aujourd'hui seules Vues et Coût de
> l'onglet Attribution sont peuplés.

### Cartes consommatrices de l'attribution
« Vidéos → abonnés » (`AttributionTab.tsx:194-330`, dont **Coût/abonné** par ligne
`costPerAcquisition(cost, attributedSubs)`), « Coût par abonné, par créatrice » (:334-378),
« Format qui convertit » (:381-421), « Économie unitaire » CAC/LTV-CAC/payback (`RevenueTab.tsx:203-241`),
export CSV (`AttributionTab.tsx:126-163`).

---

## 5. Funnel

### Événements PostHog consommés (chaînes exactes, `convex/posthogSync.ts`)
- **Funnel** (`FUNNEL_COLUMNS`, :132-139) : `$pageview`, `username_entered`, `signup_completed`,
  `target_added`, `first_alert_received`, `paywall_viewed`, `subscription_completed`.
- **Overview** (:148-156) : `$pageview`, `signup_completed`, `subscription_completed`.
- **Time-to-value** (:196-226) : `signup_completed`, `target_added`, `first_alert_received`, `subscription_completed`.
- **Paywall** (:233-248) : `paywall_viewed`, `subscription_completed` (+ `properties.variant`).
- **Sources** (:251-264) : `person.properties.source` (+ signup/subscription).
- **Funnel langue** : `person.properties.language`.
- **Cohortes** (:286-315) : `squad_created`, `squad_joined`, `target_added`, `signup_completed`.
- **Prédicteurs** (:322-348) : `subscription_completed`, `squad_created`, `squad_joined`,
  `first_alert_received`, `target_added`, `push_enabled`, `referral_link_shared`, `signup_completed`.
- **Attribution horaire** (:271-279) : `signup_completed`, `subscription_completed`.

### Définition de chaque étape & fenêtre
Le funnel = **7 comptages de personnes distinctes** (`uniqIf(person_id, event=…)`, :132-139), PAS des
occurrences. Fenêtre = **90 jours glissants** (`WINDOW_DAYS = 90`, funnelGlobal :166, source :171,
langue :179). Aucune borne calendaire, **aucun filtre de période UI** ne s'y applique.

### Pourcentages : contre la PREMIÈRE **et** la PRÉCÉDENTE
`buildFunnel` (`lib/analytics-hub.ts:63-79`) : `shareOfStart = round1(count / steps[0].count × 100)`
(**contre l'étape 1**, :70) ; `dropPct = round1(dropped / prev × 100)` avec
`dropped = Math.max(0, prev − count)` (**contre l'étape précédente**, :67,72-75). Rendu : la barre +
le % principal affichent `shareOfStart` (`HubCharts.tsx:51,61`) ; la perte « −X % » affiche `dropPct`
(:65-68).

### « Paywall vu » > inscrits (161 > 155) : pourquoi
`paywall_viewed = uniqIf(person_id, event='paywall_viewed')` (:138) est un comptage **indépendant** de
personnes distinctes, **pas un sous-ensemble** de `signup_completed`. Une personne peut voir l'offre
sans (ou avant) s'inscrire ⇒ l'ensemble « paywall » peut dépasser « inscription ». Le funnel n'est
**pas séquentiel** (`posthogSync.ts:158-162` : « une étape peut dépasser la précédente si le produit
permet de la court-circuiter »). Le dépassement n'est pas maquillé : `dropped = Math.max(0, …)` rend 0
quand `count > prev`, et `buildFunnel` ne re-trie jamais (test `lib/analytics-hub.test.ts:68-76`). NB :
`shareOfStart` d'une étape « en excès » **peut dépasser 100 %** ; la largeur de barre est clampée
`Math.min(100, …)` (`HubCharts.tsx:61`) mais **le % affiché ne l'est pas**.

### Séquentiel ou indépendant : **INDÉPENDANT** (« a atteint cet event »)
Chaque colonne est un `uniqIf` autonome, aucun `windowFunnel`/étape ordonnée. `buildFunnel` opère sur
des counts déjà donnés sans chaînage.

---

## 6. Whop

### Voie d'arrivée : **PULL REST API** (aucun webhook, CSV, ni import manuel)
1. **Cron horaire** `convex/crons.ts:60-65` → `internal.whopSync.runHourlySync`.
2. **Action** `convex/whopSync.ts:227-287` (`runHourlySync`) : projets configurés via `listWhopProjects`,
   clé lue dans `process.env[proj.apiKeyEnvVar]` (:245, projet sauté si absente), `fetchWhopPayments`,
   upsert par lots de 100.
3. **Réseau** `convex/whopApi.ts:164-224` : `GET https://api.whop.com/api/v1/payments`, auth `Bearer`,
   pagination curseur, page 100, borne `MAX_PAGES = 50` (= 5000 paiements/sync), 429 → arrêt propre.
4. **Upsert** `convex/whopSync.ts:147-207` (`internalMutation`).

Déclenchement **manuel admin** (bouton « Synchroniser », `WhopRevenueCard.tsx:86-98`) →
`requestWhopSync` (`adminMutation`, :294-306) planifie un sync scopé au projet. Config projet↔Whop
posée **hors-app** (`setWhopConfigBySlug`, `internalMutation` via `npx convex run`, :71-108).

### Champs capturés PAR PAIEMENT — `whopPayments` (`convex/schema.ts:1254-1289`)
`projectId` (:1255), `whopId` (:1257, **clé de dédup**), `status`
(`paid|refunded|failed|pending|disputed|other`, :1260-1267), `rawStatus` (:1268, valeur API brute),
`currency` (:1269), `grossAmount` (:1274), `feeAmount` (:1275, frais Whop), `netAmount` (:1276),
`refundedAmount` (:1277), `paidAt` (:1279), `planId?` (:1282), `membershipId?` (:1283),
`importedAt` (:1284), `updatedAt` (:1285). Index `by_project`, `by_whopId`, `by_project_paidAt` (:1287-1289).

### PAR MEMBERSHIP : rien de dédié
**Aucune table `memberships` Whop** (la table `memberships` `schema.ts:123` est l'appartenance
user↔projet Jarvia, sans rapport). Seul lien = le scalaire optionnel `whopPayments.membershipId`.
L'éco par membership est calculée à la volée (`convex/analyticsHub.ts:382-421`, Map `perMembership`).

### Le PLAN est-il stocké ? **Identifiant seul**
Seul `planId` (string, extrait de `plan.id`, `whopApi.ts:112`). **Aucune cadence, aucun prix de plan,
aucune devise de plan.** Confirmé par commentaire `analyticsHub.ts:302` (« aucun intervalle de plan »).

### Table plan_id → cadence + prix : **NON**
Aucune. Un plan n'est qu'un identifiant opaque. **Conséquence directe : le churn / renouvellement par
échéance (hebdo/mensuel) N'EST PAS dérivable** — les cartes de churn sont vides en dur
(`churnAvailable = false`, `analyticsHub.ts:305,431`).

### Réussi vs échoué
1. Normalisation `normalizeWhopStatus` (`lib/whop-revenue.ts:33-74` ↔ `convex/whopRevenue.ts:22-63`),
   appliquée à l'import sur `substatus ?? status` (`whopApi.ts:93-94`).
2. Filtre d'encaissement `isCollected(status) = status === "paid" || status === "disputed"`
   (`whop-revenue.ts:87-91`). Seuls les encaissés entrent dans brut/frais/net. `disputed` est compté
   (argent encore sur le solde).

Statuts source mappés (`whop-revenue.ts:35-73`) : → `paid` (`succeeded`, `paid`, `partially_refunded`,
`dispute_won`, …) ; → `refunded` (`refunded`, `auto_refunded`, `dispute_lost`, …) ; → `failed`
(`failed`, `past_due`, `canceled/cancelled`, `price_too_low`, `uncollectible`) ; → `pending`
(`pending`, `incomplete`, `drafted/draft`, `open`) ; → `disputed` (`dispute_warning*`, `resolution_*`,
`open_dispute`, …) ; → `other` (défaut).

### Dédup (`whopId`) & net
Dédup `convex/whopSync.ts:161-204` : lookup `by_whopId`. Existant + même `projectId` → `patch` ;
existant + **autre** `projectId` → **skip** (anti-mélange) ; sinon `insert`. Idempotent.
Net (`whopApi.ts:96-108`) : `amount_after_fees` privilégié (`net = amount_after_fees`,
`gross = grossRaw ?? net + fee`), sinon fallback `net = gross − fee`. Au pilotage,
`whopNetContribution = round2(max(0, netAmount − max(0, refundedAmount)))` si encaissé (`whop-revenue.ts:100-104`).

---

## 7. Devises

### Devises présentes
- **Whop** : champ API `currency`, **défaut de repli `"usd"`**, minusculé
  (`convex/whopApi.ts:110` : `(getStr(r.currency) ?? "usd").toLowerCase()`). Stocké par paiement (:1269)
  et propagé dans les résumés (`profitability.ts:189`, `analyticsHub.ts:425`).
  ⚠️ **Cette devise n'est JAMAIS lue par l'affichage** — grep `.currency` sur `components/` = **zéro**.
- **Coût créateurs / pricing** : domaine nominalement **EUR** (`MAX_PAY_PER_VIDEO_EUR = 150`,
  `lib/pricing-engine.ts:79` ↔ `convex/pricing.ts:34`), **mais** libellé UI en `$`
  (`convex/pricing.ts:664` « un palier cash exige un montant **$** »), et le formateur atteste la
  bascule historique depuis « l'ancien rendu euro » (`lib/format-rate.ts:15-18`). Aucun champ devise
  sur les montants pricing.

### Un unique formateur codé en dur USD
`lib/format-rate.ts:11-22` `formatMoney` :
```
new Intl.NumberFormat("fr-FR", { style:"currency", currency:"USD", currencyDisplay:"narrowSymbol", … })
```
**Aucune conversion** : la valeur numérique est préservée, seul le symbole `$` est apposé. C'est le
**seul** rendu monétaire de l'app (~15 fichiers : Paiements, Pricings, Validation, Progression, portail
créateur, **ProfitabilityCard**, **WhopRevenueCard**, hub Analytics), toujours en `$`.

### Additions / divisions entre devises différentes — **sans conversion**
Le revenu (devise Whop, ignorée) et le coût (pricing) sont combinés directement :
1. **Marge** `computeMargin(revenueNet, creatorCost) = round2(revenueNet − creatorCost)`
   (`lib/profitability.ts:19-21`) → **revenu Whop − coût pricing**.
2. **LTV / CAC** `ltvCacRatio = round2(ltv / cac)` (`lib/analytics-hub.ts:291`) → **LTV Whop / CAC pricing**.
3. **Payback** `paybackMonths = round2(cac / monthlyArpu)` (:293-294) → **CAC pricing / ARPU Whop**.
4. Affichage : marge, revenu, coût, RPM, CAC, LTV tous rendus en `$` par `formatMoney`
   (`ProfitabilityCard.tsx:101,111,117,168-179` ; `RevenueTab.tsx:213-241`).

### Taux de change : **NONE**
Grep exhaustif `taux|rate|fx|exchange|EUR|USD|currency|devise|conversion` sur `convex/`+`lib/` : aucun
multiplicateur de change (occurrences trouvées = `tauxCPM`, `rateLimit`, taux de conversion funnel — hors
sujet). `MAX_PAY_PER_VIDEO_EUR` est un plafond, pas un taux.

### Bug connu « € affiché en $ »
**Confirmé — manifestation par SYMBOLE, valeur inchangée.** `formatMoney` impose `$` à tout montant,
quelle que soit sa devise réelle. Un paiement Whop de `76,33` (devise du compte, potentiellement EUR)
s'affiche « 76,33 $ ».
⚠️ **En revanche, « 76,33 € rendu comme 75,10 $ » (valeur MODIFIÉE) n'est PAS reproductible** : aucun
taux n'existe, aucune valeur n'est jamais recalculée. Hypothèse à lever avec vous : soit c'est un bug de
symbole pur (la valeur ne change pas), soit les deux nombres sont **deux champs différents** (ex. brut
`76,33` vs net `75,10`) rendus tous deux en `$`. Le code ne peut pas produire `75,10` à partir de `76,33`.

---

## 8. Comptes internes / test

**Mécanisme d'exclusion des comptes test/équipe : INEXISTANT sur le chemin analytics.**

Côté **PostHog** : les `WHERE` HogQL ne filtrent QUE `timestamp` + `event` (funnel :154,166 ;
TTV :223 ; paywall :241-242 ; attribution :276 ; cohortes :309 ; prédicteurs :345). **Aucun**
`person.properties.is_internal`, aucune liste blanche/noire, aucun filtre de domaine email. Tout membre
d'équipe déclenchant `$pageview`/`signup_completed`/… est compté partout.

Côté **Jarvia** (`getAttribution`) : seul filtre = `isCostBearing` (statut, `analyticsHub.ts:43-45,124`).
Les créatrices `[E2E_TEST]`/démo ne sont **pas** exclues (`creatorMap`/`formatMap` sans garde de test).

Les prédicats de test existent mais **hors chemin analytics** : `isTest` (nom `[E2E_TEST]` / email
`e2e-creator`) uniquement dans des mutations e2e de **purge** (`creators.ts:994`, `payments.ts:918-922`,
`assignments.ts:2556`, `metricSnapshots.ts:321`, `inspirations.ts:265`) ; `isNonNotifiableRecipient`
(`emailApi.ts:71-80`) = garde-fou d'**envoi d'email**. Aucune n'est appelée par une query du hub.
**Conclusion : les comptes démo/e2e/équipe polluent potentiellement tous les agrégats.**

---

## 9. Période & ancrage

### Filtre de période : **uniquement sur les KPI de l'onglet Vue d'ensemble**
`OverviewTab.tsx` — options `PERIODS` = J7/J30/J90 (:52-56, défaut J30), état `period` → `days` (:104-108),
consommé **uniquement** par le `useMemo` `kpis` (:115-140, deps `[daily, days]`). Les onglets Attribution
et Revenus n'ont **aucun** sélecteur de période.

### Ancrage par métrique
| Métrique | Date d'ancrage | Réf. |
|---|---|---|
| KPI Visiteurs/Inscriptions/Abonnements | date de l'**event** (`toStartOfDay(timestamp)`) | `posthogSync.ts:149-156` ; `OverviewTab.tsx:116-120` |
| MRR / Revenu net par période | date de **paiement** (`periodOf(p.paidAt)`) | `analyticsHub.ts:346` |
| Attribution (vues, coût, inscrits/abonnés) | date de **publication** ; conversions 24 h après | `analyticsHub.ts:180-181,221` |
| Funnel (global/source/langue) | date de l'**event**, 90 j glissants | `posthogSync.ts:163-182` |
| Time-to-value | dates d'**events** (jalons), 90 j | `posthogSync.ts:196-226` |
| Cohortes | **semaine d'inscription** (`toStartOfWeek`) | `posthogSync.ts:286-315` |
| LTV / plans | date de **paiement** | `analyticsHub.ts:386-397` |

### Le mélange d'ancres est **IMPLICITE**, non documenté globalement
Seuls deux points sont commentés localement (indépendance du MRR au sélecteur, `OverviewTab.tsx:142-143` ;
approximation 24 h, `AttributionTab.tsx:177-183`). **Aucun commentaire ne dit que « la période ne filtre
que les KPI ».** Confirmé par le code : `days` n'affecte que les tuiles KPI ; funnel, TTV, paywall,
sources lisent le cache brut 90 j ; Attribution et Revenus ignorent totalement la période. Le libellé de
période affiché à côté des KPI **ne s'étend donc pas** aux autres cartes.

### Gotcha `minIf` epoch-0 (TTV) : **présent et correctement géré**
`posthogSync.ts:188-195` explique que `minIf` rend l'epoch 0 (et non `null`) ; correctif : chaque delta
est gaté sur la présence des deux jalons via `has_*` (`if(has_signup>0 AND has_target>0, dateDiff(...), NULL)`,
:209-211), + garde `n>0 ? … : null` au shaping (:613-617).

---

## 10. Carte par carte

Page `app/admin/[projectSlug]/analytics/page.tsx` : shell client (3 queries — `posthogSync.getProductAnalytics`,
`analyticsHub.getAttribution`, `analyticsHub.getRevenueBreakdown`) + 4 onglets. Convention `null → "—"`
(`dash`, `HubPrimitives.tsx:26-31`), jamais 0. Seuil `MIN_SAMPLE_SIZE = 30` (`lib/analytics-hub.ts:21`).

### Onglet « Vue d'ensemble » (`OverviewTab.tsx`)
| Carte | Fichier:ligne | Source | Formule |
|---|---|---|---|
| KPI **Visiteurs** | :216-222 | `overview.daily[].visitors` = `uniqIf(person_id,'$pageview')`/jour (`posthogSync.ts:150`) | `Σ visitors` sur `[anchor−days·J, anchor)`, `anchor = daily[last].ts+J` ; `delta` vs fenêtre précédente |
| KPI **Inscriptions** | :223-228 | `overview.daily[].signups` = `countIf('signup_completed')` (:151) | `Σ signups` ; `delta` vs précédente |
| KPI **Abonnements** | :229-234 | `overview.daily[].subs` = **`countIf('subscription_completed')`** (:152) | `Σ subs` ; `delta` vs précédente |
| KPI **MRR** | :235-245 | `revenue.periods[0].net` = `summarizeWhopRevenue(mois courant).net` | `value = periods[0].net` ; `delta` vs `periods[1].net` |
| **Funnel** | :252-296 ; `HubCharts.tsx:31-79` | `funnels.global\|source\|language`, 7× `uniqIf(person_id, event)` (:132-139) | `buildFunnel` : `shareOfStart = count/steps[0].count` ; `dropPct = max(0,prev−count)/prev` ; `conclusive = count≥30` |
| **Time-to-value** (3 tuiles) | :299-366 | `timeToValue.steps[]` `{medianMs,p90Ms,n}` (`quantileIf`, gate `has_*`) | `delayStatus(medianMs, budget)` ; **budgets = hypothèses UI en dur** (10 min / 1 j / 7 j, :46-50) ; `hasLongTail` si p90>median×4 |
| **Conversion par paywall** | :370-390 | `paywall.rows[]` `{n,converted}` = vus-paywall / `countIf(subscribed>0)` (:233-248) | `rate = converted/n` (abonnés / vus-paywall) |
| **Sources → abonnés** | :392-414 | `sources.rows[]` `{n=signups, converted=subs}` par `person.properties.source` | `rate = converted/n` ; « vs moyenne » = `conversionLift(rate, overallRate)` |

### Onglet « Attribution » (`AttributionTab.tsx`) — base de vues = `payableViews` (warmup exclu)
| Carte | Fichier:ligne | Source | Formule |
|---|---|---|---|
| **Vidéos → abonnés** | :194-330 | `getAttribution.rows[]` | Vues = `payableViews` ; Inscrits/Abonnés = `windowCounts` 24 h (`null` hors cache) ; Coût = `round2(fixePerVideo+cpm)` de `computeLivePricingBreakdown` ; Coût/abonné = `costPerAcquisition(cost, subs)` |
| **Coût par abonné, par créatrice** | :334-378 | `rows[]` groupées par `creatorId` | `views=ΣpayableViews` ; `cost=round2(Σcost)` ; `subs=ΣattributedSubs` ; `costPerSub=costPerAcquisition` |
| **Format qui convertit** | :381-421 | `rows[]` groupées par `format·langue` | `subs/1000 vues = per1kViews(subs, views)` |

### Onglet « Revenus » (`RevenueTab.tsx`) — `getRevenueBreakdown`, gaté `revenue.configured`
| Carte | Fichier:ligne | Source | Formule |
|---|---|---|---|
| **Revenu net par période** | :78-139 | `periods[]` `{net,newNet,returningNet,members}` par `periodOf(paidAt)` | `net=summarizeWhopRevenue.net` ; `newNet=Σ net` où `firstSeen(membershipId)===paidAt` ; `members` = memberships distincts net>0 |
| **Churn par plan** | :142-159 | — | **Toujours vide** : `churnAvailable=false` en dur (`analyticsHub.ts:305,431`). Attend `subscription_cancelled` |
| **LTV réalisée par offre** | :162-201 | `plans[]` `{members,netTotal,ltv}` par `planId` | `netTotal=round2(Σ net/membership)` ; `ltv=round2(netTotal/members)` |
| **Éco unitaire — CAC** | :211-219 | `creatorCost=Σ rows[].cost` ; `attributedSubs=Σ rows[].attributedSubs` | `CAC = round2(creatorCost / attributedSubs)` |
| … **LTV réalisée** | :220-224 | `revenue.ltv` | `round2(totalNet / totalMembers)` |
| … **LTV / CAC** | :225-232 | dérivé | `round2(ltv / cac)` ⚠️ (cross-devise, §7) |
| … **Délai de récupération** | :233-241 | `revenue.monthlyArpu` | `round2(cac / monthlyArpu)` ⚠️ (cross-devise, §7) |

### Onglet « Cohortes » (`CohortsTab.tsx`)
| Carte | Fichier:ligne | Source | Formule |
|---|---|---|---|
| **Rétention par cohorte** (heatmap) | :121-158 ; `HubCharts.tsx:163-242` | `cohorts.segments[].cohorts[]` `{size, retainedByWeek}` (`toStartOfWeek`, 9 sem.) | `pct = retained/size` ; semaines non atteintes = cellules ABSENTES (jamais 0) |
| **Prédicteurs d'abonnement** | :161-190 | `predictors.behaviors[]` (`squad`, `alerts_3`, `targets_2`, `push_enabled`, `referral_shared`) | `rate = converted/n` ; « vs moyenne » = `conversionLift(rate, baseline)` |

### Cartes Paiements admin (`app/admin/[projectSlug]/paiements/page.tsx`)
| Carte | Fichier:ligne | Source | Formule |
|---|---|---|---|
| **Revenu Whop** | `WhopRevenueCard.tsx:40-178` | `whopSync.getWhopRevenue` → `months[].summary` du mois courant | `net=Σ whopNetContribution` ; `gross/fees/refunded` ; encaissé = `paid\|disputed`. Rendu **`$`** |
| **Rentabilité — Marge** | `ProfitabilityCard.tsx:92-106` | `profitability.getProjectProfitability.total` | `margin = round2(revenueNet − creatorCost)` ⚠️ **cross-devise** (§7). Invariante au toggle |
| … Revenu / Coût | :109-119 | `total.revenueNet` (Whop) / `total.creatorCost` (moteur de paie) | Constants. Rendus **`$`** |
| … RPM business / dilué | :120-127 | `total` + toggle `includeWarmup` (défaut false) | `rpm = round2(revenueNet / (views/1000))` ; `views` = monétisées (sans warmup) ou +warmup |
| … Tableau mensuel | :141-193 | `data.months[]` | `computeProfitability(m, includeWarmup)` par mois |

**Page paiements créatrice** (`app/app/paiements/page.tsx` → `PaiementsScreen.tsx`) : `getMyPayments`,
gains propres de la créatrice. **Aucune carte revenus/Whop/rentabilité** (strictement admin).

---

## 11. Technique

**Stack** : Next.js `16.2.4` (App Router, `"use client"`), React `19.2.4`, **Convex `1.37`**, TypeScript `5`,
Tailwind v4, UI `@base-ui/react` + `shadcn` + `lucide-react`. `recharts 3.8.1` présent mais **le hub ne
l'utilise pas** (Sparkline SVG inline, `HubPrimitives.tsx:184` ; recharts seulement dans
`components/analytics/MetricChart.tsx` hors hub). **Package manager : pnpm.**

**Commandes** (`package.json:5-14`) : dev `next dev` · build `next build` · lint `eslint` ·
**test unitaire `vitest run`** (`test:unit`) · **e2e `playwright test`** (`test:e2e` + `:ui`/`:debug`).

### Tests sur les calculs analytics
**Couverture pure/client (existe)** :
- `lib/analytics-hub.test.ts` — cœur des maths du hub : `buildFunnel`, `computeDelta`, `computeConversion`,
  `conversionLift`, `overallRate`, `delayStatus`/`hasLongTail`, `buildRetentionGrid`, `costPerAcquisition`,
  `per1kViews`, `computeUnitEconomics` (CAC / LTV-CAC / payback).
- `lib/profitability.test.ts` — `computeMargin`, `computeRpm`, `viewsForToggle`, `computeProfitability`
  (vérifie que le toggle warmup change vues/RPM mais **pas** revenu/coût/marge).
- `lib/whop-revenue.test.ts` — `normalizeWhopStatus`, `whopNetContribution`, `summarizeWhopRevenue`.
- `lib/pricing-engine.test.ts` — `computeMonthlyPayout`, plafond 150, `tiersOf`, `evaluateBonusTiers`,
  **`payableAssignmentViews` (exclusion warmup)**.
- `lib/warmup.test.ts` (warmup COMPTE), `lib/earnings.test.ts` (modèle legacy).

**LACUNE — aucun test serveur Convex** (`find convex -name "*.test.ts"` = vide) :
- `convex/analyticsHub.ts` : **`windowCounts` / toute la logique d'attribution 24 h** (:86-107), assemblage
  du coût par vidéo (:204-219), split new/returning + LTV/ARPU (`getRevenueBreakdown` :416-430) — **non testés**.
- `convex/posthogSync.ts` : requêtes HogQL (funnel, garde `has_*`/`minIf`, cohortes, prédicteurs) — non
  testées **et** non vérifiées en prod (events non émis, :35-38).
- `convex/profitability.ts` / `convex/whopSync.ts` : agrégation mensuelle non testée au niveau handler.

**Synthèse** : la décoration du funnel, les ratios d'attribution et le net/devise Whop sont couverts côté
`lib/`. En revanche **l'attribution serveur réelle, l'agrégation HogQL du funnel et le revenu par période
(new/returning, LTV, ARPU) n'ont aucune couverture** — et les events sous-jacents ne sont pas encore émis.

---

## Incohérences constatées

Écarts trouvés entre deux calculs censés produire le même nombre, ou entre une valeur affichée et sa
réalité. **A = actif aujourd'hui** (données Jarvia/Whop présentes) ; **L = latent** (n'apparaît qu'une
fois les events PostHog émis).

### I-1 — « Abonnement » compté de **quatre façons** sur le même écran **[A + L]**
Quatre nombres d'« abonnés » coexistent, chacun avec une définition/source/fenêtre différente :
1. **KPI « Abonnements »** (`OverviewTab.tsx:229-234`) = `Σ countIf('subscription_completed')` — **occurrences**,
   fenêtrées par le sélecteur de période (J30 défaut). `posthogSync.ts:152`. **[L]**
2. **Étape funnel « subscription_completed »** = `uniqIf(person_id, 'subscription_completed')` — **personnes
   distinctes**, 90 j. `posthogSync.ts:139`. **[L]**
3. **« Abonnés attribués »** (Attribution, sommé) = Σ des comptes 24 h par vidéo — **double-comptés** entre
   vidéos du même jour (I-2). `AttributionTab.tsx:88` / `RevenueTab.tsx:48`. **[L]**
4. **Clients Whop** (Revenus) = `membershipId` distincts encaissés — **la seule vérité terrain** (7).
   `analyticsHub.ts:400-417`. **[A]**

`countIf` (occurrences) vs `uniqIf` (personnes) pour le **même event** garantit déjà que (1) ≠ (2). (3) est
gonflé. Seul (4) est fiable. Même divergence `countIf`/`uniqIf` sur **« Inscriptions »** (KPI `countIf` :151
vs funnel `uniqIf` :135).

### I-2 — Attribution non dédupliquée → abonnés gonflés, CAC sous-estimé **[L]**
`windowCounts` somme les mêmes conversions sur chaque vidéo dont la fenêtre 24 h les couvre, sans dédup ni
plafond (`analyticsHub.ts:86-107,179-245` ; dédup impossible car le cache ne porte que des comptes horaires,
pas d'identité). N vidéos chevauchantes ⇒ N × (conversions réelles). Le CAC hérite de l'inflation :
`CAC = creatorCost / Σ attributedSubs` (`RevenueTab.tsx:48` + `analytics-hub.ts:285-297`) → **dénominateur
gonflé ⇒ CAC sous-estimé du même facteur** (7 clients réels affichés comme ~105 attribués ⇒ CAC ÷ ~15). La
somme des abonnés attribués **n'est jamais contrainte** au total Whop. *(Latent : `attributedSubs` est `null`
tant que les events ne coulent pas.)*

### I-3 — Arithmétique inter-devises sans conversion **[A pour la marge, L pour LTV/CAC]**
`formatMoney` code en dur `currency:"USD"` (`format-rate.ts:14`) : **tout montant s'affiche en `$`**, quelle
que soit sa devise réelle, sans conversion. La devise Whop est capturée (`whopPayments.currency`) mais
**jetée à l'affichage** (grep `.currency` dans `components/` = 0). Trois calculs mélangent revenu Whop et
coût pricing sans taux (aucun taux n'existe dans le repo) :
- **Marge** `revenueNet − creatorCost` (`profitability.ts:19`) **[A]** — visible sur ProfitabilityCard aujourd'hui.
- **LTV/CAC** `ltv / cac` (`analytics-hub.ts:291`) **[L]**.
- **Payback** `cac / monthlyArpu` (`analytics-hub.ts:293`) **[L]**.
> Nuance : le cas « 76,33 € → **75,10 $** » (valeur **modifiée**) **n'est pas reproductible** — sans taux, aucune
> valeur n'est recalculée. Le défaut réel est le **symbole `$`** sur une valeur dont la vraie devise est
> ignorée. Si `75,10` et `76,33` diffèrent, ce sont **deux champs distincts** (brut vs net) tous deux rendus `$`.
> **À lever avec vous.**

### I-4 — « Vues » : warmup inclus ici, exclu là **[A]**
Deux mesures de « vues » divergent selon l'agrégat : `dashboardKpis` (`dashboard.ts:53-90`) et vues par
compte (`comptes.ts:82,186`) **incluent** le warmup (et donc `engagementRate`/`saveRate` aussi) ; tracker
(`trackerData.ts:245`), paie (`pricing.ts:288`) et rentabilité (`profitability.ts:161`) l'**excluent**. Sur
`engagementRate`/`ratioSubsViews`, le warmup est au **dénominateur** ⇒ ratios **sous-estimés** (contre-intuitif).
C'est TD-019 : **~20 agrégats** somment les métriques sans lire `isWarmup`, faussant les chiffres **dans les
deux sens**. Aucun helper de filtre unifié n'existe (§2).

### I-5 — Funnel : « Paywall vu » > inscrits (161 > 155) **[L]**
Étapes = comptages **indépendants** de personnes distinctes, pas un funnel séquentiel (`posthogSync.ts:158-162`).
`paywall_viewed` n'est pas un sous-ensemble de `signup_completed` ⇒ peut le dépasser. `shareOfStart` d'une
étape en excès **peut afficher > 100 %** (la barre est clampée `Math.min(100,…)`, `HubCharts.tsx:61`, mais
**pas le %**). Les deltas de perte (`dropPct`) supposent un ordre décroissant qui n'est pas garanti par le
produit.

### I-6 — Aucune exclusion des comptes internes/test **[A pour Jarvia, L pour PostHog]**
Aucune requête analytique n'exclut les comptes équipe/test : HogQL ne filtre que `timestamp`+`event` (§8),
et `getAttribution` ne filtre que `isCostBearing`. Les prédicats `isTest` existent mais **seulement dans les
purges e2e** et l'envoi d'email. ⇒ 3 comptes internes polluent chaque étape du funnel et l'attribution une
fois les events émis ; côté Jarvia, les créatrices `[E2E_TEST]`/démo entrent déjà dans l'attribution.

### I-7 — La période ne filtre que les KPI **[A]**
Le sélecteur J7/J30/J90 (`OverviewTab.tsx`) n'affecte **que** les 4 tuiles KPI. Funnel, TTV, paywall, sources
(90 j fixes), Attribution et Revenus **ignorent** la période. Le libellé de période à côté des KPI **suggère
faussement** qu'il gouverne toute la page. Mélange d'ancres (event / paiement / publication) **implicite et
non documenté** globalement (§9).

### I-8 — Métriques structurellement non calculables, mais cartes présentes **[A]**
- **Churn / renouvellement** : `churnAvailable = false` en dur (`analyticsHub.ts:305,431`) car aucun plan
  (cadence/prix/intervalle) n'est stocké (§6) et aucun event d'annulation n'existe. La carte « Churn par
  plan » est **toujours vide**.
- **Coût par client fiable / conversion par créatrice** : impossibles sans lien tracké (inexistant) — seule
  l'attribution 24 h approximative existe, et elle est gonflée (I-2).

### I-9 — Time-to-value : budgets = hypothèses codées en dur **[L]**
Les seuils qui colorent les tuiles TTV (signup→target 10 min, target→alert 1 j, alert→payment 7 j) sont des
**constantes UI** (`OverviewTab.tsx:46-50`), pas des valeurs métier configurées ⇒ le statut ok/warn/alert
reflète une hypothèse, pas un objectif validé.

### Note de fiabilité
La distinction **latent/actif** ci-dessus découle du fait transverse (events PostHog non émis,
`posthogSync.ts:35-38`). Aujourd'hui, seules les incohérences **[A]** (devise/marge, biais warmup, absence
d'exclusion interne côté Jarvia, période partielle, cartes churn vides) sont observables sur les données
réelles ; les incohérences **[L]** (quatre chiffres d'abonnement, double-comptage d'attribution, CAC,
funnel > 100 %) se déclencheront dès la première émission d'events. Aucune n'est corrigée dans ce rapport.
