# Diagnostic — fuseaux horaires et créatrices hors de France

Rapport de diagnostic. **Aucun fichier de code n'a été modifié.**

---

## Avertissement préalable : la stack n'est pas celle du brief

Le brief demande des `timestamptz`, des politiques RLS, un bucket privé, et
propose des requêtes `information_schema` / `show timezone`. **Ce projet n'a pas
de base SQL.** Il tourne sur **Convex** (`convex@1.37`, cf `package.json:22`),
une base document dont le schéma est déclaré en TypeScript
(`convex/schema.ts`, 2654 lignes).

Conséquences directes sur les trois missions :

| Ce que le brief suppose | La réalité ici |
|---|---|
| `timestamptz` / `timestamp` / `date` | **Un seul type possible : `v.number()`** = millisecondes depuis epoch UTC |
| `show timezone` sur la base | Pas de fuseau de base. Un nombre n'a pas de fuseau |
| RLS Postgres | Fonctions serveur avec wrappers d'autorisation (`adminQuery`, `adminMutation`…) |
| Bucket privé + URL signée | Convex File Storage (`ctx.storage`) — modèle d'accès différent, à cadrer en mission 2 |

**La bonne nouvelle : le point 1 de ta direction de correction (« tout en UTC,
sans exception ») est déjà acquis, gratuitement et sans migration possible
autrement.** Aucune information de fuseau n'est perdue à l'écriture, parce
qu'aucun instant n'est stocké autrement qu'en UTC absolu.

**La mauvaise : le bug n'est donc pas dans le stockage. Il est entièrement dans
l'interprétation.** C'est plus profond, et ça ne se règle pas par une migration
de colonnes.

---

## 1. Stockage — quelles colonnes portent une date, et de quel type

Tous les instants sont des `v.number()` (ms epoch UTC). Il n'existe **aucune**
exception dans les 2654 lignes de schéma. Relevé des champs qui comptent :

### `assignments` (les missions)

| Champ | Ligne | Nature |
|---|---|---|
| `dueDate` | `convex/schema.ts:1381` | Instant. Échéance de **production** |
| `postDate` | `convex/schema.ts:1389` | Instant. Jour de **publication** planifié |
| `postWindow` | `convex/schema.ts:1405` | `{startMin, endMin}` — **minutes depuis minuit local**, pas un instant |
| `publishedAt`, `submittedAt`, `createdAt` | table | Instants |

`postWindow` mérite d'être signalé : c'est le **seul champ du dépôt qui a été
conçu en connaissance du problème**. Le commentaire `convex/schema.ts:1394-1400`
explique qu'une plage horaire est une « intention d'horloge murale, pas un
instant », et qu'un stockage en timestamps « rejouerait le défaut de fuseau
corrigé par #51/#52/#54 ». Ce raisonnement est juste, et c'est exactement celui
qu'il faut maintenant étendre à `postDate`.

### `comptes` (les comptes TikTok / Instagram)

| Champ | Ligne | Nature |
|---|---|---|
| `warmupStartedAt` | `convex/schema.ts:735` | Instant |
| `validatedAt` | `convex/schema.ts:755` | Instant |
| `refusedAt` | `convex/schema.ts:768` | Instant |
| `warmupProtocol.targetDays` | `convex/schema.ts:794` | Entier (jours) |
| **`warmupProtocol.dailyChecks`** | **`convex/schema.ts:795`** | **`v.array(v.string())` — dates `"YYYY-MM-DD"`** |
| `targetCountry` | `convex/schema.ts:832` | Code pays, liste fermée |

**`dailyChecks` est le seul endroit du dépôt où une date est stockée comme du
texte, et c'est là qu'est le cœur du bug.** Une chaîne `"2026-09-03"` n'a de
sens que rapportée à un fuseau, et ce fuseau n'est écrit nulle part : il est
implicite (UTC) dans la fonction qui fabrique la chaîne.

### `publications` / `metricSnapshots` / `paiements`

