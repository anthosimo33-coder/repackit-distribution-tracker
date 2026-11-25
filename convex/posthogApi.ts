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
 *   body { query: { kind: "HogQLQuery", query: "SELECT …" }, refresh: "async" }
 *   auth `Bearer <personal API key>`. Réponse : 200 { results: [][], columns: [] }
 *   si PostHog a un résultat frais en cache, sinon 202 { query_status } à
 *   interroger par GET …/query/{query_status.id}/ (cf runHogQLOnce).
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
 * Attentes avant chaque NOUVEL essai après un 429. PostHog limite un projet à
 * TROIS requêtes simultanées ; au-delà elles attendent 30 s en file, puis sont
 * refusées. Un refus est donc presque toujours transitoire : il suffit qu'une
 * requête voisine se termine. Le 2026-09-16 à 08:43 UTC, le cron et deux volées
 * du hub se sont chevauchés et TOUS les agrégats sont sortis en 429 — sans un
 * seul nouvel essai. Borné (≈ 8 s au pire par requête) : le cron enchaîne une
 * trentaine de requêtes et ne doit pas franchir la limite d'une action.
 */
export const RETRY_429_DELAYS_MS = [2_000, 6_000] as const;

/**
 * ⚠️ MODE ASYNCHRONE — pourquoi on n'utilise plus le mode bloquant par défaut.
 *
 * En mode bloquant, PostHog coupe toute requête après 10 s d'EXÉCUTION
 * (`max_execution_time=10` dans le SQL ClickHouse qu'il rend) et répond 504
 * « Query has hit the max execution time ». En mode async, la même requête a
 * droit à 600 s. Mesuré sur la prod le 25/11/2026 : `abArms` sortait en 504 à
 * 10,7 s en bloquant et passait en 12,1 s en async, `abPurchases` en 13,8 s ;
 * sur les requêtes qui passent dans les deux modes, les résultats sont
 * identiques. Les requêtes A/B parcourent les 90 jours d'events (3,8 M) : elles
 * avaient franchi la limite une à une, et la volée par période de l'onglet
 * Parcours échouait en entier.
 *
 * `refresh: "async"` (et non `force_async`) garde le cache de PostHog, comme le
 * faisait le mode bloquant par défaut : un résultat encore frais revient
 * directement (200), sans interrogation.
 */
const REFRESH = "async";

/**
 * Attentes entre deux interrogations de l'état d'une requête async (la
 * dernière se répète). Courtes au début : la plupart des requêtes du hub
 * finissent en 3 à 8 s. Pas plus serrées : PostHog plafonne le projet à 240
 * appels par minute, et une volée lance 23 requêtes.
 */
export const POLL_DELAYS_MS = [500, 1_000, 1_500, 2_000] as const;

/**
 * Budget d'attente d'UNE requête async. Le cron horaire enchaîne ses requêtes
 * une à une dans une seule action (76 à 190 s mesurées le 25/11), plafonnée à
 * 10 min par Convex : sans budget, une requête emballée — qui a droit à 600 s
 * chez PostHog — emporterait tout le cron. Au-delà, la requête est ANNULÉE chez
 * PostHog, pour libérer l'une des trois places simultanées du projet.
 */
export const ASYNC_BUDGET_MS = 60_000;

/**
 * Exécute UNE requête HogQL et retourne ses lignes. Ne throw JAMAIS : toute
 * erreur (réseau, 401 clé invalide, 429 rate limit, JSON illisible, échec de la
 * requête, budget dépassé) revient dans `error` avec `rows: []` — l'appelant
 * décide de garder la valeur cachée précédente. Un 429 à la SOUMISSION est
 * retenté (cf RETRY_429_DELAYS_MS) avant d'être rendu. `fetchImpl` et `sleep`
 * sont injectables pour les tests.
 */
export async function runHogQL(
  apiKey: string,
  target: PosthogTarget,
  query: string,
  opts: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<HogQLResult> {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    const res = await runHogQLOnce(
      apiKey,
      target,
      query,
      opts.fetchImpl ?? fetch,
      sleep,
    );
    const delay = RETRY_429_DELAYS_MS[attempt];
    if (res.error !== RATE_LIMITED || delay === undefined) return res;
    await sleep(delay);
  }
}

