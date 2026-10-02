/**
 * CLAUDE REGARDE UNE VIDÉO SOUMISE — des images clés, pas la vidéo.
 *
 * Les vidéos soumises sont transcodées par Cloudflare Stream et lues en PUBLIC
 * (iframe.videodelivery.net/<uid>, cf lib/cloudflare-stream) : leurs vignettes
 * le sont aussi, à l'instant voulu (`/thumbnails/thumbnail.jpg?time=…`). Le
 * serveur MCP les récupère et les rend comme IMAGES dans la réponse de l'outil
 * `regarder_video` — le hook à l'ouverture, le milieu, la fin.
 *
 * Module sans base ni runtime Node (pas de `Buffer`) : le `fetch` est injecté,
 * testé par Vitest (lib/mcp-video.test.ts).
 */

/** Domaine public des vignettes Stream (celui du player de l'app). */
export const STREAM_PUBLIC_BASE = "https://videodelivery.net";

/** Au plus : assez pour voir le hook, le milieu et la fin, sans noyer la réponse. */
export const IMAGES_MAX = 6;
/** Hauteur demandée : lisible pour un texte incrusté, ~40 Ko l'image. */
const HAUTEUR = 480;
const OCTETS_MAX = 1_500_000;
const DELAI_MS = 8_000;

/**
 * Les instants à regarder, en secondes. Le HOOK compte double — il se joue dans
 * les 3 premières secondes —, puis le milieu, les trois quarts et la fin (le CTA).
 * Durée inconnue : des instants fixes, ceux au-delà de la fin échoueront et
 * seront dits comme tels.
 */
export function instantsDeLaVideo(duree: number | null): number[] {
  if (duree === null || !Number.isFinite(duree) || duree <= 0) return [0.5, 1.5, 3, 6, 10, 15];
  const fin = Math.max(duree - 0.8, 0.1);
  const candidats = [0.3, 1.5, 3, duree * 0.5, duree * 0.75, fin]
    .filter((t) => t <= fin)
    .map((t) => Math.round(t * 10) / 10)
    .sort((a, b) => a - b);
  const garde: number[] = [];
  for (const t of candidats) {
    if (garde.length === 0 || t - garde[garde.length - 1] >= 0.5) garde.push(t);
  }
  return garde.slice(0, IMAGES_MAX);
}

/** L'URL de la vignette d'une vidéo Stream à un instant. */
export function urlVignette(uid: string, secondes: number, base = STREAM_PUBLIC_BASE): string {
  return `${base}/${encodeURIComponent(uid)}/thumbnails/thumbnail.jpg?time=${secondes}s&height=${HAUTEUR}`;
}

