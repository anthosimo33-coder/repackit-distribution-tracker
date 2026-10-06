import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ActionCtx } from "../convex/_generated/server";
import type { Id } from "../convex/_generated/dataModel";
import { syncBonusAfterReleves } from "../convex/bonusSync";

const pub = (n: number) => `pub_${n}` as Id<"publications">;
const owner = (creator: string, project = "proj_snytch") => ({
  projectId: project as Id<"projects">,
  creatorId: creator as Id<"creators">,
});

/**
 * ctx d'action minimal. Les références de fonction Convex ne se comparent pas
 * par identité : on distingue la requête (ids de publications) de la mutation
 * (une créatrice) par la FORME de leurs arguments.
 */
function fakeCtx(opts: {
  owners: (ids: Id<"publications">[]) => ReturnType<typeof owner>[];
  failFor?: string;
}) {
  const queries: Id<"publications">[][] = [];
  const syncs: ReturnType<typeof owner>[] = [];
  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args: { publicationIds: Id<"publications">[] }) => {
      queries.push(args.publicationIds);
      return opts.owners(args.publicationIds);
    }),
    runMutation: vi.fn(async (_ref: unknown, args: ReturnType<typeof owner>) => {
      syncs.push(args);
      if (args.creatorId === opts.failFor) throw new Error("OCC");
      return { unlocked: 1, revoked: 0 };
    }),
  } as unknown as ActionCtx;
  return { ctx, queries, syncs };
}

describe("syncBonusAfterReleves — une synchro par créatrice, pas par post", () => {
  it("synchronise UNE fois chaque créatrice, quel que soit son nombre de posts", async () => {
    // 440 posts de la même créatrice + 2 d'une autre : le cas Kelly du 06/10.
    const ids = [...Array.from({ length: 440 }, (_, i) => pub(i)), pub(900), pub(901)];
    const { ctx, queries, syncs } = fakeCtx({
      owners: (part) =>
        part.some((p) => p === pub(900)) ? [owner("kelly"), owner("sarah")] : [owner("kelly")],
    });

    const r = await syncBonusAfterReleves(ctx, ids);

    // Résolution par paquets bornés (400), propriétaires dédoublonnés ENTRE paquets.
    expect(queries.map((q) => q.length)).toEqual([400, 42]);
    expect(syncs).toEqual([owner("kelly"), owner("sarah")]);
    expect(r).toEqual({ creatrices: 2, unlocked: 2, revoked: 0, echecs: 0 });
  });

  it("une même publication passée deux fois n'est résolue qu'une fois", async () => {
    const { ctx, queries } = fakeCtx({ owners: () => [owner("kelly")] });
    await syncBonusAfterReleves(ctx, [pub(1), pub(1), pub(2)]);
    expect(queries).toEqual([[pub(1), pub(2)]]);
  });

  it("même créatrice dans deux projets = deux synchros (la grille est par projet)", async () => {
    const { ctx, syncs } = fakeCtx({
      owners: () => [owner("kelly", "proj_a"), owner("kelly", "proj_b")],
    });
    await syncBonusAfterReleves(ctx, [pub(1), pub(2)]);
    expect(syncs).toEqual([owner("kelly", "proj_a"), owner("kelly", "proj_b")]);
  });

  it("une créatrice en échec n'empêche pas les autres, et ne lève pas", async () => {
    const { ctx, syncs } = fakeCtx({
      owners: () => [owner("kelly"), owner("sarah"), owner("orlane")],
      failFor: "sarah",
    });
    const r = await syncBonusAfterReleves(ctx, [pub(1)]);
    expect(syncs.map((s) => s.creatorId)).toEqual(["kelly", "sarah", "orlane"]);
    expect(r).toEqual({ creatrices: 2, unlocked: 2, revoked: 0, echecs: 1 });
  });

  it("rien à synchroniser : aucune lecture", async () => {
    const { ctx, queries, syncs } = fakeCtx({ owners: () => [] });
    const r = await syncBonusAfterReleves(ctx, []);
    expect(queries).toEqual([]);
    expect(syncs).toEqual([]);
    expect(r.creatrices).toBe(0);
  });
});

/**
 * CÂBLAGE. Différer les paliers n'est juste que si quelqu'un les synchronise
 * en fin de passage : un relevé qui passe `differerBonus: true` sans que son
 * action appelle `syncBonusAfterReleves` laisserait les paliers figés jusqu'au
 * prochain paiement — sans erreur nulle part. Les tests ci-dessus ne voient pas
 * ce défaut ; ce contrôle-ci, si.
 */
describe("câblage des relevés en masse", () => {
  const dir = path.join(__dirname, "..", "convex");
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .map((f) => ({ f, src: readFileSync(path.join(dir, f), "utf8") }));

  /** Modules qui ÉCRIVENT des relevés pour le compte d'une action appelante. */
  const COLLECTEURS: Record<string, string[]> = {
    "tiktokInternal.ts": ["collectTikTokInternally", "rescueWithApify"],
    "snapchatInternal.ts": ["collectSnapchatInternally"],
  };

  /** Arguments de chaque appel `runMutation(internal.apifySync.recordApifySnapshot, {…})`. */
  const appels = (src: string): string[] => {
    const out: string[] = [];
    const re = /internal\.apifySync\.recordApifySnapshot,\s*\{/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      let depth = 1;
      let i = m.index + m[0].length;
      while (depth > 0 && i < src.length) {
        if (src[i] === "{") depth += 1;
        if (src[i] === "}") depth -= 1;
        i += 1;
      }
      out.push(src.slice(m.index, i));
    }
    return out;
  };

  it("chaque relevé en masse diffère ses paliers", () => {
    const sites = sources.flatMap(({ f, src }) => appels(src).map((a) => ({ f, a })));
    // PRÉSENCE : le contrôle voit bien les sept sites d'écriture d'aujourd'hui.
    expect(sites.length).toBeGreaterThanOrEqual(7);
    const sansDiffere = sites.filter((s) => !/differerBonus:\s*true/.test(s.a)).map((s) => s.f);
    expect(sansDiffere).toEqual([]);
  });

  it("toute action qui relève en masse synchronise les paliers en fin de passage", () => {
    const collecteurs = Object.values(COLLECTEURS).flat();
    const releveurs = sources.filter(
      ({ f, src }) =>
        !(f in COLLECTEURS) &&
        f !== "bonusSync.ts" &&
        (appels(src).length > 0 ||
          collecteurs.some((c) => new RegExp(`\\b${c}\\(`).test(src))),
    );
    expect(releveurs.map((r) => r.f).sort()).toEqual(["apifySync.ts", "nightlyViewsSync.ts"]);
    const oublis = releveurs.filter(({ src }) => !/\bsyncBonusAfterReleves\(/.test(src)).map((r) => r.f);
    expect(oublis).toEqual([]);
  });
});
