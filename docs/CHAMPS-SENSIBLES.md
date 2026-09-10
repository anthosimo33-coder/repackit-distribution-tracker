# Champs sensibles — qui a le droit de les renvoyer

> Référence du chantier permissions (cf `AUDIT_ROLE_MANAGER.md`).
> Tenu par `scripts/check-db-spread.mjs` (branché sur `pnpm lint`) et par
> `scripts/check-db-spread.test.mjs` (branché sur `pnpm test:unit`, donc la CI).

## À quoi sert ce fichier

Une query Convex décide de ce qui traverse le réseau. Tant qu'elle écrit
`return { ...doc }`, cette décision revient au **schéma** : tout champ ajouté
plus tard à la table part au navigateur, sans que personne ne l'ait voulu.

Ce fichier liste les champs qui portent de l'**argent** ou des **coordonnées de
paiement**, et dit pour chacun **quelles queries ont le droit de le servir**.
Une query absente de la colonne « servi par » n'a pas à le renvoyer.

**Masquer n'est pas protéger.** Un champ qui arrive dans le navigateur est
lisible dans l'onglet réseau, quel que soit ce que l'écran affiche. La seule
barrière est de ne pas l'envoyer.

## Table `creators` — rémunération et coordonnées

| Champ | Contenu | Servi par | Interdit à |
|---|---|---|---|
| `paymentMethod` | sepa / paypal / usdt / autre | `creators.getCreator`, `payments.listPayments` (export CSV) | `creators.listCreators` |
| `paymentDetails` | **IBAN / e-mail PayPal / adresse USDT** | `creators.getCreator`, `payments.listPayments` (export CSV) | `creators.listCreators` |
| `clipRate` | tarif par clip négocié | `creators.getCreator` | `creators.listCreators` |
| `cycleRetainer` | forfait mensuel du talent | `creators.getCreator` | `creators.listCreators` |
| `bonusPricingId` | barème de bonus de la fiche | `creators.getCreator` | `creators.listCreators` |
| `adminNotes` | notes internes (pas financier, mais privé) | `creators.getCreator` | `creators.listCreators` |

`getCreator` sert la FICHE — le seul écran qui affiche et édite ces champs
(`components/creators/CreatorDetailView.tsx`). `listCreators` alimente cinq
écrans (table Créateurs, tracker, appariement, sélecteur de propriétaire,
assignation de campagne) dont **aucun** ne les affiche.

## Table `assignments` — tarif figé par vidéo

| Champ | Contenu | Servi par | Note |
|---|---|---|---|
| `rateSnapshot` | fixe + CPM figés à l'attribution | `assignments.listAssignments`, `getAssignmentDetailAsAdmin`, portail créateur | **Exposé DÉLIBÉRÉMENT** — le tarif unitaire fait partie du geste d'assignation |
| `pricingSnapshot` | barème complet figé | idem | idem |
| `clipRateSnapshot` | tarif clip figé | idem | idem |

Ces trois champs restent servis : c'est un arbitrage produit, pas un oubli.
La projection explicite de `listAssignments` existe pour que **le prochain**
champ financier ajouté à la table soit une décision, pas une fuite.

## Agrégats — jamais recalculés côté client

| Donnée | Query autorisée | Ce qui est interdit |
|---|---|---|
| Total dû du projet | `payments.getDueTotal` (un nombre) | lire `payments.listPayments` pour en faire une somme |
| Revenu attribué par ref | `conversionSync.readConversionAllTime` (lignes **déjà mises en forme**) | renvoyer les lignes brutes + la liste des créatrices et laisser le client dériver |

`payments.listPayments` reste réservé à la page Paiements, qui les **affiche**
toutes et les exporte en CSV.

## Autres tables entièrement financières

Ces tables n'ont pas de champ « sûr » : elles ne servent que des écrans
business (Paiements, Barèmes, Analytics, Rentabilité).

| Table | Ce qu'elle porte |
|---|---|
| `pricings` | `montantFixe`, `tauxCPM`, `seuilBonusVues`, `montantBonus`, `bonusTiers` |
| `bonusUnlocks` | `montant`, `coutReel`, `cumulAtUnlock`, `pricingId` |
| `payments` | lignes de paie, `totalDue`, `paidAt` |
| `whopPayments` | `grossAmount`, `feeAmount`, `netAmount`, `refundedAmount`, `currency` |
| `whopPlans` | `price`, `currency` |
| `whopMemberships` | `whopUserId`, `whopMembershipId`, ref d'attribution |
| `creatorConversions` | `revenue`, `currency` |

## Configuration de projet

`projects` porte `whop` (clés d'API), `fxRateToRevenue` (taux de change) et
`defaultBonusPricingId`. **Aucun ne sort** : la projection client
`convex/projects.ts` → `projectForClient` est une whitelist explicite qui ne
laisse passer que `slug`, `name`, `accentColor`, `logoUrl`, `payoutDay`,
`payCurrency`, `sidebarLinks`, `status`. C'est le modèle qu'appliquent
désormais `listCreators`, `getCreator` et `listAssignments`.

## Ajouter un champ financier — la marche à suivre

1. L'ajouter au schéma.
2. L'ajouter **explicitement** à la projection de chaque query qui doit le
   servir. Sans cette ligne, il ne sort pas — c'est voulu.
3. L'inscrire dans le tableau ci-dessus, avec sa colonne « servi par ».

Si une query en a besoin et qu'elle alimente un écran qui ne l'affiche pas :
c'est le signe qu'il faut une **seconde query**, pas un champ de plus.

## Dette connue

`scripts/db-spread-baseline.json` gèle **24 spreads préexistants** dans des
queries (`listComptes`, `listPublications`, `listInspirations`, `listFolders`,
`listIcps`, `listPersonnes`, `listAssets`…). Aucun ne porte de champ monétaire
aujourd'hui — c'est pourquoi ils n'ont pas été corrigés dans le même lot, qui
visait les fuites réelles. Le baseline est un **cliquet** : il ne peut que
rétrécir. Les traiter est un chantier d'hygiène à part entière.
