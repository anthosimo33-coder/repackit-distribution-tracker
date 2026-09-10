/**
 * RÔLES DE PORTAIL — source unique du mapping `creators.kind` ↔ `memberships.role`.
 *
 * Module PUR (aucun import `_generated`) → importable côté client ET testable
 * depuis `lib/` (même patron que `convex/creatorAssignmentFields.ts` et
 * `convex/soloDays.ts`, tous deux testés via `import "../convex/…"`). Il n'y a
 * donc PAS de réplique `lib/` à maintenir : la règle A6 interdit à `convex/`
 * d'importer `lib/`, pas l'inverse.
 *
 * Trois populations coexistent, avec des littéraux de membership DISTINCTS :
 *
 *   - "partner" → membership "creator" : le créateur partenaire HISTORIQUE. Il
 *     publie sur ses propres comptes, avec le pricing fixe/CPM/paliers. RIEN de
 *     son flux ne change.
 *   - "talent"  → membership "talent"  : dépose des rushes bruts depuis mobile.
 *     Ne voit ni script, ni compte, ni statistique, ni les rushes des autres.
 *   - "clipper" → membership "clipper" : déclare ses comptes, chauffe, monte,
 *     soumet, publie et colle le lien.
 *
 * ⚠️ CE CHOIX DE LITTÉRAUX DISTINCTS est ce qui rend l'ajout des deux rôles SÛR :
 * `requireCreator` (convex/functions.ts) exige `membership.role === "creator"` et
 * rejette donc MÉCANIQUEMENT un talent ou un clippeur de TOUTES les fonctions
 * créateur existantes. Aucune fonction du flux partenaire n'est à modifier, et
 * un oubli de gating ne peut pas ouvrir une porte : il la ferme.
 *
 * La FICHE (`creators.kind`) est la SOURCE DE VÉRITÉ : le littéral de membership
 * en dérive au signup (cf convex/auth.ts). L'invitation ne porte donc aucun rôle
 * — régénérer un lien ne peut pas dériver du rôle réel de la personne.
 */

/** Populations d'une fiche `creators`. `partner` = comportement historique. */
export const CREATOR_KINDS = ["partner", "talent", "clipper"] as const;
export type CreatorKind = (typeof CREATOR_KINDS)[number];

/** Littéraux de rôle qui donnent accès à UN portail (pas l'admin). */
export const PORTAL_ROLES = ["creator", "talent", "clipper"] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];

/**
 * Littéraux `memberships.role` qui donnent accès à L'APP INTERNE (`/admin/…`),
 * par opposition à un portail. `manager` = admin restreint : ce qu'il peut y
 * FAIRE est décidé bloc par bloc (convex/permissions.ts), mais l'endroit où il
 * travaille est le même que celui de l'admin.
 *
 * ⚠️ CE GROUPE EXISTE PARCE QU'IL MANQUAIT. `getMyPortal` ne connaissait que
 * `admin` et les trois portails : un manager n'était NI l'un NI l'autre, et
 * recevait donc « aucun espace » à l'accueil — il ne pouvait travailler qu'avec
 * l'URL du dashboard en favori. Le rôle était livré depuis #154 sans jamais
 * avoir servi en production (0 manager en base au 2026-09-05), d'où un défaut
 * armé mais jamais déclenché.
 *
 * L'ORDRE EST SIGNIFIANT : `admin` d'abord. Une personne qui serait admin sur un
 * projet et manager sur un autre atterrit sur celui où elle peut tout — c'est
 * l'ordre le moins surprenant, et le même que celui de la cascade de
 * `requirePermission` (admin AVANT manager, cf convex/functions.ts).
 */
