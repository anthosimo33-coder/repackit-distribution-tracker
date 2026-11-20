import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyAccountRead, dueAccounts } from "../convex/radarNetworks";
import { dueStoreApps } from "../convex/radarStore";
import { exportPage } from "../convex/swarmExportPage";
import { memoryDb, type MemoryDoc } from "./convex-memory-db";

/**
 * Le 20/11/2026, la facture Convex de Jarvia : ~11 Go lus par jour par `applyAccountRead`, autant par les pages de
 * l'export lu par Swarm, encore 0,5 Go par `dueStoreApps`. Une seule cause : chacun relisait TOUTE la table
 * radarApps (2 187 apps, 1,84 Mo) à chaque appel — à chaque compte relevé, à chaque page d'export, toutes les
 * 5 minutes. La table était passée de ~400 à ~2 200 apps le 15/11 (import FarmSpot, suivi d'office).
 *
 * La base en mémoire compte les documents lus. La table simulée compte 2 000 apps de plus que celles qui servent :
 * une fonction qui la relit en entier dépasse les plafonds ci-dessous.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T12:00:00Z");
const BULK = 2_000;

let seq = 0;
const id = (table: string) => `${table}_${String(++seq).padStart(6, "0")}`;

function app(slug: string, strong: string[], extra: Record<string, unknown> = {}): MemoryDoc {
  return {
    _id: id("radarApps"),
    _creationTime: ++seq,
    slug,
    name: slug,
    rivalOf: [],
    strong,
    weak: [],
    context: [],
    searches: [],
    status: "active",
    source: "manual",
    createdAt: 0,
    ...extra,
  };
}

function monde() {
  const apps: MemoryDoc[] = [];
  for (let i = 0; i < BULK; i++) apps.push(app(`app${i}`, [`appmotif${i}`]));
  const lumio = app("lumio", ["lumio"], { trackedCount: 1 });
  const glowup = app("glowup", ["glowup"], { trackedCount: 0 });
  const essai = app("essai", ["essaiapp"], { trialSince: NOW - DAY });
  const doublon = app("lumioo", ["lumio"], { status: "paused", mergedInto: lumio._id });
  apps.push(lumio, glowup, essai, doublon);
  const compte = (handle: string, appId: string, extra: Record<string, unknown> = {}): MemoryDoc => ({
    _id: id("radarTracked"),
    _creationTime: ++seq,
    platform: "tiktok",
    handle,
    appId,
    status: "active",
    matchedBy: "caption",
    fans: 1_000,
    videosSeen: 10,
    nextReadAt: NOW - DAY,
    readErrors: 0,
    addedAt: 0,
    ...extra,
  });
  const creatrice = compte("creatrice1", lumio._id, { readAt: NOW - 2 * DAY, proofAt: NOW - 3 * DAY });
  const testeuse = compte("testeuse", essai._id);
  const ancienne = compte("ancienne", doublon._id);
  // 10 vidéos (20 jours : hors fenêtre des formats) qui citent toutes Glowup, aucune Lumio : le compte change de réseau.
  const videos: MemoryDoc[] = [];
  for (let i = 0; i < 10; i++) {
    videos.push({
      _id: id("radarTrackedVideos"),
      _creationTime: ++seq,
      accountId: creatrice._id,
      appId: lumio._id,
      videoId: `v${i}`,
      publishedAt: NOW - 20 * DAY - i * 3_600_000,
      views: 1_000 + i,
      snapshots: [{ at: NOW - DAY, views: 1_000 + i }],
      lastSeenAt: NOW - DAY,
      caption: `mon avis sur glowup #${i}`,
    });
  }
  const tables: Record<string, MemoryDoc[]> = {
    radarApps: apps,
    radarTracked: [creatrice, testeuse, ancienne],
    radarTrackedVideos: videos,
    radarAccountJudgments: [],
    radarSignals: [],
    radarFormats: [],
    radarAppCandidates: [],
    radarStoreApps: [],
    radarSettings: [],
  };
  return { tables, apps, lumio, glowup, essai, doublon, creatrice, testeuse, ancienne };
}

/** Le contexte d'une mutation : lectures dans la base en mémoire, écritures notées (jamais relues). */
function mutationCtx(tables: Record<string, MemoryDoc[]>) {
  const mem = memoryDb(tables, { limit: null });
  const patches: { id: string; value: Record<string, unknown> }[] = [];
  const db = mem.db as { get: (id: string) => Promise<MemoryDoc | null>; query: (t: string) => unknown };
  const ctx = {
    db: {
      get: db.get,
      query: db.query,
      patch: async (id: string, value: Record<string, unknown>) => void patches.push({ id, value }),
      insert: async (table: string) => id(table),
      delete: async () => undefined,
    },
    scheduler: { runAfter: async () => undefined, runAt: async () => undefined },
  };
  return { mem, patches, ctx };
}

