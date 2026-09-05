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

/** Littéraux `memberships.role` qui donnent accès à UN portail (pas l'admin). */
export type PortalRole = "creator" | "talent" | "clipper";

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

/** Tous les littéraux `memberships.role`. */
export type MembershipRole = TeamRole | PortalRole;

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
  role: string | null | undefined,
): "promote" | "noop" | "refuse" {
  if (role === "admin") return "noop";
  if (role === "manager") return "promote";
  return "refuse";
}
