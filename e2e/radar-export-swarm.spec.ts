import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar → Swarm : l'export ne part plus qu'avec ce que le Radar suit ENCORE (14/11/2026). Le 13/11, Swarm comptait
 * sous une app les vidéos de ses comptes mis en pause « hors sujet » (55 % des vues affichées, l'accueil tenu par
 * Hush avec la vidéo d'une chanteuse) : un compte en pause, ses vidéos, ses signaux et ses reprises de format ne
 * partent plus. Chaque vidéo et chaque signal disent s'ils citent leur app. La JUSTIFICATION d'un compte (pseudo,
 * bio, vidéos, comment il est entré) reste interne (14/11/2026) : elle ne part plus, et un compte que plus rien ne
 * relie à son app ne part pas.
 *
 * La page lue est celle que sert /swarm/export (même fonction), page par page comme le fait Swarm. Les comptes
 * suivis sont GLOBAUX et la base e2e partagée : le test ne regarde que les siens (marqueur) et les efface.
 */
type Row = Record<string, unknown>;
type Table = "apps" | "tracked" | "trackedVideos" | "formats" | "signals";

async function exportAll(table: Table, apps?: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 500; i++) {
    const r = (await admin.mutation(api.swarmExport.e2eSwarmExport, { secret: E2E_SECRET, table, cursor, ...(apps ? { apps } : {}) })) as { rows: Row[]; cursor: string; done: boolean };
    rows.push(...r.rows);
    if (r.done) return rows;
    cursor = r.cursor;
  }
  throw new Error(`export ${table} : trop de pages`);
}