type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handler = (f: unknown) => (f as Handler)._handler;

/** Ce qu'un passage de relevés passe à chaque relevé : les motifs des apps, lus une fois pour le passage. */
const rules = (apps: readonly MemoryDoc[]) =>
  apps.map((a) => ({
    _id: a._id,
    status: a.status,
    name: a.name,
    rivalOf: a.rivalOf,
    strong: a.strong,
    weak: a.weak,
    context: a.context,
    ...(a.not ? { not: a.not } : {}),
  }));

describe("relevé d'un compte (applyAccountRead) : les motifs des apps arrivent du passage", () => {
  it("ne relit pas la table des apps, et le compte change quand même de réseau", async () => {
    const w = monde();
    const { mem, patches, ctx } = mutationCtx(w.tables);
    await handler(applyAccountRead)(ctx, { accountId: w.creatrice._id, videos: [], light: [], now: NOW, apps: rules(w.apps) });
    expect(mem.reads()).toBeLessThan(100);
    expect(patches.find((p) => p.id === w.creatrice._id && "appId" in p.value)?.value.appId).toBe(w.glowup._id);
  });

  it("sans les motifs (relevé isolé, e2e) : il les lit lui-même, même verdict", async () => {
    const w = monde();
    const { patches, ctx } = mutationCtx(w.tables);
    await handler(applyAccountRead)(ctx, { accountId: w.creatrice._id, videos: [], light: [], now: NOW });
    expect(patches.find((p) => p.id === w.creatrice._id && "appId" in p.value)?.value.appId).toBe(w.glowup._id);
  });

  it("le passage de relevés lit les motifs une fois et les passe aux deux voies (gratuite et payante)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../convex/radarNetworks.ts"), "utf8");
    const start = src.indexOf("async function accountReadsPass");
    const pass = src.slice(start, src.indexOf("\n}\n", start));
    expect(pass).toMatch(/runQuery\(internal\.radarNetworks\.appRules/);
    const calls = [...pass.matchAll(/runMutation\(internal\.radarNetworks\.applyAccountRead, \{([^}]*)\}/g)].map((m) => m[1]);
    expect(calls.length).toBe(2);
    for (const c of calls) expect(c).toMatch(/\bapps\b/);
  });
});

describe("comptes dus (dueAccounts) : les apps actives arrivent du passage", () => {
  it("ne relit pas la table des apps", async () => {
    const w = monde();
    const { mem, ctx } = mutationCtx(w.tables);
    const active = w.apps.filter((a) => a.status === "active").map((a) => a._id);
    const r = (await handler(dueAccounts)(ctx, { now: NOW, limit: 600, active })) as { due: { handle: string }[]; parked: string[] };
    expect(mem.reads()).toBeLessThanOrEqual(w.tables.radarTracked.length);
    expect(r.due.map((d) => d.handle).sort()).toEqual(["creatrice1", "testeuse"]);
    expect(r.parked).toEqual([w.ancienne._id]);
  });
});

describe("contrôles App Store (dueStoreApps)", () => {
  it("file vide : rien à comparer, la table des apps n'est pas lue", async () => {
    const w = monde();
    const { mem, ctx } = mutationCtx(w.tables);
    const r = (await handler(dueStoreApps)(ctx, { now: NOW, limit: 60 })) as { due: unknown[]; followed: unknown[] };
    expect(r.due).toEqual([]);
    expect(mem.reads()).toBe(0);
  });
});

describe("export vers Swarm (exportPage) : une page ne lit que les apps de ses lignes", () => {
  it("vidéos d'une app : quelques lectures, pas toute la table des apps", async () => {
    const w = monde();
    const { mem, ctx } = mutationCtx(w.tables);
    const r = await exportPage(ctx as never, "trackedVideos", null, [w.lumio._id as Id<"radarApps">]);
    expect(mem.reads()).toBeLessThan(50);
    expect(r.rows).toHaveLength(10);
  });

  it("comptes : une app à l'essai reste cachée, une app fondue vaut la vraie", async () => {
    const w = monde();
    const { mem, ctx } = mutationCtx(w.tables);
    const essai = await exportPage(ctx as never, "tracked", null, [w.essai._id as Id<"radarApps">]);
    expect(essai.rows).toEqual([]);
    const fondue = await exportPage(ctx as never, "tracked", null, [w.doublon._id as Id<"radarApps">]);
    expect(fondue.rows.map((x) => (x as { handle: string }).handle)).toEqual(["ancienne"]);
    expect(mem.reads()).toBeLessThan(100);
  });
});
