/**
 * Formatage de DATE pour les messages destinés à un humain, côté serveur.
 *
 * Module PUR (aucun import Convex) : testable depuis `lib/*.test.ts` comme
 * `convex/postUrlDate.ts`, et importable depuis `convex/` qui n'importe jamais
 * `lib/` (contrainte cross-tsconfig du repo).
 */

/**
 * Date FR "JJ/MM/AA" telle que l'admin la lit.
 *
 * ⚠️ Fuseau ÉPINGLÉ sur Europe/Paris. Le runtime Convex tourne en UTC, et les
 * dates de publication sont posées à MINUIT PARIS — soit 22:00 UTC la veille en
 * été, 23:00 la veille en hiver. Sans l'épingle, 28 % des publications de prod
 * (61 sur 219, relevé le 2026-08-14) s'affichent LA VEILLE dans les messages de
 * doublon : « déjà posté le 10/05 » pour un post du 11/05.
 *
 * Même convention que convex/analyticsHub.ts et convex/assignments.ts. À NE PAS
 * confondre avec convex/emails.ts:formatDateFr, dont l'UTC est délibéré (rendu
 * déterministe sans Intl) et correct pour `dueDate`, stocké à 21:59 UTC = 23:59
 * Paris le MÊME jour. Le bon fuseau dépend du champ, pas d'une règle unique.
 */
export function formatDateFr(ts: number): string {
  return new Date(ts).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "Europe/Paris",
  });
}
