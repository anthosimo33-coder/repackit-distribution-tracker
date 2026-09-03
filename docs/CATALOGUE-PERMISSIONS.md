# Catalogue de permissions — conception

> Étape 1 du chantier « rôle manager ». Suite de [AUDIT_ROLE_MANAGER.md](../AUDIT_ROLE_MANAGER.md)
> et du commit `580212b` (Étape 0 — colmatage des fuites).
> **Conception seule : aucun fichier applicatif modifié, aucun schéma touché.**

Décisions déjà prises et appliquées ici :
- **Option C** — permissions granulaires cochables par personne, pas un rôle figé.
- Le manager est rattaché à **un projet** précis (on s'appuie sur `memberships`).
- **Frontière argent** : il voit le **tarif unitaire** d'une vidéo qu'il assigne ;
  il ne voit ni coordonnées de paiement, ni tarifs négociés (`clipRate`,
  `cycleRetainer`), ni totaux dus, ni CA / revenus / conversions.

---

## Résumé (10 lignes)

1. J'ai trié les **212** fonctions d'administration une par une (les 211 de l'audit + `getDueTotal`, ajoutée à l'Étape 0). Aucune n'est restée sans case.
2. Elles se rangent dans **17 blocs**, plus **1 bloc à créer** qui n'existe pas encore parce qu'il faut d'abord découper deux fonctions : ça fait **18 cases à cocher**.
3. Sur un manager type, **11 cases sont cochées** et **7 décochées**. Les 7 décochées sont l'argent et les réglages du projet.
4. **17 fonctions sont « mixtes »** : elles font un geste de gestion *et* touchent à l'argent dans le même appel. Elles ne peuvent pas être rangées d'un côté — il faut les **couper en deux**.
5. La plus gênante est `updateCreator` : une seule fonction change le nom, le statut, la langue… **et** le tarif négocié et le RIB. Tant qu'elle n'est pas coupée, un manager qui peut modifier une fiche peut modifier une rémunération.
6. Techniquement, je recommande de stocker les permissions **sur `memberships`**, pas dans une table à part : c'est le bon grain (une personne × un projet), et cette ligne est **déjà lue** à chaque requête — donc zéro lecture supplémentaire.
7. Les permissions **s'ajoutent** à un rôle de base, elles ne le remplacent pas. `admin` continue de tout pouvoir ; le nouveau rôle `manager` ne peut que ce qui est coché.
8. **Conséquence directe : aucune migration.** Vos admins actuels gardent `role: "admin"` et donc exactement leurs accès d'aujourd'hui, sans que vous ayez à toucher quoi que ce soit.
9. Le **fail-closed** est garanti par un cliquet, sur le modèle de l'Étape 0 : une fonction qui ne déclare pas son bloc fait **échouer la CI**, et un manager sans permissions n'a accès à rien.
10. Si vous voulez un manager opérationnel vite : les **étapes 1 à 4** (≈ 6 jours) suffisent, en laissant les 17 fonctions mixtes fermées au départ.

---

## 1. Le catalogue

`✓` = coché par défaut pour un manager. Le risque décrit ce qui arrive **si la case est cochée par erreur**.

| # | Identifiant | Libellé (écran de gestion) | Ce que la personne pourra faire | Déf. | Fn | Risque si coché par erreur |
|---|---|---|---|---|---|---|
| 1 | `creators.read` | **Voir les créatrices** | Consulter la liste et la fiche d'une créatrice : identité, statut, langue, fuseau. | ✓ | 3 | 🟢 Faible — lecture d'annuaire interne. |
| 2 | `creators.manage` | **Gérer les créatrices** | Inviter, modifier une fiche, changer un statut, archiver, régénérer un lien de connexion. | ✓ | 7 | 🟠 Moyen — contient la **suppression définitive** d'une créatrice et la génération d'un lien de mot de passe. |
| 3 | `creators.pay_terms` | **Conditions de rémunération** | Voir et modifier le tarif négocié, le forfait mensuel, le barème de bonus et les coordonnées de paiement d'une créatrice. | ✗ | 0* | 🔴 **Élevé** — RIB/PayPal en clair, et un tarif modifié change ce qui sera versé. |
| 4 | `accounts.manage` | **Comptes et chauffe** | Créer, modifier, valider, refuser, archiver des comptes ; piloter le protocole de chauffe ; gérer les gestionnaires de comptes. | ✓ | 19 | 🟠 Moyen — archiver un compte le retire des cibles ; relancer une chauffe décale une mise en production. |
| 5 | `assignments.manage` | **Missions et planning** | Confier des missions, fixer dates et créneaux, joindre consignes, exemples et assets, annuler ou supprimer. **Voit le tarif unitaire de la vidéo.** | ✓ | 16 | 🟠 Moyen — `deleteAssignment` efface une ligne ; l'assignation **fige un tarif** (d'où la frontière retenue). |
| 6 | `review.manage` | **Validation des vidéos et des prises** | Approuver ou refuser une vidéo soumise, trancher les prises déposées, publier à la place d'une créatrice. | ✓ | 10 | 🟠 Moyen — approuver **déclenche l'accrual de paie** ; publier ancre la date qui sert au calcul. |
| 7 | `scripts.manage` | **Scripts et campagnes** | Créer et modifier campagnes, briques, hooks gradués ; éditer un script sur une mission ; gérer les formats. | ✓ | 22 | 🟠 Moyen — les **formats portent une grille de paie** (`rateModel`) : les modifier change des tarifs. |
| 8 | `library.manage` | **Bibliothèques** | Inspirations, dossiers, profils cibles, bibliothèque de hooks, dossiers d'images et vidéos, filtres favoris. | ✓ | 28 | 🟢 Faible — matière première de production, aucune donnée personnelle ni financière. |
| 9 | `tracker.manage` | **Tracker et publications** | Saisir et corriger des relevés, gérer les publications, déclencher un relevé de vues, marquer un post comme chauffe. | ✓ | 20 | 🟠 Moyen — le drapeau « chauffe » **décide si un post est payé** ; les synchros coûtent de l'argent (Apify). |
| 10 | `content.analytics` | **Performance des contenus** | Lire le tracker, les KPI, les verdicts par script, les courbes de vues, le taux de publication à l'heure. | ✓ | 14 | 🟢 Faible — vues et engagement, jamais d'euros. |
| 11 | `guide.manage` | **Guide et formations** | Écrire et publier les modules de formation, dans les deux langues. | ✓ | 8 | 🟢 Faible — contenu lu par les créatrices ; une erreur se corrige. |
| 12 | `challenges.manage` | **Défis** | Créer, ouvrir, clore un défi, fixer les participantes, retirer une vidéo, annuler une victoire. | ✗ | 14 | 🔴 **Élevé** — un défi **fixe un budget et un barème**, et une victoire vaut de l'argent. |
| 13 | `radar.use` | **Veille TikTok** | Suivre des comptes, consulter les tendances, lancer une recherche d'outliers. | ✓ | 11 | 🟠 Moyen — chaque synchro est **facturée à l'usage** (Apify). |
| 14 | `notifications.manage` | **Alertes de l'équipe** | Choisir les alertes Telegram et leur destinataire. | ✗ | 2 | 🔴 **Élevé** — le digest transporte le **total dû**, et on peut rediriger les alertes vers un autre canal. |
| 15 | `project.settings` | **Réglages du projet** | Durée de chauffe, délai de réutilisation d'un combo, espace talent. | ✗ | 6 | 🟠 Moyen — règles structurantes qui s'appliquent à toutes les créatrices. |
| 16 | `pricing.manage` | **Barèmes** | Créer et modifier les grilles fixe / CPM / paliers de bonus. | ✗ | 9 | 🔴 **Élevé** — c'est la définition de ce que coûte chaque vidéo. |
| 17 | `payments.manage` | **Paie des créatrices** | Voir les cycles et les totaux dus, calculer les bonus, marquer comme payé. | ✗ | 9 | 🔴 **Élevé** — montants dus, coordonnées bancaires à l'export, et marquage « payé » irréversible en pratique. |
| 18 | `business.read` | **Chiffre d'affaires** | Revenu Whop, marge, RPM, churn, conversions par créatrice, analytics produit. | ✗ | 14 | 🔴 **Élevé** — c'est le compte d'exploitation de la boîte. |

