/**
 * QUEL COMPTE DONNE SON VISAGE À UNE CRÉATRICE — choix PUR, testé Vitest
 * (lib/creator-avatar.test.ts).
 *
 * Module sans aucun import Convex, comme `convex/dateFr.ts` et
 * `convex/apifyItem.ts` : il vit dans convex/ pour que le serveur l'utilise
 * sans réplique (règle A6), et les tests l'importent depuis lib/.
 *
 * ── Le problème ─────────────────────────────────────────────────────────────
 * Une créatrice a plusieurs comptes ; la photo, elle, est UNE. Il faut donc
 * trancher, et surtout trancher TOUJOURS PAREIL : un visage qui change d'un
 * rafraîchissement à l'autre parce que deux comptes se disputent la place est
 * pire qu'une initiale.
 *
 * ── L'ordre, du plus fort au plus faible ────────────────────────────────────
 *  1. un compte ARCHIVÉ passe après les autres — c'est un compte qu'on a rangé,
 *     pas celui sur lequel elle travaille ;
 *  2. un compte GÉRÉ PAR L'ÉQUIPE passe après les siens : la photo d'un compte
 *     que l'équipe tient n'est pas forcément son visage à elle ;
 *  3. à égalité, le PLUS ANCIEN gagne. Pas le plus récent, pas la photo la plus
 *     fraîchement téléchargée : le premier compte déclaré est celui qui bouge
 *     le moins, et c'est tout ce qu'on demande à un départage.
 *
 * Aucun de ces critères n'ÉLIMINE : un compte archivé et géré reste choisi s'il
 * est le seul à porter une photo. Mieux vaut le bon visage rangé au mauvais
 * endroit que pas de visage du tout.
 */

/** Ce que le choix a besoin de savoir d'un compte — rien de plus. */
export interface CompteFace {
  plateforme: string;
  /** A-t-il une photo recopiée dans le storage ? */
  hasAvatar: boolean;
  /** Statut du compte ; "archived" recule dans l'ordre. */
  status?: string;
  managedByAdmin?: boolean;
  /** Ancienneté (`_creationTime`) — départage final, stable. */
  createdAt: number;
}

/**
 * Le compte dont la photo représente la créatrice, ou `null` si aucun n'en a.
 *
 * TIKTOK SEULEMENT, et ce n'est pas un oubli : c'est la seule plateforme dont
 * l'item de post porte l'avatar sans run supplémentaire (cf.
 * convex/apifyItem.ts). Rien n'empêchera d'en ajouter le jour où une autre
 * source alimentera `comptes.avatar`.
 */
export function pickFaceCompte<T extends CompteFace>(comptes: readonly T[]): T | null {
  const candidats = comptes.filter(
    (c) => c.plateforme === "TikTok" && c.hasAvatar,
  );
  if (candidats.length === 0) return null;
  const rang = (c: T): [number, number, number] => [
    c.status === "archived" ? 1 : 0,
    c.managedByAdmin === true ? 1 : 0,
    c.createdAt,
  ];
  return candidats.reduce((meilleur, c) => {
    const [a1, a2, a3] = rang(c);
    const [b1, b2, b3] = rang(meilleur);
    if (a1 !== b1) return a1 < b1 ? c : meilleur;
    if (a2 !== b2) return a2 < b2 ? c : meilleur;
    return a3 < b3 ? c : meilleur;
  });
}
