# Clôture — chantier Talent / Clippeur

> Troisième et dernier document du chantier, après
> [`DIAGNOSTIC-ROLES.md`](./DIAGNOSTIC-ROLES.md) (l'état des lieux d'avant) et
> [`ARBITRAGES-ROLES.md`](./ARBITRAGES-ROLES.md) (les décisions au fil de l'eau).
> Celui-ci dit ce qui a été livré, pourquoi, ce qui reste dû, et ce que les tests
> ont appris.
>
> Clos le 2026-08-13. Huit PRs, #25 à #39.

## Ce qui a été livré

| PR | Objet |
|---|---|
| #25 | Rôles `talent` / `clipper`, gardes serveur, routage, allowlists |
| #31 | Table `rushes`, dépôt Drive dégaté, brief permanent, écran talent |
| #32 | `comptes.validatedAt`, moteur de phase, quota de publication |
| #33 | Revue admin des rushes, `assignScriptToRush`, garde D7 |
| #36 | Validation des comptes, appariement clippeur ↔ talent |
| #37 | Espace clippeur : comptes, clips, publication datée |
| #38 | Pricing : tarif par clip, forfait de cycle, Guard D |
| #39 | Configuration de l'espace talent depuis l'app |

Deux populations coexistent désormais avec les créateurs partenaires, **sans
qu'aucune fonction du flux partenaire n'ait changé de comportement**. Ce n'est pas
une précaution de rédaction : c'est la contrainte qui a gouverné chaque PR, et
plusieurs décisions ci-dessous n'existent que pour la tenir.

## Les décisions structurantes

**D1 — le `creatorId` d'un clip est le CLIPPEUR, pas le talent.**
`assignments.creatorId` cumule trois rôles : le payé, le propriétaire des comptes
cibles, la clé de filtrage du portail. Le clippeur possède les comptes et publie :
il *est* ce `creatorId` au sens du code existant. L'alternative — garder le talent
et ajouter un `publisherId` — aurait relâché la garde d'appartenance
(`compte.creatorId === assignment.creatorId`) qui protège aujourd'hui contre la
publication croisée entre créatrices. Le talent reste relié par le rush.

**D3 — deux modèles de chauffe COEXISTENT, aucun n'est remplacé.**
Les partenaires comptent leur warmup en **checks réellement posés** ; les comptes
de clippeur suivent une **phase dérivée d'une date** (`validatedAt`). Les deux
règles sont incompatibles sur le même champ, et deux gates de production en
dépendent (éligibilité d'une cible, garde de publication). Appliquer la nouvelle
rétroactivement aurait changé *ce qui est publiable* du jour au lendemain, sans
qu'aucun humain n'ait rien fait.

**D5 amendée — l'unicité du combo reste `(créateur, plateforme)`.**
Le remplacement global par `(compte)` était refusé : deux couples (créateur,
plateforme) portent déjà deux comptes chez les partenaires, et le remplacement
aurait rendu repiochable un combo déjà consommé — le même script publié deux fois
par la même personne sur la même plateforme. Voir la dette TD-023 pour le
déclencheur.

**D7 cas A — les rushes sont muets, donc seuls les scripts « à afficher » sont
assignables.** La garde porte sur `hook` + `flux` seulement ; `cta` en est exclu,
son `mode` étant ignoré par conception — l'inclure aurait refusé 100 % des scripts
en production. Un `mode` absent est **refusé**, pas toléré : une brique dont
personne n'a dit si elle se dit ou s'affiche n'est pas une brique à afficher.

**B3 corrigée — le talent est au cycle J+30, pas au mois calendaire.**
Le raisonnement initial (« 12,17 échéances par an = un treizième paiement »)
supposait un salaire mensuel. Le modèle réel est un cycle de livraison : 12,17
cycles par an correspondent à 12,17 lots livrés. La correction supprime d'un coup
les questions de mois partiel, de mois de sortie, et tout second chemin de lecture.
Le moteur existant est réutilisé tel quel ; la seule addition est l'ancre
`creators.payAnchorAt`, **posée uniquement sur un talent** — sur un partenaire elle
serait antérieure à son premier post et recalerait tous ses cycles, y compris ceux
déjà payés.

**Guard D — les trois modèles de rémunération sont mutuellement exclusifs par
construction.** `accrueBaseLineItem` no-ope quand l'assignation porte un
`clipRateSnapshot`, symétriquement à Guard C pour `pricingSnapshot`. Filtrer
l'affichage aurait traité le symptôme : une ligne à 0 € masquée à l'écran ne cesse
pas d'exister dans le grand livre, et n'importe quelle agrégation future la
ramasserait.

## Ce qui reste dû, avec son déclencheur

Une dette dont personne ne connaît le déclencheur se redécouvre en production.

**TD-020 — la date d'une publication est celle où le lien est collé.**
*Déclencheur : déjà actif.* Produit de faux retards au calendrier. Le chantier a
contourné localement (le clippeur déclare sa date réelle, et le quota se compte
dessus), il n'a pas corrigé la cause.

**TD-022 — les notifications relisent la donnée au lieu de la figer à l'émission.**
*Déclencheur : un chantier qui déplacerait une écriture après la planification de
la notification.* Aujourd'hui inoffensif, et attrapé par test ; le jour où ça
casse, le message décrira un état qui n'existait pas au moment du geste.

**TD-023 — l'unicité du combo bloquera au 2ᵉ compte d'une même plateforme.**
*Déclencheur : le jour où un clippeur exploite deux comptes TikTok.* Un script
consommé sur le premier devient inassignable sur le second, et l'admin lit « tous
les scripts ont déjà été utilisés » alors que le stock est intact. Le correctif ne
doit **pas** remplacer la règle globalement (cf D5 amendée).

**TD-024 — la règle « ce lien est un shortlink TikTok » est écrite trois fois, et
deux copies sont plus étroites que l'originale.**
`convex/postUrlDate.isTikTokShortlink` reconnaît `vm.`/`vt.tiktok.com` **et**
`tiktok.com/t/<code>` ; `lib/post-url-account.ts` et `lib/inspiration-url.ts`
réimplémentent la même règle sans la forme `/t/`.
*Déclencheur : un lien `tiktok.com/t/…` collé par une créatrice.* Il sera traité
comme un shortlink par le chemin de publication (aucune date décodable) mais pas
reconnu comme tel par les deux autres — classement d'inspiration erroné, et
extraction de handle tentée sur une URL qui n'en porte pas. Correctif : les deux
`lib/` importent la définition canonique (`lib/` a le droit d'importer `convex/`).

## Ce que les tests ont appris

C'est la partie la plus réutilisable du chantier, et elle ne dépend ni de ce
produit ni de ce dépôt.

**Un test peut être vert sans rien prouver.** Cinq formes du même défaut ont été
rencontrées, chacune sur du code réel :

| # | Forme | Ce qu'on croyait tester | Ce qui se passait |
|---|---|---|---|
| 1 | **Fenêtre dégénérée** | une règle de période | la fenêtre était vide, tout passait |
| 2 | **Assertion tautologique** | une valeur calculée | la chaîne cherchée contenait le motif cherché |
| 3 | **Jeu de données idéalisé** | un audit de pseudo | prénoms nus au lieu de noms complets — le vrai cas n'était jamais formé |
| 4 | **Borne qui mesure la mise en page** | une règle métier | l'assertion tombait sur du code correct, à cause d'un rendu |
| 5 | **Rouge pour la mauvaise raison** | un invariant d'argent | l'`insert` échouait avant l'assertion, jamais atteinte |

**La question qui les couvre toutes, à se poser avant de considérer un test
écrit :** *par quel chemin exact ce résultat s'est-il produit ?*

Elle attrape les cinq. Un test vert dont on ne sait pas retracer le chemin ne
garde rien ; un test rouge dont on n'a pas lu la cause n'en garde pas davantage.

**Trois pratiques qui en découlent, appliquées ici :**

1. **Voir rouge avant de croire.** Toute spec qui garde une règle d'argent a été
   mise en échec en cassant volontairement le code qu'elle protège, puis remise au
   vert. Trois invariants de la PR #38 ont été traités ainsi ; l'un d'eux ne
   prouvait rien au premier essai.
2. **Choisir le jeu de données avant les assertions.** Des décimales, un cycle
   partiel, un modèle legacy qui cohabite, et le cas vide. Des nombres propres
   laissent passer une somme fausse en la faisant tomber juste.
3. **Traverser, pas seulement couvrir.** Sept segments verts n'entraînent pas une
   chaîne verte : le seul défaut resté invisible tout le chantier — aucun code ne
   faisait passer un rush à `published` — était **entre** deux segments couverts.
   Il a fallu écrire `e2e/chantier-chaine-complete.spec.ts` pour le voir. C'est le
   mode d'échec propre à un chantier découpé, et il ne se voit qu'en traversant.

**Et une forme de relevé, pour toute vérification de non-régression :** comparer
la **signature de chaque ligne**, pas seulement le total — un total identique peut
masquer deux lignes qui se compensent ; et **lister** les cas écartés au lieu de
les écarter en silence — un diff vert obtenu par exclusion muette est un diff qui
ment.
