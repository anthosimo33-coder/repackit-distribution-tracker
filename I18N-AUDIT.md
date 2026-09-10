# I18N — AUDIT PHASE 0

Audit en lecture seule. **Aucune modification de code.** Réalisé le 2026-08-21 sur `main` @ `6137bd5`.

Méthode : 21 agents en parallèle (10 inventaires par module, 6 transverses, 3 réfutations
adversariales du volet devises, 1 critique de complétude), puis re-vérification manuelle des
affirmations décisives. Les chiffres non re-vérifiés à la main sont signalés comme estimations.

---

## 1. Détection

| Point | Constat | Preuve |
|---|---|---|
| Next.js | **16.2.4**, App Router pur | `package.json`, `app/` |
| Pages Router | absent | pas de `pages/` |
| Lib i18n | **aucune** (ni next-intl, ni next-i18next, ni react-intl, ni i18next) | `package.json`, `pnpm-lock.yaml` |
| Locale câblée | `<html lang="fr">` en dur | [app/layout.tsx:45](app/layout.tsx:45) |
| Metadata Next | **un seul** export `metadata`, aucun `generateMetadata` | [app/layout.tsx:21](app/layout.tsx:21) |
| Dates | **Intl natif** avec `"fr-FR"` en dur (53 occurrences / 40 fichiers) | — |
| date-fns | installé mais ne sert **que** l'en-tête de mois des 4 calendriers custom (`locale fr` importée dans 8 fichiers) | — |
| Module de référence dates | `convex/dateFr.ts` (`formatDateFr` JJ/MM/AA, `formatDayMonthFr` JJ/MM, Europe/Paris épinglé), doublé côté front par `lib/format.ts:formatDate` (21 importeurs / 44 appels) | — |
| `Intl.PluralRules` / `RelativeTimeFormat` / `ListFormat` | **zéro usage** | — |
| Validation | **ni zod, ni react-hook-form, ni yup/formik** — la validation est ~100 % serveur | — |
| Error boundaries | **aucun** `error.tsx`, `global-error.tsx`, `loading.tsx` | — |
| `window.confirm/alert/prompt` | **zéro** | — |
| `public/` | ni manifest, ni sitemap, ni robots.txt, ni opengraph-image — **rien à extraire** | — |

---

## 2. Inventaire par module

`app/` + `components/` + `lib/` — 241 fichiers porteurs de texte.