| Champ | Ligne | Nature |
|---|---|---|
| `publications.datePubli` | `convex/schema.ts:386` | Instant |
| `publications.latestSnapshotAt` | `convex/schema.ts:486` | Instant |
| `metricSnapshots.capturedAt` | `convex/schema.ts:619` | Instant |
| `metricSnapshots.daysSincePublication` | `convex/schema.ts:620` | Entier dénormalisé |
| `creators.firstPostAt` / `payAnchorAt` | `convex/schema.ts:1072` / `1085` | Instants (ancres de cycle de paie) |
| `viewsDaily.date` | `convex/schema.ts:699` | **`v.string()`, jour calendaire Europe/Paris explicite** |
| `payments.lineItems[].label` | — | **Texte figé** contenant une date formatée Paris |

`viewsDaily.date` est correct et documenté (`convex/schema.ts:698`). Le libellé
de paie est un piège connu à ne pas toucher : il est écrit une fois et jamais
recalculé (`convex/dateFr.ts:35-45`).

### Verdict du point 1

**Aucune information de fuseau n'est perdue à l'écriture d'un instant.** Le seul
champ où elle est perdue est `dailyChecks` (texte de jour sans fuseau), plus —
de manière plus insidieuse — `postDate` et `dueDate`, qui sont des instants
corrects mais dont la **valeur choisie** encode déjà un fuseau (Paris), comme le
montre le point 2.

---

## 2. Écriture — où les dates sont créées, et quel fuseau elles supposent

### 2.1 `dueDate` — construit dans le navigateur de l'admin

`components/admin/AssignScriptCampaignDialog.tsx:354` (et `:530`, dupliqué) :

```js
const dueMs = new Date(`${due}T23:59:59`).getTime();
```

Une chaîne ISO **sans suffixe de fuseau** est interprétée par le moteur JS dans
le fuseau **de la machine qui exécute le code** — ici, le navigateur de l'admin,
à Paris. Vérifié numériquement :

```
saisie "2026-09-02" → stocké 2026-09-02T21:59:59.000Z
```

Soit 23:59:59 **heure de Paris**. Le fuseau de l'admin est entré dans la donnée
sans que rien ne le déclare.

### 2.2 `postDate` — même mécanisme

`components/admin/AssignmentPlanningCalendar.tsx:27-30` :

```js
/** ms de MINUIT LOCAL du jour choisi — clé de stockage de postDate (jour). */
export function dayStartMs(d: Date): number {
  return startOfDay(d).getTime();
}
```

`startOfDay` de `date-fns` travaille dans le fuseau du navigateur. Vérifié :

```
jour choisi 3 septembre → stocké 2026-09-02T22:00:00.000Z
```

Le commentaire dit « MINUIT LOCAL ». C'est vrai — mais *local de l'admin*, pas
de la créatrice. Le champ nommé « jour de publication » contient donc un instant
qui vaut **18:00 la veille à New York**.

### 2.3 `dailyChecks` — construit sur le serveur, en UTC

`convex/warmup.ts:67-70` et son jumeau `lib/warmup.ts:96-98` :

```js
export function todayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
```

`toISOString()` rend toujours de l'UTC. Le commentaire de `lib/warmup.ts:92-95`
assume le choix : « Le warmup "tourne" sur la journée UTC — choix assumé pour
que client et serveur s'accordent sur "aujourd'hui" sans gérer de TZ. »

C'est un choix cohérent tant que tout le monde vit en Europe. Il ne l'est plus.

### 2.4 Autres sites d'écriture qui supposent un fuseau

| Fichier / ligne | Ce qui est supposé |
|---|---|
| `convex/accountPhase.ts:135` | Jour UTC pour le quota de posts d'un clippeur — **effet de bord documenté et assumé** en `:126-132` |
| `lib/pay-cycle.ts:63`, `convex/payCycle.ts:38` | Jour UTC pour les bornes de cycle de paie |
| `components/challenges/CreateChallengeDialog.tsx:65` | `new Date(y, m-1, d, 23, 59, 59, 999)` — minuit local du navigateur |
| `components/comptes/CompteDialog.tsx:82-86` | `todayStart()` via `setHours(0,0,0,0)` — local navigateur, sert de `warmupStartedAt` |
| `components/rushes/AssignScriptToRushDialog.tsx:53` | Échéance J+3 dérivée en UTC |
| `convex/publications.ts:1185` | `datePubli: Date.now()` — instant, correct |

---

## 3. Lecture / affichage — qui passe un `timeZone`, qui ne le passe pas

