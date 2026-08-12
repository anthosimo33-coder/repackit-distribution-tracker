/**
 * ALLOWLIST des champs d'un `formats` servis au TALENT comme brief permanent —
 * même mécanique que `convex/talentRushFields.ts` (on part de RIEN, on ajoute
 * explicitement ce qui sort).
 *
 * Un format est un objet RICHE, conçu pour le créateur partenaire : il porte le
 * brief, mais aussi des textes de script et une grille de rémunération. Le
 * réutiliser pour le talent est le bon choix (l'admin édite avec l'outil qu'il
 * connaît), à condition que l'exposition soit une liste et pas un `...format`.
 *
 * Ce qui reste dehors, et pourquoi :
 *   - `hooks` — ce sont des TEXTES DE SCRIPT embarqués. Le talent ne voit jamais
 *     de script : c'est l'invariant central de sa population. Un brief qui les
 *     laisserait passer viderait la séparation de son sens.
 *   - `rateModel` — la rémunération du PARTENAIRE (fixe/CPM/primes). Le talent est
 *     au forfait mensuel ; lui montrer cette grille afficherait un montant qui
 *     n'est pas le sien.
 *   - `guidelines` (do/don't) — écrites pour le flux partenaire, elles parlent de
 *     publication et de comptes. Le brief permanent du talent est rédigé POUR lui
 *     dans `brief` ; ouvrir les guidelines demanderait de les réécrire d'abord.
 *   - `name` / `type` / `status` — vocabulaire d'outil interne (« Short »,
 *     « archived »), aucun sens côté talent, et `type` trahit la mécanique de
 *     publication.
 *   - `projectId`, `createdAt`, `updatedAt` — bookkeeping.
 *   - `_id` — le talent n'a aucune fonction qui prenne un formatId : le lui
 *     donner n'ouvrirait rien mais désignerait une porte.
 *
 * Invariant (vérifié par lib/talent-brief-fields.test.ts) : CHAQUE champ
 * top-level du schéma `formats` figure dans TALENT ou NON_TALENT — sinon le test
 * casse. Un champ ajouté demain au format (un lien de dossier partagé, une note
 * interne) n'atteint pas l'écran du talent tant que personne ne l'a inscrit ici.
 *
 * Module PUR (pas d'import runtime `_generated`) → importable côté client/tests.
 */

/** Les SEULS champs d'un format servis au talent. */
export const TALENT_BRIEF_FIELDS = ["brief", "exampleVideos"] as const;

/** Champs DÉLIBÉRÉMENT retirés du brief talent (script / paie / interne). */
export const NON_TALENT_BRIEF_FIELDS = [
  // Textes de script — l'invariant central de la population talent.
  "hooks",
  // Paie du partenaire, pas la sienne.
  "rateModel",
  // Écrites pour le flux partenaire (publication, comptes).
  "guidelines",
  // Vocabulaire d'outil interne.
  "name",
  "type",
  "status",
  // Bookkeeping.
  "projectId",
  "createdAt",
  "updatedAt",
] as const;

/**
 * ALLOWLIST (pas denylist) : ne garde QUE les champs de TALENT_BRIEF_FIELDS.
 * S'applique au format DÉJÀ ENRICHI par `withResolvedExamples` — les URLs signées
 * des exemples « fichier » sont donc conservées, la décomposition du format non.
 */
export function pickTalentBrief<T extends object>(format: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of TALENT_BRIEF_FIELDS) {
    const key = k as unknown as keyof T;
    if (format[key] !== undefined) out[key] = format[key];
  }
  return out;
}
