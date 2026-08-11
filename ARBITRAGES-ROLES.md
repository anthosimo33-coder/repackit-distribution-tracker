# Arbitrages — chantier rôles Talent & Clippeur

Ce document est le **pendant décisionnel** de [`DIAGNOSTIC-ROLES.md`](./DIAGNOSTIC-ROLES.md) :
le diagnostic pose les questions, celui-ci porte les réponses **et leurs raisons**.

Il existe parce que plusieurs de ces choix ont l'air d'être des complications
gratuites quand on ne connaît que le code. Ils ne le sont pas. Avant de
« simplifier » l'un d'eux, lire la ligne « Pourquoi » correspondante — chacune
correspond à un bug réel évité, mesuré ou constaté en production.

| Version | Date | État |
|---|---|---|
| Arbitrages actés par le fondateur | 2026-08-11 | En vigueur |

**Découpage du chantier** : 7 PRs, une à la fois, dans cet ordre — 1 rôles &
routage · 2 rushes & espace talent · 3 moteur de phase et quota · 4 revue &
assignation script→rush · 5 comptes & appariement clippeur↔talent · 6 espace
clippeur · 7 pricing. PR 1 mergée le 2026-08-11 (#25).

---

## Le principe qui domine tout le chantier

> **Rien du flux des créateurs partenaires ne change.**

Ils publient sur leurs propres comptes, avec leur pricing fixe/CPM/paliers et
leurs assignations. Toute évolution qui altérerait leur comportement actuel est
hors périmètre et doit être **signalée plutôt qu'appliquée**. Deux arbitrages
ci-dessous (B1, D3) ne s'expliquent que par cette règle.

Corollaire de conception, posé en PR 1 : les deux nouvelles populations reçoivent
des **littéraux `memberships.role` distincts** (`"talent"`, `"clipper"`).
`requireCreator` exigeant `"creator"`, un talent ou un clippeur est repoussé
**mécaniquement** de toutes les fonctions créateur existantes — aucune n'a été
modifiée. Un oubli de gating ferme la porte au lieu de l'ouvrir.

---

## D1 — `assignment.creatorId` = le clippeur

Le rush porte `talentId` ; l'assignation créée à partir de lui a pour `creatorId`
**le clippeur**.

**Pourquoi.** `assignments.creatorId` cumule trois rôles dans le code existant :
le **payé** (`accrueBaseLineItem`, `payments.creatorId`, `bonusUnlocks.creatorId`,
`creators.firstPostAt`), le **propriétaire des comptes cibles** (garde
`compte.creatorId === assignment.creatorId` dans `validateTargets`), et la **clé
de filtrage du portail**. Le clippeur possède les comptes et publie : il est le
`creatorId` naturel au sens du code. Choisir le talent aurait obligé à relâcher
`validateTargets` — la garde qui empêche aujourd'hui la publication croisée entre
créatrices.

---

## D2 — Étendre `memberships.role`, discriminer par `creators.kind`

Une seule table de fiches (`creators`), un champ `kind` : `partner` (absent) /
`talent` / `clipper`.

**Pourquoi.** `creators` porte déjà tout ce dont un clippeur a besoin (méthode de
paiement, `bonusPricingId`, `firstPostAt`) et tout ce sur quoi le portail filtre.
Deux tables séparées auraient dupliqué la couche de gating **et** les clés
étrangères du moteur de paie (`payments.creatorId`, `bonusUnlocks.creatorId`,
`assignments.creatorId`).

**Le rôle DÉRIVE de la fiche**, il n'est pas recopié sur l'invitation :
`convex/roles.roleForKind` est appelé au signup (`convex/auth.ts`). Un rôle
stocké sur l'invitation aurait créé deux sources de vérité, et
`regenerateInvitation` est exactement le chemin qui les fait diverger en silence.

---

## D3 — Coexistence des deux modèles de chauffe, pas remplacement

Le warmup **par checks réels** reste intact pour les partenaires. Les comptes de
clippeur reçoivent un modèle de **phase dérivée d'une date**
(`comptes.validatedAt`), discriminé par le `kind` du propriétaire.

**Pourquoi — c'est le point le plus contre-intuitif du chantier.** Le modèle en
place compte les **checks quotidiens réellement posés** (7 j TikTok/YouTube, 14 j
Instagram), délibérément découplé du calendrier ([lib/warmup.ts](./lib/warmup.ts)).
La spec des clippeurs veut l'inverse : chauffe J1-3, warmup J4-6, démo J7-13,
croisière J14+, dérivées d'une date de validation.

**Deux gates de production dépendent du modèle actuel** : l'éligibilité d'un
compte comme cible d'assignation (`validateTargets`) et la garde de publication
(`confirmPublicationCore`). Réécrire la règle changerait **la publiabilité de
chaque compte en prod du jour au lendemain, sans qu'aucun humain n'ait rien
fait** — un compte à 5/7 checks deviendrait publiable, ou cesserait de l'être,
selon la nouvelle arithmétique. La coexistence confine le changement aux comptes
neufs. `comptes.validatedAt` est additif (`v.optional`) : aucune migration.

---

## D4 — Phase 1 : Drive tel quel, preview admin par `webViewLink`

Cloudflare Stream en upload direct est la **phase 2**, après vérification que le
jeton en place a bien la portée `direct_upload` (le repo n'implémente aujourd'hui
que `/stream/copy`, cf `convex/cloudflareStreamApi.ts`).

**Mesure du 2026-08-11 qui justifie de ne pas se précipiter.**
`snytchDriveFiles` est **vide en prod** : le dépôt Drive a été livré (#95) et
jamais utilisé — aucun rush réel n'existe. Les seules vidéos téléphone réelles du
système sont les soumissions de créatrices : **19 Mo** pour celle en vol le
2026-08-11, **80 à 138 Mo** pour les 6 historiques documentées
([convex/storageCleanup.ts:12](./convex/storageCleanup.ts)) — et ce sont des
**montages finis**, pas des rushes.

Aux débits iPhone réels (4K60 ≈ 400 Mo/min, 4K30 ≈ 170, 1080p30 ≈ 65), une prise
de 5 s en 4K60 pèse ~33 Mo. Le lot de 25 rushes est donc **autour de 1,25 Go**, et
non 6,25 Go comme estimé dans le diagnostic — soit ~20 min d'upload séquentiel au
lieu de ~1 h 45, et 50 Mo perdus au maximum sur une coupure au lieu de 250.

**Conséquence actée** : le chemin séquentiel existant suffit en phase 1. La
**reprise après coupure, l'upload parallèle et la file persistée sont hors
périmètre**, et la décision de les construire se prendra sur la distribution
réelle de `rushes.sizeBytes` après le premier lot déposé — pas sur une hypothèse.

**Question produit encore ouverte** : un rush est-il une prise de 5 s du seul hook
(→ lot ≈ 0,9 Go) ou une prise complète de 30-60 s (→ lot ≈ 6-12 Go) ? Facteur 10
sur le même écran. C'est pour ça que `rushes` stocke `sizeBytes` dès la PR 2.

---

## D5 — Unicité du script : **amendée** (B1)

| Propriétaire du compte cible | Clé d'unicité du combo |
|---|---|
| Créateur **partenaire** | `(créateur, plateforme)` — **inchangé** |
| **Clippeur** | `(accountId)` |

Discriminant : le `kind` du propriétaire, dans les deux fonctions pures déjà
répliquées (`lib/script-combo-uniqueness.ts` + réplique `convex/scripts.ts`).

**Pourquoi l'amendement.** D5 prévoyait un remplacement global, au motif que
« deux verrous sur le même geste produisent des refus inexplicables ». L'argument
ne tient pas ici : ce n'est pas deux verrous sur un geste, c'est **un verrou
différent selon le type de propriétaire** — aucun geste ne subit les deux.

Et le remplacement global aurait **relâché la garantie des partenaires** :
**2 couples (créateur, plateforme) portent 2 comptes en production** (relevé le
2026-08-11 sur 24 comptes, dont 14 rattachés à un créateur). Pour eux, un combo
consommé sur le compte A serait redevenu piochable sur le compte B — soit le même
script publié deux fois par la même personne sur la même plateforme. C'est
précisément ce que l'anti-coordination existe pour empêcher.

---

## D6 — Le routage de page reste côté client

**Pourquoi.** C'est l'architecture documentée du dépôt : `proxy.ts` ne vérifie que
« authentifié », et l'invariant qui compte — aucune donnée ne franchit une
frontière de rôle — est tenu par les wrappers serveur, par fonction. Déplacer une
décision d'autorisation dans `proxy.ts` la mettrait là où on ne peut pas lire la
base à bon compte, et dupliquerait la source de vérité.

**La mitigation est une spec, pas une redirection** :
`e2e/talent-clipper-role-guard.spec.ts` prouve avec de vraies sessions que les
deux nouveaux rôles sont rejetés de l'app interne **et** du portail partenaire, et
que le partenaire garde son accès.

---

## D7 — Cas A : tous les rushes sont muets, avec une garde (B2)

Le texte arrive à l'écran au montage. `rushes` **ne porte pas de type**.

**Garde à l'assignation** : un script n'est assignable à un rush que si ses
briques **`hook` et `flux`** sont toutes en `mode: "afficher"`.

Deux précisions qui ne sont pas des détails :

1. **`cta` est EXCLU de la garde.** Le champ `mode` y est ignoré par conception
   (zone description, cf `convex/schema.ts`) et **aucun cta n'a de mode en prod**
   (14/14 absents). L'inclure refuserait **100 % des scripts** — la garde serait
   silencieusement mortelle.
2. **`mode` absent = REFUSÉ**, aligné sur le défaut `les_deux` de
   `resolveBrickMode`. Relevé prod du 2026-08-11 sur 93 briques : hook = 46
   `afficher` / 9 `dire` / 8 `les_deux` / **7 absents** ; flux = 5 `afficher` / 3
   `les_deux`. Les 7 hooks non étiquetés sont à corriger **à la main** dans
   l'admin avant mise en service ; l'espace de combos remontera de lui-même
   au-delà des 230 (46 × 5) alors disponibles.

Il faut aussi **filtrer les briques éligibles avant le tirage** et **nommer la
brique fautive** dans l'erreur : sans ça, l'admin tombe sur « aucun combo
disponible » sans explication.

*Le cas B (certains rushes parlés) n'est pas retenu. Son coût n'était pas le
schéma mais le flux : un rush parlé est lié à UN script dès le tournage, donc le
script devrait être assigné avant la prise de vue — ce qui détruit le stock de
rushes réassignables, l'intérêt économique du modèle.*

---

## Rémunération

| Rôle | Modèle | Déclencheur |
|---|---|---|
| **Talent** | Forfait mensuel récurrent, montant par talent | Échéance du mois |
| **Clippeur** | Montant fixe **par clip**, tarif par clippeur | Clip validé **puis** publié |

Aucun des deux n'est au CPM. Gel au paiement comme les modèles existants :
modifier un tarif ne réécrit jamais une ligne déjà attribuée.

### B3 — Le forfait talent est en MOIS CALENDAIRE, pas en cycles J+30

`periodOf` + `markPeriodPaid` (qui existent déjà) + cron mensuel idempotent +
section talents dans l'écran Paiements.

**Pourquoi.** Les cycles créateurs font **30 jours fixes**
(`CYCLE_LENGTH_MS`) : un forfait « mensuel » sur cette base produirait **12,17
échéances par an**, soit un 13ᵉ paiement certaines années — un bug d'argent, et
incompréhensible pour la personne payée. Second motif : tout l'écran Paiements
passe par `cyclePaymentsForCreator`, qui renvoie `[]` sans `firstPostAt`, et
`markCyclePaid` **jette** « Aucun cycle : le créateur n'a pas encore publié ». Un
talent ne publiant jamais, il serait purement **invisible** de l'écran de paie.
Le coût accepté est un second chemin de lecture dans cet écran.

### B5 — Les deux URLs avant paiement

Un clip n'est `published` — donc payé — que lorsque **toutes** ses cibles portent
une URL. C'est déjà le comportement de `confirmPublicationCore` : **ne pas le
relâcher**, ne pas prévoir de paiement partiel ni de déclenchement à la première
URL.

Conséquence assumée : si Instagram échoue ou est décalé, le clip reste en attente
et non payé jusqu'à ce que la seconde URL soit collée. Le clip n'est pas fini tant
qu'il n'est pas sorti partout ; le tarif unitaire couvre les deux comptes.
L'espace clippeur doit rendre cet état **lisible** : 1 URL sur 2 s'affiche « en
attente », avec la cible manquante nommée — jamais « publié ».

### Le piège du double paiement — invariant, pas point d'attention

Une assignation de clip ne doit **JAMAIS** porter `pricingSnapshot`. C'est le
chemin du double paiement **clip + CPM** : `accrueBaseLineItem` no-ope quand
`pricingSnapshot` est présent (Guard C), et `computeLivePricingBreakdown` ramasse
au contraire tout assignment qui en porte un. Le tarif du clip vit donc dans un
champ **disjoint**, `clipRateSnapshot`, et **une spec doit échouer** si un
assignment de clip porte un `pricingSnapshot`.

Corollaire posé dès la PR 1 : `pricingSnapshot` et `rateSnapshot` sont **absents
de l'allowlist clippeur** (`convex/clipperAssignmentFields.ts`) — deuxième ligne
de défense, même posé par erreur le champ n'atteindrait pas son écran.

### Le plafond de 150 $ ne s'applique pas au clip

`MAX_PAY_PER_VIDEO_EUR` protège contre une dérive du **CPM**. Le tarif par clip
est un montant unitaire fixe réglé par l'admin, sans calcul de vues derrière : il
n'y est **pas** soumis, et cela doit être **câblé explicitement** en PR 7 — pas
laissé au hasard de l'héritage.

---

## Le quota ne peut pas s'appuyer sur `now`

Le quota de posts par jour est **dérivé de la phase du compte**, jamais saisi à la
main, et **gardé serveur dans `confirmPublicationCore`** — une garde d'UI seule
serait contournée dans la semaine.

Il se compte sur la **date réelle de publication**, saisie par le clippeur au
moment de coller le lien, **pas** sur l'horodatage d'écriture. Motif : TD-020 — la
date d'une publication est aujourd'hui celle où le lien est collé. Un clippeur qui
poste à 22 h et colle le lien le lendemain matin produirait un **faux dépassement**
et un **faux trou**. Le champ est rendu **uniquement côté clippeur** (l'ajouter au
formulaire partenaire serait un changement de leur UX) et borné serveur comme le
fait déjà `confirmPublicationAsAdmin`.

---

## Le piège d'une ligne : le régime strict tient à un slug en dur

`SNYTCH_SLUG = "snytch"` ([lib/snytch-drive.ts](./lib/snytch-drive.ts),
`convex/projects.ts`) commande **à la fois** le dépôt de fichiers Drive **et** le
régime **strict** de disponibilité des comptes (`isAccountAvailable({strict})`,
appelé par `validateTargets` et par `confirmPublicationCore`).

En régime strict, seul un compte `"actif"` — donc **validé par l'admin** — peut
être ciblé ou publié. Hors Snytch, le régime **lenient** s'applique : un warmup
terminé mais **non validé** suffit.

**Conséquence** : si les nouveaux rôles vivaient dans un autre projet, l'invariant
« un compte non validé ne peut rien publier » **cesserait silencieusement d'être
vrai**. C'est pourquoi le chantier reste dans le projet `snytch` existant (Q4), et
pourquoi tout dégatage de ce slug doit être fait **par champ de projet explicite**,
jamais par élargissement implicite.

---

## Autres décisions de cadrage

- **Q3** — 1 talent → 1 clippeur, 1 clippeur → 1..N talents. Un champ
  `creators.clipperId` sur la fiche du **talent** suffit : pas de table de
  jointure.
- **Q4** — projet `snytch` existant, jamais un projet neuf (cf le piège ci-dessus).
- **Q5** — rush rejeté par l'admin → **purge du binaire**, métadonnées conservées.
  Rush jamais assigné → état `expired` à **60 jours**, purge du binaire.
- **B4** — l'admin choisit les comptes cibles **à l'assignation** ;
  `assignments.targets` reste **figé à la création** (modèle partagé avec les
  partenaires, à ne pas déverrouiller). Les comptes du clippeur sont cochés par
  défaut : un clip sort systématiquement sur les deux plateformes, l'écran de
  sélection doit rester trivial.
- **Le talent ne publie jamais** : `creators.firstPostAt` ne doit jamais être posé
  sur sa fiche. C'est acquis (il ne passe pas par `confirmPublicationCore`) mais
  doit être **couvert par une spec**.

---

## Hors périmètre, sans crochet laissé

Cloudflare Stream en upload direct · reprise après coupure · upload parallèle ·
file d'upload persistée · notifications automatiques « rush disponible »
(l'admin prévient à la main) · reprise responsive de l'admin (la revue de rushes
est desktop, assumé) · migration du stock Drive existant.