C'est ici que l'incohérence devient visible à l'écran. Il y a **deux familles**
d'affichage dans le dépôt, et elles ne donnent pas le même jour.

### Famille A — épinglé `Europe/Paris` (12 sites)

| Fichier / ligne | Usage |
|---|---|
| `convex/dateFr.ts:28`, `:49` | Dates FR des messages serveur |
| `convex/calendarStatus.ts:51`, `:223` | **Index de jour du statut calendrier** |
| `convex/assignments.ts:2979` | Affichage |
| `convex/analyticsHub.ts:88`, `lib/analytics-hub.ts:52`, `:66` | Jour analytics |
| `convex/viewsDaily.ts:83` | Bucket de jour |
| `convex/challengePortal.ts:88`, `components/portal/ChallengeBanner.tsx:115`, `:123` | Défis |
| `components/admin/ActionDashboard.tsx:703`, `:1103` | Tableau de bord admin |
| `components/portal/ViewAsLocale.tsx:45` | **Le mode « voir son espace »** |

L'épingle est documentée et volontaire (`convex/calendarStatus.ts:23-38`) : elle
corrige un défaut réel où 28 % des publications de prod s'affichaient la veille.

### Famille B — fuseau du navigateur, aucun `timeZone`

| Fichier / ligne | Usage |
|---|---|
| `lib/format.ts:53-62` (`formatDate`) | **Format le plus utilisé du produit** |
| `lib/format.ts:76-84` (`formatMoneyDate`) | Écrans d'argent |
| `components/portal/MissionListItem.tsx:44-49` | Échéance d'une mission, **espace créatrice** |
| `lib/creator-schedule.ts:150-154` | **Regroupement par jour du planning créatrice** |
| `components/portal/screens/MissionsScreen.tsx:77-88` | Libellés « aujourd'hui / demain » |
| `components/portal/CreatorPublicationCalendar.tsx:93` | `format(new Date(postDate), "yyyy-MM-dd")` — local navigateur |

### Famille C — épinglé UTC volontairement

`convex/emailMessages.ts:82-90` (`emailDate`) découpe en `getUTC*`. Volontaire
et correct **pour `dueDate` uniquement**, qui vaut 21:59 UTC = le bon jour à
Paris. `convex/dateFr.ts:18-21` documente précisément cette subtilité :

> « Le bon fuseau dépend du champ, pas d'une règle unique. »

### Le point de rupture

`convex/calendarStatus.ts:69-71` expose une fonction nommée `isSameLocalDay` —
**qui n'est pas locale, mais épinglée Paris**. Elle est consommée à la fois par
l'admin (`components/admin/AssignmentsCalendar.tsx:187`) et par l'espace
créatrice (`components/portal/TodayPostBanner.tsx:65`). Sur le même écran
créatrice, la bannière « à publier aujourd'hui » raisonne en jours **Paris**,
pendant que la liste des missions juste en dessous
(`lib/creator-schedule.ts:150`) regroupe en jours **navigateur**. Les deux
peuvent afficher des jours différents pour la même mission.

---

## 4. La notion de « jour » — le cœur du bug

Il n'existe **pas une** fonction « on est quel jour ? », mais **quatre
définitions concurrentes**.

| # | Fonction | Fichier / ligne | Fuseau |
|---|---|---|---|
| 1 | `todayKey` | `convex/warmup.ts:68`, `lib/warmup.ts:97` | **UTC** |
| 2 | `utcDayKey` / `utcDayRange` | `convex/accountPhase.ts:135`, `:158` | **UTC** |
| 3 | `parisDayIndex` / `isSameLocalDay` | `convex/calendarStatus.ts:63`, `:69` | **Europe/Paris** |
| 4 | `startOfLocalDay` | `lib/creator-schedule.ts:150` | **Navigateur** |

Les décisions métier s'y répartissent ainsi :

**« Le check de warmup du jour est-il fait ? »** → définition 1 (UTC).
`convex/comptes.ts:1349` (`checkedToday`) et `:1352` (écriture de `todayKey`).
La garde est serveur, pas seulement UI (`convex/comptes.ts:1319-1322`).

