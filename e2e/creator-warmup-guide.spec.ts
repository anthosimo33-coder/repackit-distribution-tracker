import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const MARKER = "[E2E_TEST]";

/**
 * Le créateur accède, depuis son portail (/app/comptes), au MÊME guide warmup
 * que l'admin — désormais le MODULE du guide, adressé par son slot, et non plus
 * un second document en catalogue. Lecture seule, et consultable même sans
 * compte déclaré.
 */
test.describe("Guide warmup — portail créateur", () => {
  test("ouvre le module warmup depuis /app/comptes, rendu, lecture seule", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const name = `[E2E_TEST] WarmupGuide ${ts}`;
    const email = `e2e-creator-warmup-guide-${ts}@repackit.test`;
    const password = "creator-warmup-12345";

    // Invitation (admin) → token, puis onboarding créateur en nav privée.
    const TITRE = `${MARKER} Warmup portail ${ts}`;
    const moduleId = await convex.mutation(api.guideModules.createModule, {
      title: TITRE,
      contentMarkdown:
        "## Les règles communes\n\n- Un e-mail **dédié** par compte.",
      status: "published",
    });
    await convex.mutation(api.guideModules.e2eSetModuleSlot, {
      secret: E2E_SECRET,
      id: moduleId,
      slot: "warmup",
    });

    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name,
      email,
    });
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/app", { timeout: 20_000 });

    // Aller sur « Mes comptes » (aucun compte déclaré : le guide reste accessible).
    await page.getByRole("link", { name: "Mes comptes", exact: true }).click();
    await page.waitForURL("**/app/comptes", { timeout: 15_000 });

    // Ouvrir le guide warmup — il rend désormais le MODULE du guide.
    await page.getByRole("button", { name: /guide warmup/i }).click();
    const guide = page.getByRole("dialog");
    await expect(guide).toBeVisible();
    await expect(guide.getByText(TITRE)).toBeVisible({ timeout: 10_000 });

    // Le markdown est RENDU (titre de section, gras), pas affiché brut.
    await expect(
      guide.getByRole("heading", { name: /les règles communes/i }),
    ).toBeVisible();
    await expect(guide.locator("strong", { hasText: "dédié" })).toBeVisible();

    // Lecture seule : aucun champ, aucune action d'édition dans le panneau.
    await expect(guide.getByRole("textbox")).toHaveCount(0);
    await expect(
      guide.getByRole("button", {
        name: /enregistrer|modifier|supprimer|ajouter|save|edit/i,
      }),
    ).toHaveCount(0);

    // Fermer.
    await page.keyboard.press("Escape");
    await expect(
      page.getByText("Guide warmup — par plateforme"),
    ).toBeHidden();

    await ctx.close();
  });
});
