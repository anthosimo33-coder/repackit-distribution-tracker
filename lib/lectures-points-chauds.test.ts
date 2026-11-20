import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import type { ProjectQueryCtx } from "../convex/functions";
import { getAttributionCore, getReliabilityCore } from "../convex/analyticsHub";
import { getMarketPnlCore } from "../convex/marketPnl";
import { invalidatePayCaches, writePaymentRows } from "../convex/dashboardCache";
import {
  computeDueTotal,
  computePayrollCaches,
  computeProjectLeaderboard,
  listPayments,
  markCyclePaid,
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
    paymentRowsCache: [],
    payCacheEpochs: [],
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

/** Le contexte d'une mutation : lectures dans la base en mémoire, écritures et planifications notées (jamais relues). */
function mutationContexte(t: Record<string, MemoryDoc[]>) {
  const mem = memoryDb(t, { limit: null });
  const ecritures: { op: string; cible: string; valeur?: Record<string, unknown> }[] = [];
  const planifies: { args: Record<string, unknown> }[] = [];
  const db = mem.db as object;
  const ctx = {
    db: {
      ...db,
      insert: async (table: string, valeur: Record<string, unknown>) => {
        ecritures.push({ op: "insert", cible: table, valeur });
        return `${table}_neuf`;
      },
      patch: async (id: string, valeur: Record<string, unknown>) => void ecritures.push({ op: "patch", cible: id, valeur }),
      replace: async (id: string, valeur: Record<string, unknown>) => void ecritures.push({ op: "replace", cible: id, valeur }),
      delete: async (id: string) => void ecritures.push({ op: "delete", cible: id }),
    },
    projectId: P as Id<"projects">,
    userId: ADMIN as Id<"users">,
    auth: { getUserIdentity: async () => ({ subject: `${ADMIN}|session`, tokenIdentifier: "t", issuer: "i" }) },
    scheduler: {
      runAfter: async (_ms: number, _fn: unknown, args: Record<string, unknown>) => void planifies.push({ args }),
      runAt: async (_ms: number, _fn: unknown, args: Record<string, unknown>) => void planifies.push({ args }),
    },
  };
  return { mem, ecritures, planifies, ctx };
}

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
      const r = (await handler(computeCostsJson)(ctx, { projectId: P, lot, lots: 2 })) as { json: string; epoch: number };
      expect(r.epoch).toBe(0);
      t.dashboardCache.push(doc("dashboardCache", { projectId: P, key: `profitCosts:${lot}/2`, json: r.json, changedAt: NOW }));
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
});