**« Combien de jours manqués ? »** → `missedDays`, `convex/warmup.ts:88-95`.
Formule : `min(joursPleinsÉcoulés, targetDays) − nombreDeChecks`. Le
commentaire la dit « TZ-robuste », et c'est **vrai en isolation** : elle ne
dérive aucune date, elle soustrait un compte de checks. Mais elle est
**empoisonnée en amont** — si un check est refusé à tort par la définition 1, le
compteur de checks est trop bas et « jours manqués » monte tout seul.

**« Jour X / 3 »** → `warmupProgress`, `lib/warmup.ts:130-137`, sur
`dailyChecks.length`. Même dépendance amont.

**« La mission est-elle en retard ? »** → deux réponses selon l'écran :
- Production : `convex/assignments.ts:2205` compare `dueDate < now`. Comparaison
  d'instants, **correcte** et sans fuseau.
- Calendrier : `convex/calendarStatus.ts` compare des `parisDayIndex`. **Paris.**

**« Est-ce à publier aujourd'hui ? »** → définition 3 côté bannière
(`TodayPostBanner.tsx:65`), définition 4 côté liste
(`creator-schedule.ts:150`).

Autrement dit : **il n'y a pas de fonction à corriger, il y a quatre horloges à
unifier.**

---

## 5. Tâches planifiées

Pas de `pg_cron`, pas de GitHub Actions de production, `vercel.json` ne contient
aucun cron. **Tout est dans `convex/crons.ts`**, qui planifie **en UTC** — Convex
ne gère pas les fuseaux nativement.

Le fichier documente déjà la doctrine (`convex/crons.ts:6-17`) : heure UTC fixe
quand « à peu près » suffit, cron horaire + garde sur l'heure de Paris quand
l'heure est promise à un humain.

| Cron | Heure | Fait avancer un compteur ? |
|---|---|---|
| `nightly-views-sync` | horaire, gardé 23h30 Paris | Non — relève de vues |
| `creator-deadline-reminders` | **10:00 UTC quotidien** | **Oui — relances d'échéance** |
| `daily-ops-digest` | 06:00 UTC quotidien | Oui — signale les warmups en retard |
| `evening-unpublished-reports` | horaire, gardé sur `eveningHourParis` | Oui — bilan de fin de journée |
| `creator-conversions-sync` | horaire, gardé Paris | Non |
| `whop-revenue-sync`, `posthog-analytics-sync` | horaire | Non |
| `purge-orphan-storage-blobs`, `expire-unassigned-rushes` | 04:15 / 04:45 UTC | Non |

### Ce qui se passe pour une créatrice à New York

**Aucun cron ne fait avancer le compteur de warmup** — c'est un point important
et rassurant. Le compteur n'avance que quand quelqu'un clique
(`convex/comptes.ts:1325`). Le bug de warmup n'est donc **pas** un bug de cron.

En revanche :

- **`daily-ops-digest` à 06:00 UTC** = 02:00 à New York. Il évalue
  `isWarmupLate` (`convex/notifications.ts:1085`) au milieu de la nuit de la
  créatrice, sur un jour UTC qui a déjà tourné depuis 2 h. Une créatrice qui
  n'a pas encore fait son check de la journée (il est 2 h du matin chez elle)
  peut être signalée en retard à l'admin.
- **`evening-unpublished-reports`** est gardé sur `eveningHourParis`
  (`convex/notifications.ts:1232`). Le « bilan du soir » de 21 h Paris part à
  15 h à New York. Il annonce « posts non publiés aujourd'hui » en plein
  après-midi de la créatrice, qui a encore neuf heures devant elle.
- **`creator-deadline-reminders` à 10:00 UTC** = 06:00 à New York. Un mail de
  relance à l'aube.

---

## 6. Source de vérité du pays

**Il n'existe qu'un seul champ pays, et il ne pilote rien.**

`comptes.targetCountry` (`convex/schema.ts:832`), validé contre une liste fermée
de 10 codes (`convex/countries.ts:11-13`). Son commentaire
(`convex/schema.ts:826-831`) est sans ambiguïté :

> « PUREMENT descriptif : ne pilote RIEN (ni scraping, ni proxy, ni filtre, ni
> affichage créatrice). »