\* `creators.pay_terms` **ne couvre aujourd'hui aucune fonction entière** : les champs qu'il protège vivent à l'intérieur de `getCreator` et `updateCreator`, qui font aussi de la gestion. Ce bloc n'existera qu'une fois ces deux fonctions découpées (Étape 3 du plan). C'est le seul bloc du catalogue qui **exige** un changement de code pour devenir réel.

**Total : 11 cochés, 7 décochés.** Somme des colonnes « Fn » = 212 (hors bloc 3, qui naîtra d'un découpage).

### Un découpage différent serait-il meilleur ?

Oui, sur un point : **`tracker.manage` (20 fonctions) mélange trois choses** — la saisie de relevés, la gestion des publications, et sept fonctions d'un tracker *legacy* (carrousels, Shorts) dont les écrans ne sont plus dans le menu. Un découpage plus fidèle serait :

| Bloc alternatif | Fn | Pourquoi |
|---|---|---|
| `tracker.readings` | 6 | Saisir et corriger des relevés, déclencher une collecte |
| `publications.manage` | 7 | Créer, corriger, supprimer des publications, drapeaux chauffe |
| `legacy.carousels` | 7 | Carrousels et Shorts — écrans hors menu, **décoché par défaut** |

Ça ferait **20 blocs**, au-delà de votre borne. Je ne le recommande pas **maintenant** : les 7 fonctions legacy sont un candidat naturel à la suppression, et découper pour héberger du code qu'on va retirer coûte deux fois. **Recommandation : garder 18 blocs, et rouvrir la question quand le sort du tracker legacy sera tranché** (question Q7).

---

## 2. Les fonctions qui ne rentrent pas dans une case

C'est ici que se joue la crédibilité du système : **33 fonctions sur 212** demandent une décision.

### 2.1 🟠 Mixtes — un geste de gestion ET une donnée financière dans le même appel (17)

Ces fonctions **ne peuvent pas être rangées d'un côté**. Il faut couper ou dupliquer.

| Fonction | Le geste de gestion | Ce qui est financier | Proposition |
|---|---|---|---|
| `updateCreator` | nom, téléphone, statut, langue, fuseau, ref, population, clippeur | `clipRate`, `cycleRetainer`, `bonusPricingId`, `paymentMethod`, `paymentDetails` | **COUPER** en `updateCreator` (gestion) + `updateCreatorPayTerms` (`creators.pay_terms`). La plus urgente des 17. |
| `getCreator` | la fiche affichée par le manager | les 5 champs ci-dessus, servis dans le même objet | **COUPER** : `getCreator` sans ces champs + `getCreatorPayTerms` séparée. Même patron que `listCreators` à l'Étape 0. |
| `createFormat` | brief, hooks, do/don't, vidéos exemples | `rateModel` (fixe par post + bonus au mille) | **COUPER** : la grille passe sous `pricing.manage`. |
| `updateFormat` | idem | idem | **COUPER**, idem. |
| `listFormats` | catalogue des briefs | `rateModel` dans le payload | **PROJETER** : retirer `rateModel` sauf si `pricing.manage`. |
| `getFormat` | détail du brief | `rateModel` | **PROJETER**, idem. |
| `listAssignments` | la liste des missions | `rateSnapshot`, `pricingSnapshot`, `clipRateSnapshot` | **GARDER TEL QUEL** — c'est exactement la frontière que vous avez tranchée : le manager voit le tarif unitaire. |
| `assignFormat` | confie une mission | fige un `pricingSnapshot` | **GARDER** — même arbitrage. Le manager assigne, donc il fige un tarif. |
| `assignScriptCampaign` | assigne N × M | fige un `pricingSnapshot` | **GARDER**, idem. |
| `assignScriptToRush` | monte un script sur une prise | fige `clipRateSnapshot` **lu sur la fiche du clippeur** | **À TRANCHER (Q2)** : le manager ne doit pas voir `clipRate`, mais cette fonction l'utilise. Elle peut le lire sans le renvoyer — à confirmer. |
| `createChallenge` | crée un défi | `budget`, `montantFixe`, `pricingId` | **COUPER ou fermer** — voir Q3. |
| `updateChallenge` | modifie un défi | idem | idem |
| `setChallengeParticipants` | fixe les participantes | fige un `pricingSnapshot` par participante | idem |
| `getChallenge` | détail du défi | barème et récompense | **PROJETER** si le bloc s'ouvre. |
| `setPublicationWarmup` | fait éditorial (« le post ne cite pas l'app ») | **décide si le post est payé** | **À TRANCHER (Q4)** — geste quotidien à conséquence monétaire. |
| `getPublicationPayFlags` | lit les deux drapeaux | dont le drapeau « rémunéré » | Suit la décision Q4. |
| `setNotifySettings` | choisit les alertes | déclencheurs Whop, et le digest porte le **total dû** | **FERMER** (bloc décoché) tant que le digest n'est pas scindé. |

### 2.2 🔵 À cheval — deux blocs légitimes, sans composante financière (9)

| Fonction | Tension | Proposition |
|---|---|---|
| `deleteAssignment` | gestion courante, mais **hard-delete** | Garder dans `assignments.manage`, **et** exiger une confirmation. Un bloc « destructif » séparé multiplierait les cases pour un gain douteux. |
| `deleteCreator` | gestion, mais opération la plus destructrice de l'app | Garder dans `creators.manage` — mais c'est ce qui rend ce bloc « risque moyen ». Voir Q1 : faut-il un bloc `creators.delete` à part ? |
| `deleteCompte` | idem, borné aux comptes vierges | Garder dans `accounts.manage` (le serveur refuse déjà si le compte a servi). |
| `generatePasswordResetLink` | support quotidien, mais action sensible sur un compte | Garder dans `creators.manage` ; le serveur refuse déjà un superadmin. |
| `confirmPublicationAsAdmin` | publication (revue) **et** ancre la date qui sert à la paie | Garder dans `review.manage` — la date est un fait, pas un montant. |
| `updatePublishedAccount` | correction de saisie, **une seule fois**, sur un post publié | Garder dans `tracker.manage`. |
| `cancelChallengeWin` | animation, mais **annule un gain acquis** | Suit le sort du bloc `challenges.manage`. |
| `setChallengeVideoRemoved` | retire une vidéo du score (elle reste payée) | idem |
| `listChallengePricings` | sert un sélecteur de défi, **lit les barèmes** | idem — à projeter (nom + id, jamais les montants). |

### 2.3 ⚪ Orphelines — aucun bloc ne les décrit vraiment (7)

Les sept fonctions du tracker **legacy** : `getNextCarouselId`, `getByCarouselId`, `duplicateCarousel`, `updateDraft`, `listSources`, `getSourceStatus`, `renameSourceId`.

Leurs écrans (`/carrousels`, `/shorts`, `/shorts/sources`, `/screenrecorder`, `/biblio-hooks`) **ne sont plus dans le menu** depuis longtemps, mais leurs routes répondent toujours. Je les ai rattachées à `tracker.manage` faute de mieux. **Elles méritent une décision à elles seules (Q7)** : les retirer serait plus propre que de leur voter une permission.

---

## 3. Modèle technique

### 3.1 Où stocker les permissions

**Sur `memberships`**, en ajoutant un champ `permissions: v.optional(v.array(v.string()))`. Pas de table dédiée.

Trois raisons, dans l'ordre d'importance :

1. **C'est le bon grain.** Une permission vaut pour *une personne sur un projet*. C'est exactement la clé de `memberships` (`by_user_project`). Une table à part rejouerait la même clé composite.
2. **Zéro lecture supplémentaire.** `requireProjectAdmin` lit **déjà** le document `memberships` à chaque requête gardée. Les permissions arrivent dans cette lecture. Une table dédiée ajouterait un aller-retour à chacune des 212 fonctions — Convex n'a pas de jointure.
3. **La révocation reste immédiate.** Le rôle est relu en base à chaque requête et n'est pas dans le JWT (constat de l'audit). Décocher une case prend effet à la requête suivante, sans reconnexion.

Ce qu'on perd : **l'historique**. `memberships` porte l'état courant, pas « qui a coché quoi le 12 mars ». Si vous voulez une trace, elle va dans une table `permissionChanges` **en ajout seul**, à côté — jamais comme source de l'état effectif (sinon il faut rejouer l'historique à chaque requête).

### 3.2 Articulation avec `requireProjectAdmin`

**Les permissions s'AJOUTENT à un rôle de base. Elles ne remplacent pas la garde.** C'est ma recommandation ferme.

Le contrôle devient une cascade, dans `convex/functions.ts` :

```
requirePermission(ctx, userId, projectId, bloc) :
  1. users.role === "superadmin"        → AUTORISÉ  (inchangé)
  2. membership absent                  → REFUSÉ    (inchangé)
  3. membership.role === "admin"        → AUTORISÉ  (accès historique, tout)
  4. membership.role === "manager"      → AUTORISÉ ssi bloc ∈ membership.permissions
  5. tout le reste                      → REFUSÉ
```

**Pourquoi ajouter plutôt que remplacer.** Si les permissions remplaçaient le rôle, il faudrait écrire les 18 permissions sur **chaque** membership admin existant avant de basculer. Ce serait une migration de données sur la production, à faire dans le même déploiement que le changement de garde — et le moindre raté enferme dehors les personnes qui font tourner la boîte. En gardant `admin` = « tout », **le jour du déploiement ne change rien pour personne** : c'est la propriété la plus précieuse du dispositif.

Cela répond aussi à votre exigence de migration (§3.5) : **il n'y en a pas.**

**Le contre-argument honnête** : deux mécanismes coexistent (un rôle qui donne tout, des permissions qui donnent le détail). C'est une dette assumée. Elle se rembourse plus tard, quand tous les comptes seront passés en `manager` avec leurs cases : `admin` deviendra alors un raccourci pour « toutes les cases », et on pourra le retirer. **On peut aller vers le modèle pur ; on ne peut pas y commencer sans risque.**

### 3.3 Fail-closed — le mécanisme, cas par cas

| Situation | Comportement | Ce qui le garantit |
|---|---|---|
| Fonction **non classée** | Impossible à écrire | Le wrapper `permissionQuery(bloc)` prend le bloc en **paramètre obligatoire**. Une fonction sans bloc n'existe pas. |
| Permission **inconnue** (faute de frappe) | Ne compile pas | Le bloc est typé `PermissionId`, une union de 18 littéraux. `tsc` refuse `"cretors.read"`. |
| Permission inconnue **arrivée en base** (écriture manuelle, ancien nom) | Ignorée → refus | La comparaison se fait contre le catalogue, jamais « la chaîne est présente donc c'est bon ». Une entrée hors catalogue n'autorise rien. |
| Membership **sans** `permissions` | Refus total | Champ optionnel ⇒ `undefined` ⇒ `[] `⇒ aucun bloc. Un manager fraîchement créé ne peut **rien** tant qu'on n'a rien coché. |
| Membership de rôle **inconnu** | Refus | La cascade se termine par un refus, pas par un `else` permissif. |
| Nouvelle fonction écrite avec l'ancien `adminQuery` | **CI rouge** | Voir §3.4. |

Le point n° 3 mérite d'être souligné : **on n'autorise pas parce qu'une chaîne est présente, on autorise parce qu'elle appartient au catalogue.** C'est ce qui empêche un nom périmé (bloc renommé, permission retirée du catalogue) de continuer à ouvrir une porte.

### 3.4 Le cliquet — qu'une fonction ajoutée dans six mois ne passe pas

Le principe de l'Étape 0 est **directement transposable**, et c'est même le meilleur argument pour ce dispositif : `scripts/check-db-spread.mjs` a déjà montré qu'un contrôle par l'API TypeScript + un baseline en cliquet tient dans ce repo, tourne en CI via `pnpm test:unit`, et se laisse voir rouge.

Le nouveau contrôle, `scripts/check-permission-coverage.mjs`, ferait :

1. Énumérer **toutes** les fonctions exportées de `convex/` gardées par un wrapper d'administration.
2. **Échouer** si l'une d'elles utilise encore `adminQuery` / `adminMutation` au lieu de `permissionQuery(bloc)` / `permissionMutation(bloc)`.
3. Le baseline `permission-coverage-baseline.json` gèle les fonctions **pas encore migrées** — il démarre à 212 et **décroît à chaque étape**, jusqu'à 0.
4. Comme à l'Étape 0, le cliquet joue **dans les deux sens** : une fonction absente du baseline échoue (régression), une entrée du baseline qui a disparu échoue aussi (baseline périmé). Il ne peut que rétrécir.

Une fois le baseline à zéro, on retire `adminQuery` / `adminMutation` du code : **une nouvelle fonction n'a plus aucun moyen de ne pas déclarer son bloc.** À ce moment-là le cliquet devient une règle, et le fichier de baseline disparaît.

Un second contrôle, plus fin, mérite d'exister : **la table du catalogue et l'union `PermissionId` doivent rester alignées.** Un bloc ajouté au type sans ligne dans `docs/CATALOGUE-PERMISSIONS.md` (ou l'inverse) fait échouer le test. Sinon le document devient faux au premier oubli — et c'est ce document que vous lirez dans l'écran de gestion.

### 3.5 Migration

**Aucune.** C'est la conséquence directe du choix « ajouter plutôt que remplacer » (§3.2) :

- Tous les memberships existants portent `role: "admin"` (ou l'utilisateur est `superadmin`). La cascade les autorise à l'étape 1 ou 3, **avant même de regarder les permissions**.
- Le champ `permissions` est `v.optional` → aucun document existant n'est invalide, **aucun backfill**.
- Le rôle `manager` est un **littéral ajouté** à l'union `memberships.role` : les valeurs existantes restent valides. Même patron exact que l'ajout de `talent` et `clipper` en 2026 (`convex/roles.ts`), qui s'était fait sans migration.

Votre première action ne sera donc pas de réparer l'existant, mais de **créer votre premier manager**.

---

## 4. Ce que ça coûte

Chaque étape est livrable et testable seule, et laisse l'app fonctionnelle.

| # | Étape | Contenu | Testable par | Effort |
|---|---|---|---|---|
| 1 | **Le socle** | Littéral `manager`, champ `permissions`, `PermissionId` (18 littéraux), `requirePermission`, wrappers `permissionQuery/Mutation`. Aucune fonction migrée. | Un manager créé en base est **refusé partout** (fail-closed prouvé). Les admins sont inchangés. | **1 j** |
| 2 | **Le cliquet** | `check-permission-coverage.mjs` + baseline à 212 + test CI. | Vu rouge dans les deux sens, comme à l'Étape 0. | **0,5 j** |
| 3 | **Le découpage financier** | Couper `updateCreator` / `getCreator` ; projeter `rateModel` hors de `listFormats` / `getFormat` ; sortir la grille de `createFormat` / `updateFormat`. Crée le bloc `creators.pay_terms`. | Relevé des **clés servies**, comme à l'Étape 0 : `clipRate` absent de `getCreator`. | **1,5 j** |
| 4 | **Migration des blocs cochés** | Basculer sur `permissionQuery(bloc)` les 11 blocs cochés (≈ 150 fonctions, mécanique). | Un manager avec les 11 cases fait un **parcours complet** ; sans une case, il est refusé sur ce bloc précis. | **2 j** |
| 5 | **Migration des blocs décochés** | Les 7 blocs restants (≈ 62 fonctions). Baseline à 0, retrait d'`adminQuery`. | Un manager est refusé de `payments`, `pricing`, `business` **nommément**, module par module. | **1,5 j** |
| 6 | **L'écran de gestion** | Lister les membres, cocher les cases, inviter un manager. Superadmin seul. | Un admin et un manager sont refusés de l'écran ; cocher prend effet **sans reconnexion**. | **2,5 j** |
| 7 | **Navigation et écrans** | Masquer les entrées de menu et les cartes selon les blocs. **Confort** — la barrière est acquise aux étapes 4-5. | Le manager ne voit ni Paiements, ni Barèmes, ni Analytics. | **1 j** |
| 8 | **Les 17 mixtes restantes** | Selon vos réponses : défis, drapeau chauffe, notifications. | Au cas par cas. | **1–2 j** |

**Total : 11 à 12 jours.**

### Le chemin le plus court vers un manager opérationnel

**Étapes 1 → 4, soit ≈ 6 jours** (le socle, le cliquet, le découpage financier, les blocs cochés).

À ce stade : le manager travaille pour de bon — créatrices, comptes, missions, validation, scripts, bibliothèques, tracker, guide — et il est **refusé de tout le reste**, parce que le reste n'est pas encore migré et que `manager` n'est autorisé que sur les blocs explicitement cochés. **Le fail-closed joue en votre faveur : ce qui n'est pas fini est fermé, pas ouvert.**

Ce qui manque alors, et qu'on peut assumer un moment :
- **L'écran de gestion (étape 6)** — vous créez vos premiers managers en ligne de commande, exactement comme les admins aujourd'hui. C'est le compromis qui fait gagner 2,5 jours.
- **Le masquage des menus (étape 7)** — le manager voit les entrées Paiements et Analytics, clique, et tombe sur un refus propre. Inélégant, **pas dangereux**.

Si je devais couper encore : l'**étape 3 (découpage financier) n'est pas négociable**. Sans elle, `creators.manage` laisse modifier un tarif négocié et lire un RIB — c'est-à-dire que la frontière argent que vous avez fixée n'existe pas.

---

## 5. Questions

### 🔴 Bloquantes pour l'Étape 2 — je ne peux pas commencer sans

**Q1 — `creators.manage` contient `deleteCreator`, l'opération la plus destructrice de l'app** (elle efface une créatrice, ses comptes, ses publications et ses missions). Un manager qui gère les fiches peut-il supprimer ? Trois options :
- (a) oui, c'est de la gestion — le bloc reste tel quel ;
- (b) non → **19e bloc** `creators.delete`, décoché par défaut ;
- (c) le manager archive, seul un admin supprime.
*Je recommande (b) : une case de plus coûte moins cher qu'une créatrice effacée.*

**Q2 — `assignScriptToRush` lit le `clipRate` du clippeur pour figer le tarif du clip.** Le manager doit pouvoir monter un script sur une prise, mais il ne doit pas voir les tarifs négociés. La fonction peut **lire** le tarif sans le **renvoyer** : est-ce acceptable, ou voulez-vous que ce geste soit réservé ?

**Q3 — Les défis.** Le bloc est décoché par défaut parce qu'un défi fixe un budget et un barème. Mais l'animation quotidienne (ouvrir, clore, retirer une vidéo, voir le classement) est typiquement un geste de manager. Trois options :
- (a) défis fermés au manager (proposition actuelle) ;
- (b) défis ouverts en entier, budget compris ;
- (c) **découper** : `challenges.run` (ouvrir/clore/participantes/classement) coché, `challenges.money` (créer un défi, fixer budget et barème) décoché. → **20e bloc.**

**Q4 — Le drapeau « chauffe » sur un post** (`setPublicationWarmup`). C'est un fait éditorial (« ce post ne mentionne pas l'app »), c'est un geste quotidien — et il **décide si le post est payé**. Le manager peut-il le poser ? Si oui, il influe indirectement sur la paie sans jamais voir un montant.

**Q5 — Le rôle `admin` doit-il rester « tout par défaut » ?** C'est ce qui donne la migration gratuite. L'alternative (tout le monde en `manager` avec cases cochées) est plus pure mais impose un backfill sur la production le jour du déploiement. *Je recommande fortement de garder `admin`.* Confirmez-vous ?

### 🟠 Non bloquantes — l'Étape 2 peut démarrer sans, mais il les faudra avant l'étape 4

**Q6 — `radar.use` est coché alors que chaque synchro est facturée à l'usage (Apify).** Le manager peut-il déclencher des dépenses de veille ? Même question pour `requestApifySync` et `requestYouTubeSync`, aujourd'hui dans `tracker.manage`.

**Q7 — Le tracker legacy** (carrousels, Shorts, sources : 7 fonctions, écrans hors menu depuis longtemps mais routes vivantes). On leur vote une permission, ou **on les supprime** ? La réponse décide aussi s'il faut découper `tracker.manage` (cf. §1).

**Q8 — Les notifications sont décochées** parce que le digest Telegram transporte le total dû et qu'on peut rediriger le canal. Voulez-vous plutôt **retirer les montants du digest**, ce qui rendrait le bloc cochable ? C'est un petit chantier à part.

**Q9 — Un manager peut-il en gérer un autre ?** Aujourd'hui je propose que l'écran de gestion (étape 6) soit **superadmin seulement**. Un admin de projet devrait-il pouvoir nommer un manager sur son projet ?

**Q10 — Faut-il tracer les changements de permissions** (qui a coché quoi, quand) ? Ça ajoute une table en ajout seul et environ une demi-journée à l'étape 6.

**Q11 — Le libellé des blocs est ce que vous lirez à l'écran.** Relisez la colonne « Libellé » du catalogue : y en a-t-il un que vous ne comprendriez pas sans explication ? C'est le seul test qui compte pour cette colonne.

---

## Annexe — tri exhaustif des 212 fonctions

**212 fonctions classées, aucune sans bloc.** `T` = type : **Q** lecture (query), **M** écriture (mutation).

Signalements : 🟠 **mixte** (gestion + argent dans le même appel, cf. §2.1) · 🔵 **à cheval** (deux blocs légitimes, cf. §2.2) · ⚪ **orpheline** (aucun bloc ne la décrit, cf. §2.3).

### `creators.read` — 3 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `getCreator` | Q | creators | Fiche détaillée d'une créatrice | 🟠 mixte |
| `getCreatorTimezone` | Q | creators | Fuseau horaire d'une créatrice |  |
| `listCreators` | Q | creators | Liste les créatrices du projet |  |

### `creators.manage` — 7 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `addCreatorToProject` | M | creators | Rattache une créatrice existante au projet |  |
| `deleteCreator` | M | creators | Supprime définitivement une créatrice | 🔵 à cheval |
| `getCreatorDeletionImpact` | Q | creators | Ce que la suppression d'une créatrice effacerait |  |
| `inviteCreator` | M | creators | Invite une créatrice (crée la fiche + le lien) |  |
| `regenerateInvitation` | M | creators | Régénère un lien d'invitation |  |
| `updateCreator` | M | creators | Modifie une fiche créatrice | 🟠 mixte |
| `generatePasswordResetLink` | M | passwordReset | Génère un lien de réinitialisation de mot de passe | 🔵 à cheval |

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

### `tracker.manage` — 20 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `requestApifySync` | M | apifySync | Bouton « relever les vues TikTok/Insta maintenant » |  |
| `createSnapshot` | M | metricSnapshots | Saisit un relevé de métriques |  |
| `deleteSnapshot` | M | metricSnapshots | Supprime un relevé |  |
| `updateSnapshot` | M | metricSnapshots | Corrige un relevé |  |
| `createPublication` | M | publications | Crée une publication |  |
| `deletePublication` | M | publications | Supprime une publication |  |
| `duplicateCarousel` | M | publications | Duplique un carrousel en brouillon | ⚪ orpheline |
| `getByCarouselId` | Q | publications | Résout un identifiant vers son format | ⚪ orpheline |
| `getNextCarouselId` | Q | publications | Ancien nom du précédent (compat) | ⚪ orpheline |
| `getNextPublicationId` | Q | publications | Prochain identifiant de publication |  |
| `getPublicationPayFlags` | Q | publications | État des drapeaux chauffe/rémunéré d'un post | 🟠 mixte |
| `getSourceStatus` | Q | publications | Statut anti-shadowban d'une source | ⚪ orpheline |
| `listPublications` | Q | publications | Liste les publications |  |
| `listSources` | Q | publications | Bibliothèque des sources Shorts | ⚪ orpheline |
| `renameSourceId` | M | publications | Renomme une source en cascade | ⚪ orpheline |
| `setPublicationWarmup` | M | publications | Marque un post comme chauffe | 🟠 mixte |
| `updateDraft` | M | publications | Édite un brouillon de carrousel | ⚪ orpheline |
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

### `challenges.manage` — 14 fonctions

| Fonction | T | Fichier | Ce qu'elle fait | |
|---|---|---|---|---|
| `cancelChallengeWin` | M | challengeSync | Annule une victoire de défi, avec motif | 🔵 à cheval |
| `evaluateChallengeNow` | M | challengeSync | Force l'évaluation d'un défi |  |
| `assignChallengeVideo` | M | challenges | Commande une vidéo de défi |  |
| `closeChallenge` | M | challenges | Clôt un défi |  |
| `createChallenge` | M | challenges | Crée un défi (objectif, récompense, barème) | 🟠 mixte |
| `deleteChallenge` | M | challenges | Supprime un brouillon de défi |  |
| `getChallenge` | Q | challenges | Détail d'un défi (réglages, classement, victoires) | 🟠 mixte |
| `listChallengePricings` | Q | challenges | Barèmes éligibles à un défi | 🔵 à cheval |
| `listChallenges` | Q | challenges | Liste les défis |  |
| `openChallenge` | M | challenges | Ouvre un défi aux participantes |  |
| `previewChallengeWinners` | Q | challenges | Aperçu des gagnantes de la prochaine évaluation |  |
| `setChallengeParticipants` | M | challenges | Fixe la liste des participantes | 🟠 mixte |
| `setChallengeVideoRemoved` | M | challenges | Retire une vidéo du score du défi | 🔵 à cheval |
| `updateChallenge` | M | challenges | Modifie un défi | 🟠 mixte |

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