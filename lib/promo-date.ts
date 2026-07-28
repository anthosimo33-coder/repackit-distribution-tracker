/**
 * Conversions date ↔ ms pour `creators.datePromoStart` (LOT 3) — PURES, testées.
 *
 * TZ-SAFE : la valeur stockée est TOUJOURS **minuit UTC du jour saisi**, quel que
 * soit le fuseau du navigateur. On construit le ms avec `Date.UTC` (jamais
 * `new Date("YYYY-MM-DD")` qui parse en LOCAL) et on relit avec les getters UTC.
 * `datePromoStart` est ainsi dans le MÊME référentiel que `publications.datePubli`
 * (ms epoch), et `isPromo` compare deux ms epoch directement.
 *
 * Piège évité : si le champ envoyait « minuit heure de Paris », un post publié le
 * 25/07 00h30 Paris (= 24/07 22h30 UTC) tomberait du mauvais côté d'un
 * datePromoStart au 25/07. Ici `dateInputToMs("2026-07-25")` rend toujours le
 * 25/07 00:00 UTC (1784937600000), indépendamment du fuseau.
 */

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" (valeur d'un <input type="date">) → ms minuit UTC ; null si vide. */
export function dateInputToMs(s: string): number | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

/** ms → "YYYY-MM-DD" (UTC) pour un <input type="date"> ; "" si absent. */
export function msToDateInput(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Normalisation SERVEUR (défense) : ramène un ms à minuit UTC de SON jour UTC. No-op
 * pour une valeur déjà à minuit UTC (le client envoie exactement ça). Répliquée à
 * l'identique dans `convex/promoDate.ts` (règle A6).
 */
export function floorToUtcMidnight(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}
