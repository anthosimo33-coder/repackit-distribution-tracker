/**
 * LE CHAT BLUSH (askblush.com, écran /app) — ses cotes et son plan de rendu, sans DOM.
 *
 * La capture est REDESSINÉE comme celle d'Instagram (components/admin/insta-conv/
 * BlushScreen) : un iPhone 11 (414×896 pt, ×2 à l'export), Safari, la barre
 * d'état iOS au-dessus de l'app. Les cotes viennent du front BLUSH lui-même
 * (src/app/app/HomeScreen.tsx, accueil/bulles.tsx, Barres.tsx, Composer.tsx)
 * et ont été RELEVÉES dans son DOM à 414 px de large (oct. 2026) : un écart ici
 * se voit à côté de l'app.
 */
import type { ConvDate, ConvItem, ConvMessage, Side } from "../convex/instaConvModel";

export const BLUSH = {
  /** Barre d'état iOS (iPhone 11), peinte à la couleur du thème de la page (#F4F2ED). */
  statusBar: 44,
  /** L'en-tête de l'app, sous la barre d'état : BLUSH au centre, l'autre à droite. */
  header: 140,
  /** Le fil : marges de la section, écart entre deux lignes (jour, groupe), entre deux bulles d'un groupe. */
  thread: { padX: 18, padTop: 32, padBottom: 16, rowGap: 16, bubbleGap: 3 },
  /** Barre de saisie : filet de 1 pt en haut, `pb` = la zone de l'indicateur d'accueil (34 pt), les idées de questions au-dessus du champ. */
  composer: { border: 1, padTop: 12, padX: 18, padBottom: 34, chips: 37, chipsGap: 10, row: 44 },
  homeIndicator: { width: 134, height: 5, bottom: 8 },
  /** Texte incrusté : sous l'en-tête (pastille askblush.com comprise). */
  overlayTop: 200,
  colors: {
    paper: "#F4F2ED",
    ink: "#121214",
    grey: "#6B6862",
    muted: "#8A8780",
    line: "#E6E3DC",
    plaque: "#F1EFEA",
    segment: "#E9E6DF",
    disabled: "#D9D6CF",
    toiInk: "#1A66DB",
    elle: "#FF4F9A",
    elleInk: "#C81D6B",
    vrai: "#12C08A",
    vraiInk: "#087A56",
    bubbleHer: "#EFEEEA",
  },
} as const;

/** Hauteur de la barre de saisie (sans ou avec la rangée d'idées de questions). */
export function composerHeight(idees: boolean): number {
  const C = BLUSH.composer;
  return C.border + C.padTop + (idees ? C.chips + C.chipsGap : 0) + C.row + C.padBottom;
}

/** Hauteur visible du fil, entre l'en-tête et la barre de saisie (découpe en slides). */
export function visibleHeight(idees: boolean): number {
  return 896 - BLUSH.statusBar - BLUSH.header - composerHeight(idees) - BLUSH.thread.padBottom;
}

// ── Plan de rendu : jours et groupes ─────────────────────────────────────────

/** La place d'une bulle dans le groupe de son expéditeur : ses coins en dépendent (comme l'app). */
export type PlaceBulle = "single" | "first" | "middle" | "last";

export const placeDansLeGroupe = (i: number, n: number): PlaceBulle => (n === 1 ? "single" : i === 0 ? "first" : i === n - 1 ? "last" : "middle");

export type BulleDuGroupe = { item: ConvMessage; index: number; place: PlaceBulle };

export type LigneBlush =
  | { kind: "day"; item: ConvDate; index: number; jour: string; heure: string | null }
  | {
      kind: "group";
      side: Side;
      bulles: BulleDuGroupe[];
      /** « BLUSH écrit » en bas du groupe, à la place de l'heure. */
      typing: { item: ConvMessage; index: number } | null;
      /** L'heure sous le groupe (celle de son dernier message). */
      heure: string;
    };

const HEURE = /^(.*?)\s*(\d{1,2}[:h]\d{2})$/;

/** « Aujourd’hui 21:40 » → le jour (en gras dans l'app) et l'heure ; sans heure, tout le texte est le jour. */
export function decouperSeparateur(text: string): { jour: string; heure: string | null } {
  const t = text.trim();
  const m = HEURE.exec(t);
  return m ? { jour: m[1], heure: m[2].replace("h", ":") } : { jour: t, heure: null };
}

/**
 * Les lignes du chat : chaque séparateur, puis les messages consécutifs d'un même
 * côté en un groupe (comme `rowsOf` de l'app : un séparateur coupe le groupe).
 * L'heure d'un groupe : celle de son dernier message qui en a une, sinon la
 * dernière connue (séparateur, groupe d'avant), sinon celle de la barre d'état.
 * « BLUSH écrit » ne compte qu'en DERNIER élément.
 */
export function planBlush(items: readonly ConvItem[], heureEcran: string): LigneBlush[] {
  const lignes: LigneBlush[] = [];
  items.forEach((item, index) => {
    if (item.kind === "date") {
      lignes.push({ kind: "day", item, index, ...decouperSeparateur(item.text) });
      return;
    }
    // « BLUSH écrit » ne se voit qu'en bas du fil : dans l'app, la réponse le remplace.
    // Une série peut donc finir une slide sur lui, la suivante montre la réponse.
    if (item.typing && index < items.length - 1) return;
    const last = lignes[lignes.length - 1];
    const groupe =
      last?.kind === "group" && last.side === item.side && !last.typing
        ? last
        : (lignes[lignes.push({ kind: "group", side: item.side, bulles: [], typing: null, heure: "" }) - 1] as Extract<LigneBlush, { kind: "group" }>);
    if (item.typing && item.side === "in") groupe.typing = { item, index };
    else groupe.bulles.push({ item, index, place: "single" });
  });
  // Les heures et les places, une fois les groupes faits.
  let heure: string | null = null;
  for (const l of lignes) {
    if (l.kind === "day") {
      if (l.heure) heure = l.heure;
      continue;
    }
    const explicite = [...l.bulles].reverse().find((b) => b.item.time)?.item.time ?? l.typing?.item.time;
    l.heure = explicite ?? heure ?? heureEcran;
    heure = l.heure;
    l.bulles.forEach((b, i) => (b.place = placeDansLeGroupe(i, l.bulles.length)));
  }
  return lignes;
}

/** Le fil se termine sur « BLUSH écrit » : l'app range alors les idées de questions et anime le logo du haut. */
export function blushEcrit(items: readonly ConvItem[]): boolean {
  const last = items[items.length - 1];
  return last?.kind === "message" && !!last.typing;
}

// ── Vocal de BLUSH : 28 barres, comme `ondeDe` de l'app ─────────────────────

export const BARRES_VOCAL = 28;

/** Hauteurs (0,15 à 1) DÉTERMINISTES : même message → même onde, à l'écran comme à l'export. */
export function ondeBlush(seed: string, n = BARRES_VOCAL): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  return Array.from({ length: n }, () => (rand() < 0.12 ? 0.15 : Math.round((0.3 + 0.7 * rand()) * 100) / 100));
}

export function formatClock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** L'initiale de l'autre, dans son rond rose (`initialeDe` de l'app : « ? » sans nom). */
export const initialeDe = (nom: string): string => [...nom.trim()][0]?.toUpperCase() ?? "?";
