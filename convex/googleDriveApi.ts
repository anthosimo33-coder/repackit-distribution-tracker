/**
 * Couche API Google Drive (REST + auth service account) — appels réseau externes
 * DESTINÉS à être appelés depuis une action Convex (convex/snytchDrive.ts) :
 * `fetch` + `crypto.subtle` ne sont dispos que dans le runtime action. Calqué sur
 * convex/cloudflareStreamApi.ts (même idiome fetch + timeout + gate d'env).
 *
 * RÔLE : gérer, avec le service account, le dossier Drive de chaque créateur
 * Snytch et l'upload direct navigateur → Drive :
 *   - createDriveFolder(name) → id du sous-dossier créé dans le dossier racine ;
 *   - initResumableUpload(folderId, fileName, mimeType) → URL de session
 *     resumable (en-tête Location) que le CLIENT PUT directement. Le gros
 *     fichier (vidéo iPhone > 1 Go) ne transite JAMAIS par Convex.
 *
 * AUTH : JWT RS256 signé via Web Crypto (crypto.subtle), échangé contre un
 * access_token OAuth2 — AUCUNE dépendance npm (googleapis/google-auth-library).
 * Scope `drive.file` (le service account ne gère QUE les fichiers/dossiers qu'il
 * crée). La clé privée n'est JAMAIS exposée ni loggée.
 *
 * ⚠️ ENV (posés via `npx convex env set`, prod ET test) :
 *   - GOOGLE_SERVICE_ACCOUNT_JSON  (JSON complet du service account)
 *   - SNYTCH_DRIVE_ROOT_FOLDER_ID  (dossier racine "Snytch Créateurs", partagé
 *     avec le service account en Éditeur)
 * ABSENTS / INVALIDES → `googleDriveConfig()` renvoie null : l'appelant log +
 * no-op (dégradation propre), JAMAIS de crash de build ni de fonction.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/. parseServiceAccount /
 * creatorFolderName sont des RÉPLIQUES de lib/snytch-drive.ts (tests Vitest
 * là-bas). Toute évolution doit être faite des DEUX côtés.
 */

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Timeout des appels REST (auth, création dossier, init upload). */
const FETCH_TIMEOUT_MS = 20_000;

// ─── Réplique A6 de lib/snytch-drive (tests Vitest là-bas) ───────────────────

interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

/** RÉPLIQUE de lib/snytch-drive.parseServiceAccount — cf tests Vitest. */
function parseServiceAccount(raw: string): ServiceAccount {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON: JSON invalide.");
  }
  if (!json || typeof json !== "object") {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON: objet JSON attendu.");
  }
  const o = json as Record<string, unknown>;
  const clientEmail = o.client_email;
  const privateKeyRaw = o.private_key;
  if (typeof clientEmail !== "string" || clientEmail.length === 0) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON: client_email manquant.");
  }
  if (typeof privateKeyRaw !== "string" || privateKeyRaw.length === 0) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON: private_key manquant.");
  }
  const tokenUri =
    typeof o.token_uri === "string" && o.token_uri.length > 0
      ? o.token_uri
      : DEFAULT_TOKEN_URI;
  return {
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
    tokenUri,
  };
}

/** RÉPLIQUE de lib/snytch-drive.creatorFolderName — cf tests Vitest. */
export function creatorFolderName(name: string, creatorId: string): string {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
  const display = clean.length > 0 ? clean : "Créateur";
  return `${display} — ${creatorId.slice(-6)}`;
}

// ─── Config / gate d'environnement ───────────────────────────────────────────

export interface GoogleDriveConfig {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
  rootFolderId: string;
}

/**
 * Config Drive depuis l'env du deployment, ou null si un secret manque / est
 * invalide. Centralise la GATE : tout appelant passe par là pour décider
 * « Drive actif » vs « no-op propre ». N'expose ni ne logge JAMAIS la clé (le
 * message d'erreur de parseServiceAccount ne cite que le champ fautif).
 */
export function googleDriveConfig(): GoogleDriveConfig | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const rootFolderId = process.env.SNYTCH_DRIVE_ROOT_FOLDER_ID;
  if (!raw || !rootFolderId) return null;
  try {
    const sa = parseServiceAccount(raw);
    return { ...sa, rootFolderId };
  } catch (e) {
    console.error(
      `[snytch-drive] GOOGLE_SERVICE_ACCOUNT_JSON invalide: ${
        e instanceof Error ? e.message : "erreur inconnue"
      } — dépôt Drive désactivé.`,
    );
    return null;
  }
}

// ─── Helpers bas niveau (fetch, base64url, PEM, extraction JSON) ──────────────

