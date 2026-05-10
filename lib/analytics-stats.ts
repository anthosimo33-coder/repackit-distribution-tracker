import type { Doc } from "@/convex/_generated/dataModel";

type Publication = Doc<"publications">;

export type MetricKey =
  | "views"
  | "likes"
  | "saves"
  | "subsGained"
  | "comments";

export type Period = "J7" | "J30" | "J90" | "All";
export type Granularity = "day" | "week";

export type TimeseriesPoint = {
  date: string;
  views?: number;
  likes?: number;
  saves?: number;
  subsGained?: number;
  comments?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Convertit un timestamp en clé de bucket selon la granularité demandée.
 *  - day  : YYYY-MM-DD (lexicographic = chronologique)
 *  - week : YYYY-Www (ISO 8601 week date — 4-jan toujours en W01)
 *
 * Toutes les dates sont en UTC pour rester déterministes (le tracker est
 * cross-fuseau, datePubli stocké en epoch ms côté Convex).
 */
function formatDateKey(timestamp: number, granularity: Granularity): string {
  const d = new Date(timestamp);
  const y = d.getUTCFullYear();
  if (granularity === "day") {
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  // ISO week : algo Wikipedia. Jeudi de la semaine donne l'année ISO.
  const target = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // lundi=0..dimanche=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNum = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function getPeriodStart(period: Period, now: number): number {
  switch (period) {
    case "J7":
      return now - 7 * DAY_MS;
    case "J30":
      return now - 30 * DAY_MS;
    case "J90":
      return now - 90 * DAY_MS;
    case "All":
      return 0;
  }
}

function readMetric(p: Publication, metric: MetricKey): number | null {
  switch (metric) {
    case "views":
      return p.vuesJ7 ?? null;
    case "likes":
      return p.likes ?? null;
    case "saves":
      return p.saves ?? null;
    case "subsGained":
      return p.subsGained ?? null;
    case "comments":
      return p.commentsTotal ?? null;
  }
}

/**
 * Bucketing client-side des publications par date (day ou ISO week) pour
 * MetricChart. Au volume actuel (~10 pubs), pas de pression perf — TD-009
 * couvrira la migration serveur si volume > 500.
 *
 * Les buckets vides ne sont PAS générés : Recharts gère naturellement les
 * gaps via `connectNulls` côté <Line>. L'array retourné contient uniquement
 * les buckets ayant au moins une publication dans la période.
 */
export function getTimeseries(
  publications: Publication[],
  options: {
    period: Period;
    granularity: Granularity;
    metrics: Set<MetricKey>;
    now?: number;
  },
): TimeseriesPoint[] {
  const now = options.now ?? Date.now();
  const start = getPeriodStart(options.period, now);

  const filtered = publications.filter(
    (p) => p.datePubli >= start && p.datePubli <= now,
  );

  // Groupe par bucket date.
  const buckets = new Map<string, Publication[]>();
  for (const p of filtered) {
    const key = formatDateKey(p.datePubli, options.granularity);
    const existing = buckets.get(key);
    if (existing) existing.push(p);
    else buckets.set(key, [p]);
  }

  const result: TimeseriesPoint[] = [];
  for (const [date, pubs] of buckets.entries()) {
    const point: TimeseriesPoint = { date };
    for (const metric of options.metrics) {
      let sum = 0;
      let any = false;
      for (const p of pubs) {
        const v = readMetric(p, metric);
        if (v !== null) {
          sum += v;
          any = true;
        }
      }
      if (any) point[metric] = sum;
    }
    result.push(point);
  }

  // Tri lexicographique (clés YYYY-MM-DD ou YYYY-Www → chronologique).
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}