describe("écran Paiements : lu dans le cache que range le passage de paie", () => {
  /** Les parts que range le cron, posées comme le ferait `writePaymentRows`. */
  async function ranger(t: Record<string, MemoryDoc[]>) {
    const { ctx } = contexte(t);
    const paie = (await handler(computePayrollCaches)(ctx, { projectId: P })) as { rowsParts: string[]; epoch: number };
    for (const [part, json] of paie.rowsParts.entries()) {
      t.paymentRowsCache.push(doc("paymentRowsCache", { projectId: P, part, of: paie.rowsParts.length, json, changedAt: NOW }));
    }
    return paie;
  }

  it("rend les lignes du calcul direct à l'identique, sans relire publications ni assignations", async () => {
    const t = monde();
    const direct = contexte(t);
    const lignes = (await handler(listPayments)(direct.ctx, { projectId: P })) as { status: string; totalDue: number }[];
    // Le monde n'est pas vide : des cycles payés et des cycles dus.
    expect(lignes.some((l) => l.status !== "paid" && l.totalDue > 0)).toBe(true);
    expect(direct.mem.bytesByTable().publications).toBeGreaterThan(0);

    await ranger(t);
    const { mem, ctx } = contexte(t);
    expect(await handler(listPayments)(ctx, { projectId: P })).toEqual(lignes);
    expect(mem.bytesByTable().publications ?? 0).toBe(0);
    expect(mem.bytesByTable().assignments ?? 0).toBe(0);
  });

  it("des parts incomplètes ne se servent pas : calcul direct", async () => {
    const t = monde();
    await ranger(t);
    t.paymentRowsCache[0].of = 2; // la part 1 manque
    const { mem, ctx } = contexte(t);
    await handler(listPayments)(ctx, { projectId: P });
    expect(mem.bytesByTable().publications).toBeGreaterThan(0);
  });

  it("un passage lu avant une mutation d'argent ne range rien", async () => {
    const t = monde();
    const { rowsParts, epoch } = await ranger(t);
    t.payCacheEpochs.push(doc("payCacheEpochs", { projectId: P, epoch: epoch + 1 }));
    const perime = mutationContexte(t);
    expect(await handler(writePaymentRows)(perime.ctx, { projectId: P, parts: ["[]"], epoch })).toEqual({ changed: false, stale: true });
    expect(perime.ecritures).toEqual([]);
    // Au bon compteur, une part identique n'est pas réécrite ; une part en trop part.
    const frais = mutationContexte(t);
    const r = await handler(writePaymentRows)(frais.ctx, { projectId: P, parts: rowsParts, epoch: epoch + 1 });
    expect(r).toEqual({ changed: false, stale: false });
    expect(frais.ecritures).toEqual([]);
  });

  it("une mutation d'argent supprime total dû, lots de rentabilité et lignes, avance le compteur et planifie un recalcul", async () => {
    const lignes = ["decisions", "dueTotal", "profitCosts:0/2", "profitCosts:1/2"].map((key) =>
      doc("dashboardCache", { projectId: P, key, json: "{}", changedAt: NOW }),
    );
    const autreProjet = doc("dashboardCache", { projectId: "projects_blush", key: "dueTotal", json: "{}", changedAt: NOW });
    const parts = [0, 1].map((part) => doc("paymentRowsCache", { projectId: P, part, of: 2, json: "[]", changedAt: NOW }));
    const compteur = doc("payCacheEpochs", { projectId: P, epoch: 4 });
    const { ecritures, planifies, ctx } = mutationContexte({
      dashboardCache: [...lignes, autreProjet],
      paymentRowsCache: parts,
      payCacheEpochs: [compteur],
    });
    await invalidatePayCaches(ctx as unknown as MutationCtx, P as Id<"projects">);
    expect(ecritures.filter((e) => e.op === "delete").map((e) => e.cible).sort()).toEqual(
      [lignes[1]._id, lignes[2]._id, lignes[3]._id, parts[0]._id, parts[1]._id].sort(),
    );
    expect(ecritures).toContainEqual({ op: "patch", cible: compteur._id, valeur: { epoch: 5 } });
    expect(planifies).toEqual([{ args: { projectId: P, epoch: 5 } }]);
  });
});