/** fetch avec timeout via AbortController (idiome cloudflareStreamApi.cfFetch). */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** base64url d'une chaîne UTF-8 ou d'octets (sans padding). */
function base64Url(input: string | ArrayBuffer | Uint8Array): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PEM PKCS#8 → DER (ArrayBuffer) pour crypto.subtle.importKey. */
function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Extrait une string non-vide d'un objet JSON (best-effort, sans `any`). */
function readString(json: unknown, key: string): string | null {
  if (!json || typeof json !== "object") return null;
  const value = (json as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Message d'erreur Drive : `{ error: { message } }` (best-effort). */
function driveErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const err = (json as { error?: unknown }).error;
  return readString(err, "message");
}

// ─── Auth : JWT service account → access_token OAuth2 ─────────────────────────

/** Signe le JWT RS256 du service account (assertion Bearer). */
async function signServiceAccountJwt(
  config: GoogleDriveConfig,
  nowSec: number,
): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: DRIVE_SCOPE,
      aud: config.tokenUri,
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(config.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(signature)}`;
}

/**
 * Échange le JWT service account contre un access_token OAuth2. Throw un message
 * lisible en cas d'échec (jamais la clé). Appelé une fois par opération Drive.
 */
export async function getAccessToken(
  config: GoogleDriveConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const jwt = await signServiceAccountJwt(config, Math.floor(Date.now() / 1000));
  const res = await fetchWithTimeout(
    config.tokenUri,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }).toString(),
    },
    fetchImpl,
  );
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const desc =
      readString(json, "error_description") ?? readString(json, "error");
    throw new Error(`Auth Google échouée: ${desc ?? `HTTP ${res.status}`}`);
  }
  const token = readString(json, "access_token");
  if (!token) throw new Error("Auth Google: access_token manquant.");
  return token;
}

// ─── Opérations Drive ────────────────────────────────────────────────────────

/**
 * Crée un sous-dossier `name` DANS le dossier racine (config.rootFolderId) et
 * renvoie son id. Le service account en est propriétaire (scope drive.file).
 */
export async function createDriveFolder(
  config: GoogleDriveConfig,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const token = await getAccessToken(config, fetchImpl);
  const res = await fetchWithTimeout(
    `${DRIVE_API}/files?fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: [config.rootFolderId],
      }),
    },
    fetchImpl,
  );
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      driveErrorMessage(json) ?? `Création dossier Drive échouée (HTTP ${res.status}).`,
    );
  }
  const id = readString(json, "id");
  if (!id) throw new Error("Création dossier Drive: id manquant.");
  return id;
}

/**
 * Initie un upload RESUMABLE dans le dossier `folderId` et renvoie l'URL de
 * session (en-tête Location). Le SERVEUR fixe ici les métadonnées (nom du
 * fichier, parent) et l'auth ; le CLIENT PUT ensuite le binaire directement sur
 * cette URL (le parent est verrouillé côté serveur — le client ne peut pas
 * changer de dossier). `fields` demande à Drive de renvoyer id/name/webViewLink
 * dans la réponse du PUT FINAL, que le client remonte à confirmUpload.
 *
 * ⚠️ CORS — l'endpoint d'upload Google (www.googleapis.com/upload/...) répond aux
 * requêtes cross-origin : le PUT navigateur → Google fonctionne sans passer par
 * un proxy. Si un jour Google restreignait le CORS, l'alternative documentée est
 * un route handler Next.js en STREAMING (chunked) — surtout PAS charger le
 * fichier entier dans une action Convex (limites de taille/durée).
 */
export async function initResumableUpload(
  config: GoogleDriveConfig,
  folderId: string,
  fileName: string,
  mimeType: string,
  sizeBytes: number | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const token = await getAccessToken(config, fetchImpl);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Type": mimeType || "application/octet-stream",
  };
  if (typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes > 0) {
    headers["X-Upload-Content-Length"] = String(Math.floor(sizeBytes));
  }
  const res = await fetchWithTimeout(
    `${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id,name,webViewLink,thumbnailLink`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ name: fileName, parents: [folderId] }),
    },
    fetchImpl,
  );
  if (!res.ok) {
    const json: unknown = await res.json().catch(() => null);
    throw new Error(
      driveErrorMessage(json) ?? `Init upload Drive échoué (HTTP ${res.status}).`,
    );
  }
  const sessionUrl = res.headers.get("location") ?? res.headers.get("Location");
  if (!sessionUrl) throw new Error("Init upload Drive: URL de session absente.");
  return sessionUrl;
}

/**
 * Supprime DÉFINITIVEMENT un fichier Drive (pas de corbeille : le service account
 * en est propriétaire, la corbeille compterait encore dans le quota). Sert à la
 * purge du binaire d'un rush refusé ou expiré, les métadonnées restant en base.
 *
 * Renvoie `true` si le fichier n'est plus là APRÈS l'appel — donc aussi sur un
 * 404, qui signifie « déjà supprimé » et rend l'opération idempotente : rejouer
 * une purge ne doit pas échouer. Tout autre échec renvoie `false` et l'appelant
 * NE marque pas le rush comme purgé — mieux vaut réessayer plus tard que
 * prétendre qu'un fichier encore présent a disparu.
 */
export async function deleteDriveFile(
  config: GoogleDriveConfig,
  fileId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const token = await getAccessToken(config, fetchImpl);
  const res = await fetchWithTimeout(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    fetchImpl,
  );
  // 204 = supprimé ; 404/410 = déjà parti (idempotence).
  if (res.ok || res.status === 404 || res.status === 410) return true;
  const json: unknown = await res.json().catch(() => null);
  console.error(
    `[snytch-drive] suppression Drive échouée (HTTP ${res.status}) : ` +
      (driveErrorMessage(json) ?? "raison inconnue"),
  );
  return false;
}
