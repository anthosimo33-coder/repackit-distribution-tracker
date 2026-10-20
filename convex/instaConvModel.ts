/**
 * GÉNÉRATEUR DE CONVERSATIONS — le MODÈLE (données seules, sans DOM).
 *
 * Deux écrans dessinent la même forme : un DM Instagram iOS (défaut) et le chat
 * de l'app BLUSH (askblush.com, `interface: "blush"`), où une personne se confie
 * à BLUSH. Vit dans `convex/` (règle A6) : l'écran (via `lib/insta-conv.ts` et
 * `lib/blush-conv.ts`), la table `instaConversations` et le serveur MCP lisent
 * et écrivent la MÊME forme. Le rendu (cotes, thèmes, groupes) reste dans `lib/`.
 */

export type Side = "in" | "out";

export type ConvMessage = {
  id: string;
  kind: "message";
  side: Side;
  text: string;
  /** Label « Modifié » au-dessus de la bulle (casse le groupe). */
  edited?: boolean;
  /** Emoji de réaction posé sous la bulle (termine le groupe). */
  reaction?: string;
  /** Fin de slide après ce message (export en série). */
  cut?: boolean;
  /** Réponse citée : le message auquel celui-ci répond, qui l'avait écrit, et sa nature. */
  reply?: ConvReply;
  /** Réponse à une story (en-tête au-dessus du message, miniature de la story si `image`). */
  story?: { closeFriends?: boolean; unavailable?: boolean; image?: string };
  /** Contenu à la place du texte : vocal, éphémère déjà vu, photo/vidéo, reel, publication, story partagée. */
  media?: ConvMedia;
  /** L'écran montre l'APPUI LONG sur ce message (réactions et menu) — un seul par écran. */
  longPress?: boolean;
  /**
   * Heure du message : en tête du menu d'appui long (Instagram), sous son groupe
   * de bulles (BLUSH). À défaut : celle d'avant (séparateur, groupe précédent),
   * ou l'heure de la barre d'état.
   */
  time?: string;
  /** Texte incrusté en haut de la capture (style TikTok) : celui de l'élément qui TERMINE la slide. */
  overlay?: string;
  /** Chat BLUSH : « BLUSH écrit » — sa bulle aux trois perles, à la place d'un message (côté BLUSH). */
  typing?: boolean;
  /** Chat BLUSH : la carte « Ta meilleure réponse » (les messages à lui envoyer, une bulle chacun, et pourquoi). */
  suggestion?: { lines: string[]; why?: string };
  /** Chat BLUSH : un vrai message de leur conv, cité par BLUSH dans sa bulle (`side` : qui l'avait écrit ; `caption` dessous). */
  cited?: { side: Side; caption?: string };
};

export type ConvReply = { side: Side; text: string; kind?: "photo" | "video" | "voice"; seconds?: number };

/**
 * Les images (`image`, `avatar`) sont des IDENTIFIANTS de la table
 * `instaConvImages` (fichier dans le storage du projet), jamais des URL : la
 * conversation reste légère (le journal MCP en garde plusieurs copies) et une
 * image d'un autre projet ne se résout pas.
 */
export type ConvMedia =
  | { type: "voice"; seconds: number }
  | { type: "photoOnce" }
  | { type: "videoOnce" }
  /** Photo ou vidéo envoyée dans la conversation (▶ en haut à droite pour une vidéo). */
  | { type: "photo" | "video"; image?: string }
  /** Reel ou publication partagés : carte avec le compte en tête, légende facultative. */
  | { type: "reel" | "post"; image?: string; avatar?: string; account: string; verified?: boolean; caption?: string }
  /** Story partagée (« Sent @compte's story ») : carte 9:16 derrière une barre. */
  | { type: "storyShare"; image?: string; avatar?: string; account: string; verified?: boolean };

export type ConvMediaType = ConvMedia["type"];

/** Médias à carte : ni groupés avec les messages voisins, ni « jumbo ». */
export const CARD_MEDIA: readonly ConvMediaType[] = ["reel", "post", "storyShare"];
export const MAX_CAPTION = 300;

