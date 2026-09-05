# Diagnostic — plusieurs rôles pour une personne, et invitation d'un externe

> **Lecture seule.** Aucun fichier applicatif modifié, aucune migration, aucun
> schéma touché. Chaque affirmation cite un chemin et une ligne. Ce qui n'a pas
> été vérifié est marqué **[NON VÉRIFIÉ]**.
>
> Daté du 2026-09-05, sur `main` à `b210f52` (PR #156). Fait suite à
> [`AUDIT_ROLE_MANAGER.md`](../AUDIT_ROLE_MANAGER.md) (l'audit d'avant le
> chantier permissions) et à [`ARBITRAGES-ROLES.md`](../ARBITRAGES-ROLES.md).
>
> **Périmètre lu** : `convex/roles.ts`, `convex/permissions.ts`,
> `convex/functions.ts` (intégral), `convex/auth.ts` (intégral),
> `convex/team.ts` (intégral), `convex/memberPermissions.ts` (intégral),
> `convex/projects.ts` (zones rôle), `convex/creators.ts` (invitation, portail,
> rattachement, suppression), `convex/schema.ts` (users, memberships,
> permissionChanges, creators, invitations), `convex/permissionCoverage.ts`,
> `convex/permissionProbe.ts`, `convex/radar.ts` + `convex/notifications.ts`
> (wrappers d'action locaux), `proxy.ts`, `app/page.tsx`, `app/app/layout.tsx`,
> `app/join/[token]/page.tsx`, `app/admin/[projectSlug]/equipe/page.tsx`,
> `components/portal/PortalRoleGate.tsx`, `components/project/ProjectProvider.tsx`,
> `components/project/use-permissions.ts`, `components/project/PermissionGate.tsx`,
> `components/layout/Sidebar.tsx`, `components/admin/TeamPermissions.tsx`,
> `lib/portal-path.ts`, `lib/roles.test.ts`, `lib/permissions.test.ts`,
> `scripts/check-permission-coverage.*`.
>
> **Vérifié en PRODUCTION** (lecture seule, `convex data --prod`, 2026-09-05) :
> 27 memberships, répartis en 21 `creator`, 4 `admin`, 1 `talent`, 1 `clipper` —
> **zéro `manager`**. La table `permissionChanges` est **vide** : aucun bloc n'a
> jamais été accordé à personne. Et **aucun des 4 admins ne porte de fiche
> `creators`** : il n'existe aujourd'hui aucun cumul de fait. Le rôle manager est
> donc **déployé mais jamais exercé** — ce qui change le statut de plusieurs
> constats ci-dessous, de « défaut actif » à « piège armé ».
>
> **Pas lu en détail** : les 21 blocs × leurs 212 fonctions une par une (seules
> les mutations de `review.manage`, `tracker.manage`, `payments.manage`,
> `challenges.run`, `assignments.manage` et `creators.manage` ont été ouvertes,
> parce que ce sont elles qui portent les conflits d'intérêt).

---

## Résumé — 10 lignes, sans jargon

1. Aujourd'hui, une personne a **exactement un rôle par projet**. C'est écrit
   comme une seule valeur dans une seule case (`memberships.role`).
2. Donc passer une créatrice manager **écrase** son rôle de créatrice. Ce n'est
   pas un effet de bord théorique : le bouton « Passer manager » de l'écran
   Rôles et droits le fait **déjà, en un clic, sans avertissement**.
3. Pire : après ce clic, elle ne perd pas seulement son espace créatrice — elle
   n'a **plus aucun espace du tout**. Le résolveur d'accueil ne connaît pas le
   rôle manager, et lui affiche « aucun espace ». Personne ne s'en est aperçu
   parce que **le rôle manager n'a jamais été utilisé en production** (vérifié :
   zéro manager, zéro droit accordé). Le piège est armé, pas déclenché — et il
   se déclenchera au **premier** manager (§1.1).
4. La bonne nouvelle : la structure est saine. Toutes les portes du serveur sont
   dans **un seul fichier**, et le rôle est relu **à chaque requête** — jamais
   mis en cache dans un jeton. Changer le modèle de rôle ne demande donc pas de
   toucher aux 212 fonctions métier.
5. Le travail réel se concentre sur **une vingtaine d'endroits** qui posent la
   question « quel est ton rôle ? » en supposant qu'il n'y en a qu'un.
6. Le vrai sujet n'est pas technique, il est de **contrôle** : une créatrice
   manager pourrait, selon les cases cochées, **valider ses propres vidéos**,
   **décider qu'un de ses posts est payé**, et **s'assigner elle-même** les
   scripts. Aucune de ces fonctions ne se demande aujourd'hui « est-ce que la
   personne visée, c'est moi ? » (§2).
7. Ce n'est pas une raison d'interdire le cumul : c'est une raison de rendre
   **quelques cases incompatibles** avec le fait d'être aussi créatrice sur le
   même projet — le socle de droits par blocs rend ça facile.
8. Sur l'invitation d'un externe : le circuit `/join` est **entièrement construit
   autour de la fiche d'une créatrice**. Un manager n'a pas de fiche, donc pas de
   circuit. Ma recommandation d'août (un second circuit pour l'équipe interne)
   **tient toujours**, mais pour une raison plus précise qu'à l'époque (§4).
9. Les deux sujets sont **séparables**. L'invitation externe peut partir seule ;
   le cumul de rôles peut partir seul. Les deux passent par un préalable commun
   d'une journée : désarmer les points 2 et 3.
10. Le risque principal du chantier n'est **pas** la cascade ni le cliquet, qui
    résistent bien. C'est que **le rôle manager n'a aujourd'hui aucun test de
    bout en bout** : les sondes ont été écrites pour ça et ne sont branchées à
    aucune spec (§5.3). Toucher au modèle de rôle sans ce filet serait le seul
    vrai danger.

---

## 1. La carte — où « une personne = un rôle » est supposé

### 1.0 Le modèle actuel, en une image

| Niveau | Où | Valeurs | Cardinalité |
|---|---|---|---|
| Rôle global | `users.role` — [convex/schema.ts:41](../convex/schema.ts) | `superadmin` \| `member` (absent ⇒ member) | 1 par personne |
| Rôle par projet | `memberships.role` — [convex/schema.ts:273](../convex/schema.ts) | `admin` \| `manager` \| `creator` \| `talent` \| `clipper` | **1 par (personne, projet)** |
| Droits fins | `memberships.permissions` — [convex/schema.ts:292](../convex/schema.ts) | tableau de blocs du catalogue | n, **manager uniquement** |
| Population de fiche | `creators.kind` — [convex/schema.ts:1096+](../convex/schema.ts) | `partner` \| `talent` \| `clipper` (absent ⇒ partner) | 1 par fiche |

Deux propriétés structurantes, à ne pas perdre de vue :

- **Le rôle de portail DÉRIVE de la fiche**, il n'est pas recopié sur
  l'invitation ([convex/auth.ts:150](../convex/auth.ts), `roleForKind(creator.kind)`).
  C'est l'arbitrage D2 de `ARBITRAGES-ROLES.md`.
- **Les droits s'AJOUTENT au rôle, ils ne le remplacent pas.** La cascade
  s'arrête sur `admin` avant de lire la moindre permission
  ([convex/functions.ts:175](../convex/functions.ts)). C'est ce qui a rendu la
  migration inutile en #154, et c'est la propriété la plus précieuse du
  dispositif.

### 1.1 Le routage à la connexion — et un défaut déjà en production

`api.creators.getMyPortal` ([convex/creators.ts:938](../convex/creators.ts)) est
**le** résolveur d'accueil. Il lit **tous** les memberships de la personne, puis :

```
isSuperadmin || memberships.some(role === "admin")   → { role: "admin", slug }
sinon, PREMIER trouvé dans l'ordre creator → talent → clipper → ce rôle
sinon                                                 → { role: "none" }
```

Trois constats, dans l'ordre de gravité :

1. **`manager` n'est nulle part dans cette fonction.** Un manager n'est ni
   `admin` (ligne 947 : `m.role === "admin"` strictement) ni un rôle de portail
   → il reçoit `{ role: "none" }`, et [app/page.tsx:35](../app/page.tsx) lui
   affiche l'écran « aucun espace ». **Un manager qui tape l'adresse du site
   arrive sur un cul-de-sac** ; il ne travaille que s'il a l'URL
   `/admin/<projet>/dashboard` en favori. Sans rapport avec le cumul de rôles :
   c'est le préalable commun aux deux sujets (§5, étape 0).
   **Statut réel** : la production ne compte **aucun manager** (27 memberships :
   21 creator, 4 admin, 1 talent, 1 clipper) et **aucun droit n'a jamais été
   accordé** (`permissionChanges` vide). Le défaut n'a donc jamais fait de mal —
   il attend le premier manager. **[NON VÉRIFIÉ à l'écran]** — établi par lecture
   du code et par l'état de la base, pas par une session manager réelle (il n'en
   existe pas).
2. La priorité `admin` d'abord est **déjà** une décision de cumul : le
   commentaire de la fonction dit « un humain admin+créateur va sur l'app
   interne ». Le cumul admin+créateur a donc été *anticipé* au routage, mais
   sans jamais être *rendu possible* en base.
3. L'ordre `creator → talent → clipper` entre rôles de portail est un choix
   « déterministe faute de mieux » assumé dans le commentaire. Il devient une
   vraie décision le jour où le cumul existe.

**Ce qui casse si le champ devient une liste** : rien mécaniquement — la
fonction lit déjà l'ensemble des memberships et fait des `.some()`. Il faut y
ajouter le cas `manager` et décider ce qu'on rend quand la personne a **deux
espaces sur le même projet** (§3).

### 1.2 `requirePermission` et la cascade — [convex/functions.ts:146](../convex/functions.ts)

```
1. superadmin                 → AUTORISÉ
2. pas de membership          → REFUSÉ
3. membership "admin"         → AUTORISÉ, sans lire permissions   (ligne 175)
4. membership "manager"       → AUTORISÉ ssi le bloc est accordé  (ligne 176+)
5. tout le reste              → REFUSÉ (pas de `else` permissif)
```

La résolution du membership est un **`.first()` sur l'index
`by_user_project`** (ligne 166). C'est **le point de rupture n°1** :

- **Si on choisit « plusieurs lignes de membership »** (une par rôle), ce
  `.first()` retourne **une ligne arbitraire**. Une créatrice-manager verrait ses
  droits marcher ou pas selon l'ordre d'insertion, et **le même code renverrait
  une réponse différente d'une requête à l'autre**. Ce n'est pas un refus propre,
  c'est un comportement indéterminé — le pire des trois sens possibles. Et le
  même `.first()` est répété à **22 endroits** (`grep by_user_project`), dont 4
  hors de `functions.ts`.
- **Si on choisit « une liste sur la même ligne »** (`roles: string[]`), chaque
  comparaison `membership.role === …` **cesse de compiler**. `tsc` donne alors la
  liste exhaustive des sites à traiter — l'échec est bruyant, pas silencieux.

C'est l'argument décisif : **la liste sur la ligne existante, pas la ligne en
plus.** Il est de la même famille que le choix de littéraux distincts pour
talent/clipper (`convex/roles.ts`, en-tête) : on choisit la forme dont l'oubli
ferme la porte.

Ce qui doit être préservé mot pour mot dans une version « liste » :

- l'ordre `admin` **avant** `manager` (sinon une personne admin+manager verrait
  ses droits limités par ses cases cochées — l'inverse de la promesse) ;
- l'absence de `else` permissif : un rôle inconnu dans la liste **n'accorde
  rien** ;
- `grantedPermissions` qui filtre par **appartenance au catalogue**
  ([convex/permissions.ts](../convex/permissions.ts)) — inchangé, il ne parle pas
  de rôle.

### 1.3 Les autres portiers de `convex/functions.ts`

| Portier | Ligne | Ce qu'il suppose | Ce qui casse en liste |
|---|---|---|---|
| `requireProjectAccess` | [58](../convex/functions.ts) | un membership existe, **rôle non lu** | rien |
| `requireProjectAdmin` | [88](../convex/functions.ts) | `membership.role !== "admin"` → refus (ligne 108) | comparaison à réécrire en « contient admin » |
| `requirePermission` | [146](../convex/functions.ts) | cascade ci-dessus | §1.2 |
| `permissionQuery` / `permissionMutation` | [195](../convex/functions.ts) | rien du rôle (délèguent) | rien |
| `requirePortalMember` | [389](../convex/functions.ts) | `membership.role !== role` → refus (ligne 401) **ET** `roleForKind(creator.kind) !== role` → refus (ligne 416) | les **deux** comparaisons ; voir ci-dessous |
| `requireCreatorViewableByAdmin` | [531](../convex/functions.ts) | passe par `requireProjectAdmin` | hérite de la ligne 108 |
| `adminViewAsPopulationQuery` | [616](../convex/functions.ts) | `roleForKind(creator.kind) !== role` | rien (parle de la fiche, pas du membership) |

**Le point délicat est la ligne 416** : la vérification de cohérence
« le membership et la fiche s'accordent sur la population ». Aujourd'hui elle
est une **égalité**. En liste, elle doit devenir « le rôle dérivé de la fiche est
**présent dans** l'ensemble » — et surtout **pas** « l'ensemble ne contient qu'un
rôle de portail ». Écrite trop strictement, elle enfermerait dehors exactement la
personne qu'on cherche à servir ; écrite trop lâchement, elle ferait sauter la
garantie que talent et clippeur ne peuvent pas entrer par une fonction créateur.

### 1.4 `lib/roles.ts` — et ce qui en dérive

Le module vit en réalité dans [`convex/roles.ts`](../convex/roles.ts) (module
pur, importable des deux côtés ; il n'y a **pas** de réplique `lib/`, cf en-tête
et règle A6). Il est testé par [`lib/roles.test.ts`](../lib/roles.test.ts).

| Symbole | Signature actuelle | Effet d'une liste |
|---|---|---|
| `resolveCreatorKind` | `string? → CreatorKind` | **aucun** — parle de la fiche |
| `roleForKind` | `string? → PortalRole` | **aucun** |
| `kindForRole` | `string? → CreatorKind \| null` | aucun, mais ses appelants passent d'un scalaire à n valeurs |
| `isPortalRole` | `string? → boolean` | aucun ; devient le **filtre** naturel d'un ensemble |
| `PortalRole` / `MembershipRole` (types) | unions de littéraux | inchangés — c'est le **conteneur** qui change |

**Il manque une pièce, et c'est elle qu'il faudrait ajouter** : une fonction pure
`rolesOf(membership)` qui rend l'**ensemble effectif**, en filtrant par la liste
fermée des littéraux — le pendant exact de `grantedPermissions` pour les
permissions. Une valeur inconnue en base n'accorderait alors rien, par la même
mécanique et au même endroit conceptuel. C'est aussi ce qui permet un champ
`roles` **optionnel** lu comme `roles ?? [role]` : zéro migration, une seule
source de vérité **à la lecture**, exactement le mode opératoire du dépôt
(schema.ts:6-21, « champs additifs `v.optional` »).

Dérivés à traiter :

- [`lib/portal-path.ts`](../lib/portal-path.ts) — `portalPathForRole(role)` prend
  **un** rôle. Avec deux espaces, il faut soit choisir avant d'appeler, soit une
  variante `portalPathsFor(roles)`.
- [`convex/permissions.ts`](../convex/permissions.ts) — **ne parle pas de rôle du
  tout**. Aucun impact. C'est la meilleure nouvelle du diagnostic : le catalogue,
  `isPermissionId`, `grantedPermissions`, `blocForRoute` et `canSeeRoute` sont
  orthogonaux au nombre de rôles.

### 1.5 L'écran Administration → Rôles et droits

Serveur : [`convex/team.ts`](../convex/team.ts), gardé par
`superadminQuery`/`superadminMutation` — **volontairement pas par un bloc**
(« un bloc *gérer les droits* serait un bloc qui permet de s'accorder tous les
autres », en-tête de `convex/functions.ts:273`). Écran :
[`app/admin/[projectSlug]/equipe/page.tsx`](../app/admin/%5BprojectSlug%5D/equipe/page.tsx)
et [`components/admin/TeamPermissions.tsx`](../components/admin/TeamPermissions.tsx).

| Élément | Ligne | Suppose « un rôle » | Ce qui casse |
|---|---|---|---|
| `listMembers` | [team.ts:87](../convex/team.ts) | rend `role: m.role` (scalaire) | le type retourné ; l'écran affiche un libellé unique |
| `promoteToManager` | [team.ts:185](../convex/team.ts) | **`patch({ role: "manager" })` — écrase** | ⚠️ voir ci-dessous |
| `setMemberPermissions` | [team.ts:146](../convex/team.ts) | refuse si `m.role !== "manager"` | comparaison |
| `TeamPermissions` (tri) | [.tsx:84-85](../components/admin/TeamPermissions.tsx) | partition binaire manager / autres | une personne serait dans **deux** listes |
| `ROLE_LABELS` | [.tsx:66](../components/admin/TeamPermissions.tsx) | un libellé par personne | affichage à repenser |
| `intouchable` | [.tsx:125](../components/admin/TeamPermissions.tsx) | `admin` ou superadmin | inchangé |

**⚠️ Le défaut le plus concret de tout le diagnostic est ici.**
`promoteToManager` ne refuse **que** le rôle `admin`
([team.ts:193](../convex/team.ts)). Le bouton « Passer manager » est donc
proposé sur la ligne d'une **créatrice**, d'un **talent** ou d'un **clippeur**,
et le clic exécute `patch(membershipId, { role: "manager" })` : le rôle de
portail est **remplacé**. Conséquences en chaîne, toutes vérifiées dans le code :

1. `requirePortalMember` la rejette de **toutes** les fonctions de son portail
   (functions.ts:401) ;
2. `getMyPortal` ne la reconnaît ni admin ni portail → `role: "none"` →
   **écran « aucun espace »** (§1.1) ;
3. sa fiche `creators` reste intacte, avec son `userId` : la personne est donc
   **invisible pour elle-même et normale pour l'admin** ;
4. le geste inverse n'existe pas — aucune mutation ne repose un rôle de portail.
   Le retour se fait en ligne de commande, ou par `updateCreator` avec un
   changement de `kind`, qui est **refusé sur une fiche non vierge**
   ([creators.ts:496](../convex/creators.ts)).

C'est exactement le besoin A vu depuis l'autre bout : le produit ne dit pas
« impossible », il dit « oui » et casse quelque chose en silence.

**Ce bouton n'a jamais été cliqué** : `permissionChanges` est vide en production,
or `promoteToManager` écrit systématiquement dans ce journal
([team.ts:201](../convex/team.ts)). Aucune créatrice n'a donc été cassée à ce
jour — mais rien n'empêche le prochain clic.

### 1.6 Les gardes de portail (creator / talent / clipper)

| Couche | Fichier | Ce qui suppose un rôle unique |
|---|---|---|
| Serveur | [convex/functions.ts:389-425](../convex/functions.ts) | égalité stricte membership↔rôle **et** fiche↔rôle (§1.3) |
| Résolveur `/` | [app/page.tsx:23-33](../app/page.tsx) | un seul `portal.role`, une seule redirection |
| Garde des 3 shells | [components/portal/PortalRoleGate.tsx:53-75](../components/portal/PortalRoleGate.tsx) | `role !== expected` ⇒ **redirection forcée** vers « chez soi » |
| Shell créateur | [app/app/layout.tsx:45](../app/app/layout.tsx) | `usePortalGate("creator")` |
| Sortie de l'app interne | [components/project/ProjectProvider.tsx:96-99](../components/project/ProjectProvider.tsx) | `portalRole` non nul ⇒ **redirection hors de l'admin** |
| Source du `portalRole` | [convex/projects.ts:187](../convex/projects.ts) | `isPortalRole(membership.role)` sur **un** membership |

**Ce qui casse, concrètement, pour une créatrice devenue manager sans perdre son
espace** : `getProjectForCurrentUser` verrait un rôle de portail dans son
ensemble et `ProjectProvider` la **sortirait de l'app interne** à chaque
navigation — elle ne pourrait jamais faire son travail de manager. Et
symétriquement, `PortalRoleGate` la renverrait vers l'admin dès qu'elle ouvre
`/app`. **Les deux gardes se renverraient la personne l'une à l'autre.** C'est le
point de rupture n°2, et il est **côté client**, dans deux fichiers seulement.

La navigation par droits ([Sidebar.tsx:249](../components/layout/Sidebar.tsx),
`canSeeRoute`) n'est **pas** concernée : elle ne lit que les blocs, jamais le
rôle.

### 1.7 Les portes qui ne passent pas par le catalogue

Quatre fonctions gardent encore « es-tu admin ? » **hors** de `functions.ts`,
via un wrapper d'action local (les actions n'ont pas d'accès `db` direct) :

- [convex/radar.ts:90-94](../convex/radar.ts) → `fetchTrendHashtags`,
  `fetchTrendVideos`, `searchOutliers` ;
- [convex/notifications.ts:1354-1358](../convex/notifications.ts) →
  `sendTestNotification`.

Les deux font `membership?.role === "admin"`. **Effet de bord déjà en
production** : un manager qui a le bloc `radar.use` **voit** le Radar
(`listRadarAccounts` est bien en `permissionQuery("radar.use")`) mais **ne peut
pas lancer une recherche d'outliers**. Pour ce chantier, ce sont surtout deux
sites que `tsc` **ne signalera pas** si on se contente de renommer le champ dans
`functions.ts` — ils lisent le document directement. À mettre sur la liste de
relecture manuelle.

### 1.8 Les tests qui verrouillent l'ensemble des rôles

| Test | Ce qu'il verrouille | Réaction à une liste |
|---|---|---|
| [lib/roles.test.ts:108-116](../lib/roles.test.ts) | **parse `convex/schema.ts`** et exige que `memberships.role` déclare exactement `admin + manager + les 3 portails` | ⚠️ le parseur `schemaLiterals` lit les `v.literal()` d'un **champ scalaire**. Un champ `v.array(v.union(...))` change la forme → le test échoue. **C'est un bon tripwire** : il oblige à traiter le sujet plutôt qu'à le glisser. |
| [lib/roles.test.ts:118-124](../lib/roles.test.ts) | « `manager` n'est PAS un rôle de portail » | reste vrai et **doit** le rester |
| [lib/roles.test.ts:37-60](../lib/roles.test.ts) | bijection `roleForKind` ↔ `kindForRole`, littéraux tous distincts | inchangé |
| [lib/permissions.test.ts](../lib/permissions.test.ts) | 21 blocs, 12 cochés par défaut, 0 en section Argent, appartenance stricte | **aucun impact** (ne parle pas de rôle) |
| [scripts/check-permission-coverage.test.mjs](../scripts/check-permission-coverage.test.mjs) | le cliquet : aucune fonction sans bloc, catalogue ↔ document | **aucun impact** |
| [e2e/talent-clipper-role-guard.spec.ts](../e2e/talent-clipper-role-guard.spec.ts) | 3 sessions réelles, chacune rejetée des portails des autres | à **étendre**, pas à modifier |
| [e2e/creator-kind-switch.spec.ts](../e2e/creator-kind-switch.spec.ts) | la bascule de population patche bien le membership | ⚠️ ce patch (creators.ts:513) écrit `role:` en dur |
| [e2e/view-as-populations.spec.ts](../e2e/view-as-populations.spec.ts) | l'observation admin rend la bonne population | inchangé |

### 1.9 Le circuit `/join` et la dérivation du rôle

Chaîne complète, dans l'ordre d'exécution :

1. **Création** — `creators.inviteCreator`
   ([creators.ts:209](../convex/creators.ts), bloc `creators.manage`) : crée la
   **fiche** `creators` (status `invited`, `kind` optionnel) **puis** une ligne
   `invitations { token, creatorId, projectId, email, expiresAt }`
   ([schema.ts:1371](../convex/schema.ts)). **L'invitation ne porte aucun rôle** —
   elle porte un `creatorId`.
2. **Affichage** — `creators.getInvitationPreview`
   ([creators.ts:884](../convex/creators.ts)), seul `publicQuery` du dépôt
   ([functions.ts:640](../convex/functions.ts)). Retour discriminé sans fuite :
   token absent / utilisé / expiré / fiche non-`invited` → **le même**
   `{ status: "invalid" }`.
3. **Écran** — [app/join/[token]/page.tsx](../app/join/%5Btoken%5D/page.tsx),
   route publique ([proxy.ts:32-40](../proxy.ts)). Un seul champ (mot de passe),
   e-mail pré-rempli non modifiable.
4. **Signature** — `convex/auth.ts`, callback `createOrUpdateUser`
   ([auth.ts:104-155](../convex/auth.ts)). **Tout est atomique avec le signup** :
   `users` + `memberships` + `creators.userId` + `status: "onboarding"` +
   `invitations.usedAt`. Le rôle du membership est
   **`roleForKind(creator.kind)`** ([auth.ts:150](../convex/auth.ts)) — dérivé de
   la fiche, jamais de l'invitation.
5. **Régénération** — `creators.regenerateInvitation`
   ([creators.ts:293](../convex/creators.ts)) : tue les anciens tokens, en crée un
   neuf en relisant `creator.email` **depuis la fiche**.

**Pourquoi c'est câblé sur `creators`** : parce que la fiche est la source de
vérité (D2), et parce qu'elle est **le seul endroit durable** où l'intention de
l'admin survit entre l'invitation et le signup. Le token, lui, est jetable.

**Ce qui casse si le rôle devient une liste** : la ligne 150 pose **un** rôle. Il
faut qu'elle pose un **ensemble** — trivial pour une fiche (un `kind` = un rôle),
mais c'est là que se branchera l'invitation d'équipe (§4).

**Deux verrous qui bloquent aujourd'hui le besoin A**, à connaître :

- `inviteCreator` refuse un e-mail **déjà présent dans le projet**
  ([creators.ts:244](../convex/creators.ts)) ;
- `addCreatorToProject` refuse si **un membership existe déjà** sur le projet
  cible, « quel que soit le rôle » ([creators.ts:1256](../convex/creators.ts)).

Donc : **on ne peut pas, aujourd'hui, donner une fiche créatrice à un manager
existant.** Le sens du besoin A (créatrice → manager) et son sens inverse
(manager → aussi créatrice) sont tous les deux fermés, par deux gardes
différentes.

---

## 2. La matrice des combinaisons

Cinq rôles de membership. Dix paires. Le tableau dit **ce que le code fait**, pas
ce que j'en pense ; la colonne « verdict » est ma proposition, la vôtre prime.

**Rappel de vocabulaire** : `creator` = créatrice **partenaire** (fiche
`kind` absent/`partner`).

**État de départ, vérifié en production** : aucun cumul n'existe aujourd'hui —
aucun des 4 admins ne porte de fiche `creators`, et il n'y a aucun manager. Tout
ce qui suit décrit donc des situations à **créer**, pas des situations à
**réparer**. C'est confortable : on choisit les règles avant qu'il y ait des cas.

| # | Paire | Verdict proposé | Ce que le code fait, concrètement |
|---|---|---|---|
| 1 | `admin` + `manager` | **Interdite** (sans objet) | La cascade autorise `admin` **ligne 175**, avant de lire une permission. Les cases cochées ne limitent **rien**. Le danger n'est pas l'accès, c'est **l'écran de gestion qui montrerait des cases décochées** à côté de quelqu'un qui peut tout : le registre mentirait. |
| 2 | `admin` + `creator` | **À trancher** (je déconseille) | Juge et partie **maximal** : `admin` franchit **toutes** les portes sans exception, y compris `payments.manage` et `creators.pay_terms`. Elle validerait ses vidéos, marquerait ses paiements payés, éditerait son propre tarif. Aucune de ces fonctions ne compare l'acteur à la cible (§2.1). |
| 3 | `admin` + `talent` | **À trancher** (je déconseille) | Même chose, périmètre plus étroit : elle tranche ses propres rushes (`rejectRush`, [rushes.ts:210](../convex/rushes.ts)) et fixe son propre forfait de cycle. |
| 4 | `admin` + `clipper` | **À trancher** (je déconseille) | Idem + elle **valide ses propres comptes** (`accounts.manage`), ce qui décide de leur publiabilité (arbitrage D3, phase dérivée de `validatedAt`) et donc de son quota de clips. |
| 5 | **`manager` + `creator`** | **Autorisée, sous conditions** | **C'est le besoin A.** Sans conflit tant que les blocs cochés restent « gestion » (créateurs, comptes, contenu, guide, radar). Devient juge et partie dès qu'on coche `review.manage`, `tracker.manage`, `assignments.manage` ou `challenges.run` (§2.1). |
| 6 | `manager` + `talent` | **Autorisée, sous conditions** | Même forme. Conflit porté par `review.manage` (elle tranche ses rushes) et `assignments.manage` (`assignScriptToRush` sur ses propres dépôts). |
| 7 | `manager` + `clipper` | **Autorisée, sous conditions** | La plus chargée des trois : `review.manage` **+** `tracker.manage` (le lien de publication et la date, donc l'ancre de paie) **+** `accounts.manage` (valider ses comptes) **+** `assignments.manage`. |
| 8 | `creator` + `talent` | **Interdite** (structurelle) | Le rôle de portail **dérive** de `creators.kind`, qui est **une** valeur par fiche. Deux populations = deux fiches ; or `inviteCreator` refuse le doublon d'e-mail dans le projet ([creators.ts:244](../convex/creators.ts)) et `addCreatorToProject` refuse un second membership ([creators.ts:1256](../convex/creators.ts)). Et surtout : `kind` pilote le **modèle de chauffe** (D3) et le **moteur de paie** — deux fiches, ce sont deux ancres de paie pour une personne. |
| 9 | `creator` + `clipper` | **Interdite** (structurelle) | Idem, plus fort : les trois modèles de rémunération sont **mutuellement exclusifs par construction** (Guard C / Guard D, cf `CLOTURE-ROLES.md`). Une même personne payée au CPM **et** au clip ferait entrer les deux moteurs sur les mêmes vidéos. |
| 10 | `talent` + `clipper` | **Interdite** (structurelle) | Idem, plus l'appariement `creators.clipperId` qui deviendrait **réflexif** : elle se déposerait des rushes à elle-même et s'auto-assignerait les scripts (arbitrage D1 : `assignment.creatorId` = le clippeur). |

**Lecture d'ensemble** : la frontière n'est pas « combien de rôles » mais
**« combien de fiches »**. Les trois paires interdites (8, 9, 10) le sont parce
qu'elles demanderaient **deux fiches `creators` pour une personne sur un projet**,
ce que le moteur de paie ne sait pas faire. Les paires 5-6-7 ne demandent
**aucune** fiche supplémentaire : la personne garde **sa** fiche et gagne un rôle
d'administration. C'est ce qui les rend faisables — et c'est exactement le besoin
que vous décrivez.

Si un jour il faut vraiment qu'une personne soit talent **et** clippeuse, la
réponse ne sera pas « deux rôles » mais **« un `kind` de plus »** (une population
mixte, avec son modèle de paie). C'est un autre chantier.

### 2.1 Les conflits « juge et partie », nommés

Aucune des mutations ci-dessous ne se demande **« la personne visée, est-ce
moi ? »**. Elles vérifient le projet, jamais l'identité. Vérifié une par une.

| Bloc | Fonction | Ce qu'elle permet sur soi-même | Enjeu |
|---|---|---|---|
| `review.manage` (coché par défaut) | `reviewVideoApprove` [assignments.ts:1192](../convex/assignments.ts) | approuver **sa propre** vidéo soumise → `to_publish` → publication → paie | Argent |
| `review.manage` | `confirmPublicationAsAdmin` [assignments.ts:3172](../convex/assignments.ts) | déclarer **sa propre** publication, avec une date qui **ancre la paie** (cf `admin-backup-publish`) | Argent |
| `review.manage` | `rejectRush` [rushes.ts:210](../convex/rushes.ts) | refuser le rush d'un autre talent | Équité |
| `tracker.manage` (coché) | `setPublicationWarmup` [publications.ts:994](../convex/publications.ts) | retirer le drapeau warmup de **son propre** post → sans `remunere` explicite, **la paie suit** : le post devient payé | **Argent, direct** |
| `tracker.manage` | `updateMetrics`, `createSnapshot` [publications.ts:670](../convex/publications.ts), [metricSnapshots.ts:214](../convex/metricSnapshots.ts) | saisir/corriger **ses propres** vues, dont dépend le CPM et les paliers de bonus | **Argent, direct** |
| `assignments.manage` (coché) | `assignScriptCampaign` [scripts.ts](../convex/scripts.ts) | `creatorId` est un **paramètre libre** : elle s'assigne les scripts, choisit le barème (par **nom** — #156 ne lui montre pas les montants) et le nombre de vidéos | Argent + équité |
| `challenges.run` (coché) | `setChallengeParticipants`, `setChallengeVideoRemoved`, `cancelChallengeWin` [challenges.ts:645,903](../convex/challenges.ts), [challengeSync.ts:140](../convex/challengeSync.ts) | fixer les participantes d'un défi **où elle concourt**, retirer la vidéo d'une rivale, annuler une victoire | Équité |
| `accounts.manage` (coché) | validation de comptes | valider **ses propres** comptes → publiabilité et quota (D3) | Équité |
| `creators.manage` (coché) | `generatePasswordResetLink` [passwordReset.ts:68](../convex/passwordReset.ts) | générer un lien de connexion pour **une autre créatrice** → prise de contrôle de son compte. Refusé uniquement pour un **superadmin** (ligne 84) | **Sécurité** |
| `payments.manage` (**décoché**) | `markPaymentPaid`, `computeViewBonus`, `setPublicationRemuneration` | se déclarer payée, calculer son bonus, épingler la rémunération d'un post | Argent |
| `creators.pay_terms` (**décoché**) | édition du tarif négocié | fixer son propre tarif | Argent |

**Trois observations qui comptent.**

1. **La frontière argent de #154 protège déjà les deux pires cas** :
   `payments.manage` et `creators.pay_terms` sont **décochés par défaut**. La
   frontière n'avait pas été pensée pour le cumul, et elle tient quand même.
2. **Mais quatre blocs cochés par défaut portent de l'argent** :
   `tracker.manage`, `review.manage`, `assignments.manage`, `accounts.manage`.
   Sur un manager **sans** fiche, c'est le rôle voulu. Sur une créatrice-manager,
   c'est de l'auto-service. **La différence n'est pas dans le bloc, elle est dans
   le cumul** — donc c'est bien au moment du cumul qu'il faut la traiter.
3. `creators.manage` + le fait d'être créatrice donne un chemin de **prise de
   contrôle du compte d'une consœur** (lien de reset). Ce risque existe déjà pour
   un manager d'aujourd'hui ; le cumul le rend seulement plus tentant. À
   signaler, pas à imputer à ce chantier.

**Deux façons de traiter, à trancher (§6, Q3)** :

- **(i) Au niveau du cumul** — le serveur refuse d'accorder certains blocs à un
  membership qui porte **aussi** un rôle de portail sur le même projet. Une seule
  règle, un seul endroit (`team.ts`), lisible dans l'écran (« ces cases sont
  indisponibles parce qu'elle est aussi créatrice sur ce projet »). Coût : faible.
  Défaut : c'est tout ou rien — elle ne peut plus valider **aucune** vidéo, y
  compris celles des autres.
- **(ii) Au niveau du geste** — chaque mutation sensible refuse quand la cible
  est la fiche de l'acteur (« tu ne peux pas valider ta propre vidéo »). ~12
  fonctions à toucher, une garde partagée. Coût : moyen. Avantage : elle fait
  son travail de manager sur **tout le monde sauf elle**, ce qui est probablement
  ce que vous voulez vraiment.

Je recommande **(ii)**, avec **(i)** pour les deux blocs Argent (qui n'ont aucun
sens sur une personne payée par le projet). Une garde partagée
`refuseSiCEstMoi(ctx, creatorId)` est du même genre que `assertScriptEditable` :
un seul endroit, appelé par les deux ou trois familles de fonctions concernées.

---

## 3. L'expérience de la personne

### 3.1 Y a-t-il un précédent ? Oui, deux — c'est moins inédit qu'il n'y paraît

1. **Le switcher de projet créateur**
   ([CreatorProjectSwitcher.tsx](../components/portal/CreatorProjectSwitcher.tsx)
   + `CreatorProjectProvider`). Une créatrice de plusieurs projets a **déjà**
   un menu de bascule, du branding par projet, et son choix **mémorisé en
   `localStorage`**. C'est exactement la mécanique dont on a besoin — appliquée à
   « quel projet » au lieu de « quel espace ».
2. **Le mode « voir l'espace d'un créateur »** (`/admin/voir/*`,
   `adminViewAsQuery`). Un admin **sort du shell admin** pour rendre les écrans
   d'un portail, en lecture seule. C'est le précédent d'un **shell qui n'est pas
   celui du rôle principal**.

En revanche, **deux espaces réellement actifs pour la même personne, avec
écriture des deux côtés, n'existe nulle part**. Et le mécanisme actuel
travaille **contre** : `PortalRoleGate` et `ProjectProvider` se renvoient la
personne l'un à l'autre (§1.6). Il faudra désactiver cette boucle, quel que soit
le choix d'interface.

### 3.2 Ce qu'elle voit dans l'écran Administration

Aujourd'hui, si le cumul existait sans rien changer à l'écran, elle apparaîtrait
**deux fois** — une fois dans la liste des managers (avec ses 21 cases), une fois
dans « Autres membres » (avec un bouton « Passer manager » sur quelqu'un qui
l'est déjà), parce que le tri est une partition binaire
([TeamPermissions.tsx:84-85](../components/admin/TeamPermissions.tsx)).

Ce qu'il faudrait, au minimum :

- **une seule ligne par personne**, portant **plusieurs étiquettes de rôle**
  (« Manager · Créatrice partenaire ») ;
- un geste **additif** (« ajouter le rôle manager ») et son inverse (« retirer le
  rôle manager »), là où il n'y a aujourd'hui qu'un remplacement irréversible ;
- un **avertissement explicite** sur les cases en conflit avec sa fiche (§2.1),
  parce que la personne qui coche ne devinera pas que `tracker.manage` veut dire
  « elle peut décider qu'un de ses posts est payé ».
- le journal (`permissionChanges`) enregistre **déjà** chaque bloc accordé/retiré
  avec son auteur ([team.ts:163](../convex/team.ts)) ; il n'enregistre **pas** les
  changements de **rôle**. Un cumul mérite une ligne de journal — c'est un
  changement de pouvoir au moins aussi important qu'une case.

### 3.3 Deux options d'interface

#### Option A — « Un espace principal, un lien vers l'autre » (recommandée pour démarrer)

Le routage ne change pas de forme : `getMyPortal` continue de rendre **un**
espace, avec l'admin prioritaire (règle déjà écrite dans le code). On ajoute :

- un booléen dans le retour (`aussiCreatrice: true`) ;
- une entrée discrète dans la sidebar admin — « **Mon espace créatrice** » →
  `/app` ;
- le chemin retour depuis le portail — « **Retour à l'espace équipe** » ;
- la levée de la boucle de redirection (§1.6) : `PortalRoleGate` cesse de
  chasser une personne qui a **aussi** le rôle attendu, et `ProjectProvider`
  cesse de sortir de l'admin quelqu'un qui a **aussi** un rôle interne.

**Ce que ça coûte** : `getMyPortal` (un champ), deux fichiers de garde (les deux
conditions à assouplir), deux liens de navigation. Aucun état à mémoriser, aucun
nouveau composant. **Estimation : 1 jour**, tests compris.

**Ce que ça coûte à l'usage** : elle atterrit toujours du côté équipe. Si son
vrai quotidien est de tourner des vidéos et que le management est occasionnel,
elle fera un clic de trop **chaque matin**.

#### Option B — « Deux espaces, un sélecteur, un souvenir »

`getMyPortal` rend **la liste** de ses espaces. Le résolveur `/` route vers
**le dernier utilisé** (mémorisé comme le fait déjà le switcher de projet), et un
sélecteur en tête de sidebar — présent **des deux côtés** — bascule de l'un à
l'autre, exactement comme le switcher de projet aujourd'hui.

**Ce que ça coûte** : la forme de retour de `getMyPortal` change → ses **3
consommateurs** s'adaptent ([app/page.tsx](../app/page.tsx),
[PortalRoleGate](../components/portal/PortalRoleGate.tsx) et les 3 layouts de
portail) ; un composant sélecteur ; une clé `localStorage` de plus (avec sa purge,
comme le filtre de campagne) ; la même levée de boucle que l'option A ; et un cas
limite à traiter — **le souvenir pointe un espace qu'on vient de lui retirer**
(fail-closed : retomber sur l'espace restant, jamais sur un écran vide).
**Estimation : 2 à 3 jours.**

**Ce que ça coûte à l'usage** : rien au quotidien, c'est l'option confortable.
Mais c'est **le double de surface** pour un besoin qui concerne peut-être une
seule personne.

**Ma recommandation** : **A d'abord**. Elle est réversible, elle ne fige aucune
forme de retour, et elle donne la réponse à la seule question qui compte —
est-ce qu'elle bascule dix fois par jour, ou deux fois par semaine ? Si c'est dix
fois, B se pose ensuite **sans rien jeter** de A.

---

## 4. L'invitation externe

### 4.1 Comment `/join` fonctionne, et pourquoi il est câblé sur `creators`

Le détail est en §1.9. Le résumé qui compte pour la décision :

**L'invitation ne porte pas de rôle — elle porte un pointeur vers une fiche.** Le
rôle est **recalculé** au signup depuis cette fiche
(`roleForKind(creator.kind)`, [auth.ts:150](../convex/auth.ts)). C'est ce qui
rend la régénération d'un lien inoffensive : `regenerateInvitation` relit la
fiche, jamais l'ancien token.

Une personne d'équipe n'a **pas** de fiche `creators`. Il n'y a donc **aucun
endroit durable** où poser son rôle avant qu'elle ait un compte. Le circuit ne
lui est pas « mal adapté » : il lui manque une pièce.

### 4.2 Réévaluation honnête de (a) contre (b)

**Ce que je disais en août** (AUDIT_ROLE_MANAGER.md, question 14) : (a) un second
circuit pour l'équipe interne ; (b) faire porter un rôle aux invitations —
« plus rapide, mais casse le principe selon lequel l'invitation ne porte aucun
rôle ». Je recommandais (a).

**Le socle de permissions change-t-il ce raisonnement ? Non — mais il en change
la formulation, et c'est important.**

L'argument d'août était formulé comme un **principe** (« une invitation ne doit
pas porter de rôle »). Formulé ainsi, il ne tient pas tout seul : depuis #154, il
existe des objets durables pour décrire un pouvoir (`memberships.permissions`, le
catalogue fermé, le journal `permissionChanges`, la validation par union de
littéraux dans `team.ts`). Un rôle écrit sur une invitation serait **validé**
aussi sérieusement qu'un bloc coché. Le tabou, comme tabou, est levé.

**Ce qui tient toujours, et qui est le vrai argument** : `regenerateInvitation`
([creators.ts:293](../convex/creators.ts)) doit pouvoir **re-dériver** ce que
l'admin avait voulu, sans le recopier. Aujourd'hui il relit la fiche. Si le rôle
ne vivait **que** sur le token :

- ou bien la régénération recopie l'ancien token → deux tokens portent la même
  vérité, et la corriger (« finalement, pas manager ») exige de savoir lequel
  fait foi ;
- ou bien la régénération redemande le rôle → et alors **l'admin peut le changer
  sans que rien ne le trace**, sur un lien qui a déjà été envoyé.

Autrement dit : **le problème n'est pas que l'invitation porte un rôle, c'est
que le rôle n'ait pas de domicile.** Et dès qu'on lui donne un domicile — une
ligne durable qui décrit la personne invitée et ce qu'elle sera —, l'option (b)
**devient** l'option (a), avec une copie redondante en plus.

**Conclusion : (a), toujours. Mais pour la bonne raison, et le socle de #154 la
rend nettement moins chère qu'en août** — le catalogue, le validateur, l'écran de
gestion et le journal existent déjà. Ce qui reste à écrire :

1. une table de **membres invités** (`email`, `projectId`, rôles visés, blocs
   visés, `expiresAt`) — la jumelle de `creators` pour l'équipe interne ;
2. `invitations` gagne un pointeur **discriminé** : elle vise **soit** une fiche
   `creators`, **soit** un membre invité. Jamais les deux, jamais aucun ;
3. une seconde branche dans `createOrUpdateUser`
   ([auth.ts:104-155](../convex/auth.ts)) — **c'est le point le plus sensible du
   dépôt** : la fonction est la seule porte de création de compte, et elle est
   atomique. La règle à tenir : une invitation dont la forme n'est **ni** l'une
   **ni** l'autre est **refusée**, pas tolérée ;
4. un geste « Inviter quelqu'un dans l'équipe » dans l'écran Rôles et droits,
   `superadminMutation` comme le reste de `team.ts` ;
5. un e-mail d'invitation d'équipe (le gabarit créatrice parle de missions).

### 4.3 L'invitation doit-elle poser plusieurs rôles d'emblée ?

**Oui, mais pas n'importe lesquels — et pas tout de suite.**

- Le seul cumul utile à l'invitation est **manager + créatrice** (paire 5). Les
  paires 8/9/10 sont structurellement interdites (§2), et `admin + manager` est
  sans objet.
- **Mais un cumul à l'invitation demande deux objets, pas un** : le membre invité
  **et** une fiche `creators` (sans quoi elle n'a ni fuseau, ni langue, ni méthode
  de paiement, ni rien de ce que le portail lit). Deux objets créés d'un coup et
  liés au même token, c'est une transaction de signup plus lourde — dans la
  fonction la plus critique du dépôt.
- **Le chemin économique existe déjà** : inviter la personne **comme créatrice**
  (circuit actuel, inchangé, elle a sa fiche), puis **ajouter le rôle manager**
  depuis l'écran Rôles et droits une fois son compte créé. Deux gestes, zéro
  risque sur `auth.ts`.

**Recommandation** : l'invitation d'équipe pose **un** rôle interne (`manager`,
avec ses blocs) — et le cumul se fait **après**, par l'écran. On garde la
possibilité de le poser d'emblée pour plus tard ; on ne la construit pas
maintenant. La règle à écrire dans le code dès le premier jour, en revanche :
**le champ est un ensemble, pas un scalaire** — pour ne pas refaire ce
diagnostic dans six mois.

---

## 5. Ce que ça coûte

### 5.1 Les étapes, livrables séparément

Chacune est testable seule, et chacune laisse le dépôt dans un état cohérent.
Les estimations sont en jours de travail, à titre indicatif.

| # | Étape | Contenu | Testable par | Est. |
|---|---|---|---|---|
| **0** | **Désarmer les deux pièges** | (a) `getMyPortal` reconnaît `manager` → il atterrit sur son dashboard au lieu de « aucun espace » (§1.1) ; (b) `promoteToManager` **refuse** un membership de portail, avec un message qui oriente (§1.5). Indépendant des deux sujets, et sans risque : zéro manager en base | 2 specs e2e : session manager → `/` → dashboard ; promotion d'une créatrice → refus lisible | **1 j** |
| **1** | **Le filet manquant** | Brancher les sondes de `permissionProbe.ts` à une **vraie spec e2e** : manager avec 12 blocs → sonde cochée OK, sonde décochée refusée, bloc hors catalogue refusé, rôle inconnu refusé (§5.3) | elle-même — c'est le test | **1 j** |
| **2** | **Le rôle devient un ensemble** | `memberships.roles` optionnel, `rolesOf()` pur dans `convex/roles.ts` (filtré par liste fermée), les ~20 comparaisons réécrites, `lib/roles.test.ts` mis à jour. **Aucun changement d'UI, aucun cumul encore possible** | unitaires (`rolesOf`) + toute la suite existante, qui doit rester verte à l'identique | **2-3 j** |
| **3** | **Le cumul devient possible, sans conflit** | Écran Rôles et droits : une ligne par personne, rôles additifs, retrait, journal du changement de rôle. Gardes serveur `promoteToManager`/`setMemberPermissions` en « contient » | e2e : promotion d'une créatrice → elle garde son portail **et** gagne l'admin | **1,5-2 j** |
| **4** | **Juge et partie** | Garde partagée « la cible, c'est moi » sur les ~12 mutations de §2.1, + refus des blocs Argent sur un membership qui porte une fiche | unitaires sur la garde + e2e : créatrice-manager refusée sur **sa** vidéo, acceptée sur celle d'une autre | **1,5-2 j** |
| **5** | **L'expérience** | Option A (§3.3) : levée de la boucle de redirection, deux liens de navigation | e2e : elle navigue dans les deux sens sans être renvoyée | **1 j** |
| **6** | **Invitation d'équipe** | Table de membres invités, pointeur discriminé sur `invitations`, seconde branche de `createOrUpdateUser`, geste dans l'écran, e-mail | e2e : invitation → signup → manager avec ses blocs, **et** les 4 cas de refus (token invalide/utilisé/expiré/forme inconnue) | **3-4 j** |
| **7** | *(optionnel)* | L'invitation pose fiche + rôle interne d'un coup (§4.3) | e2e dédié | 1-2 j |

**Total sujet A (cumul)** : étapes 0 → 5 = **8 à 10 jours**.
**Total sujet B (invitation)** : étapes 0, 1, 6 = **5 à 6 jours**.
**Les deux** : **11 à 13,5 jours** (les étapes 0 et 1 sont partagées).

### 5.2 Ensemble ou séparément, et dans quel ordre

**Séparément. Et B peut partir en premier.**

- L'**étape 6** (inviter un externe comme manager) **ne dépend pas** du cumul :
  on invite quelqu'un qui n'a **qu'un** rôle interne. Elle a besoin des étapes 0
  et 1, rien de plus.
- Le **sujet A** a besoin de 2 avant 3, de 3 avant 4, et de 5 en dernier —
  l'expérience se règle une fois qu'on sait ce que la personne a le droit de
  faire.
- Les deux ne se gênent **que** sur `createOrUpdateUser` : si l'étape 6 est
  écrite avant l'étape 2, elle posera un rôle scalaire qu'il faudra retoucher.
  **Une ligne**, dans une fonction qu'on relira de toute façon.

**Ordre recommandé** : **0 → 1 → 2 → 3 → 4 → 5**, puis **6**. Si le recrutement
est urgent : **0 → 1 → 6**, puis reprendre en 2. Ne **jamais** commencer par 3
ou 6 sans 1 (§5.3).

### 5.3 Où ce chantier fragiliserait ce qu'on vient de construire

C'est votre inquiétude principale ; voici la réponse, du plus grave au moins.

**① Le rôle manager n'a aucun test de bout en bout. C'est le vrai danger.**
Vérifié : **aucune spec e2e n'ouvre une session `manager`** (le mot n'apparaît
qu'une fois dans tout `e2e/`, et c'est dans un commentaire —
`publication-pay-flags.spec.ts:72`), aucune n'appelle `e2eAssertPermission` ni
les sondes, et `requirePermission` — la fonction qui décide de tout —
**n'est couverte par aucun test automatisé**, ni unitaire (elle
importe `_generated`, donc `lib/` ne peut pas la tester) ni e2e. Ce qui est
testé, c'est le **catalogue** (`lib/permissions.test.ts`) et le **cliquet**
(`check-permission-coverage.test.mjs`) : de l'analyse statique, pas du
comportement. L'en-tête de `permissionProbe.ts` explique que les sondes existent
**précisément** pour ça — « un wrapper de contrôle d'accès jamais exécuté est
exactement le genre de code qu'on croit vert » — et elles n'ont jamais été
branchées. **Toucher au modèle de rôle sans ce filet, c'est modifier la serrure
sans avoir jamais essayé la clé.** D'où l'étape 1, avant tout le reste.

**② La cascade tient, à une condition de rédaction.** L'ordre
`superadmin → admin → manager → refus` doit rester **séquentiel**, pas devenir
un `||`. Le piège précis : écrire `roles.some(r => r === "admin" || (r === "manager" && aLeBloc))`
inverse subtilement la sémantique — le rôle inconnu ne tomberait plus dans le
refus final, il serait simplement « pas trouvé », ce qui est le même résultat
**aujourd'hui** mais pas le jour où quelqu'un ajoutera un `else`. Écrire d'abord
`if (roles.has("admin")) return;` puis `if (!roles.has("manager")) throw;`
conserve la forme actuelle **et sa propriété**.

**③ Le fail-closed a besoin de son pendant côté rôles.** Aujourd'hui, une valeur
hors catalogue dans `permissions` n'ouvre rien, parce que `grantedPermissions`
**filtre par appartenance**. Un ensemble de rôles doit être filtré **de la même
façon**, par la liste fermée des littéraux, dans la **même fonction pure** —
sinon un rôle écrit à la main en base (`"superadmin"`, `"*"`) traverserait. Le
test correspondant existe déjà pour les permissions
(`lib/permissions.test.ts`, « une liste entièrement hors catalogue n'accorde
rien ») ; il faut son jumeau pour les rôles.

**④ Le cliquet n'est pas menacé — sauf par une porte neuve.**
`check-permission-coverage.mjs` échoue si `adminQuery`/`adminMutation`
réapparaissent, et si le catalogue et le document divergent. Rien de ce chantier
n'y touche. **Le seul risque** : ajouter une mutation « changer les rôles » qui
ne serait ni un bloc ni un `superadminMutation`. Le cliquet ne la verrait pas —
il compte les fonctions **legacy**, pas les fonctions **non gardées**. Règle à
tenir : tout ce qui touche aux rôles va dans `team.ts`, sous
`superadminMutation`, comme le reste.

**⑤ Deux sites que `tsc` ne signalera pas.** `convex/radar.ts:94` et
`convex/notifications.ts:1358` lisent `membership?.role === "admin"` sur un
document **typé par le schéma** : si `role` devient optionnel à côté d'un
`roles`, ces lignes **compilent toujours** et deviennent silencieusement fausses.
À traiter à la main, avec une relecture dédiée. (Elles portent par ailleurs un
défaut existant : un manager avec `radar.use` ne peut pas lancer une recherche
d'outliers — §1.7.)

**⑥ Deux écritures de rôle en dehors de `team.ts`.**
`convex/creators.ts:513` (bascule de population) et `convex/auth.ts:150`
(signup) écrivent `role:` en dur. En modèle d'ensemble, **elles doivent
remplacer le rôle de portail sans toucher aux autres** — un `patch` naïf
effacerait le rôle manager d'une créatrice-manager qui change de population.
C'est le genre de perte qui ne se voit qu'au moment où la personne ne peut plus
travailler.

**⑦ Le pointeur discriminé de `invitations` (étape 6) touche la fonction la plus
critique du dépôt.** `createOrUpdateUser` est la **seule** porte de création de
compte, et sa transaction est atomique avec le signup. La discipline : une
invitation dont la forme n'est ni « fiche » ni « membre invité » est **refusée**,
et le message de refus reste **le même que les autres** (pas de fuite : le
dépôt tient déjà que token absent / utilisé / expiré donnent le même
`{ status: "invalid" }`).

**⑧ Ce qui n'est PAS menacé, et c'est beaucoup.** Le catalogue des 21 blocs, la
frontière argent, `isPermissionId`, `grantedPermissions`, `blocForRoute`,
`canSeeRoute`, la sidebar qui suit les droits, `PermissionGate`, le journal
`permissionChanges`, la règle « en cas de doute on montre », les deux contrôles
du cliquet : **aucun ne parle de rôle**. Le socle de #154 est orthogonal au
nombre de rôles d'une personne. C'est ce qui rend ce chantier raisonnable.

---

## 6. Mes questions

### Bloquantes — je ne peux pas commencer sans

**Q1. La créatrice-manager peut-elle valider des vidéos, et lesquelles ?**
C'est la question qui décide de l'étape 4, et elle ne se contourne pas. Trois
réponses possibles, trois codes différents :
(i) **aucune** — le bloc `review.manage` lui est refusé tant qu'elle a une fiche ;
(ii) **toutes sauf les siennes** — garde « la cible, c'est moi » sur ~12
mutations (ma recommandation) ;
(iii) **toutes, y compris les siennes** — on assume, on ne code rien, et on le
dit clairement dans l'écran.
La même réponse vaut pour le drapeau warmup, la saisie de vues et l'assignation
de scripts, qui sont les trois autres portes d'argent (§2.1).

**Q2. Qui a le droit d'accorder un second rôle ?**
Aujourd'hui l'écran Rôles et droits est **superadmin seul**, par un choix
explicite (« la seule porte qu'on ne peut pas se déverrouiller soi-même doit
rester en dehors du système qu'elle protège »). Un admin de projet peut-il
cumuler des rôles sur **son** projet, ou est-ce que ça reste chez vous ? Je
recommande **superadmin seul**, au moins au début : un admin qui peut se donner
une fiche créatrice se donne un chemin vers l'argent.

**Q3. Combien de personnes, et laquelle en premier ?**
Une seule personne (la créatrice qui devient manager) ⇒ **option A** en
interface, et l'étape 6 peut attendre. Trois ou quatre, avec des recrutements
externes prévus ⇒ l'ordre s'inverse, et l'option B se justifie. **La réponse
change l'ordre des étapes, pas leur contenu.**

**Q4. Le sujet B est-il urgent ?**
« Recruter quelqu'un qui n'a aucun compte » : c'est pour la semaine prochaine ou
pour dans trois mois ? Si c'est imminent, il y a un contournement **sans code** :
inviter la personne comme créatrice (circuit actuel), puis la passer manager
depuis l'écran — ce qui marche **dès que l'étape 3 est faite**, et évite les 3-4
jours de l'étape 6. Ça vous laisse une fiche `creators` inutile sur son nom ;
c'est le seul inconvénient.

### Non bloquantes — je peux avancer avec une hypothèse, dites-moi si elle est fausse

**Q5.** Le défaut du §1.1 (**un manager qui tape l'adresse du site tombe sur
« aucun espace »**) — je le traite en étape 0. La production ne compte aucun
manager, donc personne ne l'a jamais rencontré : je le tiens pour établi par le
code et par l'état de la base, mais **pas** par une session réelle. Si vous
préférez le voir de vos yeux avant qu'on y touche, ça se constate en dix minutes
sur le backend local — dites-le et je le fais.

**Q6.** Le bouton « Passer manager » sur la ligne d'une créatrice (§1.5)
casserait son espace au premier clic. Il n'a jamais été cliqué (journal vide),
mais il est proposé à l'écran **dès maintenant**. Je propose de le neutraliser
dès l'étape 0 — un refus serveur explicite : « cette personne a un espace
créatrice, utilise *ajouter le rôle manager* » — sans attendre l'étape 3. Une
demi-journée de plus, et le piège est désarmé tout de suite.

**Q7.** Sur l'écran Rôles et droits, une personne à deux rôles : **une ligne avec
deux étiquettes** (ma proposition) ou **une carte par rôle** ? La première est
plus honnête (une personne = une ligne), la seconde plus proche de l'existant.

**Q8.** Une créatrice-manager doit-elle **se voir elle-même** dans la liste des
créatrices qu'elle gère ? Aucun filtre ne l'en empêche aujourd'hui ; ça a l'air
anodin, mais c'est le même sujet que Q1 sous un autre angle.

**Q9.** L'ancien argument d'août — « une invitation ne porte pas de rôle » —
n'était pas faux, il était **mal formulé** (§4.2). Le bon énoncé est : *le rôle
doit avoir un domicile durable que la régénération peut relire.* Est-ce que cette
reformulation vous convient ? Elle change ce qu'on écrit dans le code, pas la
conclusion.

**Q10.** Le digest Telegram transporte le **total dû** sur un canal par projet
(déjà signalé en août, question 16, restée sans réponse). Une créatrice-manager
qui y serait présente lirait la paie de toutes les autres — **aucun contrôle
applicatif ne l'en empêche**, c'est un canal, pas un écran. À traiter avec ce
chantier, ou à laisser hors périmètre en connaissance de cause ?
