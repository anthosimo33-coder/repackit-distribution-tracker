/**
 * Générateur de conversations — le VOCABULAIRE MCP (pur, testé par
 * `lib/mcp-conversations.test.ts`) : ce que Claude écrit → la conversation, et
 * la conversation → ce que Claude lit. Séparé de `instaConvModel` : l'écran
 * importe le modèle, jamais ces messages destinés au modèle de langage.
 */
import {
  CARD_MEDIA,
  MAX_CAPTION,
  MAX_IDEES,
  MAX_INCRUSTATION,
  MAX_ITEMS,
  MAX_LIGNES_REPONSE,
  MAX_POURQUOI,
  MAX_TEXT,
  REGLAGES_BLUSH_DEFAUT,
  VERDICTS_BLUSH,
  idImage,
  newItemId,
  nettoyerCompte,
  type Conversation,
  type ConvInterface,
  type ConvItem,
  type ConvMessage,
  type ThemeId,
  type VerdictBlush,
} from "./instaConvModel";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const THEME_MCP: Record<ThemeId, string> = { dark: "sombre", hearts: "coeurs", ocean: "ocean" };
const THEME_DE_MCP: Record<string, ThemeId> = { sombre: "dark", coeurs: "hearts", ocean: "ocean" };

/** Un élément tel que Claude l'écrit et le lit. */
export type ElementMcp = {
  type:
    | "message"
    | "date"
    | "vocal"
    | "photo_ephemere"
    | "video_ephemere"
    | "photo"
    | "video"
    | "reel"
    | "publication"
    | "story_partagee"
    // Chat BLUSH seulement.
    | "ecrit"
    | "meilleure_reponse"
    | "citation";
  cote?: "recu" | "envoye";
  texte?: string;
  modifie?: boolean;
  reaction?: string;
  /** Fin de slide après cet élément (export en série). */
  coupure?: boolean;
  /** Vocal : durée en secondes. */
  duree?: number;
  /** Réponse citée : le message cité (son côté, son texte, ou sa nature). */
  reponse?: { cote: "recu" | "envoye"; texte?: string; type?: "texte" | "photo" | "video" | "vocal"; duree?: number };
  /** Réponse à une story (`image` : sa miniature). */
  story?: { amis_proches?: boolean; indisponible?: boolean; image?: string };
  /** Photo, vidéo, reel, publication, story partagée : l'image (« img:<id> » ou lien TikTok). */
  image?: string;
  /** Lien TikTok : quelle photo d'un carrousel (1 = la première). */
  image_rang?: number;
  /** Reel, publication, story partagée : le compte, sa photo, son badge, la légende. */
  compte?: string;
  photo_compte?: string;
  certifie?: boolean;
  legende?: string;
  /** L'écran montre l'appui long sur ce message (un seul). */
  appui_long?: boolean;
  /** Heure du message (menu d'appui long ; BLUSH : sous son groupe). */
  heure?: string;
  /** Texte incrusté en haut de la slide que termine cet élément (style TikTok). */
  incrustation?: string;
  /** BLUSH, meilleure_reponse : les messages à lui envoyer (une bulle chacun), et pourquoi. */
  lignes?: string[];
  pourquoi?: string;
  /** BLUSH, citation : qui avait écrit le message cité (« autre » : la personne dont on parle ; « moi » : celle qui tient le téléphone). */
  de?: "autre" | "moi";
};

const MEDIA_DE_MCP = {
  vocal: "voice",
  photo_ephemere: "photoOnce",
  video_ephemere: "videoOnce",
  photo: "photo",
  video: "video",
  reel: "reel",
  publication: "post",
  story_partagee: "storyShare",
} as const;
const MEDIA_MCP = {
  voice: "vocal",
  photoOnce: "photo_ephemere",
  videoOnce: "video_ephemere",
  photo: "photo",
  video: "video",
  reel: "reel",
  post: "publication",
  storyShare: "story_partagee",
} as const;
const TYPES_MCP = ["message", "date", ...Object.keys(MEDIA_DE_MCP)].join(", ");
/** Le chat BLUSH : ses éléments (pas de reel ni d'éphémère), et ceux qu'il est le seul à avoir. */
const TYPES_BLUSH = ["message", "date", "vocal", "photo", "ecrit", "meilleure_reponse", "citation"];
const SEULEMENT_BLUSH = ["ecrit", "meilleure_reponse", "citation"];
/** Les champs d'un élément Instagram que le chat BLUSH n'a pas (refusés en clair plutôt qu'ignorés). */
const CHAMPS_INSTAGRAM = ["modifie", "reaction", "reponse", "story", "appui_long", "compte", "photo_compte", "certifie"];

