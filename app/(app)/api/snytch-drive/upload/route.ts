import type { NextRequest } from "next/server";

/**
 * Proxy d'upload Snytch → Google Drive — contourne le blocage CORS du PUT
 * navigateur → googleapis.com (les sessions resumables créées par un service
 * account n'autorisent pas le PUT cross-origin depuis un navigateur arbitraire).
 *
 * FLUX : le client obtient une session resumable via l'action Convex
 * getUploadSession (le service account fixe le dossier + les métadonnées côté
 * serveur), puis POST le fichier PAR CHUNKS à CETTE route (MÊME origine → aucun
 * CORS). Chaque chunk est reforwardé en PUT sur la session Drive avec son
 * Content-Range. Drive répond 308 (« continuer ») jusqu'au dernier chunk
 * (200/201 → ressource fichier). confirmUpload (Convex) enregistre ensuite les
 * métadonnées.
 *
 * GROS FICHIERS : on ne bufferise JAMAIS le fichier entier — un seul chunk
 * (< 4,5 Mo, sous la limite de body des fonctions Vercel) à la fois → gère les
 * vidéos iPhone > 1 Go (le client découpe, cf DriveUploader.CHUNK_BYTES).
 *
 * SÉCURITÉ : la cible est validée (SSRF — host *.googleapis.com, path /upload/).
 * La session est une CAPACITÉ non-devinable créée côté serveur pour le dossier
 * du créateur authentifié ; cette route ne fait que relayer des octets vers
 * Google — elle n'expose ni la clé service account ni aucune identité, et ne
 * touche pas Convex.
 */

export const runtime = "nodejs";
// Chaque requête ne traite qu'UN chunk (relais Vercel → Google, rapide) ; 60 s
// couvre très largement (Vercel plafonne selon le plan). Cf limites documentées.
export const maxDuration = 60;

/** Cible autorisée : endpoint d'upload Google uniquement (anti-SSRF). */
function isAllowedSession(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    (url.hostname === "googleapis.com" ||
      url.hostname.endsWith(".googleapis.com")) &&
    url.pathname.startsWith("/upload/")
  );
}

type ProxyResult =
  | { status: "incomplete"; range: string | null }
  | { status: "complete"; file: unknown }
  | { status: "error"; httpStatus: number; message: string };

export async function POST(request: NextRequest): Promise<Response> {
  const session = request.headers.get("x-drive-session");
  const contentRange = request.headers.get("x-drive-content-range");
  if (!session || !contentRange || !isAllowedSession(session)) {
    return Response.json({ error: "Requête d'upload invalide." }, { status: 400 });
  }

  // UN chunk (< 4,5 Mo), jamais le fichier entier.
  const chunk = await request.arrayBuffer();

  let googleRes: Response;
  try {
    googleRes = await fetch(session, {
      method: "PUT",
      headers: {
        "Content-Range": contentRange,
        "Content-Length": String(chunk.byteLength),
      },
      body: chunk,
    });
  } catch (e) {
    return Response.json(
      { error: `Relais Drive indisponible: ${e instanceof Error ? e.message : "?"}` },
      { status: 502 },
    );
  }

  const text = await googleRes.text();
  // 308 « Resume Incomplete » : chunk intermédiaire (sans Location → fetch le
  // renvoie tel quel). 200/201 : terminé (ressource fichier JSON). Sinon erreur.
  let result: ProxyResult;
  if (googleRes.status === 308) {
    result = { status: "incomplete", range: googleRes.headers.get("range") };
  } else if (googleRes.status === 200 || googleRes.status === 201) {
    let file: unknown = null;
    try {
      file = JSON.parse(text);
    } catch {
      file = null;
    }
    result = { status: "complete", file };
  } else {
    result = {
      status: "error",
      httpStatus: googleRes.status,
      message: text.slice(0, 500),
    };
  }
  return Response.json(result);
}
