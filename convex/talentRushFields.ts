/**
 * ALLOWLIST des champs d'un rush renvoyés AU TALENT — même mécanique que
 * `convex/creatorAssignmentFields.ts` et `convex/clipperAssignmentFields.ts`
 * (logique INVERSÉE : on part de RIEN et on ajoute explicitement ce qui sort).
 *
 * Le talent voit SES dépôts et rien d'autre : un fichier, sa taille, sa date, où
 * il en est. Il ne voit ni script, ni compte, ni statistique, ni le rush d'un
 * autre talent — et surtout AUCUN chemin vers ces objets.
 *
 * Ce qui reste dehors, et pourquoi :
 *   - `assignmentId` / `assignedAt` — le lien vers l'assignation est le chemin
 *     vers le SCRIPT monté sur ce rush. Un id suffit à trahir l'existence du
 *     flux clip ; le talent lit un statut (« Validé »), pas une jointure.
 *   - `talentId` / `projectId` — scoping SERVEUR, jamais une donnée d'écran.
 *   - `driveFileId` / `webViewLink` / `thumbnailLink` — le talent ne voit jamais
 *     Google Drive (même règle que le dépôt partenaire, cf FichiersScreen) : le
 *     stockage est un détail d'infrastructure, pas un lien à cliquer.
 *   - `binaryPurgedAt` — mécanique interne de nettoyage. « Refusé » se suffit ;
 *     « Refusé, fichier supprimé le … » n'apporte rien et inquiète.
 *
 * Ce qui SORT et mérite d'être justifié :
 *   - `rejectionReason` — DÉCISION PRODUIT EXPLICITE : la personne qui a filmé
 *     doit savoir pourquoi sa prise est écartée. Conséquence en cascade, à ne
 *     pas perdre : ce champ est écrit par un ADMIN et lu par un TALENT, donc
 *     (1) il est borné serveur (cf rushes.rejectRush), (2) il est rendu en TEXTE
 *     BRUT, jamais en markdown, (3) l'écran admin qui le saisira (PR 4) doit
 *     dire « visible par le talent » — ce n'est pas un champ de note interne.
 *
 * Invariant (vérifié par lib/talent-rush-fields.test.ts) : CHAQUE champ
 * top-level du schéma `rushes` figure dans TALENT ou NON_TALENT — sinon le test
 * casse, forçant une décision consciente à chaque nouveau champ. C'est la
 * mécanique qui a rattrapé deux fuites réelles côté assignments (`replayVerbatim`
 * #167, `publishedBy` #169).
 *
 * Module PUR (pas d'import runtime `_generated`) → importable côté client/tests.
 */

/** Les SEULS champs d'un rush envoyés au talent (+ `_id`/`_creationTime`). */
export const TALENT_RUSH_FIELDS = [
  "_id",
  "_creationTime",
  "fileName",
  "mimeType",
  "sizeBytes",
  "status",
  "depositedAt",
  "publishedAt",
  "rejectedAt",
  // Lu par le talent — cf en-tête (texte brut, borné serveur).
  "rejectionReason",
  "expiredAt",
] as const;

/** Champs DÉLIBÉRÉMENT retirés de la sortie talent (scoping serveur / chemin
 *  vers le flux clip / infrastructure de stockage / mécanique interne). */
export const NON_TALENT_RUSH_FIELDS = [
  "projectId",
  "talentId",
  "driveFileId",
  "webViewLink",
  "thumbnailLink",
  "assignmentId",
  "assignedAt",
  "binaryPurgedAt",
] as const;

/**
 * ALLOWLIST (pas denylist) : ne garde QUE les champs de TALENT_RUSH_FIELDS.
 * Générique + pur (testable). Un champ ajouté au schéma demain n'atteint pas
 * l'écran du talent tant que personne ne l'a inscrit ici.
 */
export function pickTalentRush<T extends object>(rush: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of TALENT_RUSH_FIELDS) {
    const key = k as unknown as keyof T;
    if (rush[key] !== undefined) out[key] = rush[key];
  }
  return out;
}
