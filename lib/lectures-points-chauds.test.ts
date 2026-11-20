import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import type { ProjectQueryCtx } from "../convex/functions";
import { getAttributionCore, getReliabilityCore } from "../convex/analyticsHub";
import { invalidatePayCaches } from "../convex/dashboardCache";
import { getMarketPnlCore } from "../convex/marketPnl";
import {
  computeDueTotal,
  computePayrollCaches,
  computeProjectLeaderboard,
} from "../convex/payments";
import { computeCostsJson, getProfitabilityCosts } from "../convex/profitability";
import { memoryDb, type MemoryDoc } from "./convex-memory-db";

/**
 * Les POINTS CHAUDS de la facture Convex de Jarvia (API d'usage, 19-20/11/2026) :
 * la carte Rentabilité (5,8 Mo lus par appel, 255 appels le 19/11), le hub
 * analytics (12 à 17 Mo par appel) et les crons de l'accueil (5,6 Mo par appel,
 * 48 fois par jour et par projet). Tous relisaient en entier les publications
 * (3,1 Mo sur Snytch) et les assignations (2,6 Mo) — et plusieurs les relisaient
 * DEUX ou TROIS fois dans le même appel.
 *
 * La base en mémoire pèse les documents lus (octets JSON par table) : une table
 * relue en entier deux fois pèse deux fois son poids. Chaque test affirme aussi
 * que la sortie est celle du calcul d'avant, sur un monde où elle n'est pas vide.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T15:00:00Z");
const P = "projects_snytch";
const ADMIN = "users_admin";

let seq = 0;
const doc = (table: string, champs: Record<string, unknown>): MemoryDoc => {
  seq += 1;
  return {
    _id: `${table}_${String(seq).padStart(6, "0")}`,
    _creationTime: NOW - 300 * DAY + seq * 1_000,
    ...champs,
  };
};

/** Un texte de script réaliste : c'est lui qui fait le poids d'une publication. */
const SCRIPT = "Hook : il m'a menti pendant trois mois. Corps : j'ai vérifié avec l'app, ".repeat(6);

function monde() {
  const t: Record<string, MemoryDoc[]> = {
    projects: [],
    users: [],
    creators: [],
    assignments: [],
    publications: [],
    metricSnapshots: [],
    payments: [],
    pricings: [],
    bonusUnlocks: [],
    challengeWins: [],
    comptes: [],
    formats: [],
    posthogCache: [],
    whopPayments: [],
    whopMemberships: [],
    dashboardCache: [],
    rushes: [],
    syncMarkers: [],
    marketGroups: [],
  };
  t.projects.push({
    _id: P,
    _creationTime: NOW - 400 * DAY,
    slug: "snytch",
    name: "Snytch",
    payCurrency: "eur",
    whop: { companyId: "biz_test", productIds: ["prod_test"] },
  });
  t.users.push({ _id: ADMIN, _creationTime: 1, role: "superadmin", email: "admin@exemple.test" });
  const pricing = doc("pricings", {
    projectId: P,
    name: "Barème Novembre",
    currency: "eur",
    montantFixe: 350,
    nbVideosCible: 30,
    tauxCPM: 1.2,
  });
  t.pricings.push(pricing);
  const pays = ["FR", "ES", "MX"];
  const personnes: [string, string | undefined, number | undefined][] = [
    ["Marine Dupont", undefined, 140],
    ["Kelly Martins-Laval", undefined, 95],
    ["Juliette Rouby", "usd", 61],
    ["Camila Hernández", "talent", undefined],
    ["Sarah Benali", "clipper", 40],
    ["Lorena Teles", undefined, undefined], // partenaire qui n'a jamais publié
  ];
  for (const [i, [name, kindOuDevise, depuis]] of personnes.entries()) {
    const kind = kindOuDevise === "talent" || kindOuDevise === "clipper" ? kindOuDevise : undefined;
    const creator = doc("creators", {
      projectId: P,
      name,
      email: `createatrice${i}@exemple.test`,
      status: "active",
      ...(kind ? { kind } : {}),
      ...(kindOuDevise === "usd" ? { payCurrency: "usd" } : {}),
      ...(depuis !== undefined ? { firstPostAt: NOW - depuis * DAY + 3_600_000 * 7 } : {}),
      createdAt: NOW - 200 * DAY,
    });
    t.creators.push(creator);
    const comptes = ["TikTok", "Instagram"].map((plateforme) => {
      const c = doc("comptes", {
        projectId: P,
        creatorId: creator._id,
        handle: `@${name.split(" ")[0].toLowerCase()}.${plateforme.toLowerCase()}_${i}`,
        plateforme,
        targetCountry: pays[i % 3],
        status: "active",
      });
      t.comptes.push(c);
      return c;
    });
    if (depuis === undefined) continue;
    // Une vidéo tous les 4 jours depuis le premier post, deux posts chacune.
    for (let jour = depuis - 1; jour > 1; jour -= 4) {
      const publishedAt = NOW - jour * DAY + 3_600_000 * 19 + 1_234;
      const pubs = comptes.map((c, k) => {
        const vues = Math.round((jour * 731.37 + k * 2_903.5 + i * 177) % 48_000) + 12;
        const p = doc("publications", {
          projectId: P,
          compte: c.handle,
          plateforme: c.plateforme,
          datePubli: publishedAt,
          postUrl: `https://www.tiktok.com/@x/video/${seq}${k}`,
          postTitle: SCRIPT.slice(0, 120),
          vuesLatest: vues,
          likesLatest: Math.round(vues / 23),
          latestSnapshotAt: NOW - Math.min(jour, 2) * DAY,
          scriptCombo: { hookBrickId: `hook_${jour % 5}`, assembledScript: SCRIPT },
          isWarmup: jour % 9 === 0,
        });
        t.publications.push(p);
        t.metricSnapshots.push(
          doc("metricSnapshots", {
            projectId: P,
            publicationId: p._id,
            capturedAt: publishedAt + 30 * DAY,
            daysSincePublication: 30,
            vues,
            likes: Math.round(vues / 23),
            createdAt: publishedAt + 30 * DAY,
            source: "apify",
          }),
        );
        return p;
      });
      t.assignments.push(
        doc("assignments", {
          projectId: P,
          creatorId: creator._id,
          status: jour > 60 ? "paid" : "published",
          createdAt: publishedAt - 3 * DAY,
          postDate: publishedAt - DAY,
          publishedBy: "creator",
          remunerated: true,
          contentType: "video",
          instructions: SCRIPT,
          pricingSnapshot: {
            currency: kindOuDevise === "usd" ? "usd" : "eur",
            montantFixe: 350,
            nbVideosCible: 30,
            tauxCPM: 1.2,
            montantBonus: 0,
            seuilBonusVues: 0,
            pricingId: pricing._id,
          },
          publicationId: pubs[0]._id,
          targets: pubs.map((p, k) => ({
            accountId: comptes[k]._id,
            platform: p.plateforme,
            publicationId: p._id,
            publishedAt,
            publishedUrl: p.postUrl,
          })),
        }),
      );
    }
    // Une mission pas encore publiée : elle compte au calendrier, pas à la paie.
    t.assignments.push(
      doc("assignments", {
        projectId: P,
        creatorId: creator._id,
        status: "assigned",
        createdAt: NOW - DAY,
        postDate: NOW + DAY,
        instructions: SCRIPT,
      }),
    );
  }
  return t;
}

