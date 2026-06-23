import { test, expect, adminPath } from "./fixtures/auth-fixture";

test.describe("Guide warmup intégré", () => {
  test("ouvre le Sheet, affiche les 7 sections, expand TikTok, ferme", async ({
    page,
  }) => {
    await page.goto(adminPath("/comptes"));

    // Ouvrir le guide.
    await page.getByRole("button", { name: /guide warmup/i }).click();
    await expect(
      page.getByText("Guide warmup — TikTok, Instagram, YouTube"),
    ).toBeVisible();

    // Les 7 sections sont présentes (triggers repliables).
    await expect(
      page.getByRole("button", { name: /Règles communes/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /TikTok — 7 jours/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Instagram — 14 jours/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /YouTube Shorts — 7 jours/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Vérifications post-warmup/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /protocole reset/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /à PAS faire/i }),
    ).toBeVisible();

    // Replié par défaut : le contenu TikTok est caché.
    await expect(page.getByText(/avant d'augmenter la cadence/i)).toBeHidden();

    // Expand TikTok → contenu visible.
    await page.getByRole("button", { name: /TikTok — 7 jours/i }).click();
    await expect(page.getByText(/avant d'augmenter la cadence/i)).toBeVisible();

    // Fermer le Sheet.
    await page.keyboard.press("Escape");
    await expect(
      page.getByText("Guide warmup — TikTok, Instagram, YouTube"),
    ).toBeHidden();
  });
});
