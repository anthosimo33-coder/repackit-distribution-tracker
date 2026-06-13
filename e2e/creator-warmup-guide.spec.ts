import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Chantier guide warmup créateur : le créateur accède, depuis son portail
 * (/app/comptes), au MÊME guide warmup que l'admin (source unique
 * components/warmup) — les 7 sections, en LECTURE SEULE. Indépendant des
 * comptes (consultable même sans compte déclaré).
 */
test.describe("Guide warmup — portail créateur", () => {
  test("ouvre le guide depuis /app/comptes, 7 sections, lecture seule", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const name = `[E2E_TEST] WarmupGuide ${ts}`;
    const email = `e2e-creator-warmup-guide-${ts}@repackit.test`;
    const password = "creator-warmup-12345";

    // Invitation (admin) → token, puis onboarding créateur en nav privée.
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

    // Ouvrir le guide warmup.
    await page.getByRole("button", { name: /guide warmup/i }).click();
    await expect(
      page.getByText("Guide warmup — TikTok, Instagram, YouTube"),
    ).toBeVisible();

    // Les 7 sections (triggers repliables) — identiques au guide admin.
    const guide = page.getByRole("dialog");
    await expect(
      guide.getByRole("button", { name: /Règles communes/i }),
    ).toBeVisible();
    await expect(
      guide.getByRole("button", { name: /TikTok — 3 jours/i }),
    ).toBeVisible();
    await expect(
      guide.getByRole("button", { name: /Instagram — 14 jours/i }),
    ).toBeVisible();
    await expect(
      guide.getByRole("button", { name: /YouTube Shorts — 3 jours/i }),
    ).toBeVisible();
    await expect(
      guide.getByRole("button", { name: /Vérifications post-warmup/i }),
    ).toBeVisible();
    await expect(
      guide.getByRole("button", { name: /protocole reset/i }),
    ).toBeVisible();
    await expect(
      guide.getByRole("button", { name: /à PAS faire/i }),
    ).toBeVisible();

    // Replié par défaut → contenu TikTok caché, puis expand → visible.
    await expect(page.getByText(/J8 minimum/i)).toBeHidden();
    await guide.getByRole("button", { name: /TikTok — 3 jours/i }).click();
    await expect(page.getByText(/J8 minimum/i)).toBeVisible();

    // Lecture seule (structurelle) : le guide est un composant statique,
    // identique pour tous les rôles — il n'expose aucun champ de saisie ni
    // action d'édition. L'isolation de rôle créateur/admin est, elle, couverte
    // par creator-role-guard.spec.ts ; ici on verrouille l'invariant « zéro UI
    // d'édition dans le guide » comme garde-fou si une édition y était ajoutée.
    await expect(guide.getByRole("textbox")).toHaveCount(0);
    await expect(
      guide.getByRole("button", {
        name: /enregistrer|modifier|supprimer|ajouter|save|edit/i,
      }),
    ).toHaveCount(0);

    // Fermer.
    await page.keyboard.press("Escape");
    await expect(
      page.getByText("Guide warmup — TikTok, Instagram, YouTube"),
    ).toBeHidden();

    await ctx.close();
  });
});