export const TEAM_ROLES = ["admin", "manager"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/**
 * TOUS les littéraux de rôle, en LISTE FERMÉE. C'est le pendant exact de
 * `PERMISSION_ID_LITERALS` pour les droits : on autorise parce qu'une valeur
 * APPARTIENT à cette liste, jamais parce qu'elle est PRÉSENTE en base.
 */
export const MEMBERSHIP_ROLES = [...TEAM_ROLES, ...PORTAL_ROLES] as const;
export type MembershipRole = TeamRole | PortalRole;

const MEMBERSHIP_ROLE_SET: ReadonlySet<string> = new Set(MEMBERSHIP_ROLES);

/** La chaîne appartient-elle à la liste fermée des rôles ? */
export function isMembershipRole(
  value: unknown,
): value is MembershipRole {
  return typeof value === "string" && MEMBERSHIP_ROLE_SET.has(value);
}

/**
 * PLUSIEURS RÔLES POUR UNE PERSONNE — la forme, et pourquoi c'est celle-là.
 *
 * Une personne peut être manager ET créatrice sur le même projet : c'est le
 * modèle de promotion interne, pas un cas limite. Deux formes étaient possibles.
 *
 * ── CE QU'ON N'A PAS FAIT : plusieurs LIGNES de membership ────────────────────
 * `memberships` se lit partout par `.first()` sur l'index `by_user_project` —
 * 22 sites dans le dépôt. Avec deux lignes, ce `.first()` rend une ligne
 * ARBITRAIRE : les droits d'une créatrice-manager marcheraient ou non selon
 * l'ordre d'insertion, et la même requête pourrait répondre différemment d'un
 * appel à l'autre. Un comportement indéterminé, jamais un refus.
 *
 * ── CE QU'ON A FAIT : une LISTE sur la ligne existante ───────────────────────
 * Chaque `membership.role === …` cesse alors de compiler, et `tsc` rend la liste
 * exhaustive des sites à traiter. On choisit la forme dont l'OUBLI FERME LA
 * PORTE plutôt que celle dont l'oubli produit du hasard — même raisonnement que
 * les littéraux distincts de talent/clipper (en-tête de ce fichier).
 *
 * ── LA COMPATIBILITÉ, SANS MIGRATION ─────────────────────────────────────────
 * `roles` est le champ neuf ; `role` (scalaire) devient un HÉRITAGE en LECTURE
 * SEULE. Un document d'avant porte `role` et pas `roles` : `rolesOf` le lit
 * comme un ensemble d'un élément. Toute écriture pose désormais `roles` ET
 * efface `role`, pour qu'un document ne porte jamais les deux — deux champs qui
 * se contredisent seraient exactement la seconde source de vérité que l'on
 * refuse ailleurs (cf D2 dans ARBITRAGES-ROLES.md).
 */
export type RoleBearer = {
  role?: string;
  roles?: readonly string[];
};

/**
 * Les rôles EFFECTIFS d'un membership : les valeurs stockées, filtrées par la
 * liste fermée.
 *
 * ⚠️ JUMEAU DE `grantedPermissions`, et pour la même raison. Une valeur écrite à
 * la main en base (« superadmin », « * », un rôle renommé) n'ouvre RIEN — elle
 * est écartée ici, avant toute comparaison. Un membership sans aucun rôle
 * valide rend un ensemble VIDE, donc aucun accès : c'est le défaut voulu.
 */
export function rolesOf(
  m: RoleBearer | null | undefined,
): ReadonlySet<MembershipRole> {
  const stored: readonly string[] =
    m?.roles ?? (typeof m?.role === "string" ? [m.role] : []);
  const out = new Set<MembershipRole>();
  for (const value of stored) {
    if (isMembershipRole(value)) out.add(value);
  }
  return out;
}

/** Ce membership porte-t-il ce rôle ? */
export function hasRole(
  m: RoleBearer | null | undefined,
  role: MembershipRole,
): boolean {
  return rolesOf(m).has(role);
}

/** Le rôle de PORTAIL d'un membership (au plus un), ou `null`. */
export function portalRoleOf(
  m: RoleBearer | null | undefined,
): PortalRole | null {
  const roles = rolesOf(m);
  return PORTAL_ROLES.find((r) => roles.has(r)) ?? null;
}

/**
 * Le rôle d'ÉQUIPE d'un membership, `admin` prioritaire, ou `null`.
 * L'ordre suit `TEAM_ROLES`, donc celui de la cascade de `requirePermission`.
 */
export function teamRoleOf(
  m: RoleBearer | null | undefined,
): TeamRole | null {
  const roles = rolesOf(m);
  return TEAM_ROLES.find((r) => roles.has(r)) ?? null;
}

/**
 * REMPLACE LE RÔLE DE PORTAIL SANS TOUCHER AUX AUTRES.
 *
 * ⚠️ C'EST LE HELPER QUI EMPÊCHE UNE PERTE SILENCIEUSE. Deux écritures posent un
 * rôle de portail hors de l'écran de gestion — le signup (`convex/auth.ts`) et
 * le changement de population (`updateCreator`). Écrites en `patch({ roles:
 * [nouveauPortail] })`, elles EFFACERAIENT le rôle manager d'une
 * créatrice-manager qui change de population : elle perdrait l'app interne sans
 * que personne n'ait demandé quoi que ce soit, et rien à l'écran ne le dirait.
 *
 * `portal = null` RETIRE le rôle de portail et ne garde que le reste (chemin de
 * la suppression d'une fiche). Le résultat suit l'ordre de `MEMBERSHIP_ROLES`,
 * pour que deux ensembles égaux s'écrivent pareil en base.
 */
export function withPortalRole(
  current: ReadonlySet<MembershipRole> | readonly string[],
  portal: PortalRole | null,
): MembershipRole[] {
  const effectifs =
    current instanceof Set
      ? (current as ReadonlySet<MembershipRole>)
      : rolesOf({ roles: current as readonly string[] });
  const gardes = new Set<MembershipRole>(
    [...effectifs].filter((r) => !isPortalRole(r)),
  );
  if (portal !== null) gardes.add(portal);
  return MEMBERSHIP_ROLES.filter((r) => gardes.has(r));
}

/**
 * REMPLACE LE RÔLE D'ÉQUIPE SANS TOUCHER AU PORTAIL — jumeau de
 * `withPortalRole`, et pour la même raison.
 *
 * ⚠️ C'EST CE HELPER QUI DÉBLOQUE LA RÉTROGRADATION. Composée des deux gestes
 * existants, elle était IMPOSSIBLE dans les deux ordres : `removeRole("admin")`
 * refuse (« c'est son dernier rôle »), et `addRole("manager")` refuse aussi
 * (admin + manager, ci-dessous). Chaque refus est juste pris isolément ; c'est
 * leur composition qui n'existait pas. L'échange doit donc être UNE écriture,
 * pas deux — et le passage par l'état intermédiaire interdit ne doit jamais
 * exister, même une milliseconde.
 *
 * Le rôle de portail est PRÉSERVÉ : rétrograder une créatrice-manager ne lui
 * retire pas son espace. `roleSetProblem` reste juge du résultat — c'est lui,
 * et non ce helper, qui refusera « admin + créatrice ».
 */
export function withTeamRole(
  current: ReadonlySet<MembershipRole> | readonly string[],
  team: TeamRole,
): MembershipRole[] {
  const effectifs =
    current instanceof Set
      ? (current as ReadonlySet<MembershipRole>)
      : rolesOf({ roles: current as readonly string[] });
  const gardes = new Set<MembershipRole>(
    [...effectifs].filter((r) => !isTeamRole(r)),
  );
  gardes.add(team);
  return MEMBERSHIP_ROLES.filter((r) => gardes.has(r));
}

/**
 * COMBINAISONS INTERDITES — la règle, en un seul endroit, côté serveur.
 *
 * Rend le motif de refus (phrase lisible par la personne qui clique), ou `null`
 * si l'ensemble est légal. Appelée par TOUTE écriture de rôles.
 *
 * ⚠️ Les trois interdits de portail ne sont pas une politique, ils sont
 * STRUCTURELS : le rôle de portail DÉRIVE de `creators.kind`, qui vaut une seule
 * valeur par fiche, et ce `kind` pilote le modèle de chauffe (D3) comme le
 * moteur de paie (Guard C / Guard D, mutuellement exclusifs). Deux populations
 * pour une personne, ce serait deux fiches, donc deux ancres de paie.
 */
export function roleSetProblem(roles: readonly string[]): string | null {
  const effectifs = rolesOf({ roles });
  if (effectifs.size === 0) {
    return "Un membre doit porter au moins un rôle connu."; // i18n-exempt: message de l'écran ADMIN « Rôles et droits » (superadmin), jamais rendu dans un portail créateur
  }
  const portails = PORTAL_ROLES.filter((r) => effectifs.has(r));
  if (portails.length > 1) {
    const noms = portails.map((r) => KIND_LABELS[kindForRole(r)!].singular);
    return (
      `Une personne ne peut pas être à la fois ${noms.join(" et ")} : sa population ` + // i18n-exempt: message de l'écran ADMIN « Rôles et droits » (superadmin), jamais rendu dans un portail créateur
      "décide de son modèle de chauffe et de sa rémunération, et une fiche n'en porte qu'une. " + // i18n-exempt: message de l'écran ADMIN « Rôles et droits » (superadmin), jamais rendu dans un portail créateur
      "Crée une seconde fiche si les deux activités doivent coexister." // i18n-exempt: message de l'écran ADMIN « Rôles et droits » (superadmin), jamais rendu dans un portail créateur
    );
  }
  if (effectifs.has("admin") && effectifs.has("manager")) {
    return (
      "Un administrateur peut déjà tout sur ce projet : lui ajouter le rôle manager " + // i18n-exempt: message de l'écran ADMIN « Rôles et droits » (superadmin), jamais rendu dans un portail créateur
      "afficherait des cases à cocher qui ne limitent rien. Retire-lui d'abord le rôle administrateur." // i18n-exempt: message de l'écran ADMIN « Rôles et droits » (superadmin), jamais rendu dans un portail créateur
    );
  }
  if (effectifs.has("admin") && portails.length > 0) {
    const espace = KIND_LABELS[kindForRole(portails[0])!].singular;
    return (
      `Le cumul administrateur + ${espace} n'est pas ouvert : un administrateur franchit ` + // i18n-exempt: message de l'écran ADMIN « Rôles et droits » (superadmin), jamais rendu dans un portail créateur
      "toutes les gardes sans exception, y compris celles qui décident de sa propre paie. " + // i18n-exempt: message de l'écran ADMIN « Rôles et droits » (superadmin), jamais rendu dans un portail créateur
      "Passe par le rôle manager, dont les droits se cochent un par un." // i18n-exempt: message de l'écran ADMIN « Rôles et droits » (superadmin), jamais rendu dans un portail créateur
    );
  }
  return null;
}

/**
 * `creators.kind` → population. ABSENT = "partner" : toutes les fiches
 * existantes sont des partenaires, d'où 0 migration (champ `v.optional`). Une
 * valeur inconnue (schéma resserré plus tard, doc écrit à la main) retombe aussi
 * sur "partner" — le comportement le plus restreint côté nouveaux flux, et le
 * seul qui ne change rien à l'existant.
 */
export function resolveCreatorKind(
  kind: string | null | undefined,
): CreatorKind {
  return kind === "talent" || kind === "clipper" ? kind : "partner";
}

/** Population → littéral de membership à poser au signup. */
export function roleForKind(kind: string | null | undefined): PortalRole {
  switch (resolveCreatorKind(kind)) {
    case "talent":
      return "talent";
    case "clipper":
      return "clipper";
    case "partner":
      return "creator";
  }
}

/**
 * Littéral de membership → population, ou `null` si le rôle n'ouvre aucun
 * portail (admin/superadmin, ou valeur inconnue). Réciproque exacte de
 * `roleForKind` (vérifié par lib/roles.test.ts).
 */
export function kindForRole(role: string | null | undefined): CreatorKind | null {
  switch (role) {
    case "creator":
      return "partner";
    case "talent":
      return "talent";
    case "clipper":
      return "clipper";
    default:
      return null;
  }
}

/** Le rôle donne-t-il accès à un portail (≠ admin) ? */
export function isPortalRole(role: string | null | undefined): role is PortalRole {
  return kindForRole(role) !== null;
}

/**
 * Le rôle donne-t-il accès à L'APP INTERNE ?
 *
 * ⚠️ APPARTENANCE, PAS NÉGATION. On répond oui parce que la valeur est DANS
 * `TEAM_ROLES`, jamais parce qu'elle n'est pas un rôle de portail. Écrit
 * `!isPortalRole(role)`, un littéral inconnu — un rôle renommé, une valeur
 * écrite à la main en base — ouvrirait l'app interne. Ici il n'ouvre rien : même
 * discipline que `isPermissionId` face au catalogue de droits.
 *
 * ⚠️ ET CE N'EST PAS UNE BARRIÈRE. Cette fonction sert au ROUTAGE (où atterrit
 * la personne). Ce qu'elle a le droit d'y faire reste décidé serveur, requête
 * par requête, par `requirePermission`.
 */
export function isTeamRole(role: string | null | undefined): role is TeamRole {
  return typeof role === "string" && TEAM_ROLE_SET.has(role);
}

const TEAM_ROLE_SET: ReadonlySet<string> = new Set(TEAM_ROLES);

/** Libellés FR pour l'admin (aucun terme technique exposé à l'écran). */
export const KIND_LABELS: Record<CreatorKind, { singular: string; plural: string }> =
  {
    // i18n-exempt: libellés ADMIN (KIND_LABELS), jamais rendus dans un portail créateur
    partner: { singular: "Créateur partenaire", plural: "Créateurs partenaires" },
    talent: { singular: "Talent", plural: "Talents" },
    clipper: { singular: "Clippeur", plural: "Clippeurs" },
  };

/**
 * PROMOTION EN ADMINISTRATEUR D'UN PROJET — décision pure, tirée du seul rôle
 * courant. Trois issues, et pas une de plus :
 *
 *   - "promote" : un `manager` monte en `admin`. C'est le seul chemin voulu, et
 *     il n'existe qu'en ligne de commande (cf convex/memberPermissions.ts).
 *   - "noop"    : déjà `admin` — la commande est rejouable sans rien réécrire.
 *   - "refuse"  : TOUT rôle de portail (creator/talent/clipper), et toute valeur
 *     inconnue ou absente. Promouvoir le membership d'une créatrice ne lui
 *     AJOUTERAIT pas l'admin : ça lui RETIRERAIT son portail, puisque
 *     `requireCreator` exige le littéral "creator" — elle perdrait son espace en
 *     échange d'un accès qu'elle n'a pas demandé. Quelqu'un qui doit avoir les
 *     deux a besoin de deux comptes, pas d'un rôle qui en écrase un autre.
 *
 * Le défaut est donc le REFUS : un littéral ajouté demain à `memberships.role`
 * n'est pas promouvable tant que personne ne l'a décidé ici.
 */
export function promotionToAdminDecision(
  // Même tolérance que `rolesOf` : un membership absent doit REFUSER, pas
  // casser à la compilation du seul appelant qui pourrait ne pas en avoir.
  bearer: RoleBearer | null | undefined,
): "promote" | "noop" | "refuse" {
  // LIT L'ENSEMBLE, PAS LE SCALAIRE. Cette fonction est arrivee (#182) quand
  // `memberships.role` etait encore une valeur unique. Depuis que le role est un
  // ENSEMBLE, toute ecriture pose `roles` et efface le scalaire : lire
  // `membership.role` aurait rendu `undefined`, donc « refuse », sur tout
  // manager cree apres la bascule — la promotion aurait cesse de marcher sans
  // que rien ne le dise.
  const roles = rolesOf(bearer);
  if (roles.has("admin")) return "noop";
  // Un portail EXCLUT la promotion, et c'est la meme doctrine qu'avant :
  // promouvoir une creatrice-manager lui RETIRERAIT son espace au lieu de lui
  // ajouter quoi que ce soit (`roleSetProblem` refuse « admin + portail »).
  if (portalRoleOf(bearer) !== null) return "refuse";
  if (roles.has("manager")) return "promote";
  return "refuse";
}