**La table `creators` n'a aucun champ pays.** Champs vérifiés : `projectId`,
`userId`, `name`, `email`, `phone`, `locale`, `kind`, `clipperId`, `status`,
`paymentMethod`, `paymentDetails`, `adminNotes`, `bonusPricingId`,
`handlesToCreate`, `driveFolderId`, `firstPostAt`, `payAnchorAt`, `clipRate`,
`cycleRetainer`, `refSlug`, `createdAt`.

**Il n'existe aucun champ fuseau horaire, nulle part.** Recherche sur
`timezone|timeZone|America/|IANA` dans `convex/`, `lib/`, `app/`,
`components/` : 20 résultats, tous des littéraux `"Europe/Paris"` ou `"UTC"`
codés en dur dans des formateurs. **Zéro donnée.**

Le seul signal de langue est `creators.locale` (`convex/schema.ts:1000`), qui
distingue `fr` / `en`. Il ne dit rien du fuseau : une créatrice anglophone peut
être à Londres, New York ou Los Angeles.

⚠️ **Note sur la maquette de la mission 3.** Son en-tête affiche « 2 comptes ·
États-Unis · New York (UTC−4) ». **Ni le pays ni le fuseau n'existent sur la
fiche créatrice aujourd'hui.** Ce ne sont pas des champs à déplacer, ce sont
deux champs à créer. Tu as raison sur le fond : le pays ne suffit pas (les US
ont six fuseaux), et le pays lui-même est aujourd'hui sur le *compte*, pas sur
la *créatrice*.

---

## 7. Environnements

| Environnement | Fuseau | Source |
|---|---|---|
| « Base » Convex | **Sans objet** — un `v.number()` n'a pas de fuseau | `convex/schema.ts` |
| Runtime serveur Convex (prod) | **UTC** | Documenté `convex/crons.ts:8`, `convex/calendarStatus.ts:26`, `convex/accountPhase.ts:127` |
| Ta machine en local | **Europe/Paris** | Mesuré ce jour : `Intl.DateTimeFormat().resolvedOptions().timeZone` → `Europe/Paris` |
| Navigateur admin | Europe/Paris | Idem |
| Navigateur créatrice US | `America/*` | **Jamais lu par l'application** |
| Runner Playwright | **Europe/Paris, forcé** | `playwright.config.ts:20-21` (`locale: "fr-FR"`, `timezoneId: "Europe/Paris"`) |
| Runner Vitest | TZ de la machine, **sauf** override par fichier | `lib/review-queue.test.ts:4`, `lib/reminder-grouping.test.ts:3`, `lib/creator-schedule.test.ts:5` → `Europe/Paris` ; `lib/date-fr.test.ts:6` → `UTC` |

**Aucun `TZ` n'est défini au niveau du projet** (ni `package.json`, ni
`vercel.json`, ni `next.config.ts`). Les seuls `process.env.TZ` sont des
overrides par fichier de test.

### La divergence qui explique que le bug ne se voie pas en dev

Elle est double, et c'est structurel :

1. **Ta machine et le navigateur de l'admin sont à Paris.** Tous les sites de la
   « famille B » (fuseau navigateur) donnent le bon résultat chez toi. Ils ne se
   trompent que dans le navigateur d'une créatrice américaine — un
   navigateur que personne dans l'équipe n'ouvre jamais.

2. **`playwright.config.ts:21` force `Europe/Paris` sur toute la suite e2e.**
   C'est justifiable — un runner à fuseau flottant rend les specs instables —
   mais l'effet secondaire est net : **aucune spec e2e ne peut, aujourd'hui,
   attraper une régression de fuseau créatrice.** Le harnais de test est aveugle
   à la classe de bugs qu'on diagnostique.

`lib/calendar-status.test.ts:52-53` fait exception et revendique la bonne
propriété : le fichier est vert sous `TZ=UTC` comme sous `TZ=Europe/Paris`. Ce
patron est le bon modèle pour la correction.

---

## Cause racine

**Le produit n'a qu'une seule horloge, celle de Paris, et elle est codée en dur
dans une douzaine d'endroits au lieu d'être une donnée.** Les échéances et les
jours de publication sont fabriqués dans le navigateur de l'admin : « le
3 septembre » devient un instant qui vaut 18 h le 2 septembre à New York.

