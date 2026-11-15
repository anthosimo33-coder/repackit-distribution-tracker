import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — le juge v3 (15/11/2026), après la relecture de 227 actions v2 (~15 % fausses) : la preuve compte les mentions
 * de pub et les hashtags de campagne (réseau d'Astra AI) ; un compte de liste sans autre preuve n'est jamais « sans
 * rapport » ; le produit sans phrase connue est décrit par son jugement ; « pousse » garde l'autre app poussée aussi.
 * L'appel à l'IA n'est pas joué : la réponse est donnée.
 */
test.describe("Radar — juge v3", () => {
  test("pub et campagnes comptées, compte de liste protégé, produit décrit, autre app gardée", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const p = `e2ejv3${ts}`;
    const h = (n: number) => `rjv3${n}_${ts}`;
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: `Jugee ${ts}`, rivalOf: [], strong: [`${p}a`] }],
      accounts: [
        // Un compte du réseau : venu d'une liste, ses légendes ne nomment pas l'app, mais portent pub et code de campagne.
        { handle: h(1), appSlug: `${p}a`, fans: 900, posts7d: 3, seed: true, videos: [1, 2, 3, 4, 5, 6].map((i) => ({ videoId: `${p}v1${i}`, ageH: i * 10, views: 100 * i, caption: `tip para estudiar ${i} #studytok #460${i} adv` })) },
        // Pousse son app et une autre : deux vidéos chacune.
        { handle: h(2), appSlug: `${p}a`, fans: 300, posts7d: 2, videos: [1, 2, 3, 4, 5].map((i) => ({ videoId: `${p}v2${i}`, ageH: i * 10, views: 50, caption: i <= 2 ? `mon avis ${p}a` : i <= 4 ? "et Mokascore aussi" : "vlog" })) },
      ],
    });
    try {
      // Le produit n'a pas de phrase connue : son jugement le décrit.
      await admin.mutation(api.radarJudge.e2eLegacyJudgment, { secret: E2E_SECRET, slug: `${p}a` });
      const r = await admin.mutation(api.radarJudge.e2eJudgeAccounts, {
        secret: E2E_SECRET,
        handles: [h(1), h(2)],
        answers: [
          { handle: h(1), verdict: "sans_rapport", why: "aucune vidéo ne nomme l'app" },
          { handle: h(2), verdict: "pousse", other: "Mokascore", why: "pousse les deux" },
        ],
      });
      expect(r.written).toBe(2);
      const block = (n: number) => r.prompt.split("\n\n").find((b: string) => b.includes(`account: @${h(n)}`))!;
      expect(block(1)).toContain(
        "evidence: 0 of 6 stored videos contain the product's name or tag (listed first); 6 of 6 carry an ad or partner disclosure; 6 of 6 carry a numbered campaign hashtag; bio names it: no; account found through a list of the product's creators",
      );
      expect(block(1)).toContain("what the product is, from an earlier review: v1");
      // Venu d'une liste, sans autre preuve : « sans rapport » devient « incertain », le verdict de l'IA est gardé à côté.
      expect(await admin.mutation(api.radarJudge.e2eJudgmentsOf, { secret: E2E_SECRET, handle: h(1) })).toEqual([
        { verdict: "incertain", aiVerdict: "sans_rapport", why: "aucune vidéo ne nomme l'app", v: 3 },
      ]);
      expect(await admin.mutation(api.radarJudge.e2eJudgmentsOf, { secret: E2E_SECRET, handle: h(2) })).toEqual([
        { verdict: "pousse", other: "Mokascore", why: "pousse les deux", v: 3 },
      ]);
    } finally {
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
