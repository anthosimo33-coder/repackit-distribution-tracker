import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — les produits web (lot 5 du dig, 14/11/2026). JobStep et Pimzi n'avaient jamais été vus : leurs créatrices
 * disent « ce site », « diese Seite », et nomment le produit par son hashtag (#jobstep, #pimzi). Une vidéo trouvée par
 * une recherche de produit web note donc ses hashtags de produit comme apps repérées ; une vidéo trouvée par une
 * recherche d'app, non. La vraie mutation de la découverte, l'appel au fournisseur seul n'est pas joué.
 */
test.describe("Radar — produits web", () => {
  test("le hashtag d'un produit web devient une app repérée, compté par auteur ; pas celui d'une recherche d'app", async () => {
    const ts = Date.now();
    const p = `e2eweb${ts}`;
    const vid = (n: number) => `${p}v${n}`;
    const video = (n: number, handle: string, caption: string) => ({
      videoId: vid(n),
      url: `https://www.tiktok.com/@${handle}/video/${vid(n)}`,
      authorId: `id${handle}`,
      authorHandle: handle,
      authorFans: 2_000,
      caption,
      lang: "autre",
      publishedAt: ts - 3_600_000,
      isAd: true,
      views: 40_000,
      likes: 900,
      comments: 30,
      shares: 20,
      saves: 50,
    });
    try {
      await admin.mutation(api.radarSignals.e2eUpsertDiscovered, {
        secret: E2E_SECRET,
        foundBy: "diese seite·de",
        videos: [
          video(1, `rweb1_${ts}`, `diese seite ist so crazy #${p}prod #lebenslauf #anzeige #fyp`),
          video(2, `rweb2_${ts}`, `für alle die keine jobs bekommen #${p}prod #cv`),
          // Le même auteur deux fois ne compte qu'une fois.
          video(3, `rweb2_${ts}`, `noch ein tipp #${p}prod`),
        ],
      });
      // Une recherche d'app : ses hashtags ne sont pas notés.
      await admin.mutation(api.radarSignals.e2eUpsertDiscovered, {
        secret: E2E_SECRET,
        foundBy: "cette app·fr",
        videos: [video(4, `rweb3_${ts}`, `cette app est trop bien #${p}autre`), video(5, `rweb4_${ts}`, `je l'adore #${p}autre`)],
      });
      const cands = await admin.mutation(api.radarSignals.e2eCandidates, { secret: E2E_SECRET, marker: p });
      expect(cands).toEqual([{ key: `#${p}prod`, kind: "hashtag", authorCount: 2 }]);
    } finally {
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: p });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
