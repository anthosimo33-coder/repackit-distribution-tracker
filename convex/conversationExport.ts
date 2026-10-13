/**
 * EXPORT WHATSAPP d'une brique « conversation » — lecture et personnalisation.
 *
 * La créatrice télécharge un export `.txt` fabriqué d'avance et l'importe dans
 * l'app analysée (BLUSH). Deux choses ne peuvent pas rester figées dans le
 * fichier déposé par l'équipe :
 *
 *  1. LES DATES. L'app compare les messages au jour de l'IMPORT (« il ne t'a pas
 *     écrit depuis 2 jours », chiffres des 21 derniers jours). Un fichier déposé
 *     le 13 et importé le 5 du mois suivant raconterait une autre histoire. Au
 *     téléchargement, toutes les dates glissent du même nombre de jours pour que
 *     le dernier message tombe `gapDays` jours avant aujourd'hui — l'écart choisi
 *     au dépôt. Les heures ne bougent pas (05:52 reste 05:52).
 *  2. LE PRÉNOM. L'app lit le prénom de l'utilisatrice dans l'export et le
 *     rapport vocal commence par lui. Le nom de « elle » (`fromName`) devient le
 *     prénom de la créatrice, dans les en-têtes ET dans le texte des messages.
 *
 * Le format reconnu est celui que lit BLUSH (regex `ENTETE` de
 * blush-prompts/lib/conv.ts) : iOS « [12/09/2026 10:45:53] », « [12/09/2026,
 * 10:45:53] », « [9/12/26, 10:45:53 AM] » ; Android « 12/09/2026 10:45 - »,
 * « 12/09/2026 à 10:45 - », « 12.09.26, 10:45 - ». Tout ce qui n'est pas une
 * ligne d'en-tête (suite d'un message sur plusieurs lignes) est recopié tel
 * quel, au prénom près. Les fins de ligne et les marques de sens (U+200E) que
 * WhatsApp sème dans ses exports sont conservées à l'octet près.
 *
 * Module PUR (aucun import `_generated`) : partagé par l'action de
 * téléchargement, l'écran de dépôt (lecture des participants) et les tests
 * `lib/`. Garde : lib/conversation-export.test.ts.
 */

/** Marques de sens d'écriture que WhatsApp place autour des en-têtes et des noms. */
const MARKS = "[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]*";
const SP = "[ \\u00a0\\u202f]";

/**
 * Une ligne d'en-tête. Groupes : 1 marques, 2 « [ » éventuel, 3 a, 4 séparateur,
 * 5 b, 6 séparateur, 7 c (la date en trois nombres), 8 le reste de l'en-tête
 * (heure, AM/PM, « ] » ou « - »), 9 marques, 10 le nom, 11 le texte.
 * Le nom va jusqu'au premier « : » suivi d'une espace, comme chez BLUSH.
 */
const HEADER = new RegExp(
  `^(${MARKS})(\\[?)(\\d{1,4})([./-])(\\d{1,2})([./-])(\\d{2,4})` +
    `(,?(?:${SP}(?:à|at))?${SP}\\d{1,2}[:.]\\d{2}(?:[:.]\\d{2})?(?:${SP}?[AaPp]\\.?[Mm]\\.?)?(?:\\]${SP}|${SP}-${SP}))` +
    `(${MARKS})(.+?): (.*)$`,
  "s",
);

/** Où est le jour dans les dates : en premier (12/09/2026) ou en second (9/12/26, téléphones américains). */
export type DateOrder = "dmy" | "mdy";

type HeaderMatch = {
  marks: string;
  bracket: string;
  a: string;
  sep1: string;
  b: string;
  sep2: string;
  c: string;
  rest: string;
  nameMarks: string;
  name: string;
  text: string;
};

function matchHeader(line: string): HeaderMatch | null {
  const m = HEADER.exec(line);
  if (!m) return null;
  return {
    marks: m[1]!,
    bracket: m[2]!,
    a: m[3]!,
    sep1: m[4]!,
    b: m[5]!,
    sep2: m[6]!,
    c: m[7]!,
    rest: m[8]!,
    nameMarks: m[9]!,
    name: m[10]!,
    text: m[11]!,
  };
}

