import schema from "../convex/schema";

/**
 * Base Convex EN MÉMOIRE pour les tests vitest d'une query réelle : elle suit
 * les index déclarés dans `convex/schema.ts` (un index absent du schéma, ou un
 * champ pris hors de l'ordre de l'index, est refusé comme par Convex) et COMPTE
 * les documents lus, avec la même limite que la production (32 000 par
 * exécution). C'est la limite qui a fait tomber l'outil MCP `scripts` le
 * 2026-11-08 : un test qui ne compte pas les lectures ne la voit jamais.
 *
 * Ordre de lecture : champs de l'index, puis `_creationTime`, comme Convex.
 * Documents comptés : tous ceux de la plage d'index parcourue (un `.filter`
 * ne réduit pas la lecture, il la trie seulement).
 */

export const CONVEX_READ_LIMIT = 32_000;

export type MemoryDoc = Record<string, unknown> & { _id: string; _creationTime: number };

type Op = "eq" | "gt" | "gte" | "lt" | "lte";
type RangeStep = { op: Op; field: string; value: unknown };

/** Ordre Convex des types : undefined < null < nombre < booléen < chaîne < reste. */
function rang(v: unknown): number {
  if (v === undefined) return 0;
  if (v === null) return 1;
  if (typeof v === "bigint") return 2;
  if (typeof v === "number") return 3;
  if (typeof v === "boolean") return 4;
  if (typeof v === "string") return 5;
  if (Array.isArray(v)) return 7;
  return 8;
}

function comparer(a: unknown, b: unknown): number {
  const ra = rang(a);
  const rb = rang(b);
  if (ra !== rb) return ra - rb;
  if (ra <= 1) return 0;
  if (typeof a === "number" || typeof a === "bigint") {
    return a < (b as number) ? -1 : a > (b as number) ? 1 : 0;
  }
  if (typeof a === "boolean") return Number(a) - Number(b);
  if (typeof a === "string") return a < (b as string) ? -1 : a > (b as string) ? 1 : 0;
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  return ja < jb ? -1 : ja > jb ? 1 : 0;
}