describe("Marquer payé : le montant vu est le montant gelé, ou rien", () => {
  async function aPayer(t: Record<string, MemoryDoc[]>) {
    const { ctx } = contexte(t);
    const lignes = (await handler(listPayments)(ctx, { projectId: P })) as {
      status: string; totalDue: number; creatorId: string; cycleIndex: number;
    }[];
    const cible = lignes.find((l) => l.status !== "paid" && l.totalDue > 0);
    if (!cible) throw new Error("aucun cycle dû dans le monde de test");
    return cible;
  }

  it("gèle le montant montré", async () => {
    const t = monde();
    const cible = await aPayer(t);
    const { ecritures, ctx } = mutationContexte(t);
    const r = await handler(markCyclePaid)(ctx, {
      projectId: P, creatorId: cible.creatorId, cycleIndex: cible.cycleIndex, expectedTotalDue: cible.totalDue,
    });
    expect(r).toEqual({ ok: true, alreadyPaid: false });
    const gele = ecritures.find((e) => e.op === "insert" && e.cible === "payments");
    expect(gele?.valeur).toMatchObject({ status: "paid", totalDue: cible.totalDue });
  });

  it("refuse un montant qui n'est plus le dû : rien n'est gelé, l'écran est invalidé", async () => {
    const t = monde();
    const cible = await aPayer(t);
    const { ecritures, planifies, ctx } = mutationContexte(t);
    const r = await handler(markCyclePaid)(ctx, {
      projectId: P, creatorId: cible.creatorId, cycleIndex: cible.cycleIndex, expectedTotalDue: cible.totalDue - 0.01,
    });
    expect(r).toEqual({
      ok: false,
      alreadyPaid: false,
      amountChanged: { seen: Math.round((cible.totalDue - 0.01) * 100) / 100, current: cible.totalDue },
    });
    expect(ecritures.filter((e) => e.cible === "payments" || e.cible.startsWith("payments_"))).toEqual([]);
    expect(ecritures).toContainEqual({ op: "insert", cible: "payCacheEpochs", valeur: { projectId: P, epoch: 1 } });
    expect(planifies).toHaveLength(1);
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

/** Un contexte d'action : chaque query et mutation est reconnue à ses arguments. */
function actionContexte(opts: { epochActuel?: number; decisionsEchouent?: boolean } = {}) {
  const ecrits: string[] = [];
  const ctx = {
    runQuery: async (_fn: unknown, args: { projectId?: string; lot?: number }) => {
      if (args.projectId === undefined) return [P];
      if (args.lot !== undefined) return { json: `{"lot":${args.lot}}`, epoch: 3 };
      // Ordre : compteur (recalcul planifié seulement), décisions (cron seulement), passage de paie.
      if (opts.epochActuel !== undefined && !ecrits.includes("compteur lu")) {
        ecrits.push("compteur lu");
        return opts.epochActuel;
      }
      if (opts.decisionsEchouent && !ecrits.includes("décisions tentées")) {
        ecrits.push("décisions tentées");
        throw new Error("Too many documents read");
      }
      return { dueTotalJson: '{"dueTotal":1}', leaderboard: [], rowsParts: ["[]"], epoch: 3 };
    },
    runMutation: async (_fn: unknown, args: { key?: string; rows?: unknown[]; parts?: string[]; epoch?: number }) => {
      ecrits.push(args.key ? `${args.key}${args.epoch !== undefined ? `@${args.epoch}` : ""}` : args.parts ? `lignes@${args.epoch}` : "classement");
      return { changed: true };
    },
  };
  return { ecrits, ctx };
}

describe("cron de l'accueil : une étape qui échoue ne prive pas les autres", () => {
  it("range la paie et la rentabilité même quand les décisions échouent, puis signale l'échec", async () => {
    const { refreshAll } = await import("../convex/dashboardCache");
    const { ecrits, ctx } = actionContexte({ decisionsEchouent: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(handler(refreshAll)(ctx, {})).rejects.toThrow("Too many documents read");
    expect(ecrits).toEqual([
      "décisions tentées",
      "dueTotal@3",
      "classement",
      "lignes@3",
      "profitCosts:0/2@3",
      "profitCosts:1/2@3",
    ]);
  });
});

describe("recalcul planifié après une mutation d'argent", () => {
  it("range les vues de la paie avec le compteur lu par le calcul", async () => {
    const { refreshPay } = await import("../convex/dashboardCache");
    const { ecrits, ctx } = actionContexte({ epochActuel: 3 });
    expect(await handler(refreshPay)(ctx, { projectId: P, epoch: 3 })).toEqual({ skipped: false });
    expect(ecrits).toEqual(["compteur lu", "dueTotal@3", "classement", "lignes@3", "profitCosts:0/2@3", "profitCosts:1/2@3"]);
  });

  it("ne fait rien quand une invalidation plus récente en a planifié un autre", async () => {
    const { refreshPay } = await import("../convex/dashboardCache");
    const { ecrits, ctx } = actionContexte({ epochActuel: 4 });
    expect(await handler(refreshPay)(ctx, { projectId: P, epoch: 3 })).toEqual({ skipped: true });
    expect(ecrits).toEqual(["compteur lu"]);
  });
});
