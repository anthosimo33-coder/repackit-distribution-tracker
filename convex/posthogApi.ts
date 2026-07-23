/**
 * Couche API PostHog — appel réseau externe (query API HogQL), DESTINÉ à être
 * appelé depuis une action Convex (convex/posthogSync.ts) : `fetch` n'est dispo
 * que dans le runtime action. Transport GÉNÉRIQUE : ce module ne connaît aucune
 * métrique du hub — il exécute une requête HogQL et rend des lignes brutes. Les
 * requêtes elles-mêmes vivent dans posthogSync.ts (au plus près du cache).
 *
 * 🔐 La clé API personnelle PostHog est passée en argument (lue depuis l'env par
 * l'appelant) et transmise UNIQUEMENT dans l'en-tête `Authorization` — jamais
 * dans l'URL, jamais loguée (les erreurs ne reprennent que statut/message API).
 *
 * ⚠️ On n'exfiltre JAMAIS d'events bruts : toutes les requêtes du hub sont des
 * AGRÉGATS (count/quantile/group by). Aucun identifiant de cible tierce ne
 * transite (cf contrainte « aucun handle Instagram de cible »).
 *
 * Réf. API : POST https://{eu|us}.posthog.com/api/projects/{id}/query/
 *   body { query: { kind: "HogQLQuery", query: "SELECT …" } }
 *   auth `Bearer <personal API key>` — réponse { results: [][], columns: [] }.
 */

/** Région d'hébergement du projet PostHog (→ base d'URL de l'API). */
export type PosthogHost = "eu" | "us";

/** Partie NON secrète de la config projet (cf projects.posthog). */
export interface PosthogTarget {
  posthogProjectId: string;
  host: PosthogHost;
}

export interface HogQLResult {
  /** Lignes de résultat (tableau de colonnes, ordre de la requête). */
  rows: unknown[][];
  columns: string[];
  /** Message d'erreur (réseau / HTTP / 429) — non null = résultat inexploitable. */
  error: string | null;
}

function baseUrl(host: PosthogHost): string {
  return host === "us" ? "https://us.posthog.com" : "https://eu.posthog.com";
}

function asRecord(x: unknown): Record<string, unknown> | undefined {
  return typeof x === "object" && x !== null
    ? (x as Record<string, unknown>)
    : undefined;
}

async function readPosthogError(res: Response): Promise<string> {
  try {
    const body = asRecord(await res.json());
    const msg = body?.detail ?? body?.message ?? body?.error;
    if (typeof msg === "string") return `HTTP ${res.status}: ${msg}`;
  } catch {
    // corps non-JSON
  }
  return `HTTP ${res.status} ${res.statusText}`.trim();
}

/**
 * Exécute UNE requête HogQL et retourne ses lignes. Ne throw JAMAIS : toute
 * erreur (réseau, 401 clé invalide, 429 rate limit, JSON illisible) revient dans
 * `error` avec `rows: []` — l'appelant décide de garder la valeur cachée
 * précédente. `fetchImpl` est injectable pour les tests.
 */
export async function runHogQL(
  apiKey: string,
  target: PosthogTarget,
  query: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<HogQLResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${baseUrl(target.host)}/api/projects/${encodeURIComponent(
    target.posthogProjectId,
  )}/query/`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    });
  } catch (e) {
    return {
      rows: [],
      columns: [],
      error: `network: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (res.status === 429) {
    return { rows: [], columns: [], error: "rate_limited (429)" };
  }
  if (!res.ok) {
    return { rows: [], columns: [], error: await readPosthogError(res) };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return {
      rows: [],
      columns: [],
      error: "réponse PostHog illisible (JSON invalide)",
    };
  }
  const body = asRecord(json);
  const results = body?.results;
  const columns = body?.columns;
  return {
    rows: Array.isArray(results)
      ? results.filter((r): r is unknown[] => Array.isArray(r))
      : [],
    columns: Array.isArray(columns)
      ? columns.filter((c): c is string => typeof c === "string")
      : [],
    error: null,
  };
}

// ─── Coerceurs de cellules ───────────────────────────────────────────────────
// HogQL rend des cellules non typées : un event absent du projet donne 0 ligne,
// un champ manquant une cellule null. Ces helpers rendent TOUJOURS une valeur
// exploitable → une carte ne casse jamais sur un event pas encore émis.

/** Nombre d'une cellule (null/undefined/NaN/chaîne non numérique → 0). */
export function cellNum(row: unknown[], i: number): number {
  const v = row[i];
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Chaîne d'une cellule (null/undefined → ""). */
export function cellStr(row: unknown[], i: number): string {
  const v = row[i];
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/**
 * Horodatage (ms epoch) d'une cellule DateTime HogQL. PostHog rend un ISO sans
 * fuseau explicite pour les `toStartOf*` (ex. "2026-07-23 10:00:00") : on force
 * l'interprétation UTC (le reste de l'app bucketise en UTC, cf periodOf).
 * Cellule illisible → null (la ligne est ignorée par l'appelant).
 */
export function cellTimeMs(row: unknown[], i: number): number | null {
  const v = row[i];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string" || v === "") return null;
  const iso = v.includes("T") ? v : v.replace(" ", "T");
  const withZone = /[Z+]|-\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(withZone);
  return Number.isFinite(ms) ? ms : null;
}