/** « 0,3 s », « 12 s », « 1 min 05 s » — l'instant d'une image, lisible. */
export function instantTexte(secondes: number): string {
  if (secondes < 60) {
    const arrondi = secondes < 10 ? Math.round(secondes * 10) / 10 : Math.round(secondes);
    return `${String(arrondi).replace(".", ",")} s`;
  }
  const s = Math.round(secondes);
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 d'octets, sans `Buffer` ni `btoa` (runtime Convex). */
export function base64(octets: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < octets.length; i += 3) {
    const n = (octets[i] << 16) | (octets[i + 1] << 8) | octets[i + 2];
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const reste = octets.length - i;
  if (reste === 1) {
    const n = octets[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + "==";
  } else if (reste === 2) {
    const n = (octets[i] << 16) | (octets[i + 1] << 8);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + "=";
  }
  return out;
}

export interface Vignette {
  secondes: number;
  data: string;
  mimeType: string;
}

/**
 * Les vignettes d'une vidéo, lues EN PARALLÈLE. Une image qui ne vient pas
 * (instant au-delà de la fin, réseau, réponse qui n'est pas une image, trop
 * lourde) est comptée en échec, jamais inventée ni remplacée.
 */
export async function lireVignettes(
  uid: string,
  instants: readonly number[],
  fetchImpl: typeof fetch,
  base = STREAM_PUBLIC_BASE,
): Promise<{ vignettes: Vignette[]; echecs: number[] }> {
  const lues = await Promise.all(
    instants.map(async (secondes): Promise<Vignette | null> => {
      const controle = new AbortController();
      const minuteur = setTimeout(() => controle.abort(), DELAI_MS);
      try {
        const r = await fetchImpl(urlVignette(uid, secondes, base), { signal: controle.signal });
        const type = (r.headers.get("content-type") ?? "").split(";")[0].trim();
        if (!r.ok || !type.startsWith("image/")) return null;
        const octets = new Uint8Array(await r.arrayBuffer());
        if (octets.length === 0 || octets.length > OCTETS_MAX) return null;
        return { secondes, data: base64(octets), mimeType: type };
      } catch {
        return null;
      } finally {
        clearTimeout(minuteur);
      }
    }),
  );
  return {
    vignettes: lues.filter((v): v is Vignette => v !== null),
    echecs: instants.filter((_, i) => lues[i] === null),
  };
}

// ─── Ce qui est DIT : la transcription Cloudflare Stream ───────────────────

/** Langues que Stream sait transcrire (doc « Generate captions »). */
export const LANGUES_TRANSCRIPTION = ["cs", "nl", "en", "fr", "de", "it", "ja", "ko", "pl", "pt", "ru", "es"] as const;

/** La langue de transcription d'une créatrice : sa locale (« pt-BR » → pt), sinon le français. */
export function langueTranscription(locale: string | null | undefined): string {
  const base = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  return (LANGUES_TRANSCRIPTION as readonly string[]).includes(base) ? base : "fr";
}

export interface Replique {
  debut: number;
  fin: number;
  texte: string;
}

const HORODATAGE = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;
const secondes = (t: string): number | null => {
  const m = HORODATAGE.exec(t.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
};

/** Les répliques d'un fichier WebVTT, dans l'ordre (balises et numéros de bloc retirés). */
export function lireVtt(vtt: string): Replique[] {
  const repliques: Replique[] = [];
  for (const bloc of vtt.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lignes = bloc.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    const i = lignes.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lignes[i].split("-->");
    const debut = secondes(a);
    const fin = secondes((b ?? "").trim().split(/\s+/)[0] ?? "");
    const texte = lignes
      .slice(i + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (debut === null || fin === null || texte === "") continue;
    repliques.push({ debut, fin, texte });
  }
  return repliques;
}

/** Ce qui est dit entre deux instants (répliques qui chevauchent la fenêtre). */
export function ditEntre(repliques: readonly Replique[], de: number, a: number): string {
  return repliques
    .filter((r) => r.fin > de && r.debut < a)
    .map((r) => r.texte)
    .join(" ");
}

export type EtatTranscription =
  | { etat: "prete"; repliques: Replique[] }
  | { etat: "en_cours" }
  | { etat: "lancee" }
  | { etat: "erreur"; message: string }
  | { etat: "indisponible" };

/**
 * La transcription d'une vidéo dans une langue : prête (répliques), en cours,
 * lancée à l'instant (gratuite, ~1 min), en erreur — ou indisponible sans
 * configuration Stream. Les appels sont injectés (testés sans réseau).
 */
export async function transcription(
  api: {
    lister: () => Promise<{ language: string; status: "ready" | "inprogress" | "error" | null }[]>;
    lancer: () => Promise<unknown>;
    vtt: () => Promise<string>;
  } | null,
  langue: string,
): Promise<EtatTranscription> {
  if (api === null) return { etat: "indisponible" };
  try {
    const piste = (await api.lister()).find((c) => c.language === langue);
    if (!piste) {
      await api.lancer();
      return { etat: "lancee" };
    }
    if (piste.status === "inprogress") return { etat: "en_cours" };
    if (piste.status === "error") return { etat: "erreur", message: "Cloudflare n'a pas pu transcrire cette vidéo." };
    return { etat: "prete", repliques: lireVtt(await api.vtt()) };
  } catch (e) {
    return { etat: "erreur", message: e instanceof Error ? e.message : "transcription illisible" };
  }
}
