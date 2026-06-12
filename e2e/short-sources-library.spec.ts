import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
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
    notes: `${E2E_MARKER} library spec`,
  });
}

/**
 * Bibliothèque sources (/shorts/sources) — matrice + filtres + action.
 *
 * 3 sources de couverture distincte (1/3, 2/3, 3/3). Vérifie l'affichage,
 * le filtre Complets, et l'action "Nouveau Short" qui pré-remplit le sourceId.
 */
test.describe("Anti-shadowban — bibliothèque /shorts/sources", () => {
  test("matrice + filtre Complets + action pré-remplie", async ({ page }) => {
    const ts = Date.now();
    const srcA = `e2e_lib_a_${ts}`; // TikTok only → 1/3 (partiel)
    const srcB = `e2e_lib_b_${ts}`; // TikTok + Instagram → 2/3 (partiel)
    const srcC = `e2e_lib_c_${ts}`; // 3 plateformes → 3/3 (complet)

    const icpId = (await convex.mutation(api.icps.createIcp, {
      nom: `${E2E_MARKER} lib ${ts}`,
    })) as Id<"icps">;
    await ensureCompte("@e2e_lib_tt", "TikTok");
    await ensureCompte("@e2e_lib_ig", "Instagram");
    await ensureCompte("@e2e_lib_yt", "YouTube");

    let n = 0;
    async function createShort(
      source: string,
      plateforme: "TikTok" | "Instagram" | "YouTube",
      compte: string,
    ) {
      n += 1;
      await convex.mutation(api.publications.createPublication, {
        carouselId: `E2ELIB${ts}_${n}`,
        hookId: null,
        hookText: `${E2E_MARKER} lib hook ${source}`,
        mecanique: "Erreur",
        niveau: "Broad-A",
        angleTonal: "Psycho",
        langue: "FR",
        mediaType: "short",
        icpId,
        plateformes: [plateforme],
        compte,
        datePubli: ts,
        notes: `${E2E_MARKER} lib spec`,
        sourceId: source,
      });
    }

    await createShort(srcA, "TikTok", "@e2e_lib_tt");
    await createShort(srcB, "TikTok", "@e2e_lib_tt");
    await createShort(srcB, "Instagram", "@e2e_lib_ig");
    await createShort(srcC, "TikTok", "@e2e_lib_tt");
    await createShort(srcC, "Instagram", "@e2e_lib_ig");
    await createShort(srcC, "YouTube", "@e2e_lib_yt");

    await page.goto(adminPath("/shorts/sources"));

    // Les 3 sources apparaissent dans la matrice.
    await expect(page.getByText(srcA).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(srcB).first()).toBeVisible();
    await expect(page.getByText(srcC).first()).toBeVisible();

    // Filtre "Complets" → seule la source 3/3 reste (srcC), srcA disparaît.
    await page.getByRole("button", { name: "Complets" }).click();
    await expect(page.getByText(srcC).first()).toBeVisible();
    await expect(page.getByText(srcA)).toHaveCount(0);

    // Retour "Tous" puis action "Nouveau Short" sur srcA → modal pré-rempli.
    await page.getByRole("button", { name: "Tous" }).click();
    const rowA = page.locator("tr", { hasText: srcA });
    await rowA.getByRole("button", { name: /nouveau short/i }).click();

    await expect(page).toHaveURL(/nouveau=open/, { timeout: 10000 });
    const dialog = page.getByRole("dialog", { name: /nouvelle publication/i });
    await expect(dialog).toBeVisible();
    // Le sourceId est pré-rempli (affiché dans le combobox Source).
    await expect(dialog.getByText(srcA).first()).toBeVisible();
  });
});