| Module | Fichiers | Strings ≈ | Risque |
|---|---:|---:|---|
| **Analytics** (hub PostHog/Whop, tracker, carte Whop) | 22 | **850** | élevé |
| **Admin — pages** `app/admin/**` | 23 | **583** | élevé |
| **Composants admin** `components/admin/**` | 33 | **553** | élevé |
| **Comptes / Créateurs / Talent / Clippeur** | 30 | **537** | élevé |
| **Composants racine + shorts/project/icps/formats/warmup/rushes** | 26 | **520** | élevé |
| **Portail créateur** `components/portal/**` | 27 | **366** | élevé |
| **Inspirations / Nouveau / Scripts / Calendrier** | 27 | **298** | élevé |
| **lib/** — dictionnaires de libellés et formatteurs | 29 | **213** | élevé |
| **UI partagée** (ui, layout, filters, brand, guides) | 11 | **82** | moyen |
| **Portails publics** (login, join, reset-password, API) | 13 | **67** | moyen |
| **Sous-total app + components + lib** | **241** | **4 069** | |

### 2 bis. `convex/` — le module que l'énoncé n'anticipait pas

Le périmètre annoncé (« app/ et components/ ») ne couvre pas là où vit le texte serveur.
**557 littéraux accentués hors commentaires**, sur **64 fichiers**, plus ~150 messages FR sans accent
(« Compte introuvable. ») — soit **≈ 600 strings**, dont ~95 en seed hors périmètre.

| Fichier | Strings | `ConvexError` |
|---|---:|---:|
| `convex/scriptSeedData.ts` | 60 | 0 | *(contenu de scripts — hors périmètre, à acter)* |
| `convex/emails.ts` | 44 | 0 |
| `convex/assignments.ts` | 38 | 59 |
| `convex/scripts.ts` | 33 | 49 |
| `convex/notificationMessage.ts` | 29 | 0 | *(Telegram — hors périmètre)* |
| `convex/publications.ts` | 28 | 33 |
| `convex/notificationEvents.ts` | 20 | 0 |
| `convex/demoSeed.ts` + `demoMultiProject.ts` | 35 | 4 | *(seeds)* |
| `convex/comptes.ts` | 17 | 35 |
| `convex/creators.ts` / `functions.ts` / `radar.ts` | 39 | 42 |
| 54 autres fichiers | ≈ 214 | ≈ 120 |

**342 `throw new ConvexError(...)` sur 31 fichiers.** Ils sont **réellement affichés** : `lib/convex-error.ts`
lit `error.data` et le rend verbatim, appelé 126 à 193 fois selon le mode de comptage, presque
toujours en `toast.error`. **La majorité du texte d'erreur lu par l'utilisateur vit donc hors du
périmètre annoncé, dans un runtime où next-intl ne tourne pas.**

### Totaux

- **Occurrences** : ≈ **4 670** (4 069 client + ~600 serveur).
- **Chaînes uniques** : ≈ **2 570** (beaucoup de libellés répétés : « Enregistrer », « Annuler », statuts).
- **Réellement extractibles** après retrait du hors-périmètre (Telegram ~87, seeds ~95, `console.*` ~55,
  throws internes ~34) : **≈ 3 100 – 3 300**.

> Les deux comptages (somme module par module vs. corpus dédupliqué) divergent parce qu'ils ne
> comptent pas la même chose. Aucun des deux n'a été recompté à la main ligne à ligne : ce sont des
> ordres de grandeur, pas des chiffres d'inventaire.

---

## 3. Surfaces transverses

| Surface | Volume | Constat |
|---|---:|---|
| **Toasts (sonner)** | 319 appels / 83 fichiers | 202 littéraux FR uniques + 48 messages de repli |
| **Validation** | 342 `ConvexError` | 100 % serveur, 274 littéraux distincts, affichés verbatim |
| **Emails (Resend)** | 7 templates, ~50 strings | tout en dur dans `convex/emails.ts` |
| **Telegram** | ~87 strings | **hors périmètre, confirmé par le code** (voir §5) |
| **Metadata Next** | 1 export | `app/layout.tsx` uniquement, aucun titre par page |
| **Charts** | inclus dans Analytics | axes, séries, légendes, formatters de tooltip |
| **Pluriels manuels** | **156 ternaires `? "s" : ""`** sur 132 lignes / 49 fichiers | + ~35 accords irréguliers, 3 accords de **genre** |
| **`"fr-FR"` en dur** | 53 occurrences / 40 fichiers | + `localeCompare("fr")`, tables `JOURS_FR`/`MOIS_FR` |
| **Sélecteurs e2e sur texte FR** | **1 014 occurrences / 90 specs sur 143** | contre 61 `getByTestId` |

---

## 4. DEVISES

> Réponses aux 4 questions de la section G. Chaque affirmation est adossée à du code cité.
> **Les 3 réfutations adversariales ont toutes rendu `refuted: true`** : le premier rapport était
> juste sur le fond, faux sur l'exhaustivité. Ce qui suit intègre les corrections.

### G.1 — Le schéma porte-t-il un champ `currency` sur les paiements créateurs ?

**Réponse : PARTIEL — OUI sur le revenu, NON sur la paie créatrice.**

| Porteur | Devise ? | Chemin |
|---|---|---|
| **Revenu Whop** | **OUI**, obligatoire | `whopPayments.currency: v.string()` — [convex/schema.ts:1619](convex/schema.ts:1619) |
| Offres Whop | oui, optionnel | `whopPlans.currency` — [convex/schema.ts:1677](convex/schema.ts:1677) |
| **Paie créatrice** | **NON** | `payments.lineItems[].amount` (schema.ts:1548), `payments.totalDue` (schema.ts:1582) — `v.number()` nus |
| Barèmes | NON | `pricings.montantFixe` / `tauxCPM` / `bonusTiers[].montant` / `coutReel` / `montantBonus` |
| Bonus | NON | `bonusUnlocks.montant` / `coutReel` |
| Tarifs clippeur/talent | NON | `creators.clipRate` / `cycleRetainer` |
| Snapshots figés | NON | `assignments.rateSnapshot` / `pricingSnapshot` / `clipRateSnapshot` |
| Grilles de format | NON | `formats.rateModel` |

La devise de paie existe **uniquement au niveau PROJET** : `projects.payCurrency: v.optional(v.string())`
([convex/schema.ts:149](convex/schema.ts:149)), + `projects.fxRateToRevenue` (schema.ts:154).

**Conséquence factuelle** : un payout n'a pas de devise propre, il hérite de celle de son projet.
**Deux créateurs d'un même projet ne peuvent pas être payés dans deux devises différentes.**
`convex/payments.ts` — le module qui écrit `lineItems`/`totalDue` et gèle les montants au paiement —
ne contient **pas une seule occurrence du mot `currency`** (preuve négative vérifiée). Idem `convex/creators.ts`.

**Porteur de devise implicite raté par le premier rapport** : `creators.paymentMethod`
([convex/schema.ts:814](convex/schema.ts:814)) est un `v.union("sepa" | "paypal" | "usdt" | "autre")`.
« sepa » = virement **euros** par définition, « usdt » = stablecoin **dollar**. C'est un **rail de
paiement qui présuppose une devise**, posé sur la fiche créatrice, alors que le dû (`payments.totalDue`)
est libellé en `projects.payCurrency` (« usd » en prod). Rien dans le schéma ne relie les deux.

### G.2 — Où le symbole est-il appliqué ?

**Le chemin dominant est correct.** `formatMoney(n, currency?)` ([lib/format-rate.ts:21](lib/format-rate.ts:21))
fait déjà `Intl.NumberFormat("fr-FR", {style:"currency", currency: code, currencyDisplay:"narrowSymbol"})`
et — vérifié à la main — **retourne un nombre sans symbole quand la devise est absente** (jamais de
défaut inventé). `payCurrency` est threadé explicitement depuis la donnée : **122 occurrences**
hors tests (app 25, components 64, lib 5, convex 28).

> Le premier rapport annonçait « 104 emplacements ». Chiffre non reproductible, réfuté : 122 hors
> tests, 125 tests compris. Rectifié ici.

**Hardcodes réels sur des montants affichés — inventaire consolidé après réfutation :**

| # | Lieu | Symbole | Porte sur |
|---|---|---|---|
| 1 | [app/admin/[projectSlug]/paiements/page.tsx:262](app/admin/[projectSlug]/paiements/page.tsx:262) | `€` | En-tête CSV « Total dû (€) » — **la valeur sous cet en-tête est en USD** |
| 2 | [convex/emails.ts:85](convex/emails.ts:85) + 337-344 | `$` | `formatAmount` colle « $ » en dur dans le **sujet ET le corps** de l'email « paiement effectué » |
| 3 | [convex/pricing.ts:860](convex/pricing.ts:860) | `$` | Message de validation « Un palier cash exige un montant $ ≥ 0. » |
| 4 | [components/analytics/hub/OffresTab.tsx:74](components/analytics/hub/OffresTab.tsx:74) | `$` | `usd()` — formateur complet, symbole en dur, **aucune devise en base derrière** (`cost_usd` transite par le blob `posthogCache.json`) |
| 5 | [components/analytics/hub/RetentionTab.tsx:571](components/analytics/hub/RetentionTab.tsx:571), 604 | `€` | « (dont N à 0 €) » — JSX rendu |
| 6 | [components/analytics/hub/OffresTab.tsx:516](components/analytics/hub/OffresTab.tsx:516), 588, 778-779 | `€` | attribut `title=` + prose (« dernier 7,99 € », « premier 4,99 € ») |
| 7 | [components/analytics/hub/explanations.ts:81](components/analytics/hub/explanations.ts:81) | `€` | « un net à 0,00 € peut signaler un paiement parti en litige » |
| 8 | [convex/analyticsHub.ts:1207](convex/analyticsHub.ts:1207), 1209 | `€` | **écrit EN BASE** par `seedSnytchOfferChanges` puis rendu : « Nouvelle offre 4,99 €/semaine » |

**La garde anti-hardcode existante `lib/currency-hardcode.test.ts` a trois trous**, dont un non
documenté par le premier rapport :
1. Périmètre limité à `components/` + `app/` — `convex/` et `lib/` y échappent (explique #2, #3, #8).
2. Le regex `GLUED` (`}\s*[€£¥$]`) ne se déclenche pas sur un littéral isolé (explique #1, #5, #6, #7).
3. **Un opt-out ligne-à-ligne `// currency-hardcode-exempt: <raison>`** ([lib/currency-hardcode.test.ts:84-95](lib/currency-hardcode.test.ts:84))
   qui retire du scan le marqueur **et la ligne suivante** — vérifié à la main, utilisé une fois en
   production ([OffresTab.tsx:73](components/analytics/hub/OffresTab.tsx:73)), c'est ce qui laisse
   passer #4.

**Nom trompeur** : `MAX_PAY_PER_VIDEO_EUR = 150` ([lib/pricing-engine.ts:83](lib/pricing-engine.ts:83)
et sa réplique `convex/pricing.ts:36`) — le nom dit EUR, la paie est en USD. Le seuil ne porte aucune
devise et s'applique identiquement quelle que soit `payCurrency`. Non affiché en UI.

### G.3 — Les agrégats additionnent-ils des devises différentes ?

**Réponse en deux temps. Sur les COÛTS : non, prouvé. Sur les REVENUS : oui, dans le cas multi-devise.**

**Coûts — aucun mélange, par construction.** Tous les agrégats de coût (coût total créateurs, coût
complet du moteur, CAC, RPM promo, coût par clip via `lineItems`, leaderboard) sont bornés à
`ctx.projectId`, donc à une seule `payCurrency`. `computeProjectLeaderboard` est borné projet
([convex/payments.ts:768](convex/payments.ts:768)). `acquisitionCost` et `fullEngineCost`
([OverviewTab.tsx:225](components/analytics/hub/OverviewTab.tsx:225), :233) ont un numérateur 100 %
`payCurrency` et un dénominateur qui est un **compte**, pas un montant. Aucun agrégat « coût par
clip » n'existe (grep : seul un libellé unitaire). Aucune boucle cross-projet ne somme d'argent.

**Revenus — la garde ne compose pas.** C'est la correction la plus importante de la réfutation.
`summarizeWhopRevenue` zéroïse bien dès qu'il voit deux devises
([convex/whopRevenue.ts:226-236](convex/whopRevenue.ts:226)) — **mais elle est appliquée PAR PÉRIODE
côté serveur, puis les composants ADDITIONNENT les périodes côté client** :

- [convex/analyticsHub.ts:875](convex/analyticsHub.ts:875) — `net: summarizeWhopRevenue(list).net` : garde **locale à la période**.
- [components/analytics/hub/OverviewTab.tsx:245](components/analytics/hub/OverviewTab.tsx:245) — `revenue.periods.reduce((s, p) => s + p.net, 0)` → alimente « Revenu net par client ».
- [components/analytics/hub/PromoRpmCard.tsx:72](components/analytics/hub/PromoRpmCard.tsx:72) — même reduce → numérateur du RPM promo.

Deux mois encaissés dans deux devises donnent deux nets mono-devise (donc non zéroïsés) sommés sans
contrôle. `revenue.mixedCurrency` **est** renvoyé (`analyticsHub.ts:1131`) mais **aucun composant ne le
lit** (0 occurrence dans `components/` et `app/`).

Autres contournements de la garde, dans la même query :
- `monthlyArpu` / `ltv` : sommes brutes ([analyticsHub.ts:988](convex/analyticsHub.ts:988) → :1140-1142), alors que `dailyNet` dix lignes plus haut **est** protégé (:976) — la garde est appliquée sélectivement.
- `plans[]` : `netTotal`, `ltv`, `netPerMemberMonth` sont des sommes brutes ; la devise affichée vient de `modalPrice(list)`, la devise **modale**, jamais une vérification d'unicité.
- `periods[]` : seul `net` est protégé ; `newNet`, `returningNet`, `unattributedNet` sont des `+=` bruts (en multi-devise, `net` tombe à 0 pendant que ses trois parts restent non nulles — le contrôle « Σ des parts = total » partirait en écart).
- `abRevenue.rows[].net` (:1071-1113) : sommes brutes par bras du test A/B.
- `lib/analytics-hub.ts:306-315` — le contrôle de fiabilité `no_cross_currency` **affiche** la garantie « N devises — affichées séparément, jamais sommées », et son statut est au mieux `"info"`, jamais `"violation"` : il ne remonte pas dans le bandeau d'alerte.

**Rentabilité par projet** : `getProjectProfitability` ne renvoie même pas `mixedCurrency`
([convex/profitability.ts:189-205](convex/profitability.ts:189)). Le **tableau mensuel** n'est pas
zéroïsé (chaque mois a son `summarizeWhopRevenue` local, :124-126) et `ProfitabilityCard` applique le
taux du projet ligne à ligne ([ProfitabilityCard.tsx:82](components/ProfitabilityCard.tsx:82), :175).

**Code dormant** : `computeUnitEconomics` ([lib/analytics-hub.ts:829](lib/analytics-hub.ts:829)) divise
une LTV (devise du **revenu**) par un CAC (devise de la **paie**) et un CAC par `monthlyArpu`, sans
aucun taux — `UnitEconomicsInput` n'a pas de champ `fxRateToRevenue`, contrairement à `PromoRpmInput`
juste en dessous. **Aucun consommateur en prod** (grep : uniquement le fichier et son test).

**Situation observée** : une seule devise Whop aujourd'hui, donc aucun de ces cas ne se produit
actuellement en prod. **Non vérifié contre la prod** — je n'ai pas interrogé la base.

### G.4 — Conclusion devises

**Rien à faire dans la PR i18n.** Le chemin d'affichage dominant est déjà exactement ce que demande
la section G : `Intl.NumberFormat` + devise venue de la transaction, aucun défaut inventé. La PR i18n
n'aura qu'à **remplacer `"fr-FR"` par la locale active** dans `formatMoney` et les 3 autres familles
de formateurs. Aucune conversion, aucun taux, aucun backfill.

**Ce qui reste à trancher hors i18n, listé sans action de ma part :**

| # | Décision | Impact |
|---|---|---|
| D1 | Pas de `currency` sur `payments` : un créateur payé « sepa » (€) reçoit un dû libellé en USD | Modélisation paie |
| D2 | Les 8 hardcodes ci-dessus : #1 (CSV « € » sur des USD) est un **défaut d'affichage réel aujourd'hui** | Bug, indépendant de l'i18n |
| D3 | Garde revenus non composable : la somme client contourne la garde serveur | Latent, activé au 2ᵉ devise Whop |
| D4 | `MAX_PAY_PER_VIDEO_EUR` mal nommé | Cosmétique |
| D5 | `convex/whopApi.ts:176` : `?? "usd"` en défaut d'ingestion, alors que la doc interne dit « revenu Whop = euros ». Si Whop omettait le champ, `sameCurrency("usd","usd")` → true, `effectiveFxRate` → 1, marge calculée sans conversion | Latent |

---

## 5. Blocages et arbitrages **avant** Phase 1

Sept points qui changent la forme de la PR. Je ne les tranche pas.

### B1 — Texte français **persisté en base** (bloquant, non résoluble au read)

`payments.lineItems[].label` ([convex/schema.ts:1547](convex/schema.ts:1547)) stocke des **phrases
françaises figées avec date et pluriel inline**, écrites au paiement et rendues verbatim sur les deux
écrans Paiements — vérifié à la main :

```
convex/payments.ts:386   `Fixe — ${g.videoCount} vidéo${…"s"} publiée${…"s"}`
convex/payments.ts:395   `CPM — ${a.totalViews} vues`
convex/payments.ts:404   "Bonus paliers (cumul de vues)"
convex/payments.ts:284   `Forfait — cycle ${cycleIndex + 1}`
convex/assignments.ts:1748  `${format?.name ?? "Format"} — bonus (${views} vues cumulées)`
```

Ces libellés sont **gelés au paiement** — c'est intentionnel (mémoire projet : « le libellé de paie
est PERSISTÉ, ne pas changer son format »). Ils ne se traduisent ni au read ni par extraction.
Il faudrait un descripteur structuré + migration. **Même problème** pour `offerChanges.title/detail`
(`convex/analyticsHub.ts:1207`, seedé `--prod`) et `filterPresets.filters.statut` qui stocke
« Publié » / « À venir » ([convex/schema.ts:688](convex/schema.ts:688) ↔ [TrackerListSection.tsx:111](components/tracker/TrackerListSection.tsx:111), vérifié).

### B2 — Une mine : un message serveur français lu **par regex**

```
components/admin/AdminPublishForm.tsx:141
  if (/précède la\s+création/i.test(msg)) setBackdate(msg);
```

Le message vient de [convex/assignments.ts:2903](convex/assignments.ts:2903). **Traduire ce
`ConvexError` casse le flux de régularisation de date en silence, sans erreur de compilation.**
Vérifié à la main. C'est l'argument le plus fort pour la règle F (codes stables) — et il faut le
traiter en premier, pas en dernier.

### B3 — `convex/` est hors de portée de next-intl

342 `ConvexError` français sur 31 fichiers, tous affichés. La règle A6 du repo interdit à `convex/`
d'importer `lib/` (0 import, vérifié). Un catalogue en `lib/` serait inutilisable côté serveur : il
doit vivre en `convex/`, que `lib/` peut importer (précédent : `convex/rushStatus.ts`).
Trois options, à trancher : (a) codes stables `ERR_*` + mapping côté Next — c'est la règle F de
l'énoncé, la plus propre, mais 342 sites ; (b) locale passée en argument à chaque appel ;
(c) catalogue serveur autonome. **Idem pour les emails** (§B5).

### B4 — Répliques `lib/` ↔ `convex/` (règle A6)

18 paires de jumeaux dupliquent leurs libellés **sous test de parité** :
`notification-events`, `scriptDecision`, `countries`, `analytics-hub`, `tracker-data`,
`calendar-status`, `snytch-drive`, `payout`↔`payments`. **Extraire un seul côté fait diverger les
deux moteurs et casse la CI.** Les inventaires n'ont couvert que la moitié `lib/`.

Neuf modules `convex/` sont par ailleurs **importés directement par des composants**
(`roles`, `accountPhase`, `rushStatus`, `calendarStatus`, `postWindow`, `handleHygiene`,
`analyticsContract`…) : l'extraction ne peut pas s'arrêter à `app/` + `components/`.

### B5 — Emails : la locale doit vivre sur `creators`, pas sur `users`

**Contradiction entre deux agents, à trancher par le user.**

- Le destinataire d'un email est **toujours** une ligne `creators`, résolue par 3 points uniques
  (`getCreatorContact` L106, `getAssignmentNotifyData` L116, `listDeadlineReminderTargets` L145).
  L'email d'**invitation part avant que `creators.userId` existe** → argument pour poser `locale` sur `creators`.
- Mais `users` est la **seule entité commune aux 4 identités** (admin, créateur, clippeur, talent),
  et une fiche `creators` existe **par projet** → une créatrice sur 2 projets aurait 2 langues, et les
  admins n'ont pas de fiche `creators`.

**Résolution proposée** (à valider) : `locale` sur `users` pour l'UI, **plus** `locale` sur `creators`
pour l'email d'invitation pré-compte. L'énoncé demande `users` ; l'invitation est le seul cas qui ne
tient pas.

### B6 — Telegram : hors périmètre, **confirmé par le code**

`projects.notify.chatId` est un chat_id **unique par projet** (`schema.ts:168`, `notifyApi.ts:39`),
l'UI dit « ajoute le bot au groupe » (`NotificationSettings.tsx:221`) et
`convex/notificationMessage.ts:489` l'écrit : « le canal est un groupe partagé, pas une boîte
personnelle ». **Aucun destinataire humain à résoudre** → les ~87 chaînes restent en FR, conformément
à la règle I.

### B7 — Fuseaux horaires : ne pas unifier

Trois conventions coexistent **volontairement** et sont documentées champ par champ (Paris épinglé /
UTC délibéré / navigateur). Les unifier derrière un formateur unique réintroduirait la régression #52
(28 % des publications de prod décalées d'un jour). `formatDateFr` UTC de `emails.ts:73` est délibéré.
**À ne pas « généraliser » en passant.**

---

## 6. Pièges de l'extraction elle-même

### 6.1 — Pluriels et accords (156 sites)

Bonne nouvelle : le prédicat est uniformément `n > 1`, ce qui **coïncide exactement avec la catégorie
CLDR `one` du français** (0 et 1). Mauvaise nouvelle, les cas non mécaniques :

| Cas | Lieu |
|---|---|
| **Conjugaison de verbe** : `port{n>1?"ent":"e"}` | [pricings/page.tsx:350](app/admin/[projectSlug]/pricings/page.tsx:350) |
| **Pluriel anglais dans une phrase FR** : `rush{n>1?"es":""}` → « 3 rushes » | [paiements/page.tsx:548](app/admin/[projectSlug]/paiements/page.tsx:548) |
| **Accord féminin redoublé** : `créatrice${s} concernée${s}` | [pricings/page.tsx:200](app/admin/[projectSlug]/pricings/page.tsx:200) |
| **Triple accord** : `${ok} cycle${s} marqué${s} payé${s}.` | [paiements/page.tsx:219](app/admin/[projectSlug]/paiements/page.tsx:219) |
| **Accord de GENRE** : `isClip → Validé / Validée` | 3 sites |
| **Mot coupé entre 2 nœuds JSX** — extraction mécanique impossible | `CompteReassignDialog:333-339`, `pricings:350`, `NatureRewardsCard:112`, ~10 cas |
| **Titre de dialogue en 4 enfants JSX**, le « ? » isolé | [paiements/page.tsx:410-412](app/admin/[projectSlug]/paiements/page.tsx:410) |

### 6.2 — Le piège e2e qu'un grep ne trouve pas

`e2e/scripts-decision.spec.ts:263` matche `getByText("atteint 50 posts publiés")`. **Ce littéral
n'existe dans aucun fichier source** : il est produit par
`atteint{" "}{JUGEABLE_THRESHOLD} posts publiés` ([scripts/[id]/analytics/page.tsx:368](app/admin/[projectSlug]/scripts/[id]/analytics/page.tsx:368)).
Une extraction qui déplace le nombre dans une clé ICU casse ce spec **sans qu'un grep préalable ait
pu l'anticiper**. Il y en a d'autres du même type.

### 6.3 — Apostrophes : le piège classique est **absent**

**0 occurrence de U+2019** dans `app/`, `components/`, `lib/`, `convex/`, `e2e/` (l'unique du dépôt est
dans un commentaire de test). Tout est ASCII U+0027, écrit `&apos;` en JSX (282 occ. / 86 fichiers),
qui rend exactement U+0027. **Une chaîne JSON avec `'` sera rendu-identique.** Idem pour les 167 `{" "}` :
Playwright normalise les blancs.

**En revanche, un vrai piège ICU arrive** : en ICU MessageFormat, `'` devant un `{` **échappe le
placeholder**. `« l'{count} »` casse silencieusement. Un seul cas aujourd'hui
(`convex/rushScriptEligibility.ts:118`), mais il se multipliera à la réécriture. À couvrir par le
linter de la Phase 1.

### 6.4 — Tests unitaires

53 des 94 fichiers vitest assertent sur des libellés FR, **dont 13 qui lisent le source par
`readFileSync`** — ceux-là cassent par construction.

### 6.5 — Valeurs FR en base à mapper (règle E)

| Valeur | Où | État |
|---|---|---|
| `mecanique` : Erreur, Volume, Comparaison, Contradiction, Universalité, Question | `convex/schema.ts` `v.literal()` | **dormant** — retiré de l'UI, vérifié |
| `niveau` : Broad-A, Broad-B, Niché | idem | dormant |
| `angleTonal` : Psycho, Accusatoire, Pédagogique, Observation, Provocant | idem | **actif** — exposé brut en label de graphe par `lib/dashboard-stats.ts:101` |
| `statut` : « Publié », « À venir » | `filterPresets.filters.statut` | **actif** — vérifié |
| `interval` : jour/semaine/mois/trimestre/an | produit FR par `convex/whopApi.ts:231`, persisté, relu par un `switch` FR en `lib/churn.ts:260` | **actif, protocole serveur↔client** |
| `compte.statut` : « actif » | `lib/compte-status.ts` | mappé, jamais affiché brut |
| `paymentMethod` : « autre » | `lib/creator-status.ts` | mappé |
| `verdict` : « MOYEN » | `lib/verdict.ts` | actif |

**Défaut relevé au passage** : `PAYMENT_METHOD_LABELS` est **dupliqué et divergent** —
`app/admin/[projectSlug]/paiements/page.tsx:113` dit `sepa: "SEPA"`, `lib/creator-status.ts:55` dit
`sepa: "Virement SEPA"`. Deux clés i18n pour la même valeur stockée.

### 6.6 — Le coût caché : 67 fichiers de formatage

next-intl n'impose pas que d'extraire des chaînes : il faut router **nombres, dates et devises** par
la locale active. 67 fichiers appellent `"fr-FR"` / `Intl.*` / `localeCompare("fr")`, **dont 27 hors
inventaire** (`lib/currency.ts`, `lib/whop-revenue.ts`, `components/ui/calendar.tsx`, 22 fichiers `convex/`).

Deux formateurs construisent **virgule et séparateur de milliers à la main** — `formatPercent` et
`convex/emails.ts:formatAmount` (espace ASCII là où Intl produit U+202F) : **la locale n'aura aucun
effet dessus** tant qu'ils ne passent pas par Intl.

### 6.7 — Dates ambiguës FR/EN (18 sites)

Priorité sur les deux surfaces que l'énoncé désigne :
- **Tableau de paiements** : `PaiementsScreen:297/371/372` via `formatDate` (JJ/MM/AA) + libellés de lignes JJ/MM.
- **Panneau du calendrier de publication** : `AssignmentDetailSheet:70/255/329/538/644`.
- Pire cas : `TrackerDataView:858` — `shortDay` produit un axe X en JJ/MM **par découpage d'ISO, hors Intl**.

### 6.8 — Nom du fichier téléchargé

`lib/video-download.ts` construit `<creatorName>-<label>.mp4` en slugifiant **un libellé d'interface
français**. `paiements/page.tsx` exporte `paiements-cycles.csv` avec 7 en-têtes FR.
**Le nom du fichier livré changerait avec la locale** — à trancher (probablement : figer en anglais
ou garder FR).

---

## 7. Faisabilité de l'infra (Phase 1)

**Favorable dans l'ensemble.**

- Le layout racine est un **Server Component déjà dynamique** (`ConvexAuthNextjsServerProvider` appelle
  `cookies()`) : lire `NEXT_LOCALE` via `cookies()` y coûte **zéro**. `NextIntlClientProvider` s'insère
  proprement entre `<body>` et `ConvexClientProvider` (englober aussi le `Toaster`).
- **~100 % des strings sont côté client** (39/61 dans `app/`, 188/206 dans `components/` en `"use client"`).
  Seuls `app/layout.tsx` (metadata) et `app/not-found.tsx` exigent l'API serveur de next-intl.
- `resolveJsonModule` déjà actif.

**Deux points durs :**

1. **`app/[locale]/…` est impossible** : le segment dynamique racine est déjà pris par
   `app/[projectSlug]` (login brandé) — le préfixer casserait des URLs et 13 redirects.
   → confirme la stratégie de l'énoncé : **next-intl sans routing i18n, locale par cookie**.
2. **Lire `users.locale` avant le premier rendu n'est fait nulle part aujourd'hui** (0 occurrence de
   `convexAuthNextjsToken` / `fetchQuery` / `cookies()` dans `app|components|lib`). C'est **possible**
   via `convexAuthNextjsToken()` + `fetchQuery` dans le layout, mais au prix d'un **aller-retour Convex
   bloquant par page**. Le cookie évite ce coût, et `AppShell` masque déjà la pré-hydratation par un
   spinner sans texte → **pas de flash FR→EN si on s'appuie sur le cookie**, la lecture Convex ne
   servant qu'à re-synchroniser le cookie après login.

**Écran de réglages** : **aucun n'existe côté admin** — surface à créer. Côté portail, seul
`ProfilScreen` convient, et seulement pour les partenaires.

**Branchement CI** : job `test` de `.github/workflows/e2e.yml` (clé à **ne jamais renommer**), étape
vitest ligne 66, précédent déjà en place avec `scripts/verif-harnais.sh` ligne 46.
`eslint.config.mjs` n'a **aucune règle custom** — `scripts/check-i18n.mjs` s'y branche sans conflit.

---

## 8. Découpage proposé (l'extraction dépasse largement 40 fichiers)

265 fichiers à toucher → **7 PRs**. Ordre imposé par les dépendances, pas par le volume.

| PR | Contenu | Fichiers ≈ | Strings ≈ |
|---|---|---:|---:|
| **0** | **Arbitrages B1→B5** + infra seule (next-intl, provider, cookie, `users.locale` + mutation, sélecteur, types générés, `scripts/check-i18n.mjs` + CI). **Zéro extraction.** | ~15 | 0 |
| **1** | Layout, nav, UI partagée, portails publics (login/join/reset) | 24 | ~150 |
| **2** | **Frontière Convex** : 342 `ConvexError` → codes stables + mapping. **Doit précéder tout le reste** (B2). | ~35 | ~340 |
| **3** | Analytics (hub + tracker + Whop) — le plus gros bloc | 22 | ~850 |
| **4** | Admin : pages + `components/admin` | 56 | ~1 140 |
| **5** | Rôles : comptes, créateurs, talent, clippeur, portail créateur | 57 | ~900 |
| **6** | Emails (catalogue serveur autonome, locale destinataire) | ~5 | ~50 |
| **7** | Reste : inspirations, nouveau, scripts, calendrier, racine, `lib/` | 53 | ~1 030 |

**PR 2 avant PR 3-5** : la mine `AdminPublishForm:141` et les 342 messages serveur conditionnent la
forme de tout le reste. Extraire les écrans d'abord obligerait à y repasser.

---

## 9. Ce que je n'ai pas vérifié

- **Aucun appel à la prod.** Toutes les affirmations sur le comportement multi-devise sont
  structurelles (lecture de code), pas observées.
- Les décomptes de strings sont des **ordres de grandeur** issus d'agents, pas un inventaire ligne à
  ligne. Seuls les points cités avec `fichier:ligne` en §4, §5 et §6.5 ont été **re-vérifiés à la main**.
- Je n'ai pas ouvert les 151 specs e2e une par une : le chiffre « 1 014 sélecteurs texte / 90 specs »
  vient d'un agent.
- `convex/scriptSeedData.ts` (~18 « € », 60 strings) et `convex/demoSeed.ts` : classés
  « contenu, hors périmètre » **par moi**, pas par une règle explicite de l'énoncé. À confirmer.

---

## 10. STOP — j'attends validation

Questions ouvertes avant Phase 1, par ordre d'impact :

1. **B3/PR2** — les 342 `ConvexError` : codes stables `ERR_*` (règle F, propre, 342 sites) ou locale
   passée en argument ?
2. **B1** — `payments.lineItems[].label` : on laisse le français figé en base (l'historique de paie
   reste FR pour tout le monde), ou on remodélise + migre ?
3. **B5** — `locale` sur `users` seul (l'invitation pré-compte partira alors en FR) ou `users` + `creators` ?
4. **§6.8** — noms de fichiers téléchargés : figés en anglais, ou traduits ?
5. **§9** — seeds `convex/scriptSeedData.ts` / `demoSeed.ts` : hors périmètre, confirmé ?
6. **§4/D2** — le CSV « Total dû (€) » sur des montants USD est un défaut d'affichage **actuel** :
   je le corrige dans la PR 4, ou tu le traites à part ?

---

# ÉTAPE 0 — VÉRIFICATION PROD (bloquante)

Réalisée le 2026-08-21 sur `giddy-bass-969` (prod), par **export snapshot en lecture seule**
(`npx convex export --prod`). Aucune écriture, aucune fonction exécutée, aucune variable d'env lue.

## 0.1 — Valeurs distinctes de devise, avec volume

### Revenu — `whopPayments` (164 lignes, **un seul projet** : snytch)

| Devise | `paid` | `failed` | `refunded` | `pending` | **Total** |
|---|---:|---:|---:|---:|---:|
| **eur** | **123** | 31 | 8 | 1 | **163** |
| **usd** | **0** | **1** | 0 | 0 | **1** |

Σ net encaissé : **1 185,81 € brut de table** ; net sécurisé (`status = "paid"`) = **833,41 €**.
Σ usd : **5,99 $**, sur une ligne **`failed`**.

**La ligne usd** : `pay_xF6gztDIswuQdT`, `memberName: "anthosimo"` (compte de test admin),
`status: "failed"`, `failureMessage` bancaire, `refundedAmount: 0`,
`billingReason: "subscription_create"`, `membershipId: mem_cQrqcTIY2B7Qwm`,
`planId: plan_nAPsb2Wyhia7X`. **Ce membership ne porte que cette seule ligne** (vérifié).

### Paie créatrices — `payments` (16 cycles)

**Aucun champ `currency` sur les 16 lignes** (vérifié sur l'export, pas seulement sur le schéma).
La devise dérive de `projects.payCurrency`, et **les 3 projets sont en `usd`** :

| Projet | `payCurrency` | `fxRateToRevenue` | Cycles | Σ `totalDue` |
|---|---|---|---:|---:|
| snytch | `usd` | **0.86** | 14 | 769,62 |
| repackit | `usd` | *(absent)* | 2 | 0,00 |
| thea-app | `usd` | *(absent)* | 0 | — |

**Une seule devise de paie en prod.**

### Offres — `whopPlans` (15 lignes) : 14 `eur` + **1 `usd`**

Le plan usd est `plan_nAPsb2Wyhia7X` « Pro — Weekly » 5,99 $ — **le plan de la ligne échouée**.
Il existe aussi un plan **eur** homonyme « Pro — Weekly » à 7,99 € (`plan_22OfkN5xAE13m`, 8 abonnés,
actif).

## 0.2 — Verdict : aucune métrique affichée ne mélange deux devises aujourd'hui

Vérifié sur 4 axes (sommes de périodes, offres/plans, marge, paie) puis soumis à
**3 réfutations adversariales indépendantes** — les trois ont rendu **`refuted: false`**.

**Mécanisme unique et vérifiable :** `isSecuredRevenue(status) = status === "paid"`
([convex/whopRevenue.ts:75](convex/whopRevenue.ts:75)) ⇒ `paymentCount` du bucket usd reste 0 (:188)
⇒ écarté par `collected = byCurrency.filter(c => c.paymentCount > 0)` (:211)
⇒ `currencies = ["eur"]`, longueur 1 ⇒ **`mixedCurrency` n'est jamais levé**.
Partout ailleurs la ligne usd contribue exactement 0 (`whopNetContribution` rend 0 hors `"paid"`).

**Les deux seuls pixels où la ligne usd compte pour autre chose que 0 sont des COMPTES, pas des
montants** : la colonne « Échecs » du détail par jour (+1 le 14/07/2026), et « Hebdomadaire N clients »
de l'onglet Offres (+1). Défaut générique « membership sans encaissement compté comme client »,
sans rapport avec la devise (les 31 échecs eur produisent le même effet).

**Ce qu'un humain voit réellement** sur « Économie par offre » : la ligne
« Pro — Weekly · **5,99 $** / semaine », badge « historique », `opacity-60`, **ses 4 colonnes
chiffrées remplacées** par « Aucun paiement encaissé sur cette offre, seulement des tentatives
échouées », deux rangs sous « Pro — Weekly · **7,99 €** ». Chaque ligne est formatée avec **sa
propre** devise (`OffresTab.tsx:807/819`), jamais avec la devise globale. Aucune somme ne mélange.

**Marge — sens du taux vérifié chiffre en main.** `effectiveFxRate("usd","eur",0.86) = 0.86`
puis `computeMargin` fait `revenueNet − creatorCost × fx` ([lib/profitability.ts:29](lib/profitability.ts:29)) :
`833,41 € − 769,62 $ × 0,86 = 833,41 − 661,87 = +171,54 €` (vert).
Une inversion aurait donné `769,62 / 0,86 = 894,91` ⇒ `−61,50 €` (rouge) — **le signe de la marge
aurait basculé**. Il ne bascule pas. Contrôle indépendant : un taux usd→eur est nécessairement < 1 ;
0,86 n'est cohérent qu'avec ce sens.

## 0.3 — DETTE : le défaut de composition est LATENT, pas actif

La garde A5 est posée **par période** côté serveur ([convex/analyticsHub.ts:875](convex/analyticsHub.ts:875))
puis les composants **additionnent les périodes côté client** :
[OverviewTab.tsx:245](components/analytics/hub/OverviewTab.tsx:245),
[PromoRpmCard.tsx:72](components/analytics/hub/PromoRpmCard.tsx:72).
`revenue.mixedCurrency` est renvoyé mais **aucun composant ne le lit** (0 occurrence).

**Déclencheur 1 — un paiement usd passe `"paid"`.** La garde zéroïse alors le net **entier** des mois
bi-devises (y compris leur part eur) et laisse intacts les mois mono-devise ; le reduce client
additionne ensuite un mois eur et un mois usd. Le total serait faux **deux fois**, affiché **sans
symbole** (`currency = null` ⇒ `formatMoney` sans devise, [lib/format-rate.ts:24](lib/format-rate.ts:24))
et **sans aucun avertissement**.

**Déclencheur 2 — trouvé par la réfutation, plus insidieux, n'exige AUCUN encaissement usd.**
Dans la branche **non** mixte, `refunded` et `disputed` sont sommés sur **tous** les buckets de devise
([convex/whopRevenue.ts:239-240](convex/whopRevenue.ts:239)), alors que ni un remboursement ni un
litige n'incrémente `paymentCount`. **Une 2ᵉ devise présente uniquement en remboursement ou en litige
mélange donc les montants « à risque » et « remboursements » en gardant `mixedCurrency` à `false`,
`currency` à `"eur"`, le symbole € affiché et le contrôle de fiabilité au vert.**
Surfaces concernées : `OffresTab.tsx:275/288`, `OverviewTab.tsx:285`, `WhopRevenueCard.tsx:132`.
Ce déclencheur contamine aussi `dailyNet` (:976), dont la garde est pourtant au bon niveau
d'agrégation : son prédicat, `mixedCurrency`, ne voit que les devises **encaissées**.

**Surface d'argent sans garde A5 du tout** : `splitRevenueByOrigin` et `computeRenewalStats`
([convex/whopRevenue.ts:345-390](convex/whopRevenue.ts:345), :606-700) alimentent **tout l'onglet
Rétention** sans la moindre garde, pas même par période.

**Sans garde de devise non plus** : [RetentionTab.tsx:151](components/analytics/hub/RetentionTab.tsx:151)
applique `attribution?.fxRateToRevenue` **brut**, seul consommateur de taux de l'app à ne pas passer
par `effectiveFxRate` — donc à ne pas vérifier que les deux devises diffèrent.

## 0.4 — Défaut ACTIF trouvé au passage (chiffre faux aujourd'hui, sans rapport avec l'i18n)

[convex/profitability.ts:112-114](convex/profitability.ts:112) collecte `whopPayments` **sans aucun
filtre de compte interne**, alors que tout le hub les exclut
([convex/analyticsHub.ts:830](convex/analyticsHub.ts:830), :1075, via `internalAccountsFor`).

**Mesuré sur l'export prod, à la main :**

| Grandeur | Écran | Valeur |
|---|---|---:|
| Net encaissé, tous comptes | Carte Rentabilité « Revenu Whop » | **833,41 €** |
| Net encaissé hors `mem_4Hrv8RLuDels71` | Hub « Revenu net encaissé » | **826,09 €** |
| **Écart** | | **7,32 €** |

Les 7,32 € sont **un paiement encaissé du compte interne `sofiamatcha`**. La marge et le RPM business
de la carte Rentabilité sont donc gonflés d'autant.

**Second point** : `internalAccounts.ts` n'exclut que `mem_4Hrv8RLuDels71` (« sofiamatcha »).
**`mem_cQrqcTIY2B7Qwm` (« anthosimo », le compte de test de l'admin) n'y est pas** — c'est
précisément lui qui produit la ligne d'offre « 5,99 $ » et le +1 sur « Hebdomadaire N clients ».
Le renseigner ferait disparaître les deux symptômes.

## 0.5 — Portée de la vérification

- Snapshot du 2026-08-21 uniquement. Rien ne garantit qu'un paiement usd ne passera pas `paid` demain.
- Les montants ci-dessus sont recalculés **par moi** sur l'export (`jq` + `awk`), pas lus dans l'UI.
  `769,62 $` est la Σ `totalDue` des cycles, utilisée comme **proxy** du coût créatrices — la carte
  Rentabilité, elle, recalcule via `computeLivePricingBreakdown`, donc son coût réel peut différer.
- Je n'ai pas ouvert l'application.

---

# ANNEXE — QUANTIFICATION DU DÉFAUT `perMembership`

Lecture seule, export snapshot prod du **2026-08-21 (168 lignes `whopPayments`)**.
**Aucune correction.** Chantier analytics, après l'i18n.

## Le défaut

[convex/analyticsHub.ts:887-897](convex/analyticsHub.ts:887) ouvre une entrée `perMembership`
pour **tout** paiement portant un `membershipId`, **sans filtre de statut** :

```ts
for (const p of payments) {
  if (!p.membershipId) continue;          // ← seule condition
  const net = whopNetContribution(p);     // 0 si le paiement n'est pas "paid"
  const cur = perMembership.get(p.membershipId) ?? { net: 0, ... };
  cur.net += net;
  if (net > 0) cur.months.add(periodOf(p.paidAt));
  perMembership.set(p.membershipId, cur);
}
```

Un abonnement dont **tous** les paiements ont échoué crée donc une entrée à net 0, puis
`byPlan.members += 1` ([:904-912](convex/analyticsHub.ts:904)). Il compte comme abonné sans
avoir jamais payé un centime.

**27 memberships sur 115 (23 %)** sont dans ce cas : **24 en échec pur, 3 intégralement
remboursés**.

## Contradiction interne, visible dans le même produit

| KPI | Écran | Base | Valeur |
|---|---|---|---:|
| **Clients payants** | Vue d'ensemble / Fiabilité | `whopCollectedAmount > 0` (paid\|disputed) | **88** |
| **Abonnés** (Σ colonne) | Offres | `perMembership.size`, aucun filtre | **115** |

**27 personnes d'écart entre deux compteurs du même hub**, sur le même périmètre, parce que
l'un filtre et l'autre non.

## Chiffres AFFICHÉS — colonne « Abonnés » par offre

Base : exclusion A4 complète (post-[#76](https://github.com/anthosimo33-coder/repackit-distribution-tracker/pull/76)).
Avant #76 le total affiché est **116** (le compte de test `anthosimo` en plus).

| Offre | Affiché | Réel | Écart |
|---|---:|---:|---:|
| Snytch Pro — Hebdo · 4,99 €/sem | 59 | 50 | **+9** |
| Snytch Pro 3 cibles — Hebdo | 29 | 23 | **+6** |
| **Snytch Pro — Mensuel · 16,99 €/mois** | **11** | **2** | **+9 — ×5,5** |
| Pro — Weekly | 8 | 7 | +1 |
| Snytch Pro 3 Cibles— Mensuel | 5 | 4 | +1 |
| Unlock the names on big accounts… | 1 | 0 | +1 |
| Pro — Monthly | 1 | 1 | 0 |
| Cible supplémentaire — Hebdo | 1 | 1 | 0 |
| **TOTAL** | **115** | **88** | **+27** |

**Le pire cas est le mensuel à 16,99 €** : 11 abonnés affichés, **2 payants réels**. C'est
précisément l'offre dont l'onglet cherche à établir si « le mensuel se vend » — la réponse
affichée est cinq fois trop optimiste.

## Chiffres AFFICHÉS — répartition Hebdo / Mensuel

| Ligne | Affiché | Réel | Écart |
|---|---:|---:|---:|
| « Hebdomadaire N clients » | 98 | 81 | **+17** |
| « Mensuel N clients » | 17 | 7 | **+10** |

## LTV — calculée, mais AFFICHÉE NULLE PART

Vérifié : `grep -rn '\.ltv\|monthlyArpu' components/ app/` → **0 occurrence**. Les champs
`plans[].ltv`, `revenue.ltv` et `revenue.monthlyArpu` sont renvoyés par le serveur et lus par
aucun composant. Les valeurs ci-dessous sont donc **fausses mais invisibles** — à corriger
avant tout affichage, pas après.

| Grandeur | Calculée | Réelle | Écart |
|---|---:|---:|---:|
| `ltv` global | 7,59 € | 9,92 € | **−23 %** |
| `ltv` — Snytch Pro Mensuel 16,99 € | 2,91 € | 15,99 € | **−82 %** |
| `ltv` — Snytch Pro 3 cibles Hebdo | 7,67 € | 9,67 € | −21 % |
| `ltv` — Snytch Pro Hebdo 4,99 € | 5,46 € | 6,45 € | −15 % |
| `ltv` — Pro — Weekly | 19,29 € | 22,05 € | −13 % |
| `ltv` — Snytch Pro 3 Cibles Mensuel | 22,76 € | 28,45 € | −20 % |

Le dénominateur est gonflé, le numérateur non (les échecs valent 0) : **la LTV est
sous-estimée**, de 13 % à 82 % selon l'offre.

## Ce qui n'est PAS touché — vérifié

| Grandeur | Statut | Pourquoi |
|---|---|---|
| `monthlyArpu` | **identique** (8,82 €) | `memberMonths` ne compte que les mois à `net > 0` — les 27 y contribuent 0 |
| `netPerMemberMonth` (« Net/mois/abonné », affiché) | **identique** | même raison : `netTotal / memberMonths`, dénominateur déjà propre |
| `netPerPayment` (affiché) | **identique** | vient de `summarizeWhopRevenue.paymentCount`, pas de `perMembership` |
| Tous les MONTANTS (net, brut, frais, marge) | **identiques** | les 27 contribuent 0 € |

**Le défaut ne touche que des COMPTES et les ratios qui les prennent au dénominateur.**
Aucun montant affiché n'est faux de ce fait.

## Réserve

Le partage entre « échec » et « remboursé » est lu sur `status` au moment de l'export. Un
abonnement en échec aujourd'hui peut encaisser demain : les 24 échecs purs ne sont pas
définitivement des non-clients, ce sont des non-clients **à cette date**. La correction devra
trancher si « abonné » veut dire « a payé au moins une fois » (ce que suppose ce calcul) ou
« a un abonnement actif », qui est une autre question et se lit dans `whopMemberships`.