**Le compteur de warmup, lui, suit une deuxième horloge : UTC.** Une créatrice à
New York qui coche son check après 20 h locales le pose sur la journée UTC
suivante — elle perd un jour, et « jours manqués » monte tout seul.

**Il n'existe aucun champ fuseau, ni aucun pays sur la créatrice**, donc rien ne
permet aujourd'hui de calculer « quel jour est-il pour elle ». Par impact
décroissant : (1) les quatre définitions concurrentes de « jour », (2) l'absence
de donnée de fuseau, (3) les crons UTC qui alertent à contretemps.

---

## Scénario reproductible

**Le 2 septembre 2026 à 21 h heure de Paris, tu crées un assignment pour
@detectivekezz (New York, EDT = UTC−4), échéance de production le 2, publication
prévue le 3.**

### Ce qui est stocké

| Champ | Valeur en base | Chemin |
|---|---|---|
| `dueDate` | `2026-09-02T21:59:59.000Z` | `AssignScriptCampaignDialog.tsx:354` |
| `postDate` | `2026-09-02T22:00:00.000Z` | `AssignmentPlanningCalendar.tsx:29` |

Les deux valeurs sont *cohérentes avec Paris* et **ne portent aucune trace** du
fait que la créatrice est ailleurs.

### Ce que tu vois à Paris

- Calendrier admin : la vignette est sur le **jeudi 3 septembre**
  (`AssignmentsCalendar.tsx:203` + `parisDayIndex`). ✅
- Échéance : « 02/09/26 ». ✅

### Ce que Keziah voit à New York

| Écran | Affiche | Pourquoi |
|---|---|---|
| Liste des missions (`MissionsScreen.tsx:77`) | **« mercredi 2 septembre »** | `startOfLocalDay(2026-09-02T22:00Z)` en EDT = 2 sept 18:00 → seau du 2 |
| Calendrier créatrice (`CreatorPublicationCalendar.tsx:93`) | **case du 2 septembre** | `format(new Date(postDate), "yyyy-MM-dd")` en local |
| Bannière « à publier aujourd'hui » (`TodayPostBanner.tsx:65`) | **le 3 septembre** | `isSameLocalDay` est épinglé **Paris** |
| E-mail de relance (`emailMessages.ts:82`) | « 09/02/2026 » | `getUTCDate()` sur 21:59:59Z |

**Deux écrans de la même page lui annoncent deux jours différents.** Et le jour
affiché dans sa liste de missions n'est pas celui que tu vois dans ton
calendrier.

Vérifié numériquement (`node`, ce jour) :

```
dueDate stocké (UTC): 2026-09-02T21:59:59.000Z   vu à NY: 02/09/2026 17:59:59
postDate "3 sept"    : 2026-09-02T22:00:00.000Z   vu à NY: 02/09/2026 18:00:00
                                                  jour NY: mercredi 2 septembre
check posé à 21h NY le 2 sept → clé UTC écrite: "2026-09-03"
```

### Le warmup, dans le même scénario

Keziah fait son check du soir **le 2 septembre à 21 h chez elle**. Il est
01 h UTC le 3. `todayKey` (`convex/warmup.ts:68`) écrit **`"2026-09-03"`**.

Le lendemain **3 septembre à 10 h chez elle** (14 h UTC), elle rouvre l'app pour
son check : `checkedToday` (`convex/comptes.ts:1349`) trouve `"2026-09-03"` déjà
présent → **`WARMUP_CHECK_ALREADY_DONE`, « Le check du jour est déjà fait. »**

Elle a fait deux jours de travail, le compteur en enregistre un. `missedDays`
(`convex/warmup.ts:88`) voit deux jours pleins écoulés pour un seul check et
affiche **« 1 jour manqué »**. Son « Jour 3/3 » stagne à « Jour 2/3 ». Et le
digest de 06:00 UTC la signale en retard à l'admin.

**Toute créatrice US qui travaille le soir — c'est-à-dire toute créatrice US —
perd systématiquement des jours de warmup.**

### Ce qui devrait s'afficher

