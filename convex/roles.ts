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

/** Tous les littéraux `memberships.role`. */
export type MembershipRole = "admin" | PortalRole;

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

/** Libellés FR pour l'admin (aucun terme technique exposé à l'écran). */
export const KIND_LABELS: Record<CreatorKind, { singular: string; plural: string }> =
  {
    partner: { singular: "Créateur partenaire", plural: "Créateurs partenaires" },
    talent: { singular: "Talent", plural: "Talents" },
    clipper: { singular: "Clippeur", plural: "Clippeurs" },
  };
