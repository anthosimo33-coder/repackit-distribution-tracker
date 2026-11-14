import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — le jugement sémantique, phase A (lot 4 du dig, 14/11/2026) : l'IA juge ce qu'est chaque app et si un compte
 * à preuve faible pousse bien son produit ; RIEN N'AGIT. L'appel à l'IA n'est pas joué : la réponse est donnée, la
 * sélection, ce qu'on donne à lire et ce qui est rangé sont les vrais.
 */
test.describe("Radar — jugement à blanc", () => {
  test("seuls les comptes à preuve faible sont jugés, une fois ; les comptes en pause ne nourrissent pas la fiche ; rien ne change", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const p = `e2ejug${ts}`;
    const h = (n: number) => `rjug${n}_${ts}`;
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [{ slug: `${p}a`, name: `Jugee ${ts}`, rivalOf: [], strong: [`${p}a`] }],
      accounts: [
        // 1 : preuve forte (bio + vidéos) : pas jugé.
        { handle: h(1), appSlug: `${p}a`, fans: 1_000, posts7d: 2, bio: `Je teste ${p}a`, videos: [{ videoId: `${p}v11`, ageH: 5, views: 900, caption: `Mon avis sur ${p}a` }, { videoId: `${p}v12`, ageH: 30, views: 800, caption: `Encore ${p}a` }] },
        // 2 : plus aucune preuve (légendes sans l'app) : jugé « aucune ».
        { handle: h(2), appSlug: `${p}a`, fans: 500, posts7d: 1, videos: [{ videoId: `${p}v21`, ageH: 8, views: 700, caption: "Ma recette du jour" }] },
        // 3 : 2 vidéos sur 6 citent l'app (preuve par vidéos, minoritaire) : jugé.
        {
          handle: h(3),
          appSlug: `${p}a`,
          fans: 300,
          posts7d: 6,
          videos: [1, 2, 3, 4, 5, 6].map((i) => ({ videoId: `${p}v3${i}`, ageH: i * 10, views: 100 * i, caption: i <= 2 ? `astuce ${p}a` : "vlog" })),
        },
        // 4 : en pause « hors sujet », légende bien reconnaissable : ni jugé, ni lu pour la fiche de l'app.
        { handle: h(4), appSlug: `${p}a`, fans: 9_000_000, posts7d: 1, offTopic: true, videos: [{ videoId: `${p}v41`, ageH: 4, views: 4_000_000, caption: `chanson-${ts}` }] },
      ],
    });
    try {
      const handles = [h(1), h(2), h(3), h(4)];
      const r = await admin.mutation(api.radarJudge.e2eJudgeAccounts, {
        secret: E2E_SECRET,
        handles,
        answers: [
          { handle: h(2), verdict: "sans_rapport", why: "Recettes de cuisine, rien sur l'app" },
          { handle: h(3), verdict: "pousse", why: "Deux vidéos montrent l'app" },
        ],
      });
      expect(r.asked.map((a: { handle: string; weak: string }) => [a.handle, a.weak]).sort()).toEqual([
        [h(2), "aucune"],
        [h(3), "videos_minoritaires"],
      ]);
      expect(r.prompt).toContain(`account: @${h(2)}`);
      expect(r.written).toBe(2);
      // Rien n'agit : les statuts n'ont pas bougé.
      expect(r.statuses).toEqual({ [h(1)]: "active", [h(2)]: "active", [h(3)]: "active", [h(4)]: "paused" });
      // Jugés une fois : redemandés, ils ne sont plus donnés à juger.
      const again = await admin.mutation(api.radarJudge.e2eJudgeAccounts, { secret: E2E_SECRET, handles, answers: [] });
      expect(again.asked).toEqual([]);

      // La fiche de l'app : ce qu'écrivent ses comptes ACTIFS seulement.
      const n = await admin.mutation(api.radarJudge.e2eJudgeNatures, {
        secret: E2E_SECRET,
        slugs: [`${p}a`],
        answers: [{ slug: `${p}a`, nature: { digital: true, kind: "app", aboutIt: "oui", why: "Les vidéos montrent l'app" } }],
      });
      expect(n.written).toBe(1);
      expect(n.prompt).toContain(`Mon avis sur ${p}a`);
      expect(n.prompt).not.toContain(`chanson-${ts}`);
    } finally {
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