function lire(doc: MemoryDoc, chemin: string): unknown {
  let cur: unknown = doc;
  for (const part of chemin.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function champsDeLIndex(table: string, index: string): string[] {
  if (index === "by_creation_time") return ["_creationTime"];
  if (index === "by_id") return ["_id"];
  type AvecIndex = { " indexes"(): { indexDescriptor: string; fields: string[] }[] };
  const def = (schema.tables as unknown as Record<string, AvecIndex | undefined>)[table];
  if (!def) throw new Error(`Table inconnue du schéma : ${table}`);
  const found = def[" indexes"]().find((i) => i.indexDescriptor === index);
  if (!found) throw new Error(`Index absent du schéma : ${table}.${index}`);
  return [...found.fields, "_creationTime"];
}

export interface MemoryDb {
  /** À poser en `ctx.db`. */
  db: unknown;
  /** Documents lus depuis la création (ou le dernier `resetReads`). */
  reads(): number;
  resetReads(): void;
}

/**
 * `limit` : nombre de lectures au-delà duquel la query échoue comme en
 * production. `null` = compter sans jamais échouer (mesurer l'ancien code).
 */
export function memoryDb(
  tables: Record<string, MemoryDoc[]>,
  opts: { limit?: number | null } = {},
): MemoryDb {
  const limit = opts.limit === undefined ? CONVEX_READ_LIMIT : opts.limit;
  let reads = 0;
  const lus = (n: number) => {
    reads += n;
    if (limit !== null && reads > limit) {
      throw new Error(
        `Too many documents read in a single function execution (limit: ${limit}).`,
      );
    }
  };

  const parId = new Map<string, MemoryDoc>();
  for (const docs of Object.values(tables)) for (const d of docs) parId.set(d._id, d);

  // Par (table, index) : documents triés, regroupés par valeur du 1er champ.
  const trie = new Map<string, { champs: string[]; groupes: Map<string, MemoryDoc[]>; tous: MemoryDoc[] }>();
  const indexe = (table: string, index: string) => {
    const cle = `${table}|${index}`;
    let t = trie.get(cle);
    if (!t) {
      const champs = champsDeLIndex(table, index);
      const tous = [...(tables[table] ?? [])].sort((a, b) => {
        for (const c of champs) {
          const r = comparer(lire(a, c), lire(b, c));
          if (r !== 0) return r;
        }
        return 0;
      });
      const groupes = new Map<string, MemoryDoc[]>();
      for (const d of tous) {
        const k = JSON.stringify(lire(d, champs[0]) ?? "__undefined__");
        const g = groupes.get(k);
        if (g) g.push(d);
        else groupes.set(k, [d]);
      }
      t = { champs, groupes, tous };
      trie.set(cle, t);
    }
    return t;
  };

  const plage = (table: string, index: string, steps: RangeStep[]): MemoryDoc[] => {
    const { champs, groupes, tous } = indexe(table, index);
    // Convex : égalités sur un PRÉFIXE de l'index, dans l'ordre, puis au plus
    // une borne basse et une borne haute sur le champ suivant.
    let i = 0;
    for (const s of steps) {
      if (s.op === "eq") {
        if (champs[i] !== s.field) {
          throw new Error(`${table}.${index} : eq("${s.field}") hors de l'ordre de l'index (${champs.join(", ")})`);
        }
        i += 1;
      } else if (champs[i] !== s.field) {
        throw new Error(`${table}.${index} : borne sur "${s.field}" hors de l'ordre de l'index (${champs.join(", ")})`);
      }
    }
    const premier = steps[0];
    const base =
      premier && premier.op === "eq"
        ? (groupes.get(JSON.stringify(premier.value ?? "__undefined__")) ?? [])
        : tous;
    return base.filter((d) =>
      steps.every((s) => {
        const r = comparer(lire(d, s.field), s.value);
        switch (s.op) {
          case "eq":
            return r === 0;
          case "gt":
            return r > 0;
          case "gte":
            return r >= 0;
          case "lt":
            return r < 0;
          default:
            return r <= 0;
        }
      }),
    );
  };

  const query = (table: string) => {
    let index = "by_creation_time";
    let steps: RangeStep[] = [];
    let desc = false;
    const filtres: ((d: MemoryDoc) => boolean)[] = [];
    const lignes = () => {
      const r = plage(table, index, steps);
      return desc ? [...r].reverse() : r;
    };
    const garde = (d: MemoryDoc) => filtres.every((f) => f(d));
    const q = {
      withIndex(nom: string, f?: (b: unknown) => unknown) {
        index = nom;
        steps = [];
        if (f) {
          const b: Record<Op, (field: string, value: unknown) => unknown> = {
            eq: (field, value) => (steps.push({ op: "eq", field, value }), b),
            gt: (field, value) => (steps.push({ op: "gt", field, value }), b),
            gte: (field, value) => (steps.push({ op: "gte", field, value }), b),
            lt: (field, value) => (steps.push({ op: "lt", field, value }), b),
            lte: (field, value) => (steps.push({ op: "lte", field, value }), b),
          };
          f(b);
        }
        champsDeLIndex(table, index);
        return q;
      },
      order(dir: "asc" | "desc") {
        desc = dir === "desc";
        return q;
      },
      filter(f: (b: unknown) => unknown) {
        filtres.push(filtreConvex(f));
        return q;
      },
      async collect() {
        const r = lignes();
        lus(r.length);
        return r.filter(garde);
      },
      async take(n: number) {
        const out: MemoryDoc[] = [];
        let vus = 0;
        for (const d of lignes()) {
          if (out.length >= n) break;
          vus += 1;
          if (garde(d)) out.push(d);
        }
        lus(vus);
        return out;
      },
      async first() {
        return (await q.take(1))[0] ?? null;
      },
      async unique() {
        const r = await q.take(2);
        if (r.length > 1) throw new Error(`unique() : plusieurs documents dans ${table}.${index}`);
        return r[0] ?? null;
      },
      async *[Symbol.asyncIterator]() {
        for (const d of lignes()) {
          lus(1);
          if (garde(d)) yield d;
        }
      },
    };
    return q;
  };

  const db = {
    async get(id: string) {
      const d = parId.get(id) ?? null;
      if (d) lus(1);
      return d;
    },
    query,
  };

  return {
    db,
    reads: () => reads,
    resetReads: () => {
      reads = 0;
    },
  };
}

/** Le sous-ensemble du constructeur de `.filter` Convex : field, eq/neq, and/or/not, comparaisons. */
function filtreConvex(f: (b: unknown) => unknown): (d: MemoryDoc) => boolean {
  type Expr = (d: MemoryDoc) => unknown;
  const val = (x: unknown): Expr => (typeof x === "function" ? (x as Expr) : () => x);
  const b = {
    field: (chemin: string): Expr => (d) => lire(d, chemin),
    eq: (x: unknown, y: unknown): Expr => (d) => comparer(val(x)(d), val(y)(d)) === 0,
    neq: (x: unknown, y: unknown): Expr => (d) => comparer(val(x)(d), val(y)(d)) !== 0,
    lt: (x: unknown, y: unknown): Expr => (d) => comparer(val(x)(d), val(y)(d)) < 0,
    lte: (x: unknown, y: unknown): Expr => (d) => comparer(val(x)(d), val(y)(d)) <= 0,
    gt: (x: unknown, y: unknown): Expr => (d) => comparer(val(x)(d), val(y)(d)) > 0,
    gte: (x: unknown, y: unknown): Expr => (d) => comparer(val(x)(d), val(y)(d)) >= 0,
    and: (...xs: unknown[]): Expr => (d) => xs.every((x) => Boolean(val(x)(d))),
    or: (...xs: unknown[]): Expr => (d) => xs.some((x) => Boolean(val(x)(d))),
    not: (x: unknown): Expr => (d) => !val(x)(d),
  };
  const expr = val(f(b));
  return (d) => Boolean(expr(d));
}