export type ConvDate = { id: string; kind: "date"; text: string; cut?: boolean; overlay?: string };

export type ConvItem = ConvMessage | ConvDate;

export type ConvLocale = "fr" | "en";

export const THEME_IDS = ["dark", "hearts", "ocean"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** L'écran dessiné : un DM Instagram iOS, ou le chat de l'app BLUSH. */
export const INTERFACES = ["instagram", "blush"] as const;
export type ConvInterface = (typeof INTERFACES)[number];

/** Les quatre verdicts de BLUSH, en badge sur l'initiale de l'autre (🤏 à deux doigts · 🔥 partant · 🤔 hésite · 🧊 s'éloigne). */
export const VERDICTS_BLUSH = ["🤏", "🔥", "🤔", "🧊"] as const;
export type VerdictBlush = (typeof VERDICTS_BLUSH)[number];

/** L'en-tête et la barre de saisie du chat BLUSH. */
export type ReglagesBlush = {
  /** Le badge sur l'initiale de l'autre (en haut à droite). */
  verdict: VerdictBlush;
  /** L'anneau vert autour de son initiale : 1 à 4 quarts (de « On se parle » à « On est ensemble »). */
  niveau: number;
  /** Le compteur de bulles, à côté du bouton du compte (rose sous 3, gris à 0). */
  bulles: number;
  /** Les questions toutes prêtes au-dessus du champ (rien pendant que BLUSH écrit). */
  idees: string[];
};

export const MAX_IDEES = 4;
export const MAX_LIGNES_REPONSE = 4;
export const MAX_POURQUOI = 300;
export const MAX_INCRUSTATION = 160;

/**
 * Version de la FORME du JSON que ce code écrit (2 : le chat BLUSH, oct. 2026 ;
 * absente = 1, avant elle). Un écran chargé AVANT une mise à jour relit un
 * brouillon sans connaître ses nouveaux champs et le réenregistre aussitôt,
 * amputé : vu le 20/10, un chat BLUSH réécrit deux fois en DM Instagram par un
 * onglet resté ouvert. Le serveur refuse donc d'enregistrer, depuis l'écran, une
 * forme plus ancienne que celle qu'il garde (`formeRefusee`). À monter d'un cran
 * avec chaque champ qu'un ancien écran perdrait.
 */
export const VERSION_FORME = 2;

/** La version de forme d'un `data` stocké ou envoyé (absente ou illisible : 1). */
export function versionDeData(data: string): number {
  try {
    const v = (JSON.parse(data) as { version?: unknown } | null)?.version;
    return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
  } catch {
    return 1;
  }
}

/** Vrai si écrire `nouveau` par-dessus `stocke` ferait perdre une forme plus récente (un écran périmé). */
export function formeRefusee(stocke: string, nouveau: string): boolean {
  return versionDeData(nouveau) < versionDeData(stocke);
}

export type Conversation = {
  /** La forme écrite par le code qui a enregistré (voir `VERSION_FORME`). */
  version?: number;
  /** Absent : Instagram (les conversations d'avant le chat BLUSH n'ont pas ce champ). */
  interface?: "blush";
  /** Chat BLUSH : l'en-tête et la barre de saisie (gardés si l'on repasse à Instagram). */
  blush?: ReglagesBlush;
  themeId: ThemeId;
  locale: ConvLocale;
  /** `avatar` : photo en data URL (posée à l'écran), id d'une image du projet (posée par Claude), ou rien. */
  contact: { name: string; username: string; avatar: string | null };
  status: { time: string; battery: number; lowPower: boolean; signal: number };
  /** Décalage de défilement, en pt : 0 = dernier message posé au-dessus de la saisie. */
  scroll: number;
  /**
   * Le fil COMMENCE au premier élément : Instagram montre alors, au-dessus, la
   * fiche du contact (grande photo, nom, « View profile »), visible si le fil
   * est court. Faux pour une capture prise au milieu d'un fil.
   */
  threadStart?: boolean;
  items: ConvItem[];
};

/** Le texte incrusté d'une capture (ou d'une slide) : celui de l'élément qui la termine. */
export function incrustationDe(items: readonly ConvItem[]): string | null {
  return items[items.length - 1]?.overlay?.trim() || null;
}

/**
 * Paramètre du lien « télécharger » que rend le MCP (`…/conversations?c=<id>&exporter=1`) :
 * l'écran dessine la conversation et lance l'export tout seul (PNG, ou ZIP pour une série).
 */
export const PARAM_EXPORT = "exporter";

/** Bornes : un fil de capture tient en quelques dizaines de bulles. */
export const MAX_ITEMS = 120;
export const MAX_TEXT = 1_000;
export const MAX_TITRE = 80;

let seq = 0;
export function newItemId(): string {
  seq += 1;
  return `i${Date.now().toString(36)}${seq}`;
}

export function defaultConversation(): Conversation {
  const m = (side: Side, text: string, extra: Partial<ConvMessage> = {}): ConvMessage => ({
    id: newItemId(),
    kind: "message",
    side,
    text,
    ...extra,
  });
  return {
    version: VERSION_FORME,
    themeId: "dark",
    locale: "fr",
    contact: { name: "Lucas", username: "lucas.mrtn", avatar: null },
    status: { time: "23:47", battery: 62, lowPower: false, signal: 3 },
    scroll: 0,
    threadStart: true,
    items: [
      // Une heure du jour s'affiche seule (« 14:35 » sur capture) ; « YESTERDAY AT… », « MON… » pour les autres jours.
      { id: newItemId(), kind: "date", text: "23:12" },
      m("out", "tu peux m'expliquer pk t'étais en ligne à 3h ?"), // i18n-exempt: donnée de la capture, pas de l'interface
      m("in", "jdormais"),
      m("out", "arrête de mentir je l'ai vu"), // i18n-exempt: donnée de la capture, pas de l'interface
      m("out", "t'avais dit que c'était fini avec elle"), // i18n-exempt: donnée de la capture, pas de l'interface
      m("in", "c'est pas ce que tu crois", { reaction: "😂" }),
      m("in", "laisse moi t'expliquer stp"),
      m("out", "c'est trop tard", { edited: true }),
    ],
  };
}

export const REGLAGES_BLUSH_DEFAUT: ReglagesBlush = { verdict: "🧊", niveau: 2, bulles: 37, idees: [] };

/** L'exemple d'un chat BLUSH : elle raconte, BLUSH répond en bulles courtes, puis se remet à écrire. */
export function defaultBlushConversation(): Conversation {
  const m = (side: Side, text: string, extra: Partial<ConvMessage> = {}): ConvMessage => ({
    id: newItemId(),
    kind: "message",
    side,
    text,
    ...extra,
  });
  return {
    version: VERSION_FORME,
    interface: "blush",
    blush: { ...REGLAGES_BLUSH_DEFAUT, idees: [] },
    themeId: "dark",
    locale: "fr",
    contact: { name: "Théo", username: "", avatar: null }, // i18n-exempt: donnée de la capture, pas de l'interface
    status: { time: "21:47", battery: 54, lowPower: false, signal: 3 },
    scroll: 0,
    items: [
      // Le jour en gras, l'heure à côté : comme les séparateurs de l'app.
      { id: newItemId(), kind: "date", text: "Aujourd’hui 21:40" }, // i18n-exempt: donnée de la capture, pas de l'interface
      m("out", "au début il me répondait en 10 min même au taf"), // i18n-exempt: donnée de la capture, pas de l'interface
      m("in", "10 min au taf, c’est de l’amour avec une pause café 😭"), // i18n-exempt: donnée de la capture, pas de l'interface
      m("in", "et maintenant ?", { time: "21:41" }), // i18n-exempt: donnée de la capture, pas de l'interface
      m("out", "6h pour un « mdr »", { time: "21:46" }), // i18n-exempt: donnée de la capture, pas de l'interface
      m("in", "", { typing: true }),
    ],
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const texteCourt = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Les réglages du chat BLUSH, relus sans faire confiance au stockage (repli : ceux par défaut). */
export function nettoyerReglagesBlush(raw: unknown): ReglagesBlush {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ReglagesBlush, unknown>>;
  const verdict = (VERDICTS_BLUSH as readonly unknown[]).includes(r.verdict) ? (r.verdict as VerdictBlush) : REGLAGES_BLUSH_DEFAUT.verdict;
  const idees = Array.isArray(r.idees) ? r.idees.map((q) => texteCourt(q, 60)).filter(Boolean).slice(0, MAX_IDEES) : [];
  return {
    verdict,
    niveau: clamp(Math.round(Number(r.niveau) || REGLAGES_BLUSH_DEFAUT.niveau), 1, 4),
    bulles: clamp(Math.round(Number(r.bulles ?? REGLAGES_BLUSH_DEFAUT.bulles) || 0), 0, 9999),
    idees,
  };
}

/** Un identifiant d'image (table `instaConvImages`) plausible, ou rien. */
export function idImage(v: unknown): string | undefined {
  return typeof v === "string" && /^[a-z0-9]{8,64}$/i.test(v) ? v : undefined;
}

/** Nom de compte Instagram : sans @, lettres, chiffres, points et soulignés, 30 caractères. */
export function nettoyerCompte(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/^@+/, "").replace(/[^A-Za-z0-9._]/g, "").slice(0, 30) : "";
}

/** Toutes les images qu'une conversation référence (sans doublon), photo du contact comprise. */
export function imagesDeConversation(c: Pick<Conversation, "items"> & { contact?: Conversation["contact"] }): string[] {
  const ids = new Set<string>();
  const photo = idImage(c.contact?.avatar);
  if (photo) ids.add(photo);
  for (const it of c.items) {
    if (it.kind !== "message") continue;
    if (it.story?.image) ids.add(it.story.image);
    const md = it.media;
    if (md && "image" in md && md.image) ids.add(md.image);
    if (md && "avatar" in md && md.avatar) ids.add(md.avatar);
  }
  return [...ids];
}

/** Les champs facultatifs d'un message, relus sans faire confiance au stockage. */
function nettoyerMessage(it: ConvMessage): ConvMessage {
  const m: ConvMessage = { id: it.id, kind: "message", side: it.side, text: it.text };
  if (it.edited === true) m.edited = true;
  if (typeof it.reaction === "string" && it.reaction) m.reaction = it.reaction;
  if (it.cut === true) m.cut = true;
  if (it.longPress === true) m.longPress = true;
  if (typeof it.time === "string" && it.time.trim()) m.time = it.time.trim().slice(0, 8);
  const overlay = texteCourt(it.overlay, MAX_INCRUSTATION);
  if (overlay) m.overlay = overlay;
  // Chat BLUSH : écrire, la meilleure réponse et une citation sont des bulles de BLUSH.
  if (it.typing === true && it.side === "in") m.typing = true;
  const sug = it.suggestion;
  if (sug && typeof sug === "object" && Array.isArray(sug.lines)) {
    const lines = sug.lines.map((l) => texteCourt(l, MAX_TEXT)).filter(Boolean).slice(0, MAX_LIGNES_REPONSE);
    const why = texteCourt(sug.why, MAX_POURQUOI);
    if (lines.length) m.suggestion = { lines, ...(why ? { why } : {}) };
  }
  const cited = it.cited;
  if (cited && typeof cited === "object" && (cited.side === "in" || cited.side === "out")) {
    const caption = texteCourt(cited.caption, 60);
    m.cited = { side: cited.side, ...(caption ? { caption } : {}) };
  }
  const r = it.reply;
  if (r && (r.side === "in" || r.side === "out")) {
    const kind = r.kind === "photo" || r.kind === "video" || r.kind === "voice" ? r.kind : undefined;
    const text = typeof r.text === "string" ? r.text : "";
    if (kind || text.trim()) {
      m.reply = { side: r.side, text, ...(kind ? { kind } : {}), ...(kind === "voice" ? { seconds: clamp(Math.round(Number(r.seconds) || 1), 1, 600) } : {}) };
    }
  }
  if (it.story && typeof it.story === "object") {
    const image = idImage(it.story.image);
    m.story = {
      ...(it.story.closeFriends === true ? { closeFriends: true } : {}),
      ...(it.story.unavailable === true ? { unavailable: true } : {}),
      ...(image ? { image } : {}),
    };
  }
  const md = it.media as (Partial<Record<string, unknown>> & { type?: unknown }) | undefined;
  const image = idImage(md?.image);
  const avatar = idImage(md?.avatar);
  if (md?.type === "voice") m.media = { type: "voice", seconds: clamp(Math.round(Number(md.seconds) || 1), 1, 600) };
  else if (md?.type === "photoOnce" || md?.type === "videoOnce") m.media = { type: md.type };
  else if (md?.type === "photo" || md?.type === "video") m.media = { type: md.type, ...(image ? { image } : {}) };
  else if (md?.type === "reel" || md?.type === "post" || md?.type === "storyShare") {
    const caption = typeof md.caption === "string" ? md.caption.trim().slice(0, MAX_CAPTION) : "";
    const commun = {
      ...(image ? { image } : {}),
      ...(avatar ? { avatar } : {}),
      account: nettoyerCompte(md.account),
      ...(md.verified === true ? { verified: true } : {}),
    };
    m.media = md.type === "storyShare" ? { type: "storyShare", ...commun } : { type: md.type, ...commun, ...(caption ? { caption } : {}) };
  }
  return m;
}

/** Relit une conversation stockée ; null si elle est illisible ou d'une autre forme. */
export function parseConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<Conversation>;
  if (!c.themeId || !(THEME_IDS as readonly string[]).includes(c.themeId)) return null;
  if (c.locale !== "fr" && c.locale !== "en") return null;
  if (!c.contact || !c.status || !Array.isArray(c.items)) return null;
  const items = c.items
    .filter(
      (it): it is ConvItem =>
        !!it &&
        typeof it.id === "string" &&
        typeof it.text === "string" &&
        (it.kind === "date" || (it.kind === "message" && (it.side === "in" || it.side === "out"))),
    )
    .slice(0, MAX_ITEMS)
    .map((it): ConvItem => {
      if (it.kind === "message") return nettoyerMessage(it);
      const overlay = texteCourt(it.overlay, MAX_INCRUSTATION);
      return { id: it.id, kind: "date", text: it.text, ...(it.cut === true ? { cut: true } : {}), ...(overlay ? { overlay } : {}) };
    });
  return {
    // Relue par ce code, elle a sa forme : c'est elle qui repartira à l'enregistrement.
    version: VERSION_FORME,
    ...(c.interface === "blush" ? { interface: "blush" as const } : {}),
    ...(c.blush !== undefined || c.interface === "blush" ? { blush: nettoyerReglagesBlush(c.blush) } : {}),
    themeId: c.themeId,
    locale: c.locale,
    contact: {
      name: String(c.contact.name ?? ""),
      username: String(c.contact.username ?? ""),
      avatar: typeof c.contact.avatar === "string" ? c.contact.avatar : null,
    },
    status: {
      time: String(c.status.time ?? ""),
      battery: clamp(Number(c.status.battery) || 0, 0, 100),
      lowPower: !!c.status.lowPower,
      signal: clamp(Math.round(Number(c.status.signal) || 0), 0, 4),
    },
    scroll: Number(c.scroll) || 0,
    ...(c.threadStart === true ? { threadStart: true } : {}),
    items,
  };
}

/** `data` d'une ligne de `instaConversations` → conversation (repli : l'exemple). */
export function conversationDeData(data: string): Conversation {
  try {
    return parseConversation(JSON.parse(data)) ?? defaultConversation();
  } catch {
    return defaultConversation();
  }
}
