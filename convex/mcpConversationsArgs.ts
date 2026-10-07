/**
 * Générateur de conversations — le VOCABULAIRE MCP (pur, testé par
 * `lib/mcp-conversations.test.ts`) : ce que Claude écrit → la conversation, et
 * la conversation → ce que Claude lit. Séparé de `instaConvModel` : l'écran
 * importe le modèle, jamais ces messages destinés au modèle de langage.
 */
import {
  MAX_ITEMS,
  MAX_TEXT,
  newItemId,
  type Conversation,
  type ConvItem,
  type ThemeId,
} from "./instaConvModel";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const THEME_MCP: Record<ThemeId, string> = { dark: "sombre", hearts: "coeurs", ocean: "ocean" };
const THEME_DE_MCP: Record<string, ThemeId> = { sombre: "dark", coeurs: "hearts", ocean: "ocean" };

/** Un élément tel que Claude l'écrit et le lit. */
export type ElementMcp = {
  type: "message" | "date";
  cote?: "recu" | "envoye";
  texte: string;
  modifie?: boolean;
  reaction?: string;
  /** Fin de slide après cet élément (export en série). */
  coupure?: boolean;
};

/** Les champs qu'un outil d'écriture peut poser (tous facultatifs en modification). */
export type ChampsMcp = {
  messages?: unknown;
  theme?: unknown;
  langue?: unknown;
  contact_nom?: unknown;
  contact_pseudo?: unknown;
  heure?: unknown;
  batterie?: unknown;
  economie_energie?: unknown;
  reseau?: unknown;
  defilement?: unknown;
};

/** Messages écrits par Claude → éléments de la conversation (ids neufs), ou le refus à lui rendre. */
export function elementsDeMcp(raw: unknown): { items: ConvItem[] } | { refus: string } {
  if (!Array.isArray(raw)) return { refus: "« messages » : une liste." };
  if (raw.length > MAX_ITEMS) return { refus: `« messages » : ${MAX_ITEMS} éléments au plus.` };
  const items: ConvItem[] = [];
  for (const [i, r] of raw.entries()) {
    const o = (r ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const texte = typeof o.texte === "string" ? o.texte.trim() : "";
    if (!texte) return { refus: `Élément ${n} : « texte » vide.` };
    if (texte.length > MAX_TEXT) return { refus: `Élément ${n} : ${MAX_TEXT} caractères au plus.` };
    const coupure = o.coupure === true ? { cut: true } : {};
    if (o.type === "date") {
      items.push({ id: newItemId(), kind: "date", text: texte, ...coupure });
      continue;
    }
    if (o.cote !== "recu" && o.cote !== "envoye") {
      return { refus: `Élément ${n} : « cote » vaut « recu » (bulle à gauche) ou « envoye » (à droite).` };
    }
    const reaction = typeof o.reaction === "string" ? Array.from(o.reaction.trim()).slice(0, 4).join("") : "";
    items.push({
      id: newItemId(),
      kind: "message",
      side: o.cote === "envoye" ? "out" : "in",
      text: texte,
      ...(o.modifie === true ? { edited: true } : {}),
      ...(reaction ? { reaction } : {}),
      ...coupure,
    });
  }
  return { items };
}

/**
 * Applique les champs fournis par Claude à une conversation (création : partir
 * de `defaultConversation()` sans ses messages ; modification : de l'existante).
 * Un champ absent ne change rien ; la photo du contact ne se pose qu'à l'écran.
 */
export function appliquerChampsMcp(base: Conversation, champs: ChampsMcp): { conversation: Conversation } | { refus: string } {
  const c: Conversation = JSON.parse(JSON.stringify(base));
  if (champs.messages !== undefined) {
    const r = elementsDeMcp(champs.messages);
    if ("refus" in r) return r;
    c.items = r.items;
  }
  if (champs.theme !== undefined) {
    const t = typeof champs.theme === "string" ? THEME_DE_MCP[champs.theme] : undefined;
    if (!t) return { refus: `« theme » : ${Object.keys(THEME_DE_MCP).join(", ")}.` };
    c.themeId = t;
  }
  if (champs.langue !== undefined) {
    if (champs.langue !== "fr" && champs.langue !== "en") return { refus: "« langue » : fr ou en." };
    c.locale = champs.langue;
  }
  if (typeof champs.contact_nom === "string") c.contact.name = champs.contact_nom.trim().slice(0, 60);
  if (typeof champs.contact_pseudo === "string") c.contact.username = champs.contact_pseudo.trim().replace(/^@/, "").slice(0, 60);
  if (typeof champs.heure === "string") c.status.time = champs.heure.trim().slice(0, 8);
  if (typeof champs.batterie === "number") c.status.battery = clamp(Math.round(champs.batterie), 0, 100);
  if (typeof champs.economie_energie === "boolean") c.status.lowPower = champs.economie_energie;
  if (typeof champs.reseau === "number") c.status.signal = clamp(Math.round(champs.reseau), 0, 4);
  if (typeof champs.defilement === "number") c.scroll = clamp(Math.round(champs.defilement), -200, 1200);
  return { conversation: c };
}

/** La conversation telle que Claude la lit : sans id, sans la photo (seulement si elle existe). */
export function conversationPourMcp(c: Conversation) {
  return {
    theme: THEME_MCP[c.themeId],
    langue: c.locale,
    contact: { nom: c.contact.name, pseudo: c.contact.username, photo: c.contact.avatar ? "posée à l'écran" : "aucune" },
    barreEtat: { heure: c.status.time, batterie: c.status.battery, economieEnergie: c.status.lowPower, reseau: c.status.signal },
    defilement: c.scroll,
    messages: c.items.map(
      (it): ElementMcp =>
        it.kind === "date"
          ? { type: "date", texte: it.text, ...(it.cut ? { coupure: true } : {}) }
          : {
              type: "message",
              cote: it.side === "out" ? "envoye" : "recu",
              texte: it.text,
              ...(it.edited ? { modifie: true } : {}),
              ...(it.reaction ? { reaction: it.reaction } : {}),
              ...(it.cut ? { coupure: true } : {}),
            },
    ),
  };
}
