/**
 * FAMILLES D'ANGLE des hooks — taxonomie éditoriale VIVANTE.
 *
 * Module PUR (aucun import Convex) : importable depuis `convex/` et depuis le
 * client, testable en vitest via `lib/angle-family.test.ts`. Même arrangement
 * que `convex/viewsDaily.ts` / `convex/dateFr.ts`.
 *
 * ⚠️ CHAÎNE LIBRE, pas un enum. Les familles se découvrent à l'usage : figer
 * l'union obligerait à un déploiement pour nommer un angle qui marche, et la
 * migration de tous les hooks existants à chaque renommage. `ANGLE_FAMILY_SUGGESTIONS`
 * n'est donc qu'une liste de départ proposée à la saisie — jamais une contrainte.
 *
 * Le prix de la liberté, c'est le quasi-doublon (« Nostalgie » vs « nostalgie »
 * vs « nostalgie  »). D'où deux fonctions distinctes :
 *  - `normalizeAngleFamily` nettoie ce qui est STOCKÉ (espaces, longueur) sans
 *    toucher à la casse — l'admin écrit ce qu'il veut lire ;
 *  - `angleFamilyKey` produit la clé de REGROUPEMENT (casse et accents pliés),
 *    pour que les agrégats ne se scindent pas sur une majuscule.
 */

/**
 * Familles proposées à la saisie (état au lancement du chantier). Ce sont des
 * SUGGESTIONS : une famille absente d'ici reste parfaitement valide, et cette
 * liste peut être complétée sans migration.
 */
export const ANGLE_FAMILY_SUGGESTIONS: readonly string[] = [
  "vérification",
  "trahison",
  "colère/accusation",
  "renoncement/fierté",
  "rechute",
  "effacement",
  "nostalgie",
];

/**
 * Longueur maximale STOCKÉE. Une famille est une étiquette de rangement, pas une
 * description : borner évite qu'un copier-coller malheureux devienne un libellé
 * d'axe de graphe illisible.
 */
export const ANGLE_FAMILY_MAX_LENGTH = 40;

/** Libellé du bucket des hooks sans famille renseignée (graphe + filtres). */
export const ANGLE_FAMILY_NONE_LABEL = "Sans famille";

/**
 * Valeur à STOCKER pour une saisie quelconque : espaces de bord retirés,
 * espaces internes compressés, longueur bornée. Rend `null` pour une saisie
 * vide ou blanche — « pas de famille » est une absence, jamais la chaîne vide
 * (qui créerait un bucket fantôme dans les agrégats).
 *
 * La CASSE est laissée telle quelle : c'est ce que l'admin verra réaffiché.
 */
export function normalizeAngleFamily(
  input: string | null | undefined,
): string | null {
  if (input === null || input === undefined) return null;
  const collapsed = input.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, ANGLE_FAMILY_MAX_LENGTH);
}

/**
 * Clé de REGROUPEMENT d'une famille : minuscules et accents pliés.
 *
 * « Vérification », « vérification » et « Verification » sont la MÊME famille —
 * les compter séparément scinderait un angle qui marche en trois barres
 * anémiques et ferait rater la lecture qu'on cherche (« quelle famille monte
 * cette semaine ? »). Le libellé AFFICHÉ reste l'orthographe rencontrée en
 * premier, pas cette clé.
 */
export function angleFamilyKey(family: string): string {
  return family
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
