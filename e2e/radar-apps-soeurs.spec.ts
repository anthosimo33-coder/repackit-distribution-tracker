import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — les apps sœurs (lot 5 du dig, 14/11/2026) : les autres apps de l'éditeur d'une app suivie entrent dans la
 * file des contrôles comme une app des classements ; une app déjà connue n'est pas recréée. L'appel à l'App Store n'est
 * pas joué : ses réponses sont données ; la file et l'écriture sont les vraies.
 */
test.describe("Radar — apps sœurs, marques à slogan", () => {
  test("les apps sœurs neuves entrent dans la file, une déjà vue garde la sienne ; l'app suivie est notée regardée", async () => {
    const ts = Date.now();
    const p = `e2esib${ts}`;
    const sid = (n: number) => `9${ts}${n}`;
    const entry = (n: number, name: string) => ({ storeId: sid(n), name, artist: `Éditeur ${ts}`, genre: "Éducation", released: "2026-03-01" });
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, { secret: E2E_SECRET, apps: [{ slug: `${p}a`, name: `Suivie ${ts}`, rivalOf: [], strong: [`${p}a`] }], accounts: [] });
    // Une des sœurs est déjà dans la file (vue dans un classement français).
    await admin.mutation(api.radarStore.e2eSeedStoreApps, { secret: E2E_SECRET, country: "fr", entries: [entry(1, "Déjà vue")] });
    try {
      const r = await admin.mutation(api.radarStore.e2eAddSiblings, { secret: E2E_SECRET, slug: `${p}a`, entries: [entry(1, "Déjà vue"), entry(2, "Sœur A"), entry(3, "Sœur B")] });
      expect(r?.added).toBe(2);
      expect(r?.siblingsAt).toBeGreaterThan(ts - 1);
      expect(r?.queued).toEqual([
        { storeId: sid(1), countries: ["fr"] },
        { storeId: sid(2), countries: ["sibling"] },
        { storeId: sid(3), countries: ["sibling"] },
      ]);
      // Redemandées, elles ne sont pas recréées.
      expect((await admin.mutation(api.radarStore.e2eAddSiblings, { secret: E2E_SECRET, slug: `${p}a`, entries: [entry(2, "Sœur A")] }))?.added).toBe(0);
    } finally {
      await admin.mutation(api.radarStore.e2eClearStore, { secret: E2E_SECRET, prefix: `9${ts}` });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });

  test("une marque à slogan (« … IA n°1 ») est cherchée aussi sous son cœur : son réseau y est trouvé", async () => {
    const ts = Date.now();
    const core = `wgo${ts}`;
    const storeId = `8${ts}`;
    await admin.mutation(api.radarStore.e2eSeedStoreApps, {
      secret: E2E_SECRET,
      country: "fr",
      entries: [{ storeId, name: `Wgo${ts} IA n°1 - Quiz Révision`, artist: "Inc.", genre: "Éducation", released: "2026-02-01" }],
    });
    try {
      const r = await admin.mutation(api.radarStore.e2eCheckStoreApp, {
        secret: E2E_SECRET,
        storeId,
        // Seul le hashtag du cœur existe (comme #wilgo, quand #wilgoian1 n'existe pas).
        tags: [{ tag: core, videos: 1_106, views: 42_000_000, items: [`lea.${core}`, `kate.${core}`, "fan_x"].map((author) => ({ author, desc: `#${core}` })) }],
        profiles: [`lea.${core}`, `kate.${core}`, "fan_x"].map((handle) => ({ handle, fans: 300, bio: "", descs: [] })),
      });
      expect(r).toMatchObject({ outcome: "network", creators: 2 });
      expect(r?.read.tags).toEqual([`${core}ian1`, `${core}ian1app`, core, `${core}app`]);
    } finally {
      await admin.mutation(api.radarStore.e2eClearStore, { secret: E2E_SECRET, prefix: `8${ts}` });
    }
  });
});