test.describe("Radar → Swarm — l'export", () => {
  test("seuls les comptes suivis ET reliés à leur app partent, sans leur justification ; chaque vidéo et chaque signal disent s'ils citent l'app", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2esw${ts}`;
    const m = `e2eswm${ts}`;
    const h = (n: number) => `rsw${n}_${ts}`;
    const appName = `E2E Export ${ts}`;
    const vid = (n: number, i: number) => `${m}${n}${i}`;
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: appName, rivalOf: [], strong: [`${p}a`] }],
      accounts: [
        // 1 : sa bio nomme l'app ; une vidéo sur deux la cite.
        {
          handle: h(1),
          appSlug: `${p}a`,
          fans: 1_000,
          posts7d: 2,
          bio: `J'utilise ${p}a tous les jours`,
          videos: [
            { videoId: vid(1, 1), ageH: 20, views: 5_000, caption: `Mon astuce avec ${p}a` },
            { videoId: vid(1, 2), ageH: 44, views: 3_000, caption: "Ma routine du matin" },
          ],
        },
        // 2 : en pause « hors sujet » (une chanteuse sous l'app, comme Hush) : rien de lui ne part.
        {
          handle: h(2),
          appSlug: `${p}a`,
          fans: 9_000_000,
          posts7d: 1,
          offTopic: true,
          videos: [{ videoId: vid(2, 1), ageH: 30, views: 4_300_000, caption: "New single out now" }],
        },
        // 3 : son pseudo porte l'app.
        { handle: `${p}a_fan${ts}`, appSlug: `${p}a`, fans: 50, posts7d: 1, videos: [{ videoId: vid(3, 1), ageH: 10, views: 800, caption: "Bonne journée" }] },
        // 4 : rien dans la bio, deux vidéos sur trois citent l'app.
        {
          handle: h(4),
          appSlug: `${p}a`,
          fans: 120,
          posts7d: 3,
          videos: [
            { videoId: vid(4, 1), ageH: 5, views: 900, caption: `Le site c'est ${p}a` },
            { videoId: vid(4, 2), ageH: 29, views: 700, caption: `Encore ${p}a` },
            { videoId: vid(4, 3), ageH: 53, views: 600, caption: "Mon chat" },
          ],
        },
        // 5 : actif, mais plus rien ne le relie à son app (ni pseudo, ni bio, aucune vidéo qui la cite) : ne part pas.
        { handle: h(5), appSlug: `${p}a`, fans: 300, posts7d: 1, videos: [{ videoId: vid(5, 1), ageH: 8, views: 1_200, caption: "Ma recette du jour" }] },
      ],
      formats: [
        {
          kind: "hook",
          key: `${p}hook`,
          label: "pov tu découvres",
          members: [
            { handle: h(1), videoId: vid(1, 1), views: 5_000, ageH: 20 },
            { handle: h(2), videoId: vid(2, 1), views: 4_300_000, ageH: 30 },
          ],
        },
      ],
    });
    await admin.mutation(api.radarSignals.e2eSeedSignals, {
      secret: E2E_SECRET,
      signals: [
        { videoId: `${m}s1`, handle: h(1), fans: 1_000, caption: `Mon astuce avec ${p}a ${m}`, lang: "fr", publishedAt: ts - 20 * 3_600_000, views: 50_000, app: appName, tracked: true },
        { videoId: `${m}s2`, handle: h(2), fans: 9_000_000, caption: `New single out now ${m}`, lang: "en", publishedAt: ts - 30 * 3_600_000, views: 4_300_000, app: appName, tracked: true },
      ],
    });
    try {
      // ── Les comptes : les actifs seulement, chacun avec ce qui le relie à son app ──
      const mine = new Set([h(1), h(2), `${p}a_fan${ts}`, h(4), h(5)]);
      const tracked = (await exportAll("tracked")).filter((t) => mine.has(t.handle as string));
      const byHandle = new Map(tracked.map((t) => [t.handle as string, t]));
      // Le compte en pause ne part pas ; celui que plus rien ne relie à son app part « en pause » (pas un créateur pour
      // Swarm), pour que ses vidéos gardent leur pseudo.
      expect([...byHandle.keys()].sort()).toEqual([h(1), h(4), h(5), `${p}a_fan${ts}`].sort());
      expect(byHandle.get(h(5))).toMatchObject({ handle: h(5), status: "paused" });
      expect(tracked.filter((t) => t.status === "active").map((t) => t.handle as string).sort()).toEqual([h(1), h(4), `${p}a_fan${ts}`].sort());
      expect(byHandle.get(h(1))).toMatchObject({ status: "active", bio: `J'utilise ${p}a tous les jours` });
      // Aucune justification ne part, pour aucun compte.
      for (const t of tracked) for (const k of ["proof", "matchedBy", "proofAt"]) expect(t).not.toHaveProperty(k);

      // ── Les vidéos : celles des comptes actifs, chacune dit si elle cite son app ──
      const videos = new Map((await exportAll("trackedVideos")).filter((x) => (x.videoId as string).startsWith(m)).map((x) => [x.videoId as string, x.cites]));
      expect(Object.fromEntries([...videos].sort())).toEqual(
        // La vidéo du compte au pseudo de l'app la cite par le pseudo (règle du Radar).
        // Celle du compte que rien ne relie plus à son app part encore (compte actif), et dit qu'elle ne la cite pas : Swarm ne la compte pas.
        Object.fromEntries([[vid(1, 1), true], [vid(1, 2), false], [vid(3, 1), true], [vid(4, 1), true], [vid(4, 2), true], [vid(4, 3), false], [vid(5, 1), false]].sort()),
      );
      expect(videos.has(vid(2, 1))).toBe(false);

      // ── Les formats : les reprises des comptes suivis seulement ──
      const format = (await exportAll("formats")).find((f) => f.key === `${p}hook`);
      expect(format).toMatchObject({ accountCount: 1, maxViews: 5_000 });
      expect((format!.members as { handle: string }[]).map((x) => x.handle)).toEqual([h(1)]);

      // ── Les signaux : pas ceux d'un compte en pause ; ceux qui restent disent s'ils citent l'app ──
      const signals = (await exportAll("signals")).filter((s) => (s.videoId as string).startsWith(m));
      expect(signals.map((s) => [s.videoId, s.appName, s.cites])).toEqual([[`${m}s1`, appName, true]]);
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });

  test("par groupes d'apps : `apps` ne rend que les comptes et vidéos rangés sous ces apps ; les vidéos partent allégées (15/11/2026)", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2eswg${ts}`;
    const h = (n: number) => `rswg${n}_${ts}`;
    const vids = (n: number, k: number) => Array.from({ length: k }, (_, i) => ({ videoId: `${p}v${n}${i}`, ageH: 5 + i, views: 1_000 + i, caption: `Avec ${p}${n === 3 ? "b" : "a"} encore` }));
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [
        { slug: `${p}a`, name: `E2E Groupe A ${ts}`, rivalOf: [], strong: [`${p}a`] },
        { slug: `${p}b`, name: `E2E Groupe B ${ts}`, rivalOf: [], strong: [`${p}b`] },
      ],
      accounts: [
        { handle: h(1), appSlug: `${p}a`, fans: 100, posts7d: 2, videos: vids(1, 3) },
        { handle: h(2), appSlug: `${p}a`, fans: 100, posts7d: 2, videos: vids(2, 2) },
        { handle: h(3), appSlug: `${p}b`, fans: 100, posts7d: 2, videos: vids(3, 2) },
      ],
    });
    try {
      const ids = new Map((await exportAll("apps")).filter((a) => (a.slug as string).startsWith(p)).map((a) => [a.slug as string, a.id as string]));
      const [a, b] = [ids.get(`${p}a`)!, ids.get(`${p}b`)!];
      const handles = async (apps: string[]) => (await exportAll("tracked", apps)).map((t) => t.handle as string).sort();
      expect(await handles([a])).toEqual([h(1), h(2)]);
      expect(await handles([b])).toEqual([h(3)]);
      expect(await handles([a, b])).toEqual([h(1), h(2), h(3)]);
      const videos = await exportAll("trackedVideos", [b, a]);
      expect(videos.map((x) => x.videoId as string).sort()).toEqual([...vids(1, 3), ...vids(2, 2), ...vids(3, 2)].map((x) => x.videoId).sort());
      // Ce que Swarm ne lit pas ne part plus.
      for (const x of videos) for (const k of ["id", "hookKey", "coverUrl", "lastSeenAt"]) expect(x).not.toHaveProperty(k);
      expect(videos[0]).toMatchObject({ cites: true, platform: "tiktok" });
      // Un id qui n'est pas une app, ou une autre table que tracked et trackedVideos : refusé.
      await expect(exportAll("tracked", ["pas-un-id"])).rejects.toThrow(/n'est pas l'id d'une app/);
      await expect(exportAll("signals", [a])).rejects.toThrow(/tracked et trackedVideos/);
    } finally {
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });

  test("une app en pause ou à l'essai ne part pas : ni ses créateurs, ni leurs vidéos, ni leurs reprises, ni leurs signaux (15/11/2026)", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2eswh${ts}`;
    const m = `e2eswhm${ts}`;
    const h = (l: string) => `${p}${l}_fan`;
    const nom = (l: string) => `E2E Cachée ${l} ${ts}`;
    // Trois apps : suivie (a), en pause (b, comme Hipobuy hors périmètre), à l'essai (c) ; un compte prouvé chacune.
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: ["a", "b", "c"].map((l) => ({ slug: `${p}${l}`, name: nom(l), rivalOf: [], strong: [`${p}${l}`] })),
      accounts: ["a", "b", "c"].map((l) => ({ handle: h(l), appSlug: `${p}${l}`, fans: 500, posts7d: 1, videos: [{ videoId: `${m}${l}1`, ageH: 6, views: 2_000, caption: `Avec ${p}${l}` }] })),
      formats: [{ kind: "hook", key: `${p}hook`, label: "pov tu caches", members: ["a", "b", "c"].map((l) => ({ handle: h(l), videoId: `${m}${l}1`, views: 2_000, ageH: 6 })) }],
    });
    await admin.mutation(api.radarSignals.e2eSeedSignals, {
      secret: E2E_SECRET,
      signals: ["a", "b", "c"].map((l) => ({ videoId: `${m}s${l}`, handle: h(l), fans: 500, caption: `Avec ${p}${l} ${m}`, lang: "fr", publishedAt: ts - 6 * 3_600_000, views: 40_000, app: nom(l), tracked: true })),
    });
    await admin.mutation(api.swarmExport.e2eSetAppState, { secret: E2E_SECRET, slug: `${p}b`, state: "paused" });
    await admin.mutation(api.swarmExport.e2eSetAppState, { secret: E2E_SECRET, slug: `${p}c`, state: "trial" });
    try {
      const mine = (rows: Row[], k: string) => rows.map((r) => r[k] as string).filter((x) => x.startsWith(p) || x.startsWith(m)).sort();
      expect(mine(await exportAll("tracked"), "handle")).toEqual([h("a")]);
      expect(mine(await exportAll("trackedVideos"), "videoId")).toEqual([`${m}a1`]);
      expect(mine(await exportAll("signals"), "videoId")).toEqual([`${m}sa`]);
      const format = (await exportAll("formats")).find((f) => f.key === `${p}hook`);
      expect((format!.members as { handle: string }[]).map((x) => x.handle)).toEqual([h("a")]);
      // Filtré par apps, pareil : l'app cachée ne rend rien.
      const ids = new Map((await exportAll("apps")).filter((a) => (a.slug as string).startsWith(p)).map((a) => [a.slug as string, a.id as string]));
      expect(mine(await exportAll("tracked", [ids.get(`${p}b`)!, ids.get(`${p}c`)!]), "handle")).toEqual([]);
      // L'essai réussi (l'app redevient suivie) : tout revient à la synchro suivante.
      await admin.mutation(api.swarmExport.e2eSetAppState, { secret: E2E_SECRET, slug: `${p}c`, state: "active" });
      expect(mine(await exportAll("tracked"), "handle")).toEqual([h("a"), h("c")]);
      expect(mine(await exportAll("signals"), "videoId")).toEqual([`${m}sa`, `${m}sc`]);
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
