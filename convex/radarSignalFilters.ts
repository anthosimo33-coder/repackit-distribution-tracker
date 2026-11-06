/**
 * NOUVEAU RADAR — filtres de l'écran Signaux, PURS et sans texte d'interface
 * (l'écran traduit les clés). Partagés par l'écran et l'outil MCP `signaux`.
 *
 * Règles (validées sur maquette le 06/11/2026) :
 *  - dans un groupe, les cases s'additionnent (OU) ; entre groupes, elles se
 *    cumulent (ET) ;
 *  - le compteur d'une case = ce qu'on obtient en la cochant, compte tenu des
 *    AUTRES groupes ; une case à 0 non cochée ne se coche pas, une case cochée
 *    tombée à 0 reste décochable ;
 *  - défaut : 7 jours, toutes les vidéos, sans les ignorées ; « tout effacer »
 *    y revient ; un résultat vide propose de retirer un filtre, avec son effet ;
 *  - l'état tient dans l'adresse de la page (lien partageable).
 */
import { LANG_BUCKETS, RETENTION_DAYS, viewsPerHour } from "./radarSignalsMath";

export type SignalStatus = "nouveau" | "enregistre" | "adapte" | "ignore";
export const STATUSES: readonly SignalStatus[] = ["nouveau", "enregistre", "adapte", "ignore"];
export const DEFAULT_STATUT: readonly SignalStatus[] = ["nouveau", "enregistre", "adapte"];

/** Ce dont les filtres ont besoin d'un signal (sous-ensemble de listSignalsCore). */
export type FilterableSignal = {
  handle: string;
  fans: number;
  caption: string;
  lang: string;
  publishedAt: number;
  views: number;
  ratio: number;
  competitor: string | null;
  /** L'app que la vidéo pousse (réseau suivi, ou légende qui la cite). */
  app: string | null;
  status: SignalStatus;
};

export type GroupKey = "origine" | "langue" | "app" | "taille" | "statut";
/** `values` vide = valeurs tirées des données (les apps suivies changent). */
export const GROUPS: readonly { key: GroupKey; values: readonly string[] }[] = [
  { key: "origine", values: ["concurrent", "autre"] },
  { key: "langue", values: LANG_BUCKETS },
  { key: "app", values: [] },
  { key: "taille", values: ["xs", "s", "m", "l"] },
  { key: "statut", values: STATUSES },
];

export const AGE_OPTIONS = ["1", "3", "7", "30", "90", "all"] as const;
export type AgeKey = (typeof AGE_OPTIONS)[number];
export const SEUIL_OPTIONS = ["0", "10", "50", "200"] as const;
export type SeuilKey = (typeof SEUIL_OPTIONS)[number];
export const SORTS = ["ratio", "vph", "views", "recent"] as const;
export type SortKey = (typeof SORTS)[number];

export type Filters = {
  sel: Record<GroupKey, string[]>;
  age: AgeKey;
  seuil: SeuilKey;
  q: string;
  sort: SortKey;
};

export const DEFAULT_AGE: AgeKey = "7";