const poids = (docs: readonly MemoryDoc[]) => docs.reduce((n, d) => n + JSON.stringify(d).length, 0);

type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const handler = (f: unknown) => (f as Handler)._handler;

function contexte(t: Record<string, MemoryDoc[]>) {
  const mem = memoryDb(t, { limit: null });
  const ctx = {
    db: mem.db,
    projectId: P as Id<"projects">,
    userId: ADMIN as Id<"users">,
    auth: { getUserIdentity: async () => ({ subject: `${ADMIN}|session`, tokenIdentifier: "t", issuer: "i" }) },
  };
  return { mem, ctx: ctx as unknown as ProjectQueryCtx };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

describe("cron de l'accueil : un seul passage de paie pour le total dû et le classement", () => {
  it("rend le total dû et le classement du calcul direct, en lisant les publications une fois", async () => {
    const t = monde();
    const direct = contexte(t);
    const dueTotal = await computeDueTotal(direct.ctx, P as Id<"projects">);
    const classement = await computeProjectLeaderboard(direct.ctx, P as Id<"projects">, NOW);

    const { mem, ctx } = contexte(t);
    const paie = (await handler(computePayrollCaches)(ctx, { projectId: P })) as {
      dueTotalJson: string;
      leaderboard: { creatorId: string; totalDue: number; rank: number }[];
    };

    // Le monde n'est pas vide : trois partenaires classées, de l'argent dû.
    expect(dueTotal.dueTotal).toBeGreaterThan(0);
    expect(classement.map((r) => r.name)).toHaveLength(3);
    expect(paie.dueTotalJson).toBe(JSON.stringify(dueTotal));
    expect(paie.leaderboard).toEqual(
      classement.map(({ creatorId, name, rank, totalDue, currency, rate, cycleStart, cycleEnd }) => ({
        creatorId,
        name,
        rank,
        totalDue,
        currency,
        rate,
        cycleStart,
        cycleEnd,
      })),
    );
    // Les deux anciennes queries lisaient chacune toutes les publications.
    expect(mem.bytesByTable().publications).toBeGreaterThan(0);
    expect(mem.bytesByTable().publications).toBeLessThanOrEqual(poids(t.publications));
  });
});

describe("carte Rentabilité : lue dans le cache que range le cron", () => {
  it("rend le calcul direct à l'identique, sans relire publications ni assignations", async () => {
    const t = monde();
    const directs: unknown[] = [];
    for (const lot of [0, 1]) {
      const { ctx } = contexte(t);
      directs.push(await handler(getProfitabilityCosts)(ctx, { projectId: P, lot, lots: 2 }));
    }
    // Le monde n'est pas vide : des mois coûtés dans chaque lot.
    for (const d of directs) {
      const months = (d as { part: { creators: { months: unknown[] }[] } }).part.creators.flatMap((c) => c.months);
      expect(months.length).toBeGreaterThan(0);
    }
    for (const lot of [0, 1]) {
      const { ctx } = contexte(t);
      const json = (await handler(computeCostsJson)(ctx, { projectId: P, lot, lots: 2 })) as string;
      t.dashboardCache.push(doc("dashboardCache", { projectId: P, key: `profitCosts:${lot}/2`, json, changedAt: NOW }));
    }
    for (const lot of [0, 1]) {
      const { mem, ctx } = contexte(t);
      const lu = await handler(getProfitabilityCosts)(ctx, { projectId: P, lot, lots: 2 });
      expect(lu).toEqual(directs[lot]);
      expect(mem.bytesByTable().publications ?? 0).toBe(0);
      expect(mem.bytesByTable().assignments ?? 0).toBe(0);
      expect(mem.reads()).toBeLessThan(10);
    }
  });

  it("calcule en direct quand le cache a été invalidé", async () => {
    const t = monde();
    const { mem, ctx } = contexte(t);
    await handler(getProfitabilityCosts)(ctx, { projectId: P, lot: 0, lots: 2 });
    expect(mem.bytesByTable().publications).toBeGreaterThan(0);
  });

  it("une mutation d'argent supprime le total dû et les deux lots, pas les décisions", async () => {
    const lignes = ["decisions", "dueTotal", "profitCosts:0/2", "profitCosts:1/2"].map((key) =>
      doc("dashboardCache", { projectId: P, key, json: "{}", changedAt: NOW }),
    );
    const autreProjet = doc("dashboardCache", { projectId: "projects_blush", key: "dueTotal", json: "{}", changedAt: NOW });
    const mem = memoryDb({ dashboardCache: [...lignes, autreProjet] });
    const supprimes: string[] = [];
    const ctx = { db: { ...(mem.db as object), delete: async (id: string) => void supprimes.push(id) } };
    await invalidatePayCaches(ctx as unknown as MutationCtx, P as Id<"projects">);
    expect(supprimes.sort()).toEqual([lignes[1]._id, lignes[2]._id, lignes[3]._id].sort());
  });
});

describe("hub analytics : chaque table du projet lue une seule fois par appel", () => {
  const cas: [string, (ctx: ProjectQueryCtx) => Promise<unknown>][] = [
    ["getReliability", (ctx) => getReliabilityCore(ctx)],
    ["getAttribution", (ctx) => getAttributionCore(ctx)],
    ["getMarketPnl", (ctx) => getMarketPnlCore(ctx, {})],
  ];
  for (const [nom, appel] of cas) {
    it(`${nom} : publications et assignations lues une fois`, async () => {
      const t = monde();
      const { mem, ctx } = contexte(t);
      await appel(ctx);
      const parTable = mem.bytesByTable();
      expect(parTable.publications).toBeGreaterThan(0);
      expect(parTable.publications).toBeLessThanOrEqual(poids(t.publications));
      expect(parTable.assignments).toBeGreaterThan(0);
      expect(parTable.assignments).toBeLessThanOrEqual(poids(t.assignments));
    });
  }
});

describe("cron de l'accueil : une étape qui échoue ne prive pas les autres", () => {
  it("range la paie et la rentabilité même quand les décisions échouent, puis signale l'échec", async () => {
    const { refreshAll } = await import("../convex/dashboardCache");
    const ecrits: string[] = [];
    const ctx = {
      runQuery: async (_fn: unknown, args: { projectId?: string; lot?: number }) => {
        if (args.projectId === undefined) return [P];
        if (args.lot !== undefined) return `{"lot":${args.lot}}`;
        // L'ordre des étapes : décisions (échoue), puis le passage de paie.
        if (!ecrits.includes("décisions tentées")) {
          ecrits.push("décisions tentées");
          throw new Error("Too many documents read");
        }
        return { dueTotalJson: '{"dueTotal":1}', leaderboard: [] };
      },
      runMutation: async (_fn: unknown, args: { key?: string; rows?: unknown[] }) => {
        ecrits.push(args.key ?? "classement");
        return { changed: true };
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(handler(refreshAll)(ctx, {})).rejects.toThrow("Too many documents read");
    expect(ecrits).toEqual(["décisions tentées", "dueTotal", "classement", "profitCosts:0/2", "profitCosts:1/2"]);
  });
});
