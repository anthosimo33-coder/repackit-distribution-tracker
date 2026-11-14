import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — un compte mis en pause « hors sujet » ne reprend que PROUVÉ, comme à son entrée (14/11/2026). Jusque-là,
 * le rejugement (toutes les 6 h) relançait un compte dès qu'UNE de ses vidéos rangées citait l'app : 597 comptes
 * relançables le 13/11, aux trois quarts des déchets. Il faut maintenant son pseudo, sa bio, ou au moins deux vidéos.
 *
 * Ce qui est suivi se lit dans l'export vers Swarm (seuls les comptes actifs partent). Comptes globaux, base e2e
 * partagée : le test sème les siens sous un marqueur et les efface.
 */
type Row = Record<string, unknown>;

async function trackedHandles(): Promise<Set<string>> {
  const out = new Set<string>();
  let cursor: string | null = null;
  for (let i = 0; i < 500; i++) {
    const r = (await admin.mutation(api.swarmExport.e2eSwarmExport, { secret: E2E_SECRET, table: "tracked", cursor })) as { rows: Row[]; cursor: string; done: boolean };
    for (const t of r.rows) out.add(t.handle as string);
    if (r.done) return out;
    cursor = r.cursor;
  }
  throw new Error("export tracked : trop de pages");
}

test.describe("Radar — la reprise d'un compte en pause", () => {
  test("une seule vidéo qui cite l'app ne suffit plus ; deux, oui", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const p = `e2erp${ts}`;
    const h = (n: number) => `rrp${n}_${ts}`;
    // Neuf vidéos rangées, dont `cites` citent l'app (ses motifs ont changé depuis sa mise en pause, par exemple).
    const videos = (n: number, cites: number) =>
      Array.from({ length: 9 }, (_, i) => ({ videoId: `${p}v${n}${i}`, ageH: 24 * (i + 1), views: 1_000, caption: i < cites ? `Je teste ${p}a ${i}` : `Ma journée ${i}` }));
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: `E2E Reprise ${ts}`, rivalOf: [], strong: [`${p}a`] }],
      accounts: [
        { handle: h(1), appSlug: `${p}a`, fans: 100, posts7d: 0, offTopic: true, videos: videos(1, 1) },
        { handle: h(2), appSlug: `${p}a`, fans: 100, posts7d: 0, offTopic: true, videos: videos(2, 2) },
      ],
    });
    try {
      const avant = await trackedHandles();
      expect([avant.has(h(1)), avant.has(h(2))]).toEqual([false, false]);
      await admin.mutation(api.radarNetworks.e2eRejudgePaused, { secret: E2E_SECRET });
      const apres = await trackedHandles();
      // Une mention isolée : il reste en pause. Deux vidéos qui citent l'app : il reprend.
      expect([apres.has(h(1)), apres.has(h(2))]).toEqual([false, true]);
    } finally {
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
