/**
 * Compteurs d'une CHAÎNE YouTube (`channels.list?part=statistics`).
 *
 * Module PUR (aucun import Convex) : testable en vitest via
 * `lib/youtube-channel.test.ts`. Même arrangement que `convex/apifyItem.ts`.
 *
 * L'API rend les compteurs en CHAÎNES de caractères ("18430"), et masque
 * `subscriberCount` quand la chaîne a choisi de le cacher — auquel cas le champ
 * est absent, pas à zéro. La distinction est la même que partout dans ce
 * chantier : `null` = non collecté, jamais 0.
 *
 * Coût : `channels.list` vaut 1 unité de quota par appel, sur un quota
 * quotidien de 10 000. Négligeable.
 */

export type ChannelStats = {
  /** Handle interrogé, tel que fourni (sert à rattacher la réponse au compte). */
  handle: string;
  subscribers: number | null;
  /** Vues CUMULÉES de la chaîne. */
  totalViews: number | null;
};

function toCount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Lit la réponse de `channels.list` pour UN handle. `null` si la réponse ne
 * contient aucun item (chaîne introuvable, handle erroné) — distinct d'une
 * chaîne trouvée dont les compteurs sont masqués, qui rend un objet à `null`.
 */
export function parseChannelStats(
  handle: string,
  apiResponse: unknown,
): ChannelStats | null {
  const rec =
    apiResponse && typeof apiResponse === "object"
      ? (apiResponse as Record<string, unknown>)
      : {};
  const items = Array.isArray(rec.items) ? rec.items : [];
  if (items.length === 0) return null;
  const first =
    items[0] && typeof items[0] === "object"
      ? (items[0] as Record<string, unknown>)
      : {};
  const stats =
    first.statistics && typeof first.statistics === "object"
      ? (first.statistics as Record<string, unknown>)
      : {};
  return {
    handle,
    // `hiddenSubscriberCount: true` → le champ est ABSENT. On rend null, pas 0 :
    // afficher « 0 abonné » pour une chaîne qui les masque serait un mensonge.
    subscribers: toCount(stats.subscriberCount),
    totalViews: toCount(stats.viewCount),
  };
}

/** Handle YouTube normalisé pour `forHandle` : « @nom ». null si illisible. */
export function youtubeHandleFrom(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (raw === "") return null;
  // Accepte « @nom », « nom », et une URL de chaîne « youtube.com/@nom ».
  const fromUrl = /youtube\.com\/@([^/?#]+)/i.exec(raw);
  const name = fromUrl ? fromUrl[1] : raw.replace(/^@/, "");
  if (name === "" || /[/?#\s]/.test(name)) return null;
  return `@${name}`;
}