/** Coupe en lignes en GARDANT les fins de ligne : `parts[2k]` = ligne, `parts[2k+1]` = sa fin. */
function splitKeepingEol(text: string): string[] {
  return text.split(/(\r\n|\r|\n)/);
}

/** Même règle que BLUSH : un premier nombre > 12 est un jour, un second aussi ; sinon AM/PM ⇒ mois d'abord. */
function orderOf(headers: readonly HeaderMatch[]): DateOrder {
  let ampm = false;
  for (const h of headers) {
    if (h.a.length > 2) continue; // année d'abord (2026-09-12) : sans ambiguïté
    if (+h.a > 12) return "dmy";
    if (+h.b > 12) return "mdy";
    ampm ||= /[AaPp]\.?[Mm]/.test(h.rest);
  }
  return ampm ? "mdy" : "dmy";
}

type Ymd = { y: number; m: number; d: number };

function ymdOf(h: HeaderMatch, order: DateOrder): Ymd {
  if (h.a.length > 2) return { y: +h.a, m: +h.b, d: +h.c };
  const year = h.c.length === 2 ? 2000 + +h.c : +h.c;
  return order === "dmy"
    ? { y: year, m: +h.b, d: +h.a }
    : { y: year, m: +h.a, d: +h.b };
}

const DAY_MS = 86_400_000;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Jour « AAAA-MM-JJ » → numéro de jour (UTC, sans heure : aucune DST possible). */
function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / DAY_MS);
}

function dayKeyOf(ymd: Ymd): string {
  return `${ymd.y}-${pad2(ymd.m)}-${pad2(ymd.d)}`;
}

/** Nombre de jours de `from` à `to` (positif si `to` est après). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/**
 * Le fichier écrit-il les jours et les mois sous 10 avec un zéro (« 02/09 ») ou
 * sans (« 9/2/26 ») ? Lu sur le fichier entier : un « 30 » ne dit rien, un « 9 »
 * ou un « 09 » tranche. Sans indice, le zéro des téléphones européens, aucun
 * zéro pour les dates américaines.
 */
type Padding = { day: boolean; month: boolean };

function paddingOf(headers: readonly HeaderMatch[], order: DateOrder): Padding {
  let day: boolean | null = null;
  let month: boolean | null = null;
  for (const h of headers) {
    const yearFirst = h.a.length > 2;
    const [dayTok, monthTok] = yearFirst ? [h.c, h.b] : order === "dmy" ? [h.a, h.b] : [h.b, h.a];
    if (day === null && +dayTok < 10) day = dayTok.length === 2;
    if (month === null && +monthTok < 10) month = monthTok.length === 2;
    if (day !== null && month !== null) break;
  }
  const fallback = order === "dmy";
  return { day: day ?? fallback, month: month ?? fallback };
}

function shiftedHeaderDate(h: HeaderMatch, order: DateOrder, padding: Padding, shiftDays: number): string {
  const ymd = ymdOf(h, order);
  const t = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d) + shiftDays * DAY_MS);
  const y = t.getUTCFullYear();
  const m = padding.month ? pad2(t.getUTCMonth() + 1) : String(t.getUTCMonth() + 1);
  const d = padding.day ? pad2(t.getUTCDate()) : String(t.getUTCDate());
  if (h.a.length > 2) return `${y}${h.sep1}${m}${h.sep2}${d}`;
  const year = h.c.length === 2 ? pad2(y % 100) : String(y);
  return order === "dmy"
    ? `${d}${h.sep1}${m}${h.sep2}${year}`
    : `${m}${h.sep1}${d}${h.sep2}${year}`;
}

// ─── Lecture (écran de dépôt) ────────────────────────────────────────────────

export type ExportParticipant = { name: string; messages: number };

export type ExportInspection = {
  /** Lignes d'en-tête lues (= messages, médias compris). */
  messages: number;
  /** Auteurs, du plus bavard au moins bavard. */
  participants: ExportParticipant[];
  /** Jour du premier et du dernier message, « AAAA-MM-JJ » (null : aucun en-tête reconnu). */
  firstDay: string | null;
  lastDay: string | null;
  order: DateOrder;
};

