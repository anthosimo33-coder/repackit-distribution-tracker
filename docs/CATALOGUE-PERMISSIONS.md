# Catalogue de permissions

> Chantier « rôle manager ». Suite de [AUDIT_ROLE_MANAGER.md](../AUDIT_ROLE_MANAGER.md),
> du commit `580212b` (Étape 0 — colmatage des fuites) et de la conception validée.
> **Étapes 1 et 2 implémentées** : le socle et le cliquet. Les 212 fonctions
> d'administration ne sont PAS migrées — elles restent sur `adminQuery`/`adminMutation`.

Décisions actées :
- **Option C** — permissions granulaires cochables par personne, pas un rôle figé.
- Le manager est rattaché à **un projet** précis (on s'appuie sur `memberships`).
- **Frontière argent** : il voit le **tarif unitaire** d'une vidéo qu'il assigne ;
  il ne voit ni coordonnées de paiement, ni tarifs négociés, ni totaux dus, ni CA.
- Les permissions **s'ajoutent** au rôle : `admin` reste « tout », **aucune migration**.

---

## Résumé (10 lignes)

1. Il y a **21 cases à cocher**, qui couvrent les **212** fonctions d'administration. Aucune fonction n'est restée sans case.
2. Sur un manager type, **12 cases sont cochées** et **9 décochées**. Les décochées sont l'argent, les réglages système, la suppression d'une créatrice et les écrans historiques.
3. Les cases sont rangées en **5 sections** — Créateurs, Production, Contenu, Argent, Système — et c'est ce regroupement que l'écran de gestion utilisera.
4. **Toute la section Argent est décochée**, et ce n'est pas une liste à maintenir : un test vérifie qu'aucun bloc de cette section ne peut être coché par défaut.
5. Le socle est **posé et vérifié** : un manager sans case cochée est refusé partout, une case cochée ouvre son bloc et pas celui d'à côté.
6. Le point le plus important est vérifié au runtime : **un droit écrit à la main en base, hors catalogue, n'ouvre rien**. On autorise parce qu'un nom appartient au catalogue, jamais parce qu'il est présent en base.
7. **Vos admins actuels n'ont rien vu passer** : ils gardent le rôle `admin`, qui donne tout sans qu'aucune case ne soit écrite. C'est ce qui rend la migration inutile.
8. Chaque changement de droits est **journalisé** (qui, quand, quelle personne, quelle case, dans quel sens), y compris ceux faits en ligne de commande.
9. Un **cliquet** empêche qu'une fonction ajoutée dans six mois échappe au système : elle fait échouer la CI tant qu'elle n'a pas déclaré sa case.
10. Reste à faire : découper les fonctions qui mélangent gestion et argent, puis migrer les 212 — **≈ 9 jours**, dont 4 pour un manager réellement opérationnel.

---

## 1. Le catalogue

`✓` = coché par défaut pour un manager. `Fn` = nombre de fonctions couvertes. Le risque décrit ce qui arrive **si la case est cochée par erreur**.

| # | Identifiant | Section | Libellé (écran de gestion) | Ce que la personne pourra faire | Déf. | Fn | Risque si coché par erreur |
|---|---|---|---|---|---|---|---|
| 1 | `creators.read` | Créateurs | **Voir les Créateurs** | Consulter la liste et la fiche d'une créatrice : identité, statut, langue, fuseau. | ✓ | 3 | 🟢 Faible — lecture d'annuaire interne. |
| 2 | `creators.manage` | Créateurs | **Gérer les Créateurs** | Inviter, modifier une fiche, changer un statut, archiver, régénérer un lien de connexion. | ✓ | 5 | 🟠 Moyen — inviter et archiver engagent, mais rien n'est effacé. |
| 3 | `creators.delete` | Créateurs | **Supprimer une créatrice** | Effacer définitivement une créatrice, ses comptes, ses publications et ses missions. | ✗ | 2 | 🔴 **Élevé** — efface la créatrice, ses comptes, ses publications et ses missions. |
| 4 | `accounts.manage` | Créateurs | **Comptes et chauffe** | Créer, modifier, valider, refuser, archiver des comptes ; piloter le protocole de chauffe. | ✓ | 19 | 🟠 Moyen — archiver retire un compte des cibles ; relancer une chauffe décale une mise en production. |
| 5 | `assignments.manage` | Production | **Assignments et planning** | Confier des Assignments, fixer dates et créneaux, joindre consignes, exemples et Assets. Montre le tarif unitaire de la vidéo. | ✓ | 16 | 🟠 Moyen — `deleteAssignment` efface une ligne, et assigner **fige un tarif**. |
| 6 | `review.manage` | Production | **Validation et Rushes** | Approuver ou refuser une vidéo soumise, trancher les Rushes déposés, publier à la place d'une créatrice. | ✓ | 10 | 🟠 Moyen — approuver **déclenche l'accrual de paie** ; publier ancre la date qui sert au calcul. |
| 7 | `scripts.manage` | Production | **Scripts et campagnes** | Créer et modifier campagnes, briques et formats ; éditer un script sur une mission ; graduer un hook. | ✓ | 22 | 🟠 Moyen — les formats portent une grille de paie (`rateModel`), à projeter hors du payload. |
| 8 | `challenges.run` | Production | **Animer les Défis** | Ouvrir et clore un défi, fixer les participantes, suivre le classement, retirer une vidéo, annuler une victoire. | ✓ | 10 | 🟠 Moyen — annuler une victoire retire un gain acquis ; le budget, lui, reste hors de portée. |
| 9 | `library.manage` | Contenu | **Inspirations, Assets et hooks** | Gérer les Inspirations et leurs dossiers, les ICP, la bibliothèque de hooks, les dossiers d'Assets et les filtres favoris. | ✓ | 28 | 🟢 Faible — matière première de production, ni donnée personnelle ni montant. |
| 10 | `guide.manage` | Contenu | **Comment ça marche** | Écrire et publier les modules du guide lu par les créatrices, dans les deux langues. | ✓ | 8 | 🟢 Faible — contenu lu par les créatrices ; une erreur se corrige. |
| 11 | `tracker.manage` | Contenu | **Tracker et publications** | Saisir et corriger des relevés, gérer les publications, déclencher un relevé de vues, marquer un post comme chauffe. | ✓ | 13 | 🟠 Moyen — le drapeau « chauffe » décide si un post est payé (tracé, cf. §4) ; les synchros sont facturées. |
| 12 | `content.analytics` | Contenu | **Performance des contenus** | Lire le Tracker, les KPI du Dashboard, les verdicts par script, les courbes de vues et le taux de publication à l'heure. | ✓ | 14 | 🟢 Faible — vues et engagement, jamais d'euros. |
| 13 | `radar.use` | Contenu | **Radar** | Suivre des comptes TikTok, consulter les tendances, lancer une recherche d'outliers. | ✓ | 11 | 🟠 Moyen — chaque synchro est **facturée à l'usage** (Apify). |
| 14 | `creators.pay_terms` | Argent | **Conditions de rémunération** | Voir et modifier le tarif négocié, le forfait mensuel, la grille de bonus et les coordonnées de paiement d'une créatrice. | ✗ | 0* | 🔴 **Élevé** — RIB/PayPal en clair, et un tarif modifié change ce qui sera versé. |
| 15 | `pricing.manage` | Argent | **Pricings** | Créer et modifier les grilles de rémunération : fixe, CPM, paliers de bonus. | ✗ | 9 | 🔴 **Élevé** — c'est la définition de ce que coûte chaque vidéo. |
| 16 | `payments.manage` | Argent | **Paiements** | Voir les cycles et les totaux dus, calculer les bonus de vues, marquer un paiement comme payé. | ✗ | 9 | 🔴 **Élevé** — montants dus, coordonnées bancaires à l'export, marquage « payé » irréversible en pratique. |
| 17 | `business.read` | Argent | **Analytics et revenus** | Revenu Whop, marge, RPM, rétention et churn, conversions par créatrice, analytics produit. | ✗ | 14 | 🔴 **Élevé** — c'est le compte d'exploitation de la boîte. |
| 18 | `challenges.money` | Argent | **Budget des Défis** | Créer et modifier un défi : objectif, récompense, budget et barème associé. | ✗ | 4 | 🔴 **Élevé** — fixe un budget et un barème, donc ce que le défi va coûter. |
| 19 | `notifications.manage` | Système | **Notifications** | Choisir les alertes Telegram de l'équipe et leur destinataire. | ✗ | 2 | 🔴 **Élevé** — le digest transporte le **total dû**, et on peut rediriger les alertes. |
| 20 | `project.settings` | Système | **Réglages du projet** | Durée de chauffe, délai de réutilisation d'un combo, réglages de l'espace talent. | ✗ | 6 | 🟠 Moyen — règles structurantes qui s'appliquent à toutes les créatrices. |
| 21 | `legacy.access` | Système | **Écrans historiques** | Carrousels, Shorts et sources — des écrans retirés du menu dont les routes répondent encore. | ✗ | 7 | 🟢 Faible — écrans hors menu, sans donnée financière. Décoché pour ne pas prolonger leur vie. |

\* `creators.pay_terms` **ne couvre encore aucune fonction entière** : les champs qu'il protège (tarif négocié, forfait, grille de bonus, coordonnées de paiement) vivent à l'intérieur de `getCreator` et `updateCreator`, qui font aussi de la gestion. Ce bloc devient réel à l'étape 3. C'est le seul du catalogue qui exige un changement de code pour exister — et c'est le plus important : sans lui, « gérer une créatrice » veut dire « modifier sa rémunération ».

**21 blocs · 12 cochés · 9 décochés · somme des fonctions = 212.**

> ⚠️ Ce tableau et le module `convex/permissions.ts` sont **tenus alignés par un test**
> (`scripts/check-permission-coverage.mjs`, porté par `pnpm test:unit`). Un bloc ajouté
> d'un côté sans l'autre fait échouer la CI. Le document est ce que vous lirez dans
> l'écran de gestion : un document faux serait pire qu'un document absent.

### Les libellés reprennent le vocabulaire de l'app

« Assignments », « Validation », « Rushes », « Pricings », « Paiements », « Inspirations », « Assets », « Radar », « Défis », « Comment ça marche » : ce sont les mots **exacts** du menu (`messages/fr.json`, clés `nav.item.*`), pas une traduction des noms techniques. La personne qui coche doit retrouver le mot qu'elle voit à l'écran. C'est pour ça que le bloc des missions s'appelle « Assignments et planning » et non « Missions » : l'app dit *Assignments*.

---

## 2. Les fonctions qui demandent encore une décision

**28 fonctions sur 212.** Les arbitrages rendus ont déjà retiré 5 cas de cette liste (`deleteCreator` et `getCreatorDeletionImpact` ont leur bloc, les défis sont scindés).

### 2.1 🟠 Mixtes — un geste de gestion ET une donnée financière dans le même appel (17)

Ces fonctions **ne peuvent pas être rangées d'un côté**. Elles sont la matière de l'étape 3.

| Fonction | Le geste de gestion | Ce qui est financier | Décision |
|---|---|---|---|
| `updateCreator` | nom, téléphone, statut, langue, fuseau, ref, population, clippeur | `clipRate`, `cycleRetainer`, `bonusPricingId`, `paymentMethod`, `paymentDetails` | **COUPER** → `updateCreatorPayTerms` sous `creators.pay_terms`. La plus urgente des 17. |
| `getCreator` | la fiche affichée par le manager | les 5 champs ci-dessus, servis dans le même objet | **COUPER** → `getCreatorPayTerms`. Même patron que `listCreators` à l'Étape 0. |
| `createFormat` | brief, hooks, do/don't, vidéos exemples | `rateModel` (fixe par post + bonus au mille) | **COUPER** : la grille passe sous `pricing.manage`. |
| `updateFormat` | idem | idem | **COUPER**, idem. |
| `listFormats` | catalogue des briefs | `rateModel` dans le payload | **PROJETER** : retirer `rateModel` sans `pricing.manage`. |
| `getFormat` | détail du brief | `rateModel` | **PROJETER**, idem. |
| `getChallenge` | réglages, participantes, classement, victoires | barème et récompense | **PROJETER** : masquer budget et barème sans `challenges.money`. |
| `listAssignments` | la liste des Assignments | `rateSnapshot`, `pricingSnapshot`, `clipRateSnapshot` | **GARDER** — c'est la frontière tranchée : le manager voit le tarif unitaire. |
| `assignFormat` | confie un Assignment | fige un `pricingSnapshot` | **GARDER**, même arbitrage. |
| `assignScriptCampaign` | assigne N × M | fige un `pricingSnapshot` | **GARDER**, idem. |
| `assignScriptToRush` | monte un script sur une prise | lit `clipRate` sur la fiche du clippeur | **GARDER TEL QUEL** — elle *lit* le tarif sans le *renvoyer*. C'est le bon patron. |
| `setPublicationWarmup` | fait éditorial | décide si le post est payé | **GARDER coché**, mais **TRACER** — cf. §3.6. |
| `getPublicationPayFlags` | lit les deux drapeaux | dont le drapeau « rémunéré » | **GARDER coché** (lecture seule). |
| `createChallenge` | crée un défi | `budget`, `montantFixe`, `pricingId` | **`challenges.money`**, décoché. |
| `updateChallenge` | modifie un défi | idem | **`challenges.money`**, décoché. |
| `setChallengeParticipants` | fixe les participantes | fige un `pricingSnapshot` par participante | **`challenges.run`** (coché) — le barème vient du défi, pas de ce geste. À revérifier à l'étape 8. |
| `setNotifySettings` | choisit les alertes | déclencheurs Whop ; le digest porte le **total dû** | **`notifications.manage`**, décoché tant que le digest n'est pas scindé (chantier séparé). |

### 2.2 🔵 À cheval — deux blocs légitimes, sans composante financière (4)

| Fonction | Tension | Décision |
|---|---|---|
| `deleteAssignment` | gestion courante, mais **hard-delete** | Reste dans `assignments.manage`. Un bloc « destructif » par verbe multiplierait les cases sans réduire le risque. |
| `deleteCompte` | idem, borné aux comptes vierges | Reste dans `accounts.manage` — le serveur refuse déjà si le compte a servi. |
| `generatePasswordResetLink` | support quotidien, action sensible | Reste dans `creators.manage` ; le serveur refuse déjà un superadmin. |
| `confirmPublicationAsAdmin` | publication **et** ancre la date qui sert à la paie | Reste dans `review.manage` — une date est un fait, pas un montant. |
| `updatePublishedAccount` | correction de saisie, une seule fois | Reste dans `tracker.manage`. |
| `cancelChallengeWin` | animation, mais **annule un gain acquis** | Reste dans `challenges.run` (coché) : annuler une victoire est un geste d'animation, et le motif est obligatoire. |
| `setChallengeVideoRemoved` | retire une vidéo du score (elle reste payée) | Reste dans `challenges.run`. |
| `listChallengePricings` | sert un sélecteur, **lit les barèmes** | Passé sous `challenges.money` (décoché) : c'est une lecture de barèmes. |

### 2.3 ⚪ Le tracker legacy — un bloc qui est un marqueur (7)

`getNextCarouselId`, `getByCarouselId`, `duplicateCarousel`, `updateDraft`, `listSources`, `getSourceStatus`, `renameSourceId`.

Leurs écrans (`/carrousels`, `/shorts`, `/shorts/sources`, `/screenrecorder`) **ne sont plus dans le menu** depuis longtemps, mais leurs routes répondent toujours.

Elles ont désormais leur bloc, **`legacy.access`, décoché**. Ce bloc n'est pas là pour être coché : **c'est le marqueur du chantier de suppression à venir.** Tant qu'il existe, il compte exactement ce qu'il reste à retirer, et son nombre — 7 — est visible dans le catalogue plutôt qu'enfoui dans un fichier de dette. Le jour où ces écrans partent, le bloc disparaît avec eux, et le catalogue tombe à 20.

---

## 3. Le modèle technique — ce qui est implémenté

### 3.1 Où vivent les permissions

Sur **`memberships`**, champ `permissions: v.optional(v.array(v.string()))`. Pas de table dédiée.

1. **C'est le bon grain.** Un droit vaut pour une personne × un projet — la clé exacte de `memberships` (`by_user_project`).
2. **Zéro lecture supplémentaire.** `requireProjectAdmin` lit **déjà** ce document à chaque requête gardée. Une table dédiée ajouterait un aller-retour sur chacune des 212 fonctions — Convex n'a pas de jointure.
3. **Révocation immédiate.** Le rôle et les droits sont relus en base à chaque requête, jamais portés par le JWT. Décocher prend effet à la requête suivante, sans reconnexion.

### 3.2 La cascade — les permissions s'AJOUTENT au rôle

`requirePermission` (`convex/functions.ts`) :

```
1. superadmin            → AUTORISÉ   (inchangé)
2. pas de membership     → REFUSÉ
3. membership "admin"    → AUTORISÉ   sans lire `permissions`
4. membership "manager"  → AUTORISÉ   ssi le bloc est accordé
5. tout le reste         → REFUSÉ
```

L'étape 3 est celle qui compte : **un admin est autorisé avant même qu'on regarde une permission.** C'est ce qui rend la migration inutile — et c'est aussi ce qui fait que le jour du déploiement ne change rien pour personne.

Le prix : deux mécanismes coexistent le temps de la bascule. Il se rembourse plus tard, quand tous les comptes seront passés en `manager` avec leurs cases — `admin` deviendra alors un raccourci pour « toutes les cases », et pourra être retiré. **On peut aller vers le modèle pur ; on ne pouvait pas y commencer sans risque.**

### 3.3 Fail-closed — cas par cas, et vérifié au runtime

| Situation | Comportement | Ce qui le garantit | Vérifié |
|---|---|---|---|
| Fonction **sans bloc déclaré** | impossible à écrire | le bloc est un paramètre **obligatoire** de `permissionQuery(bloc)` | compilation |
| Bloc **mal orthographié** dans le code | ne compile pas | `PermissionId` = union de 21 littéraux | `tsc` |
| Bloc **hors catalogue** passé par un appelant non typé | refus | garde explicite en tête de `requirePermission` | ✅ runtime |
| Membership **sans** `permissions` | refus total | `undefined` ⇒ ensemble vide | ✅ runtime |
| Valeur **hors catalogue écrite en base** | n'ouvre rien | `grantedPermissions` **filtre par le catalogue** avant de comparer | ✅ runtime |
| Rôle de membership **inconnu** | refus | la cascade finit par un refus, pas par un `else` permissif | ✅ runtime |

**Le cinquième cas est celui qui ne se voit pas en lisant le code d'appel, et c'est le plus important.** On autorise parce qu'un nom **appartient au catalogue**, jamais parce qu'il est **présent en base**. Avec un simple `includes`, un bloc renommé ou retiré laisserait une valeur périmée continuer d'ouvrir une porte que plus personne ne relit. En filtrant d'abord, un nom périmé n'ouvre plus rien — et c'est le sens le plus sûr, pas le plus commode.

Corollaire assumé : **l'écriture est permissive, la lecture est la garantie.** `memberPermissions` stocke les chaînes verbatim et se contente de *nommer* celles qui sortent du catalogue dans son rapport. Faire de l'écriture le gardien créerait un second endroit où la règle vit, et un `permissions` figé par une validation d'hier décrirait un monde qui n'existe plus.

### 3.4 Le journal des changements de droits

Table `permissionChanges`, **en ajout seul** : jamais de `patch`, jamais de `delete`.

| Champ | Contenu |
|---|---|
| `projectId`, `subjectUserId` | de qui on parle, et sur quel projet |
| `permission` | le bloc — `v.string()` et non une union, pour qu'un bloc **retiré du catalogue reste lisible dans l'historique** |
| `granted` | le sens : accordé ou retiré |
| `actorUserId`, `actorLabel` | qui a fait le geste (`"cli"` quand c'est hors session) |
| `at` | quand |

Deux choix méritent d'être dits :

- **Seuls les changements sont consignés.** Réécrire les mêmes droits ne produit aucune ligne. Un journal qui consigne les non-événements devient illisible, et c'est comme ça qu'on cesse de le lire.
- **L'état effectif reste sur le membership**, pas dans le journal. Rejouer l'historique pour reconstruire les droits serait une lecture de plus à chaque requête — exactement ce qu'on a refusé en §3.1.

Le journal est écrit **dès maintenant**, alors que l'écran n'arrive qu'à l'étape 6, parce que les premiers managers se créeront en ligne de commande : un droit accordé hors écran doit laisser la même trace, sinon le journal ment par omission le jour où on le relit.

### 3.5 Migration

**Aucune.** Le champ `permissions` est optionnel (aucun document existant n'est invalide), `manager` est un littéral **ajouté** à l'union `memberships.role` (les valeurs existantes restent valides — même patron exact que l'ajout de `talent` et `clipper`, passé sans migration), et la cascade autorise `admin` avant de regarder les droits.

Votre première action ne sera donc pas de réparer l'existant, mais de **créer votre premier manager**.

### 3.6 Réponse à Q4 — une seconde table, pas la même

**Il faut une SECONDE table pour tracer le drapeau « chauffe ». Le journal des permissions ne peut pas servir aux deux.**

Trois raisons, et la première suffirait :

1. **Le sujet n'est pas du même type.** `permissionChanges.subjectUserId` est un `Id<"users">`. Tracer un drapeau de post demande un `Id<"publications">`. Les faire cohabiter imposerait un sujet polymorphe (`v.union` de deux formes) que **chaque lecteur devrait démêler** — pour ne jamais lire les deux ensemble, puisque personne ne veut « tous les changements, droits et drapeaux confondus ».
2. **Les index diffèrent.** On interroge les droits par `(projet, personne)` ; on interrogera les drapeaux par publication, et pour la paie par période. Une table unique porterait des index dont la moitié serait morte à chaque lecture.
3. **Les durées de vie diffèrent.** Le journal des droits est un registre de sécurité qu'on garde. La trace des drapeaux sert un **contrôle de paie** : elle a vocation à être relue avec un cycle, et peut-être purgée avec lui.

Table proposée, `publicationFlagChanges` : `projectId`, `publicationId`, `flag` (`"warmup" | "remunerated"`), `before`, `after`, `actorUserId`, `at`. **Elle n'est pas implémentée ici** : elle exige de modifier `setPublicationWarmup` et `setPublicationRemuneration`, donc de toucher deux des 212 — ce que ce chantier s'interdit. C'est un lot à part, à faire avant ou pendant l'étape 4.

---

## 4. Où en est le chantier

| # | Étape | État | Effort |
|---|---|---|---|
| 1 | **Le socle** — littéral `manager`, champ `permissions`, `PermissionId` (21 littéraux), `requirePermission`, wrappers, journal des changements | ✅ **fait** | 1 j |
| 2 | **Le cliquet** — couverture (baseline 212) + alignement catalogue ↔ document | ✅ **fait** | 0,5 j |
| 3 | **Le découpage financier** — couper `updateCreator`/`getCreator`, projeter `rateModel` et le barème des défis. Crée `creators.pay_terms`. | à faire | 1,5 j |
| 4 | **Migration des 12 blocs cochés** (≈ 145 fonctions, mécanique) | à faire | 2 j |
| 5 | **Migration des 9 blocs décochés** (≈ 67 fonctions). Baseline à 0, retrait d'`adminQuery`. | à faire | 1,5 j |
| 6 | **L'écran de gestion** — lister, cocher, inviter. Superadmin seul. | à faire | 2,5 j |
| 7 | **Navigation** — masquer menus et cartes. Confort : la barrière est acquise aux étapes 4-5. | à faire | 1 j |
| 8 | **Les mixtes restantes** + la table `publicationFlagChanges` (§3.6) | à faire | 1–2 j |

**Reste ≈ 9,5 à 10,5 jours.** Le chemin le plus court vers un manager opérationnel : **étapes 3 et 4, soit ≈ 3,5 jours** — les premiers managers se créent alors en ligne de commande, et ils voient encore les entrées de menu qu'ils ne peuvent pas ouvrir (un refus propre, pas un danger).

**L'étape 3 n'est pas négociable** : sans elle, `creators.manage` laisse modifier un tarif négocié et lire un RIB, c'est-à-dire que la frontière argent n'existe pas.

---

## 5. Comment on crée un manager aujourd'hui

L'écran arrive à l'étape 6. En attendant, en ligne de commande — et **ces chemins tracent déjà** :

```bash
npx convex run memberPermissions:grantProjectManager \
  '{"email":"...","projectSlug":"snytch"}' --env-file <cible>
```

Sans `permissions`, les **12 blocs cochés par défaut** sont appliqués. Pour un jeu précis :

```bash
npx convex run memberPermissions:setMemberPermissions \
  '{"email":"...","projectSlug":"snytch","permissions":["creators.read","review.manage"]}' --env-file <cible>
```

Et pour relire l'état — rôle, droits stockés, droits **effectifs**, valeurs ignorées, et le journal :

```bash
npx convex run memberPermissions:describeMember \
  '{"email":"...","projectSlug":"snytch"}' --env-file <cible>
```

`describeMember` distingue `stored` (ce qui est écrit) de `effective` (ce qui est **réellement** accordé, après filtrage par le catalogue) et liste `ignored`. C'est la lecture qui permet de voir qu'un bloc renommé a cessé d'ouvrir quoi que ce soit.

---

## 6. Arbitrages appliqués

| | Décision | Effet dans le catalogue |
|---|---|---|
| Q1 | Le manager archive, il ne supprime pas | **`creators.delete`** créé, décoché — `deleteCreator` et `getCreatorDeletionImpact` |
| Q2 | `assignScriptToRush` inchangée | reste dans `assignments.manage` : elle lit `clipRate` sans le renvoyer |
| Q3 | Défis scindés | **`challenges.run`** coché (10 fn) · **`challenges.money`** décoché (4 fn) ; `getChallenge` à projeter |
| Q4 | Drapeau chauffe coché, mais tracé | reste dans `tracker.manage` ; **seconde table** requise — cf. §3.6 |
| Q5 | `admin` = tout par défaut | acquis, c'est ce qui rend la migration inutile |
| Q6 | Veille et synchros ouvertes | `radar.use` coché, `requestApifySync`/`requestYouTubeSync` dans `tracker.manage` coché |
| Q7 | Legacy conservé | **`legacy.access`** créé, décoché — marqueur du chantier de suppression |
| Q8 | Notifications fermées | `notifications.manage` décoché ; le digest est un chantier séparé |
| Q9 | Écran superadmin seul | étape 6 |
| Q10 | Journal des droits | table `permissionChanges`, en ajout seul, écrite dès la ligne de commande |
| Q11 | Libellés du vocabulaire de l'app | colonne **Section** ajoutée, 5 sections |

---

## 7. Questions

Aucune ne bloque l'étape 3 — je peux enchaîner sans réponse.

1. **`setChallengeParticipants` fige un `pricingSnapshot` par participante.** Je l'ai laissée dans `challenges.run` (coché), parce que le barème vient du défi et non de ce geste : ajouter une participante à un défi déjà doté n'ouvre aucun choix de montant. Confirmez-vous, ou préférez-vous la basculer dans `challenges.money` ?

2. **`legacy.access` est décoché et personne ne le cochera.** Voulez-vous que je programme la **suppression** de ces 7 fonctions et de leurs 5 écrans comme un lot à part, ou reste-t-on sur « on verra » ?

3. **La table `publicationFlagChanges` (§3.6) touche `setPublicationWarmup` et `setPublicationRemuneration`.** Je la fais avant l'étape 4, ou en même temps que la migration de `tracker.manage` ?

4. **Les libellés.** Relisez la colonne « Libellé » : « Voir les Créateurs », « Assignments et planning », « Validation et Rushes », « Inspirations, Assets et hooks », « Comment ça marche », « Analytics et revenus », « Écrans historiques ». Y en a-t-il un que vous ne comprendriez pas sans explication ? C'est le seul test qui compte pour cette colonne.

---

## Annexe — tri exhaustif des 212 fonctions

**212 fonctions classées, aucune sans bloc.** `T` = **Q** lecture (query), **M** écriture (mutation).

Signalements : 🟠 **mixte** (gestion + argent dans le même appel, §2.1) · 🔵 **à cheval** (deux blocs légitimes, §2.2) · ⚪ **orpheline** (tracker legacy, §2.3).

### `creators.read` — 3 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `getCreator` | Q | creators | Fiche détaillée d'une créatrice | 🟠 mixte |
| `getCreatorTimezone` | Q | creators | Fuseau horaire d'une créatrice |  |
| `listCreators` | Q | creators | Liste les créatrices du projet |  |

### `creators.manage` — 5 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `addCreatorToProject` | M | creators | Rattache une créatrice existante au projet |  |
| `inviteCreator` | M | creators | Invite une créatrice (crée la fiche + le lien) |  |
| `regenerateInvitation` | M | creators | Régénère un lien d'invitation |  |
| `updateCreator` | M | creators | Modifie une fiche créatrice | 🟠 mixte |
| `generatePasswordResetLink` | M | passwordReset | Génère un lien de réinitialisation de mot de passe | 🔵 à cheval |

### `creators.delete` — 2 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `deleteCreator` | M | creators | Supprime définitivement une créatrice |  |
| `getCreatorDeletionImpact` | Q | creators | Ce que la suppression d'une créatrice effacerait |  |

### `accounts.manage` — 19 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `archiveCompte` | M | comptes | Archive un compte |  |
| `createCompte` | M | comptes | Crée un compte |  |
| `declareManagedCompte` | M | comptes | Déclare un compte géré par l'équipe |  |
| `deleteCompte` | M | comptes | Supprime un compte vierge | 🔵 à cheval |
| `getCompteUsage` | Q | comptes | Ce à quoi un compte est rattaché (avant suppression) |  |
| `listComptes` | Q | comptes | Liste les comptes du projet |  |
| `listComptesAValider` | Q | comptes | File des comptes déclarés à valider |  |
| `listCreatorAvailableComptes` | Q | comptes | Comptes disponibles d'une créatrice |  |
| `markWarmupCheckAsAdmin` | M | comptes | Coche la chauffe du jour d'un compte géré |  |
| `refuseCompte` | M | comptes | Refuse un compte déclaré, avec motif |  |
| `restartWarmup` | M | comptes | Relance la chauffe d'un compte |  |
| `setAccountBio` | M | comptes | Définit la bio à mettre sur un compte |  |
| `unarchiveCompte` | M | comptes | Réactive un compte archivé |  |
| `updateCompte` | M | comptes | Modifie un compte |  |
| `updateWarmupProtocol` | M | comptes | Modifie le protocole de chauffe |  |
| `createPersonne` | M | personnes | Crée un gestionnaire |  |
| `deletePersonne` | M | personnes | Supprime un gestionnaire |  |
| `listPersonnes` | Q | personnes | Liste les gestionnaires de comptes |  |
| `updatePersonne` | M | personnes | Renomme un gestionnaire |  |

### `assignments.manage` — 16 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `addModelVideoToAssignment` | M | assignments | Attache une vidéo d'exemple à une mission |  |
| `assignFormat` | M | assignments | Confie une mission basée sur un format | 🟠 mixte |
| `cancelAssignment` | M | assignments | Abandonne une mission (garde l'historique) |  |
| `deleteAssignment` | M | assignments | Supprime définitivement une mission | 🔵 à cheval |
| `listAssignableCreators` | Q | assignments | Créatrices à qui on peut confier une mission |  |
| `listAssignableCreatorsWithAccounts` | Q | assignments | Idem, avec leurs comptes disponibles |  |
| `listAssignments` | Q | assignments | Liste toutes les missions du projet | 🟠 mixte |
| `nudgeAssignment` | M | assignments | Relance une créatrice par e-mail |  |
| `removeModelVideoFromAssignment` | M | assignments | Retire une vidéo d'exemple |  |
| `setAssetFolders` | M | assignments | Attache des dossiers d'assets à une mission |  |
| `setAssignmentInstructions` | M | assignments | Modifie la consigne libre d'une mission |  |
| `setAssignmentOverlayText` | M | assignments | Modifie le texte à incruster sur la vidéo |  |
| `setAssignmentPostDate` | M | assignments | Fixe le jour de publication prévu |  |
| `setAssignmentPostWindow` | M | assignments | Fixe le créneau horaire de publication |  |
| `assignScriptCampaign` | M | scripts | Assigne une campagne à N créatrices × M vidéos | 🟠 mixte |
| `assignScriptToRush` | M | scripts | Monte un script sur une prise déposée | 🟠 mixte |

### `review.manage` — 10 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `confirmPublicationAsAdmin` | M | assignments | Colle le lien de publication à la place de la créatrice | 🔵 à cheval |
| `countVideoSubmitted` | Q | assignments | Compteur du badge « à valider » |  |
| `listManagedToPublish` | Q | assignments | Vidéos que l'équipe doit publier elle-même |  |
| `listPublished` | Q | assignments | Vidéos publiées récemment |  |
| `listVideoSubmitted` | Q | assignments | File des vidéos en attente de revue |  |
| `reviewVideoApprove` | M | assignments | Approuve une vidéo soumise |  |
| `reviewVideoReject` | M | assignments | Refuse une vidéo, avec motif |  |
| `countRushesToReview` | Q | rushes | Compteur du badge « rushes » |  |
| `listRushesForReview` | Q | rushes | File des prises à trancher |  |
| `rejectRush` | M | rushes | Refuse une prise déposée, avec motif |  |

### `scripts.manage` — 22 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `createFormat` | M | formats | Crée un format | 🟠 mixte |
| `deleteFormat` | M | formats | Supprime un format |  |
| `getFormat` | Q | formats | Détail d'un format | 🟠 mixte |
| `listFormats` | Q | formats | Liste les formats (brief + grille de paie) | 🟠 mixte |
| `updateFormat` | M | formats | Modifie un format | 🟠 mixte |
| `availableCombosForAssignment` | Q | scripts | Combos encore disponibles pour une créatrice |  |
| `createBrick` | M | scripts | Crée une brique de script |  |
| `createCampaign` | M | scripts | Crée une campagne |  |
| `deleteBrick` | M | scripts | Supprime une brique |  |
| `deleteCampaign` | M | scripts | Supprime une campagne |  |
| `editScriptBrickText` | M | scripts | Édite le texte d'une brique sur une mission |  |
| `editScriptCombo` | M | scripts | Remplace une brique du script d'une mission |  |
| `getCampaign` | Q | scripts | Détail d'une campagne et de ses briques |  |
| `getGraduationPreview` | Q | scripts | Aperçu avant promotion d'un hook |  |
| `getReplaySource` | Q | scripts | Données pour rejouer un script |  |
| `graduateHook` | M | scripts | Promeut un hook vers les ouvertures prouvées |  |
| `hookUsagesForCampaign` | Q | scripts | Qui a déjà reçu quel hook |  |
| `importHooks` | M | scripts | Importe des hooks de la bibliothèque en briques |  |
| `listCampaigns` | Q | scripts | Liste les campagnes de scripts |  |
| `previewCombosForAssignment` | Q | scripts | Aperçu des combos qui seront tirés |  |
| `updateBrick` | M | scripts | Modifie une brique |  |
| `updateCampaign` | M | scripts | Modifie une campagne |  |

### `challenges.run` — 10 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `cancelChallengeWin` | M | challengeSync | Annule une victoire de défi, avec motif | 🔵 à cheval |
| `evaluateChallengeNow` | M | challengeSync | Force l'évaluation d'un défi |  |
| `assignChallengeVideo` | M | challenges | Commande une vidéo de défi |  |
| `closeChallenge` | M | challenges | Clôt un défi |  |
| `getChallenge` | Q | challenges | Détail d'un défi (réglages, classement, victoires) | 🟠 mixte |
| `listChallenges` | Q | challenges | Liste les défis |  |
| `openChallenge` | M | challenges | Ouvre un défi aux participantes |  |
| `previewChallengeWinners` | Q | challenges | Aperçu des gagnantes de la prochaine évaluation |  |
| `setChallengeParticipants` | M | challenges | Fixe la liste des participantes | 🟠 mixte |
| `setChallengeVideoRemoved` | M | challenges | Retire une vidéo du score du défi | 🔵 à cheval |

### `library.manage` — 28 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `createAsset` | M | assets | Enregistre un fichier uploadé |  |
| `createAssetFolder` | M | assets | Crée un dossier d'assets |  |
| `deleteAsset` | M | assets | Supprime un fichier |  |
| `deleteAssetFolder` | M | assets | Supprime un dossier et ses fichiers |  |
| `listAssetFolders` | Q | assets | Liste les dossiers d'images/vidéos |  |
| `listAssets` | Q | assets | Liste les fichiers d'un dossier |  |
| `renameAssetFolder` | M | assets | Renomme un dossier d'assets |  |
| `setAssetFolderPostprocess` | M | assets | Active le nettoyage des métadonnées d'un dossier |  |
| `createPreset` | M | filterPresets | Enregistre un filtre favori |  |
| `deletePreset` | M | filterPresets | Supprime un filtre favori |  |
| `listPresets` | Q | filterPresets | Liste les filtres favoris |  |
| `createFolder` | M | folders | Crée un dossier d'inspirations |  |
| `deleteFolder` | M | folders | Supprime un dossier |  |
| `listFolders` | Q | folders | Liste les dossiers d'inspirations |  |
| `updateFolder` | M | folders | Renomme un dossier |  |
| `countHooks` | Q | hooks | Compte les hooks de la bibliothèque |  |
| `getHookVariants` | Q | hooks | Variantes d'un hook |  |
| `listHooks` | Q | hooks | Liste les hooks |  |
| `listHooksWithUsage` | Q | hooks | Hooks avec leur usage |  |
| `createIcp` | M | icps | Crée un profil cible |  |
| `deleteIcp` | M | icps | Supprime un profil cible |  |
| `listIcps` | Q | icps | Liste les profils cibles |  |
| `updateIcp` | M | icps | Modifie un profil cible |  |
| `createInspiration` | M | inspirations | Ajoute une inspiration |  |
| `deleteInspiration` | M | inspirations | Supprime une inspiration |  |
| `getInspirationById` | Q | inspirations | Détail d'une inspiration |  |
| `listInspirations` | Q | inspirations | Liste les inspirations |  |
| `updateInspiration` | M | inspirations | Modifie une inspiration |  |

### `guide.manage` — 8 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `getGuideForAdmin` | Q | guide | Guide du projet (édition) |  |
| `updateProjectGuide` | M | guide | Enregistre le guide |  |
| `createModule` | M | guideModules | Crée un module |  |
| `deleteModule` | M | guideModules | Supprime un module |  |
| `getWarmupModuleForAdmin` | Q | guideModules | Module « protocole de chauffe » |  |
| `listModulesForAdmin` | Q | guideModules | Modules de formation (publiés et brouillons) |  |
| `moveModule` | M | guideModules | Réordonne un module |  |
| `updateModule` | M | guideModules | Modifie un module |  |

### `tracker.manage` — 13 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `requestApifySync` | M | apifySync | Bouton « relever les vues TikTok/Insta maintenant » |  |
| `createSnapshot` | M | metricSnapshots | Saisit un relevé de métriques |  |
| `deleteSnapshot` | M | metricSnapshots | Supprime un relevé |  |
| `updateSnapshot` | M | metricSnapshots | Corrige un relevé |  |
| `createPublication` | M | publications | Crée une publication |  |
| `deletePublication` | M | publications | Supprime une publication |  |
| `getNextPublicationId` | Q | publications | Prochain identifiant de publication |  |
| `getPublicationPayFlags` | Q | publications | État des drapeaux chauffe/rémunéré d'un post | 🟠 mixte |
| `listPublications` | Q | publications | Liste les publications |  |
| `setPublicationWarmup` | M | publications | Marque un post comme chauffe | 🟠 mixte |
| `updateMetrics` | M | publications | Met à jour les métriques d'une publication |  |
| `updatePublishedAccount` | M | publications | Corrige le compte d'une publication publiée | 🔵 à cheval |
| `requestYouTubeSync` | M | youtubeSync | Bouton « relever les vues YouTube maintenant » |  |

### `content.analytics` — 14 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `dashboardKpis` | Q | dashboard | KPI de contenu (vues, engagement, winners) |  |
| `decisionDashboard` | Q | dashboardDecisions | Sections « à décider » et « posts 48 h » |  |
| `aggregateTimeseries` | Q | metricSnapshots | Courbe agrégée d'une métrique |  |
| `listSnapshotsByPublication` | Q | metricSnapshots | Relevés successifs d'une publication |  |
| `getCreatorPublicationStats` | Q | publicationLateness | Taux de publication à l'heure par créatrice |  |
| `previewEveningReport` | Q | publicationLateness | Aperçu du bilan du soir |  |
| `perfByBrick` | Q | scriptAnalytics | Performance par brique de script |  |
| `perfByCombo` | Q | scriptAnalytics | Performance par combinaison de briques |  |
| `perfByTier` | Q | scriptAnalytics | Performance par palier de hook |  |
| `postsForBrick` | Q | scriptAnalytics | Posts réels utilisant une brique |  |
| `campaignDecisions` | Q | scriptDecision | Verdicts par dimension d'une campagne |  |
| `listTrackerPosts` | Q | trackerData | Tableau du tracker (posts et métriques) |  |
| `trackerViewsDaily` | Q | trackerData | Vues par jour |  |
| `trackerWarmupHiddenDates` | Q | trackerData | Dates masquées par le filtre chauffe |  |

### `radar.use` — 11 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `addRadarAccount` | M | radar | Ajoute un compte à suivre |  |
| `getRadarSearch` | Q | radar | Recherche d'outliers en cache |  |
| `listRadarAccounts` | Q | radar | Comptes TikTok suivis en veille |  |
| `listRadarVideos` | Q | radar | Mur de vidéos des comptes suivis |  |
| `listTrendCountries` | Q | radar | Pays disponibles pour la veille |  |
| `listTrendHashtags` | Q | radar | Hashtags tendance d'un pays |  |
| `listTrendVideos` | Q | radar | Vidéos d'un hashtag tendance |  |
| `removeRadarAccount` | M | radar | Retire un compte suivi |  |
| `requestRadarAccountSync` | M | radar | Resynchronise un compte suivi |  |
| `requestRadarSync` | M | radar | Resynchronise toute la veille |  |
| `updateRadarAccountNote` | M | radar | Annote un compte suivi |  |

### `creators.pay_terms` — 0 fonction

Ce bloc **ne couvre encore aucune fonction entière** : les champs qu'il protège vivent à l'intérieur de `getCreator` et `updateCreator`, qui font aussi de la gestion. Il devient réel à l'étape 3 (découpage financier).


### `pricing.manage` — 9 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `archivePricing` | M | pricing | Archive un barème |  |
| `createPricing` | M | pricing | Crée un barème |  |
| `deletePricing` | M | pricing | Supprime un barème |  |
| `getCreatorBonusStatus` | Q | pricing | Paliers de bonus d'une créatrice |  |
| `getDefaultBonusPricingId` | Q | pricing | Barème de bonus par défaut |  |
| `listPricingSnapshotDrift` | Q | pricing | Missions dont le barème figé a dérivé |  |
| `listPricings` | Q | pricing | Liste les barèmes |  |
| `setDefaultBonusPricing` | M | pricing | Désigne le barème de bonus par défaut |  |
| `updatePricing` | M | pricing | Modifie un barème |  |

### `payments.manage` — 9 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `computeViewBonus` | M | assignments | Calcule et crédite le bonus de vues |  |
| `listValidatedForBonus` | Q | assignments | Vidéos candidates au calcul de bonus, avec montants |  |
| `getDueTotal` | Q | payments | Total dû du projet |  |
| `leaderboard` | Q | payments | Classement des créatrices par gains |  |
| `listPayments` | Q | payments | Cycles de paie de toutes les créatrices |  |
| `markCyclePaid` | M | payments | Marque un cycle comme payé |  |
| `markPaymentPaid` | M | payments | Marque un paiement comme payé |  |
| `markPeriodPaid` | M | payments | Marque toute une période comme payée |  |
| `setPublicationRemuneration` | M | publications | Décide si un post est payé |  |

### `business.read` — 14 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `getAttribution` | Q | analyticsHub | Coût et vues par vidéo, efficacité par créatrice |  |
| `getBillingCountries` | Q | analyticsHub | Ventes par pays de facturation |  |
| `getChurn` | Q | analyticsHub | Résiliations et rétention des abonnés |  |
| `getDayDetail` | Q | analyticsHub | Détail d'une journée (ventes, revenu, membres) |  |
| `getNatureRewards` | Q | analyticsHub | Récompenses en nature dues et livrées (dépense) |  |
| `getReliability` | Q | analyticsHub | Fiabilité des chiffres, écarts entre sources |  |
| `getRevenueBreakdown` | Q | analyticsHub | Revenu net Whop décomposé nouveau/récurrent |  |
| `getViewCounters` | Q | analyticsHub | Les quatre compteurs de vues du projet |  |
| `readConversionAllTime` | Q | conversionSync | Visiteurs, ventes et revenu par créatrice |  |
| `getProductAnalytics` | Q | posthogSync | Agrégats PostHog (funnel, activation, offres) |  |
| `requestPosthogSync` | M | posthogSync | Bouton « actualiser » les analytics produit |  |
| `getProjectProfitability` | Q | profitability | Revenu net moins coût créateurs, marge et RPM |  |
| `getWhopRevenue` | Q | whopSync | Revenu Whop par mois |  |
| `requestWhopSync` | M | whopSync | Bouton « resynchroniser le revenu Whop » |  |

### `challenges.money` — 4 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `createChallenge` | M | challenges | Crée un défi (objectif, récompense, barème) | 🟠 mixte |
| `deleteChallenge` | M | challenges | Supprime un brouillon de défi |  |
| `listChallengePricings` | Q | challenges | Barèmes éligibles à un défi | 🔵 à cheval |
| `updateChallenge` | M | challenges | Modifie un défi | 🟠 mixte |

### `notifications.manage` — 2 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `getNotifySettings` | Q | notifications | Réglages des alertes Telegram |  |
| `setNotifySettings` | M | notifications | Modifie les alertes et leur destinataire | 🟠 mixte |

### `project.settings` — 6 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `getComboCooldownSettings` | Q | projects | Délai de réutilisation d'un combo |  |
| `getTalentSettings` | Q | projects | Réglages de l'espace talent |  |
| `getWarmupSettings` | Q | projects | Durée de chauffe du projet |  |
| `setComboCooldownDays` | M | projects | Modifie ce délai |  |
| `setTalentSettings` | M | projects | Modifie l'espace talent (brief, dépôt) |  |
| `setWarmupSettings` | M | projects | Modifie la durée de chauffe |  |

### `legacy.access` — 7 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `duplicateCarousel` | M | publications | Duplique un carrousel en brouillon | ⚪ orpheline |
| `getByCarouselId` | Q | publications | Résout un identifiant vers son format | ⚪ orpheline |
| `getNextCarouselId` | Q | publications | Ancien nom du précédent (compat) | ⚪ orpheline |
| `getSourceStatus` | Q | publications | Statut anti-shadowban d'une source | ⚪ orpheline |
| `listSources` | Q | publications | Bibliothèque des sources Shorts | ⚪ orpheline |
| `renameSourceId` | M | publications | Renomme une source en cascade | ⚪ orpheline |
| `updateDraft` | M | publications | Édite un brouillon de carrousel | ⚪ orpheline |