const RATE_LIMITED = "rate_limited (429)";

const echec = (error: string): HogQLResult => ({ rows: [], columns: [], error });

const networkError = (e: unknown): HogQLResult =>
  echec(`network: ${e instanceof Error ? e.message : String(e)}`);

const ILLISIBLE = "réponse PostHog illisible (JSON invalide)";

/** Lignes et colonnes d'un corps de résultat HogQL (`{ results, columns }`). */
function rowsOf(body: Record<string, unknown> | undefined): HogQLResult {
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

async function runHogQLOnce(
  apiKey: string,
  target: PosthogTarget,
  query: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<HogQLResult> {
  const url = `${baseUrl(target.host)}/api/projects/${encodeURIComponent(
    target.posthogProjectId,
  )}/query/`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: { kind: "HogQLQuery", query }, refresh: REFRESH }),
    });
  } catch (e) {
    return networkError(e);
  }
  if (res.status === 429) return echec(RATE_LIMITED);
  if (!res.ok) return echec(await readPosthogError(res));
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return echec(ILLISIBLE);
  }
  const body = asRecord(json);
  const status = asRecord(body?.query_status);
  // Pas de `query_status` : PostHog a servi un résultat frais de son cache.
  if (!status) return rowsOf(body);
  if (status.complete === true || status.error === true) {
    return fromStatus(status, res.status);
  }
  if (typeof status.id !== "string" || status.id === "") {
    return echec("réponse PostHog sans identifiant de requête async");
  }
  return pollUntilDone(`${url}${encodeURIComponent(status.id)}/`, headers, fetchImpl, sleep);
}

/** Résultat d'un `query_status` terminé : ses lignes, ou le message de PostHog. */
function fromStatus(status: Record<string, unknown>, httpStatus: number): HogQLResult {
  if (status.error === true) {
    const msg = status.error_message ?? status.error_code;
    return echec(
      `HTTP ${httpStatus}: ${typeof msg === "string" && msg !== "" ? msg : "échec de la requête"}`,
    );
  }
  return rowsOf(asRecord(status.results));
}

/**
 * Interroge l'état d'une requête async jusqu'à son résultat, son échec ou la fin
 * du budget. Un 429 ici ne RESOUMET pas la requête (elle tourne déjà) : on
 * attend, et on réinterroge.
 */
async function pollUntilDone(
  statusUrl: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<HogQLResult> {
  let waited = 0;
  for (let i = 0; ; i++) {
    const delay = POLL_DELAYS_MS[Math.min(i, POLL_DELAYS_MS.length - 1)];
    if (waited + delay > ASYNC_BUDGET_MS) {
      try {
        await fetchImpl(statusUrl, { method: "DELETE", headers });
      } catch {
        // Annulation au mieux : PostHog l'arrêtera de toute façon à 600 s.
      }
      return echec(
        `délai dépassé : la requête tournait encore chez PostHog après ${
          ASYNC_BUDGET_MS / 1000
        } s (annulée)`,
      );
    }
    await sleep(delay);
    waited += delay;

    let res: Response;
    try {
      res = await fetchImpl(statusUrl, { method: "GET", headers });
    } catch (e) {
      return networkError(e);
    }
    if (res.status === 429) continue;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return echec(res.ok ? ILLISIBLE : `HTTP ${res.status} ${res.statusText}`.trim());
    }
    const status = asRecord(asRecord(json)?.query_status);
    if (!status) {
      return echec(res.ok ? ILLISIBLE : `HTTP ${res.status} ${res.statusText}`.trim());
    }
    if (status.complete === true || status.error === true) {
      return fromStatus(status, res.status);
    }
  }
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

/** Tableau de chaînes d'une cellule groupArray HogQL (non-array → []). */
export function cellStrArr(row: unknown[], i: number): string[] {
  const v = row[i];
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x : String(x)));
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
