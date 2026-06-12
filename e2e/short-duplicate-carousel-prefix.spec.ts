import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

async function ensureCompte(
  handle: string,
  plateforme: "TikTok" | "Instagram" | "YouTube",
) {
  const comptes = await convex.query(api.comptes.listComptes, {});
  const existing = comptes.find(
    (c) => c.handle === handle && c.plateforme === plateforme,
  );
  if (existing) {
    if (!existing.actif) {
      await convex.mutation(api.comptes.updateCompte, {
        id: existing._id,
        actif: true,
      });
    }
    return;
  }
  await convex.mutation(api.comptes.createCompte, {
    handle,
    plateforme,
    notes: `${E2E_MARKER} dup-prefix spec`,
  });
}

/**
 * Bug fix duplicateCarousel — un Short dupliqué reçoit un ID préfixé S###
 * (mediaType source), PAS C### (ancien hardcode). cf computeNextPublicationId.
 *
 * Test serveur : crée un Short, le duplique vers une autre plateforme, vérifie
 * le préfixe. Cleanup explicite (le duplicat a notes:"" → hors marker E2E).
 */
test.describe("Anti-shadowban — duplicateCarousel préfixe Short", () => {
  test("duplicat d'un Short → carouselId S### (pas C###)", async () => {
    const ts = Date.now();
    const sourceCarouselId = `E2EDUP${ts}`;

    const icpId = await convex.mutation(api.icps.createIcp, {
      nom: `${E2E_MARKER} dup ${ts}`,
    });
    await ensureCompte("@e2e_dup_tt", "TikTok");
    await ensureCompte("@e2e_dup_ig", "Instagram");

    // Short source (sans sourceId → pas de validation anti-doublon ici).
    await convex.mutation(api.publications.createPublication, {
      carouselId: sourceCarouselId,
      hookId: null,
      hookText: `${E2E_MARKER} dup hook ${ts}`,
      mecanique: "Erreur",
      niveau: "Broad-A",
      angleTonal: "Psycho",
      langue: "FR",
      mediaType: "short",
      icpId,
      plateformes: ["TikTok"],
      compte: "@e2e_dup_tt",
      datePubli: ts,
      notes: `${E2E_MARKER} dup spec`,
    });

    const result = await convex.mutation(api.publications.duplicateCarousel, {
      sourceCarouselId,
      targetCompte: "@e2e_dup_ig",
      targetPlateforme: "Instagram",
    });

    // Le préfixe doit suivre le mediaType source (Short → S###), pas "C".
    expect(result.carouselId).toMatch(/^S\d{3,}$/);
    expect(result.carouselId.startsWith("C")).toBe(false);

    // Cleanup explicite : le duplicat a notes:"" (non couvert par le cleanup
    // global par marker). On supprime source + duplicat.
    const pubs = await convex.query(api.publications.listPublications, {});
    for (const p of pubs) {
      if (
        p.carouselId === result.carouselId ||
        p.carouselId === sourceCarouselId
      ) {
        await convex.mutation(api.publications.deletePublication, {
          id: p._id,
        });
      }
    }
  });
});
