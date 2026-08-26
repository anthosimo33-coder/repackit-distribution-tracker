/**
 * CODES DE REJET MÉTIER — identifiants STABLES, jamais affichés tels quels.
 *
 * Un code existe pour qu'un appelant puisse BRANCHER sur une erreur sans lire
 * son texte. `components/admin/AdminPublishForm` branchait le flux de
 * régularisation de date sur `/précède la\s+création/i` : traduire ce message,
 * ou seulement le reformuler, cassait la régularisation en silence — pas
 * d'erreur de compilation, pas de test rouge, juste un mur là où il devait y
 * avoir une question.
 *
 * ⚠️ Un code ne se renomme pas. Il vit dans le protocole entre le serveur et le
 * client, comme un nom de champ de schéma.
 *
 * Le module vit dans `convex/` : le runtime Convex n'importe rien hors de
 * `convex/` (règle A6), et `lib/` peut l'importer dans ce sens-là.
 */
export const ERR = {
  /**
   * Date de publication antérieure à la création de l'assignation. Ce n'est PAS
   * une saisie fautive : c'est une régularisation (post publié hors de l'app).
   * Le client propose de confirmer, il ne bloque pas.
   */
  PUBLISHED_AT_BEFORE_CREATION: "ERR_PUBLISHED_AT_BEFORE_CREATION",
} as const;

export type ErrCode = (typeof ERR)[keyof typeof ERR];