/** Préfixe d'une image du projet telle que Claude la lit (et la renvoie pour la garder). */
export const PREFIXE_IMAGE = "img:";
/**
 * Jeton posé par l'action à la place d'une image qu'elle vient de ranger dans le
 * storage (lien TikTok, lien d'image, data URL) ; la mutation le résout en id.
 */
export const PREFIXE_FICHIER = "fichier:";

/**
 * Une référence d'image écrite par Claude → ce que porte la conversation : l'id
 * (« img:<id> »), ou le jeton d'une image tout juste rangée (« fichier:<n> »),
 * résolu par la mutation. `null` : forme refusée.
 */
export function refImage(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.startsWith(PREFIXE_IMAGE) && /^[a-z0-9]{8,64}$/i.test(t.slice(PREFIXE_IMAGE.length))) return t.slice(PREFIXE_IMAGE.length);
  if (/^fichier:\d{1,3}$/.test(t)) return t;
  return null;
}

/** Une image en data URL (photo envoyée dans la discussion, encodée par Claude) → ses octets. */
export function octetsDataUrl(v: string): { octets: Uint8Array; type: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(v.trim());
  if (!m) return null;
  try {
    const bin = atob(m[2].replace(/\s+/g, ""));
    return { octets: Uint8Array.from(bin, (c) => c.charCodeAt(0)), type: m[1] };
  } catch {
    return null;
  }
}

/** Lien d'image hors TikTok : https, un vrai nom d'hôte (ni IP, ni réseau local). */
export function lienImagePublic(v: string): boolean {
  try {
    const u = new URL(v.trim());
    const h = u.hostname.toLowerCase();
    return (
      u.protocol === "https:" &&
      h.includes(".") &&
      !/^[\d.]+$/.test(h) &&
      !h.includes(":") &&
      !/(^|\.)(localhost|local|internal|lan)$/.test(h)
    );
  } catch {
    return false;
  }
}

/** Les formes qu'une image peut prendre côté Claude (rappelées dans chaque refus). */
const FORMES_IMAGE = "un lien TikTok, un lien d'image (https), une image en data URL, ou « img:<id> » lu dans lire_conversation";
const CITATION_DE_MCP = { photo: "photo", video: "video", vocal: "voice" } as const;
const CITATION_MCP = { photo: "photo", video: "video", voice: "vocal" } as const;

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
  /** Photo du contact (mêmes formes qu'une image ; "" la retire). */
  photo_contact?: unknown;
  /** Le fil commence ici : fiche du contact au-dessus du premier message. */
  debut_du_fil?: unknown;
  /** L'écran : « instagram » (DM iOS) ou « blush » (le chat de l'app BLUSH). */
  interface?: unknown;
  /** Chat BLUSH : le badge du verdict, l'anneau du niveau (1 à 4), le compteur de bulles, les idées de questions. */
  verdict?: unknown;
  niveau?: unknown;
  bulles?: unknown;
  idees?: unknown;
};