export function defaultFilters(): Filters {
  return { sel: { origine: [], langue: [], app: [], taille: [], statut: [...DEFAULT_STATUT] }, age: DEFAULT_AGE, seuil: "0", q: "", sort: "ratio" };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const tailleOf = (fans: number) => (fans < 1_000 ? "xs" : fans < 10_000 ? "s" : fans < 50_000 ? "m" : "l");

export function valuesOf(s: FilterableSignal, key: GroupKey): string[] {
  if (key === "origine") return [s.competitor ? "concurrent" : "autre"];
  if (key === "langue") return [s.lang];
  if (key === "app") return s.app ? [s.app] : [];
  if (key === "taille") return [tailleOf(s.fans)];
  return [s.status];
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Le signal passe-t-il tous les filtres, sauf celui qu'on compte (`skip`) ? */
export function matches(s: FilterableSignal, f: Filters, now: number, skip: GroupKey | "age" | "seuil" | null = null): boolean {
  for (const g of GROUPS) {
    if (g.key === skip) continue;
    const want = f.sel[g.key];
    if (want.length && !valuesOf(s, g.key).some((x) => want.includes(x))) return false;
  }
  if (skip !== "age" && f.age !== "all" && now - s.publishedAt > Number(f.age) * DAY) return false;
  if (skip !== "seuil" && s.ratio < Number(f.seuil)) return false;
  if (f.q) {
    const needle = f.q.trim().toLowerCase();
    if (needle && !`${s.caption} ${s.handle} ${s.competitor ?? ""}`.toLowerCase().includes(needle)) return false;
  }
  return true;
}

const SORTERS: Record<SortKey, (now: number) => (a: FilterableSignal, b: FilterableSignal) => number> = {
  ratio: () => (a, b) => b.ratio - a.ratio,
  vph: (now) => (a, b) => viewsPerHour(b.views, b.publishedAt, now) - viewsPerHour(a.views, a.publishedAt, now),
  views: () => (a, b) => b.views - a.views,
  recent: () => (a, b) => b.publishedAt - a.publishedAt,
};

export function applyFilters<T extends FilterableSignal>(signals: readonly T[], f: Filters, now: number): T[] {
  return signals.filter((s) => matches(s, f, now)).sort(SORTERS[f.sort](now));
}

export type FacetOption = { value: string; count: number; checked: boolean; disabled: boolean };

/** Les compteurs de chaque case, compte tenu des autres groupes. */
export function facets(signals: readonly FilterableSignal[], f: Filters, now: number) {
  const valuesFor = (g: (typeof GROUPS)[number]) =>
    g.values.length
      ? g.values
      : // Valeurs des données, plus celles cochées (une app cochée reste décochable).
        Array.from(new Set([...signals.flatMap((s) => valuesOf(s, g.key)), ...f.sel[g.key]])).sort((a, b) => a.localeCompare(b));
  const groups = GROUPS.map((g) => ({
    key: g.key,
    options: valuesFor(g).map((value): FacetOption => {
      const count = signals.filter((s) => matches(s, f, now, g.key) && valuesOf(s, g.key).includes(value)).length;
      const checked = f.sel[g.key].includes(value);
      return { value, count, checked, disabled: count === 0 && !checked };
    }),
  }));
  const single = <K extends "age" | "seuil">(key: K, values: readonly Filters[K][]) =>
    values.map((value) => ({
      value,
      count: signals.filter((s) => matches(s, { ...f, [key]: value }, now)).length,
      checked: f[key] === value,
    }));
  return { groups, age: single("age", AGE_OPTIONS), seuil: single("seuil", SEUIL_OPTIONS) };
}

export function toggle(f: Filters, key: GroupKey, value: string): Filters {
  const cur = f.sel[key];
  return { ...f, sel: { ...f.sel, [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] } };
}

export type FilterKey = GroupKey | "age" | "seuil" | "q";

export function isDefault(f: Filters, key: FilterKey): boolean {
  if (key === "age") return f.age === DEFAULT_AGE;
  if (key === "seuil") return f.seuil === "0";
  if (key === "q") return f.q.trim() === "";
  if (key === "statut") return sameSet(f.sel.statut, DEFAULT_STATUT);
  return f.sel[key].length === 0;
}

export function reset(f: Filters, key: FilterKey): Filters {
  const d = defaultFilters();
  if (key === "age" || key === "seuil" || key === "q") return { ...f, [key]: d[key] };
  return { ...f, sel: { ...f.sel, [key]: d.sel[key] } };
}

export const clearAll = (f: Filters): Filters => ({ ...defaultFilters(), sort: f.sort });

/**
 * Les pastilles des filtres actifs : une par case cochée, une seule pour le
 * statut (sa valeur par défaut n'en fait pas), une pour la période, le seuil et
 * la recherche quand ils s'écartent du défaut.
 */
export type Chip =
  | { kind: "q"; value: string }
  | { kind: "age"; value: AgeKey }
  | { kind: "seuil"; value: SeuilKey }
  | { kind: "statut"; values: string[] }
  | { kind: "group"; key: Exclude<GroupKey, "statut">; value: string };

export function chips(f: Filters): Chip[] {
  const out: Chip[] = [];
  if (!isDefault(f, "q")) out.push({ kind: "q", value: f.q.trim() });
  if (!isDefault(f, "age")) out.push({ kind: "age", value: f.age });
  if (!isDefault(f, "seuil")) out.push({ kind: "seuil", value: f.seuil });
  for (const g of GROUPS) {
    if (g.key === "statut") {
      if (!isDefault(f, "statut")) out.push({ kind: "statut", values: STATUSES.filter((s) => f.sel.statut.includes(s)) });
      continue;
    }
    for (const value of f.sel[g.key]) out.push({ kind: "group", key: g.key, value });
  }
  return out;
}

export function removeChip(f: Filters, c: Chip): Filters {
  if (c.kind === "group") return toggle(f, c.key, c.value);
  return reset(f, c.kind === "statut" ? "statut" : c.kind);
}

/** Résultat vide : les filtres à retirer, avec ce qu'on retrouve (les 4 meilleurs, > 0). */
export function suggestions(signals: readonly FilterableSignal[], f: Filters, now: number) {
  const keys: FilterKey[] = ["q", "age", "seuil", ...GROUPS.map((g) => g.key)];
  return keys
    .filter((k) => !isDefault(f, k))
    .map((key) => ({ key, count: signals.filter((s) => matches(s, reset(f, key), now)).length }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
}

// ─── Vues enregistrées ───────────────────────────────────────────────────────

export type PresetId = "tout" | "horsDomaine" | "concurrents" | "latam";
export const PRESETS: readonly { id: PresetId; patch: (f: Filters) => Filters }[] = [
  { id: "tout", patch: (f) => clearAll(f) },
  { id: "horsDomaine", patch: (f) => ({ ...clearAll(f), sel: { ...clearAll(f).sel, origine: ["autre"] } }) },
  { id: "concurrents", patch: (f) => ({ ...clearAll(f), age: "90", sel: { ...clearAll(f).sel, origine: ["concurrent"] } }) },
  { id: "latam", patch: (f) => ({ ...clearAll(f), age: "30", sel: { ...clearAll(f).sel, langue: ["pt", "es-am"] } }) },
];

/** Même filtrage (le tri ne compte pas) ? */
export function sameFilters(a: Filters, b: Filters): boolean {
  return a.age === b.age && a.seuil === b.seuil && a.q.trim() === b.q.trim() && GROUPS.every((g) => sameSet(a.sel[g.key], b.sel[g.key]));
}

// ─── Adresse de la page ──────────────────────────────────────────────────────

const PARAM: Record<GroupKey, string> = { origine: "o", langue: "l", app: "a", taille: "t", statut: "st" };

/** Les filtres dans l'adresse ; un filtre au défaut n'y figure pas. */
export function toSearchParams(f: Filters, base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  for (const g of GROUPS) {
    p.delete(PARAM[g.key]);
    if (!isDefault(f, g.key)) p.set(PARAM[g.key], f.sel[g.key].join(",") || "-");
  }
  for (const [k, def] of [["age", DEFAULT_AGE], ["seuil", "0"], ["tri", "ratio"]] as const) {
    const val = k === "tri" ? f.sort : f[k];
    p.delete(k);
    if (val !== def) p.set(k, val);
  }
  p.delete("q");
  if (f.q.trim()) p.set("q", f.q.trim());
  return p;
}

/** Relit l'adresse ; toute valeur inconnue est ignorée (un vieux lien ne casse rien). */
export function fromSearchParams(p: { get(name: string): string | null }): Filters {
  const f = defaultFilters();
  for (const g of GROUPS) {
    const raw = p.get(PARAM[g.key]);
    if (raw === null) continue;
    const vals = raw === "-" ? [] : raw.split(",").map((x) => x.trim()).filter(Boolean);
    // Une app se garde telle quelle (liste ouverte) ; les autres groupes filtrent leurs valeurs connues.
    f.sel[g.key] = g.values.length ? vals.filter((x) => g.values.includes(x)) : vals;
  }
  const age = p.get("age");
  if (age && (AGE_OPTIONS as readonly string[]).includes(age)) f.age = age as AgeKey;
  const seuil = p.get("seuil");
  if (seuil && (SEUIL_OPTIONS as readonly string[]).includes(seuil)) f.seuil = seuil as SeuilKey;
  const tri = p.get("tri");
  if (tri && (SORTS as readonly string[]).includes(tri)) f.sort = tri as SortKey;
  f.q = p.get("q") ?? "";
  return f;
}

/**
 * Début de la fenêtre lue en base : toute la rétention, au jour près (des args
 * stables d'une minute à l'autre, donc une query qui ne se relance pas pour rien).
 * Les périodes plus courtes se filtrent à l'écran, ce qui donne leurs compteurs.
 */
export function listSince(now: number): number {
  return Math.floor(now / DAY) * DAY - RETENTION_DAYS * DAY;
}
