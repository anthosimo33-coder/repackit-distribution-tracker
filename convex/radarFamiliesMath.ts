/**
 * RADAR — FAMILLES DE HOOKS : le même format d'une langue à l'autre. Un hook se
 * reprend traduit ou adapté (09/11/2026 : « new obsession: a game where you go
 * through a missing girl's phone » en anglais le 24/10, en allemand le 27/10, en
 * français le 30/10) ; le gabarit (radarNetworkMath.hookTemplate) n'en voit que
 * des formats sans lien. Claude Haiku range chaque nouveau hook dans une famille
 * déjà connue ou en ouvre une ; il ne réécrit ni ne publie rien.
 *
 * Module pur : la consigne, le schéma de la réponse, sa validation, la langue
 * d'un format et le coût d'un appel. L'appel vit dans convex/radarFamilies.
 */

const DAY = 86_400_000;

export const FAMILY_MODEL = "claude-haiku-5-5";
/** Formats rangés : hooks repris par au moins deux comptes, actifs ces 14 jours. */
export const FAMILY_WINDOW_MS = 14 * DAY;
/** Nouveaux hooks par appel, et familles connues montrées au modèle. */
export const FAMILY_BATCH = 30;
export const FAMILY_KNOWN_MAX = 150;
/** Une famille connue reste proposée 60 jours après sa dernière reprise. */
export const FAMILY_KNOWN_WINDOW_MS = 60 * DAY;
/** Exemples gardés par famille (ses variantes, langues différentes d'abord). */
export const FAMILY_EXAMPLES = 4;
const LABEL_MAX = 80;
const HOOK_MAX = 160;

/** Claude Haiku 5.5, prompts de moins de 100 000 jetons : 0,10 $ / 0,50 $ le million. */
export const HAIKU_USD_PER_MTOK = { input: 0.1, output: 0.5 } as const;
export function haikuCostUsd(usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): number {
  const input = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  return (input * HAIKU_USD_PER_MTOK.input + usage.output_tokens * HAIKU_USD_PER_MTOK.output) / 1_000_000;
}

export type FamilyCandidate = { id: string; variants: string[] };
export type KnownFamily = { id: string; label: string; examples: string[] };

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const FAMILY_SYSTEM = [
  "You sort short-video hooks (the text shown on screen in TikTok videos that promote apps) into families.",
  "A family is ONE idea or format, whatever the language or wording: the same hook translated, adapted to another country, or lightly rephrased belongs to the same family.",
  "Two different ideas that only share a theme (for example two different jokes about a cheating boyfriend) are different families.",
  "Labels are written in French: the idea in 8 words or fewer, neutral, without quotation marks.",
].join(" ");

/** La demande : familles connues (E1…), nouveaux hooks (H1…). Les ids réels ne quittent pas le serveur. */
export function familyPrompt(candidates: readonly FamilyCandidate[], known: readonly KnownFamily[]): string {
  const lines: string[] = [];
  lines.push("Known families:");
  if (known.length === 0) lines.push("(none yet)");
  known.forEach((f, i) => lines.push(`E${i + 1}: ${clip(f.label, LABEL_MAX)} — examples: ${f.examples.map((e) => `«${clip(e, HOOK_MAX)}»`).join(" / ")}`));
  lines.push("", "New hooks to place (variants of the same hook are separated by /):");
  candidates.forEach((c, i) => lines.push(`H${i + 1}: ${c.variants.map((v) => `«${clip(v, HOOK_MAX)}»`).join(" / ")}`));
  lines.push(
    "",
    "For EVERY new hook, give the family it belongs to: a known family (E…), or a new family (N1, N2… — new hooks with the same idea share the same N).",
    "List each new family once with its French label.",
  );
  return lines.join("\n");
}

/** Le schéma de la réponse (sortie structurée) : un placement par hook, les nouvelles familles. */
export const FAMILY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["placements", "newFamilies"],
  properties: {
    placements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hook", "family"],
        properties: { hook: { type: "string" }, family: { type: "string" } },
      },
    },
    newFamilies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label"],
        properties: { id: { type: "string" }, label: { type: "string" } },
      },
    },
  },
} as const;

export type Placement = { formatId: string; family: { known: string } | { ref: string } };
export type Placed = { placements: Placement[]; newFamilies: { ref: string; label: string }[] };

/**
 * La réponse du modèle ramenée à une forme sûre. Un hook absent, une famille
 * inconnue ou une nouvelle famille sans étiquette : le hook ouvre SA famille,
 * étiquetée de sa variante — on ne perd jamais un format, on n'invente rien.
 */
export function placeAnswer(answer: unknown, candidates: readonly FamilyCandidate[], known: readonly KnownFamily[]): Placed {
  const a = (answer ?? {}) as { placements?: unknown; newFamilies?: unknown };
  const labels = new Map<string, string>();
  for (const f of Array.isArray(a.newFamilies) ? a.newFamilies : []) {
    const id = typeof f?.id === "string" ? f.id.trim().toUpperCase() : "";
    const label = typeof f?.label === "string" ? clip(f.label, LABEL_MAX) : "";
    if (/^N\d+$/.test(id) && label && !labels.has(id)) labels.set(id, label);
  }
  const byHook = new Map<number, string>();
  for (const p of Array.isArray(a.placements) ? a.placements : []) {
    const h = typeof p?.hook === "string" ? /^H(\d+)$/i.exec(p.hook.trim()) : null;
    const fam = typeof p?.family === "string" ? p.family.trim().toUpperCase() : "";
    if (h && !byHook.has(Number(h[1]))) byHook.set(Number(h[1]), fam);
  }
  const placements: Placement[] = [];
  const used = new Map<string, string>();
  candidates.forEach((c, i) => {
    const fam = byHook.get(i + 1) ?? "";
    const e = /^E(\d+)$/.exec(fam);
    if (e && known[Number(e[1]) - 1]) {
      placements.push({ formatId: c.id, family: { known: known[Number(e[1]) - 1].id } });
      return;
    }
    if (labels.has(fam)) {
      used.set(fam, labels.get(fam)!);
      placements.push({ formatId: c.id, family: { ref: fam } });
      return;
    }
    const own = `self:${c.id}`;
    used.set(own, clip(c.variants[0] ?? "", LABEL_MAX));
    placements.push({ formatId: c.id, family: { ref: own } });
  });
  return { placements, newFamilies: [...used].map(([ref, label]) => ({ ref, label })) };
}

/** La langue d'un format : celle de la majorité de ses comptes (« autre » sans langue connue). */
export function formatLang(langs: readonly (string | undefined)[]): string {
  const count = new Map<string, number>();
  for (const l of langs) if (l) count.set(l, (count.get(l) ?? 0) + 1);
  return [...count].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? "autre";
}

/** Les exemples d'une famille : la nouvelle variante ajoutée, sans doublon, une langue nouvelle avant une langue déjà vue. */
export function addExample(examples: readonly { text: string; lang: string }[], ex: { text: string; lang: string }): { text: string; lang: string }[] {
  if (examples.some((e) => e.text === ex.text)) return [...examples];
  const next = [...examples, ex];
  if (next.length <= FAMILY_EXAMPLES) return next;
  // Trop d'exemples : on retire le plus ancien d'une langue représentée deux fois.
  const seen = new Map<string, number>();
  for (const e of next) seen.set(e.lang, (seen.get(e.lang) ?? 0) + 1);
  const drop = next.findIndex((e) => (seen.get(e.lang) ?? 0) > 1);
  return next.filter((_, i) => i !== (drop >= 0 ? drop : 0));
}
