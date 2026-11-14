import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — le juge v2 (14/11/2026), après la relecture à la main des 125 premiers verdicts qui auraient agi (3 sur 10
 * faux) : l'IA lit d'abord les vidéos qui citent l'app, même plus anciennes que les 10 dernières, avec le décompte de
 * la preuve ; un jugement v1 ne compte plus (le compte, l'app, sont rejugés). L'appel à l'IA n'est pas joué.
 */
test.describe("Radar — juge v2", () => {
  test("les vidéos qui citent l'app d'abord, la preuve comptée ; un jugement v1 est refait, un v2 non", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const p = `e2ejv2${ts}`;
    const h = (n: number) => `rjv2${n}_${ts}`;
    // 12 vidéos : les 10 dernières n'en parlent pas, les 2 plus anciennes citent l'app.
    const videos = Array.from({ length: 12 }, (_, i) => ({
      videoId: `${p}v${i}`,
      ageH: 10 + i * 10,
      views: 100 + i,
      caption: i >= 10 ? `mon avis sur ${p}a numéro ${i}` : `vlog du jour ${i}`,
    }));
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: `Jugee ${ts}`, rivalOf: [], strong: [`${p}a`] }],
      accounts: [
        { handle: h(1), appSlug: `${p}a`, fans: 300, posts7d: 3, videos },
        { handle: h(2), appSlug: `${p}a`, fans: 300, posts7d: 1, videos: [{ videoId: `${p}w1`, ageH: 20, views: 50, caption: "ma recette" }] },
      ],
    });
    try {
      // h(2) déjà jugé en v1 ; l'app aussi (« media », v1).
      await admin.mutation(api.radarJudge.e2eLegacyJudgment, { secret: E2E_SECRET, handle: h(2), slug: `${p}a` });

      const r = await admin.mutation(api.radarJudge.e2eJudgeAccounts, {
        secret: E2E_SECRET,
        handles: [h(1), h(2)],
        answers: [
          { handle: h(1), verdict: "placement", why: "deux vidéos" },
          { handle: h(2), verdict: "sans_rapport", why: "recettes" },
        ],
      });
      // Le jugement v1 ne compte plus : h(2) est redonné à juger.
      expect(r.asked.map((a: { handle: string }) => a.handle).sort()).toEqual([h(1), h(2)].sort());
      expect(r.written).toBe(2);
      const block = r.prompt.split("\n\n").find((b: string) => b.includes(`account: @${h(1)}`))!;
      expect(block).toContain("evidence: 2 of 12 stored videos contain the product's name or tag (listed first); bio names it: no; account found through a video naming the product");
      const list = block.split("then the latest: ")[1];
      expect(list.startsWith(`"mon avis sur ${p}a numéro 10" | "mon avis sur ${p}a numéro 11" | "vlog du jour 0"`)).toBe(true);
      // Le jugement v1 est remplacé : un seul jugement, le v2.
      expect(await admin.mutation(api.radarJudge.e2eJudgmentsOf, { secret: E2E_SECRET, handle: h(2) })).toEqual([{ verdict: "sans_rapport", why: "recettes", v: 2 }]);
      // Jugés en v2 : plus redemandés.
      const again = await admin.mutation(api.radarJudge.e2eJudgeAccounts, { secret: E2E_SECRET, handles: [h(1), h(2)], answers: [] });
      expect(again.asked).toEqual([]);

      // L'app jugée en v1 est rejugée tout de suite, puis plus.
      const n = await admin.mutation(api.radarJudge.e2eJudgeNatures, {
        secret: E2E_SECRET,
        slugs: [`${p}a`],
        answers: [{ slug: `${p}a`, nature: { digital: true, kind: "app", aboutIt: "oui", why: "une app" } }],
      });
      expect(n.asked.map((a: { name: string }) => a.name)).toEqual([`Jugee ${ts}`]);
      expect(n.written).toBe(1);
      const n2 = await admin.mutation(api.radarJudge.e2eJudgeNatures, { secret: E2E_SECRET, slugs: [`${p}a`], answers: [] });
      expect(n2.asked).toEqual([]);
    } finally {
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