Une mission datée du 3 septembre devrait expirer à **23:59 à New York** (soit
05:59 le 4 à Paris), s'afficher « jeudi 3 septembre » dans **tous** les écrans de
Keziah, apparaître le 3 dans ton calendrier admin avec l'heure de Paris en
mention secondaire, et son check du 2 à 21 h locales devrait compter pour le
**2**.

---

## Plan de correction proposé

Sept étapes, ordonnées pour que chacune soit livrable et vérifiable seule.
**Aucune ne demande de migration destructive.**

### Étape 0 — Rendre le bug visible en test *(préalable, non négociable)*

`playwright.config.ts:21` force `Europe/Paris`. Tant que c'est le cas, aucune
régression de fuseau créatrice ne peut être attrapée. Ajouter un **projet
Playwright dédié** en `America/New_York` sur les seules specs de l'espace
créatrice, et adopter le patron de `lib/calendar-status.test.ts:52` (vert sous
`TZ=UTC` **et** sous `TZ=Europe/Paris`) pour les tests unitaires touchés.

- **Fichiers** : `playwright.config.ts`, nouveaux fichiers de spec.
- **Risque données** : nul. **Migration** : non.
- *Conforme à ta règle « une assertion doit avoir été vue rouge » : cette étape
  est ce qui rend le rouge possible.*

### Étape 1 — Poser la donnée de fuseau

Ajouter `timezone: v.optional(v.string())` sur **`creators`** et sur
**`comptes`**, plus `defaultTimezone` sur `projects`. Résolution en cascade :
compte → créatrice → projet → **`"Europe/Paris"` explicite et journalisé**,
jamais un repli silencieux.