/** Ce que l'écran de dépôt montre d'un export : combien de messages, qui écrit, de quand à quand. */
export function inspectExport(text: string): ExportInspection {
  const headers: HeaderMatch[] = [];
  for (const line of splitKeepingEol(text).filter((_, i) => i % 2 === 0)) {
    const h = matchHeader(line);
    if (h) headers.push(h);
  }
  const order = orderOf(headers);
  const counts = new Map<string, number>();
  let first: number | null = null;
  let last: number | null = null;
  for (const h of headers) {
    const name = h.name.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    const n = dayNumber(dayKeyOf(ymdOf(h, order)));
    if (first === null || n < first) first = n;
    if (last === null || n > last) last = n;
  }
  const keyOfNumber = (n: number) => {
    const t = new Date(n * DAY_MS);
    return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
  };
  return {
    messages: headers.length,
    participants: [...counts.entries()]
      .map(([name, messages]) => ({ name, messages }))
      .sort((x, y) => y.messages - x.messages || x.name.localeCompare(y.name)),
    firstDay: first === null ? null : keyOfNumber(first),
    lastDay: last === null ? null : keyOfNumber(last),
    order,
  };
}

// ─── Personnalisation (téléchargement) ───────────────────────────────────────

/** Le prénom d'un nom complet (« Juliette Chetrit » → « Juliette »). Vide si le nom l'est. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * Décalage, en jours, qui pose le dernier message `gapDays` jours avant
 * `today` (« AAAA-MM-JJ », jour de Paris du téléchargement).
 */
export function shiftDaysFor(input: { lastDay: string; gapDays: number; today: string }): number {
  return daysBetween(input.lastDay, input.today) - input.gapDays;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remplace, MOT ENTIER, le nom complet de « elle » puis son prénom seul par le
 * prénom de la créatrice. Une seule passe : un prénom qui en contient un autre
 * (Léa → Léana) ne se remplace pas deux fois. « Léandre » n'est pas « Léa ».
 */
function nameReplacer(fromName: string, toName: string): (s: string) => string {
  const variants = [...new Set([fromName.trim(), firstNameOf(fromName)])]
    .filter((v) => v.length > 0)
    .sort((x, y) => y.length - x.length)
    .map(escapeRegExp);
  if (variants.length === 0) return (s) => s;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${variants.join("|")})(?![\\p{L}\\p{N}])`, "gu");
  return (s) => s.replace(re, toName);
}

export type PersonalizeOptions = {
  /** Jours ajoutés à CHAQUE date (négatif : vers le passé). 0 = dates inchangées. */
  shiftDays: number;
  /** Nom de « elle » tel qu'il apparaît dans l'export, et le prénom qui le remplace. */
  rename?: { fromName: string; toName: string };
};

/**
 * L'export tel que la créatrice le télécharge : dates glissées de `shiftDays`,
 * nom de « elle » remplacé. Le reste — heures, autres auteurs, fins de ligne,
 * marques U+200E, lignes de suite — est recopié à l'identique.
 */
export function personalizeExport(text: string, options: PersonalizeOptions): string {
  const parts = splitKeepingEol(text);
  const lines = parts.filter((_, i) => i % 2 === 0);
  const headers = lines.map(matchHeader);
  const found = headers.filter((h): h is HeaderMatch => h !== null);
  const order = orderOf(found);
  const padding = paddingOf(found, order);
  const fromName = options.rename?.fromName.trim() ?? "";
  const toName = options.rename?.toName.trim() ?? "";
  const rename = fromName && toName ? nameReplacer(fromName, toName) : null;
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      out.push(parts[i]!);
      continue;
    }
    const line = parts[i]!;
    const h = headers[i / 2];
    if (!h) {
      out.push(rename ? rename(line) : line);
      continue;
    }
    const date =
      options.shiftDays === 0
        ? `${h.a}${h.sep1}${h.b}${h.sep2}${h.c}`
        : shiftedHeaderDate(h, order, padding, options.shiftDays);
    const name = rename && h.name.trim() === fromName ? h.name.replace(fromName, toName) : h.name;
    const body = rename ? rename(h.text) : h.text;
    out.push(`${h.marks}${h.bracket}${date}${h.rest}${h.nameMarks}${name}: ${body}`);
  }
  return out.join("");
}