/** Messages écrits par Claude → éléments de la conversation (ids neufs), ou le refus à lui rendre. */
export function elementsDeMcp(raw: unknown, iface: ConvInterface = "instagram"): { items: ConvItem[] } | { refus: string } {
  if (!Array.isArray(raw)) return { refus: "« messages » : une liste." };
  if (raw.length > MAX_ITEMS) return { refus: `« messages » : ${MAX_ITEMS} éléments au plus.` };
  const items: ConvItem[] = [];
  let appuiLong = false;
  for (const [i, r] of raw.entries()) {
    const o = (r ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const type = typeof o.type === "string" ? o.type : "message";
    if (iface === "blush") {
      const r = elementBlush(o, type, n);
      if ("refus" in r) return r;
      items.push(r.item);
      continue;
    }
    if (SEULEMENT_BLUSH.includes(type)) return { refus: `Élément ${n} : « type » ${type} n'existe que dans le chat BLUSH (interface « blush »).` };
    const media = type in MEDIA_DE_MCP ? MEDIA_DE_MCP[type as keyof typeof MEDIA_DE_MCP] : null;
    if (type !== "message" && type !== "date" && !media) {
      return { refus: `Élément ${n} : « type » vaut ${TYPES_MCP}.` };
    }
    const texte = typeof o.texte === "string" ? o.texte.trim() : "";
    if (!texte && !media) return { refus: `Élément ${n} : « texte » vide.` };
    if (texte.length > MAX_TEXT) return { refus: `Élément ${n} : ${MAX_TEXT} caractères au plus.` };
    const coupure = o.coupure === true ? { cut: true } : {};
    const incr = incrustationDe(o.incrustation, n);
    if ("refus" in incr) return incr;
    if (type === "date") {
      items.push({ id: newItemId(), kind: "date", text: texte, ...coupure, ...incr.champ });
      continue;
    }
    if (o.cote !== "recu" && o.cote !== "envoye") {
      return { refus: `Élément ${n} : « cote » vaut « recu » (bulle à gauche) ou « envoye » (à droite).` };
    }
    const reaction = typeof o.reaction === "string" ? Array.from(o.reaction.trim()).slice(0, 4).join("") : "";
    const message: ConvMessage = {
      id: newItemId(),
      kind: "message",
      side: o.cote === "envoye" ? "out" : "in",
      text: texte,
      ...(o.modifie === true ? { edited: true } : {}),
      ...(reaction ? { reaction } : {}),
      ...coupure,
    };
    const image = o.image === undefined ? undefined : refImage(o.image);
    if (image === null) return { refus: `Élément ${n} : « image » = ${FORMES_IMAGE}.` };
    const avatar = o.photo_compte === undefined ? undefined : refImage(o.photo_compte);
    if (avatar === null) return { refus: `Élément ${n} : « photo_compte » = ${FORMES_IMAGE}.` };
    if (media === "voice") message.media = { type: "voice", seconds: clamp(Math.round(Number(o.duree) || 3), 1, 600) };
    else if (media === "photoOnce" || media === "videoOnce") message.media = { type: media };
    else if (media === "photo" || media === "video") message.media = { type: media, ...(image ? { image } : {}) };
    else if (media && (CARD_MEDIA as readonly string[]).includes(media)) {
      const account = nettoyerCompte(o.compte);
      if (!account) return { refus: `Élément ${n} : « compte » = le nom du compte qui a publié (sans @).` };
      const commun = { ...(image ? { image } : {}), ...(avatar ? { avatar } : {}), account, ...(o.certifie === true ? { verified: true } : {}) };
      const caption = typeof o.legende === "string" ? o.legende.trim().slice(0, MAX_CAPTION) : "";
      message.media =
        media === "storyShare" ? { type: "storyShare", ...commun } : { type: media as "reel" | "post", ...commun, ...(caption ? { caption } : {}) };
    }
    const rep = o.reponse as Record<string, unknown> | undefined;
    if (rep !== undefined) {
      if (!rep || typeof rep !== "object" || (rep.cote !== "recu" && rep.cote !== "envoye")) {
        return { refus: `Élément ${n} : « reponse » = { cote: recu|envoye, texte, type?: texte|photo|video|vocal }.` };
      }
      const kind = typeof rep.type === "string" && rep.type in CITATION_DE_MCP ? CITATION_DE_MCP[rep.type as keyof typeof CITATION_DE_MCP] : undefined;
      const cite = typeof rep.texte === "string" ? rep.texte.trim().slice(0, MAX_TEXT) : "";
      if (!kind && !cite) return { refus: `Élément ${n} : « reponse.texte » vide (ou précise reponse.type : photo, video, vocal).` };
      message.reply = {
        side: rep.cote === "envoye" ? "out" : "in",
        text: cite,
        ...(kind ? { kind } : {}),
        ...(kind === "voice" ? { seconds: clamp(Math.round(Number(rep.duree) || 3), 1, 600) } : {}),
      };
    }
    const story = o.story as Record<string, unknown> | undefined;
    if (story !== undefined) {
      const miniature = story?.image === undefined ? undefined : refImage(story.image);
      if (miniature === null) return { refus: `Élément ${n} : « story.image » = ${FORMES_IMAGE}.` };
      message.story = {
        ...(story && story.amis_proches === true ? { closeFriends: true } : {}),
        ...(story && story.indisponible === true ? { unavailable: true } : {}),
        ...(miniature ? { image: miniature } : {}),
      };
    }
    if (o.appui_long === true) {
      if (appuiLong) return { refus: `Élément ${n} : un seul « appui_long » par conversation.` };
      appuiLong = true;
      message.longPress = true;
    }
    if (typeof o.heure === "string" && o.heure.trim()) message.time = o.heure.trim().slice(0, 8);
    Object.assign(message, incr.champ);
    items.push(message);
  }
  return { items };
}

/** « incrustation » : un texte court, ou rien. */
function incrustationDe(v: unknown, n: number): { champ: { overlay?: string } } | { refus: string } {
  if (v === undefined || v === null || v === "") return { champ: {} };
  if (typeof v !== "string") return { refus: `Élément ${n} : « incrustation » = le texte à incruster en haut de la slide.` };
  const t = v.trim();
  if (t.length > MAX_INCRUSTATION) return { refus: `Élément ${n} : « incrustation » : ${MAX_INCRUSTATION} caractères au plus.` };
  return { champ: t ? { overlay: t } : {} };
}

/**
 * Un élément du chat BLUSH : « recu » = BLUSH (à gauche, bulles blanches),
 * « envoye » = la personne qui se confie (à droite, bulles bleues). « ecrit »,
 * « meilleure_reponse » et « citation » sont des bulles de BLUSH.
 */
function elementBlush(o: Record<string, unknown>, type: string, n: number): { item: ConvItem } | { refus: string } {
  if (!TYPES_BLUSH.includes(type)) return { refus: `Élément ${n} : dans le chat BLUSH, « type » vaut ${TYPES_BLUSH.join(", ")}.` };
  const instagram = CHAMPS_INSTAGRAM.find((k) => o[k] !== undefined);
  if (instagram) return { refus: `Élément ${n} : « ${instagram} » n'existe pas dans le chat BLUSH (Instagram seulement).` };
  const texte = typeof o.texte === "string" ? o.texte.trim() : "";
  if (texte.length > MAX_TEXT) return { refus: `Élément ${n} : ${MAX_TEXT} caractères au plus.` };
  const incr = incrustationDe(o.incrustation, n);
  if ("refus" in incr) return incr;
  const commun = { ...(o.coupure === true ? { cut: true } : {}), ...incr.champ };
  if (type === "date") {
    if (!texte) return { refus: `Élément ${n} : « texte » vide (ex. « Aujourd’hui 21:40 »).` };
    return { item: { id: newItemId(), kind: "date", text: texte, ...commun } };
  }
  const deBlush = SEULEMENT_BLUSH.includes(type);
  if (deBlush && o.cote !== undefined && o.cote !== "recu") return { refus: `Élément ${n} : « ${type} » est une bulle de BLUSH (cote « recu », ou rien).` };
  if (!deBlush && o.cote !== "recu" && o.cote !== "envoye") {
    return { refus: `Élément ${n} : « cote » vaut « recu » (BLUSH, à gauche) ou « envoye » (elle, à droite).` };
  }
  const m: ConvMessage = { id: newItemId(), kind: "message", side: deBlush || o.cote === "recu" ? "in" : "out", text: "" };
  if (typeof o.heure === "string" && o.heure.trim()) m.time = o.heure.trim().slice(0, 8);
  if (type === "ecrit") m.typing = true;
  else if (type === "meilleure_reponse") {
    const lignes = Array.isArray(o.lignes) ? o.lignes.map((l) => (typeof l === "string" ? l.trim() : "")).filter(Boolean) : [];
    if (!lignes.length) return { refus: `Élément ${n} : « lignes » = les messages à lui envoyer (${MAX_LIGNES_REPONSE} au plus), une bulle chacun.` };
    if (lignes.length > MAX_LIGNES_REPONSE) return { refus: `Élément ${n} : « lignes » : ${MAX_LIGNES_REPONSE} messages au plus.` };
    if (lignes.some((l) => l.length > MAX_TEXT)) return { refus: `Élément ${n} : ${MAX_TEXT} caractères au plus par ligne.` };
    const pourquoi = typeof o.pourquoi === "string" ? o.pourquoi.trim().slice(0, MAX_POURQUOI) : "";
    m.suggestion = { lines: lignes, ...(pourquoi ? { why: pourquoi } : {}) };
  } else if (type === "citation") {
    if (!texte) return { refus: `Élément ${n} : « texte » = le message cité, recopié tel quel.` };
    if (o.de !== undefined && o.de !== "autre" && o.de !== "moi") return { refus: `Élément ${n} : « de » vaut « autre » (la personne dont on parle) ou « moi » (celle qui tient le téléphone).` };
    const legende = typeof o.legende === "string" ? o.legende.trim().slice(0, 60) : "";
    m.text = texte;
    m.cited = { side: o.de === "moi" ? "out" : "in", ...(legende ? { caption: legende } : {}) };
  } else if (type === "vocal") m.media = { type: "voice", seconds: clamp(Math.round(Number(o.duree) || 7), 1, 600) };
  else if (type === "photo") {
    const image = o.image === undefined ? undefined : refImage(o.image);
    if (image === null) return { refus: `Élément ${n} : « image » = ${FORMES_IMAGE}.` };
    m.media = { type: "photo", ...(image ? { image } : {}) };
  } else {
    if (!texte) return { refus: `Élément ${n} : « texte » vide.` };
    m.text = texte;
  }
  return { item: { ...m, ...commun } };
}

/**
 * Applique les champs fournis par Claude à une conversation (création : partir
 * de `defaultConversation()` sans ses messages ; modification : de l'existante).
 * Un champ absent ne change rien ; la photo du contact ne se pose qu'à l'écran.
 */
export function appliquerChampsMcp(base: Conversation, champs: ChampsMcp): { conversation: Conversation } | { refus: string } {
  const c: Conversation = JSON.parse(JSON.stringify(base));
  if (champs.interface !== undefined) {
    if (champs.interface !== "instagram" && champs.interface !== "blush") return { refus: "« interface » : instagram ou blush." };
    if (champs.interface === "blush") {
      c.interface = "blush";
      c.blush ??= { ...REGLAGES_BLUSH_DEFAUT, idees: [] };
    } else delete c.interface;
  }
  const iface: ConvInterface = c.interface === "blush" ? "blush" : "instagram";
  if (champs.messages !== undefined) {
    const r = elementsDeMcp(champs.messages, iface);
    if ("refus" in r) return r;
    c.items = r.items;
  }
  if (champs.verdict !== undefined || champs.niveau !== undefined || champs.bulles !== undefined || champs.idees !== undefined) {
    const b = { ...(c.blush ?? REGLAGES_BLUSH_DEFAUT) };
    if (champs.verdict !== undefined) {
      if (!(VERDICTS_BLUSH as readonly unknown[]).includes(champs.verdict)) return { refus: `« verdict » : ${VERDICTS_BLUSH.join(" ")} (à deux doigts, partant, hésite, s'éloigne).` };
      b.verdict = champs.verdict as VerdictBlush;
    }
    if (champs.niveau !== undefined) {
      if (typeof champs.niveau !== "number" || champs.niveau < 1 || champs.niveau > 4) return { refus: "« niveau » : 1 à 4 (l'anneau vert, de « On se parle » à « On est ensemble »)." };
      b.niveau = Math.round(champs.niveau);
    }
    if (champs.bulles !== undefined) {
      if (typeof champs.bulles !== "number" || champs.bulles < 0) return { refus: "« bulles » : le solde du compteur (0 ou plus)." };
      b.bulles = clamp(Math.round(champs.bulles), 0, 9999);
    }
    if (champs.idees !== undefined) {
      if (!Array.isArray(champs.idees) || champs.idees.some((q) => typeof q !== "string")) return { refus: "« idees » : une liste de questions courtes ([] les retire)." };
      const idees = (champs.idees as string[]).map((q) => q.trim().slice(0, 60)).filter(Boolean);
      if (idees.length > MAX_IDEES) return { refus: `« idees » : ${MAX_IDEES} au plus.` };
      b.idees = idees;
    }
    c.blush = b;
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
  if (typeof champs.debut_du_fil === "boolean") {
    if (champs.debut_du_fil) c.threadStart = true;
    else delete c.threadStart;
  }
  if (champs.photo_contact !== undefined) {
    if (champs.photo_contact === "" || champs.photo_contact === null) c.contact.avatar = null;
    else {
      const photo = refImage(champs.photo_contact);
      if (photo === null) return { refus: `« photo_contact » = ${FORMES_IMAGE} ("" la retire).` };
      c.contact.avatar = photo;
    }
  }
  return { conversation: c };
}

/** Un élément du chat BLUSH tel que Claude le lit. */
function elementBlushPourMcp(it: ConvItem): ElementMcp {
  const commun = { ...(it.overlay ? { incrustation: it.overlay } : {}), ...(it.cut ? { coupure: true } : {}) };
  if (it.kind === "date") return { type: "date", texte: it.text, ...commun };
  const heure = it.time ? { heure: it.time } : {};
  if (it.typing) return { type: "ecrit", ...heure, ...commun };
  if (it.suggestion) return { type: "meilleure_reponse", lignes: it.suggestion.lines, ...(it.suggestion.why ? { pourquoi: it.suggestion.why } : {}), ...heure, ...commun };
  if (it.cited) return { type: "citation", texte: it.text, de: it.cited.side === "out" ? "moi" : "autre", ...(it.cited.caption ? { legende: it.cited.caption } : {}), ...heure, ...commun };
  const cote = it.side === "out" ? ("envoye" as const) : ("recu" as const);
  const md = it.media;
  if (md?.type === "voice") return { type: "vocal", cote, duree: md.seconds, ...heure, ...commun };
  if (md?.type === "photo" || md?.type === "video") return { type: "photo", cote, ...(md.image ? { image: PREFIXE_IMAGE + md.image } : {}), ...heure, ...commun };
  return { type: "message", cote, texte: it.text, ...heure, ...commun };
}

/** La conversation telle que Claude la lit : sans id, sans la photo (seulement si elle existe). */
export function conversationPourMcp(c: Conversation) {
  if (c.interface === "blush") {
    const b = c.blush ?? REGLAGES_BLUSH_DEFAUT;
    return {
      interface: "blush" as const,
      contact: { nom: c.contact.name },
      verdict: b.verdict,
      niveau: b.niveau,
      bulles: b.bulles,
      idees: b.idees,
      barreEtat: { heure: c.status.time, batterie: c.status.battery, economieEnergie: c.status.lowPower, reseau: c.status.signal },
      defilement: c.scroll,
      messages: c.items.map(elementBlushPourMcp),
    };
  }
  return {
    interface: "instagram" as const,
    theme: THEME_MCP[c.themeId],
    langue: c.locale,
    contact: {
      nom: c.contact.name,
      pseudo: c.contact.username,
      photo: idImage(c.contact.avatar) ? PREFIXE_IMAGE + c.contact.avatar : c.contact.avatar ? "posée à l'écran" : "aucune",
    },
    debutDuFil: c.threadStart === true,
    barreEtat: { heure: c.status.time, batterie: c.status.battery, economieEnergie: c.status.lowPower, reseau: c.status.signal },
    defilement: c.scroll,
    messages: c.items.map((it): ElementMcp => {
      if (it.kind === "date") return { type: "date", texte: it.text, ...(it.overlay ? { incrustation: it.overlay } : {}), ...(it.cut ? { coupure: true } : {}) };
      const r = it.reply;
      const md = it.media;
      return {
        type: md ? MEDIA_MCP[md.type] : "message",
        cote: it.side === "out" ? "envoye" : "recu",
        ...(md ? {} : { texte: it.text }),
        ...(md?.type === "voice" ? { duree: md.seconds } : {}),
        ...(md && "image" in md && md.image ? { image: PREFIXE_IMAGE + md.image } : {}),
        ...(md && "account" in md ? { compte: md.account } : {}),
        ...(md && "avatar" in md && md.avatar ? { photo_compte: PREFIXE_IMAGE + md.avatar } : {}),
        ...(md && "verified" in md && md.verified ? { certifie: true } : {}),
        ...(md && "caption" in md && md.caption ? { legende: md.caption } : {}),
        ...(it.edited ? { modifie: true } : {}),
        ...(it.reaction ? { reaction: it.reaction } : {}),
        ...(r
          ? {
              reponse: {
                cote: r.side === "out" ? ("envoye" as const) : ("recu" as const),
                ...(r.kind ? { type: CITATION_MCP[r.kind] } : { texte: r.text }),
                ...(r.kind === "voice" ? { duree: r.seconds } : {}),
              },
            }
          : {}),
        ...(it.story
          ? {
              story: {
                ...(it.story.closeFriends ? { amis_proches: true } : {}),
                ...(it.story.unavailable ? { indisponible: true } : {}),
                ...(it.story.image ? { image: PREFIXE_IMAGE + it.story.image } : {}),
              },
            }
          : {}),
        ...(it.longPress ? { appui_long: true } : {}),
        ...(it.time ? { heure: it.time } : {}),
        ...(it.overlay ? { incrustation: it.overlay } : {}),
        ...(it.cut ? { coupure: true } : {}),
      };
    }),
  };
}