Ajouter aussi `country` sur `creators` (absent aujourd'hui), pour alimenter la
proposition automatique et l'en-tête de la mission 3.

Table pays → fuseau par défaut pour les 10 pays de `convex/countries.ts:11` :
`US → America/New_York`, `FR → Europe/Paris`, `GB → Europe/London`,
`DE → Europe/Berlin`, `ES → Europe/Madrid`, `IT → Europe/Rome`,
`CA → America/Toronto`, `AU → Australia/Sydney`,
`BR → America/Sao_Paulo`, `AR → America/Argentina/Buenos_Aires`.
Proposition **modifiable**, jamais imposée.

- **Fichiers** : `convex/schema.ts`, `convex/countries.ts`, nouveau
  `convex/timezones.ts` + réplique `lib/timezones.ts` (règle A6).
- **Risque données** : nul (champs optionnels, additifs).
- **Migration** : non — le champ absent se comporte exactement comme aujourd'hui.

### Étape 2 — Le module unique

Un seul module qui répond aux trois questions : « quel jour est-il pour ce
compte ? », « à quel instant UTC finit le jour J pour ce compte ? », « comment
formater cet instant pour ce compte ? ».

Il doit **absorber les quatre définitions existantes** (`todayKey`,
`utcDayKey`, `parisDayIndex`, `startOfLocalDay`) et non s'ajouter en cinquième.
`convex/calendarStatus.ts` est le meilleur point de départ : il est déjà pur,
déjà testé, déjà importable des deux côtés — il suffit de **paramétrer son
fuseau** au lieu de le figer.

⚠️ `isSameLocalDay` doit être renommée : son nom ment (elle est Paris, pas
locale) et ce mensonge est une cause probable de futures régressions.

- **Fichiers** : `convex/calendarStatus.ts`, `lib/calendar-status.ts`,
  `convex/warmup.ts`, `lib/warmup.ts`, `convex/accountPhase.ts`.
- **Risque données** : nul (calcul). **Migration** : non.
- **Risque réel** : c'est l'étape qui touche le plus de code. À isoler seule.

### Étape 3 — Le warmup, d'abord

C'est le préjudice le plus concret (des jours de travail perdus). Faire lire
`todayKey` dans le fuseau du **compte** plutôt qu'en UTC.

**Point délicat, à décider ensemble :** les `dailyChecks` déjà en base sont des
clés UTC. Les réinterpréter dans un fuseau US décalerait l'historique. Ma
recommandation : **ne rien réécrire**, ne changer que le comportement à partir
de la bascule. Les warmups en cours se terminent avec un décompte au pire
inchangé, jamais dégradé — et `missedDays` compte des checks, pas des dates,
donc rien ne casse.

- **Fichiers** : `convex/comptes.ts` (`applyWarmupCheck`), `convex/warmup.ts`,
  `lib/warmup.ts`.
- **Risque données** : faible, **si** on ne réécrit pas l'existant.
- **Migration** : non (recommandé).

### Étape 4 — Échéances et dates de publication

`dueDate` et `postDate` saisis comme **date locale de la créatrice**, convertis
en instant UTC (fin de journée locale / minuit local) **côté serveur**, plus
jamais dans le navigateur de l'admin.

- **Fichiers** : `AssignScriptCampaignDialog.tsx:354` et `:530` (les deux
  copies), `AssignmentPlanningCalendar.tsx:29`, `convex/scripts.ts:1451`,
  `:2037`, `convex/assignments.ts:385`.
- **Risque données** : **le plus élevé du plan.** Les `postDate` existants sont
  à minuit Paris. Réinterprétés dans un fuseau US, ils reculeraient d'un jour.
- **Migration** : **oui, et c'est la seule.** Réécrire les `postDate`/`dueDate`
  des assignments **non encore publiés** des créatrices non-Paris. Réversible
  (décalage déterministe), à jouer sur un export de prod d'abord, et à laisser
  intacts les assignments déjà publiés ou payés.

### Étape 5 — Affichage double

Heure locale créatrice en principal, heure de Paris en secondaire côté admin.
Uniformiser les familles A/B/C sur le module de l'étape 2.

- **Fichiers** : `lib/format.ts`, `components/portal/*`,
  `components/admin/AssignmentsCalendar.tsx`, `convex/emailMessages.ts`.
- **Risque données** : nul. **Migration** : non.

### Étape 6 — Les crons

Passer `daily-ops-digest` et `creator-deadline-reminders` d'un déclenchement
quotidien UTC à un déclenchement horaire qui ne traite que les comptes dont le
minuit local vient d'être franchi. Le patron existe déjà et fonctionne :
`evening-unpublished-reports` (`convex/crons.ts`) + `parisHour`
(`convex/notifications.ts:1211`). Il suffit de le généraliser par fuseau.

`convex/crons.ts:6-17` prévient que ça coûte 23 exécutions à vide par jour —
c'est le prix, et il est justifié ici.

- **Fichiers** : `convex/crons.ts`, `convex/notifications.ts`, `convex/emails.ts`.
- **Risque données** : nul. **Migration** : non.

### Tests sur les cas qui cassent

- **DST US ≠ DST Europe** : entre le 8 mars et le 29 mars 2026, l'écart
  Paris↔New York est de **5 h**, pas 6. Idem entre le 25 octobre et le
  1ᵉʳ novembre. Ces deux fenêtres sont les seules où un décalage figé casse.
- **`America/Los_Angeles`** : UTC−7/−8. Le franchissement de minuit UTC tombe à
  16 h/17 h locales — le problème du warmup y est encore plus large.
- **Assignment créé à 23 h 30 heure de Paris** : déjà le lendemain en UTC, encore
  la veille à New York. Les trois horloges divergent simultanément.
- **Fuseau à décalage non entier** (`Asia/Kolkata`, UTC+5:30) : à couvrir même
  hors périmètre actuel, un décalage en heures pleines est une hypothèse fausse
  qui coûte cher plus tard.

---

## Deux réserves sur la direction proposée

**« Tout instant stocké en `timestamptz`, en UTC, sans exception. »** — déjà
acquis, et ce n'est pas là qu'est le bug. Insister sur le stockage ferait rater
la cible : le problème est l'**interprétation**, pas la conservation.

**« Un champ fuseau IANA sur le compte, avec repli sur le créateur puis le
projet. »** — d'accord sur la cascade, avec une nuance : `postDate` est une
propriété de la **mission**, et une mission peut viser plusieurs comptes
(`assignments.targets[]`). Deux comptes dans deux fuseaux différents sur la même
mission produiraient deux « jours » distincts pour un seul `postDate`. Je
recommande de **résoudre le fuseau au niveau de la créatrice** pour les dates de
mission, et de garder le fuseau du compte pour ce qui est réellement propre au
compte (warmup, quotas). À trancher avant l'étape 4.

---

*Rapport produit sans modification du code. En attente de validation avant toute
correction.*
