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
 * L'ÉCRAN COMPTES D'UN CRÉATEUR SANS AUCUN COMPTE DÉCLARÉ — côté créateur ET en
 * observation admin.
 *
 * C'est l'état de TOUT créateur qui vient d'être invité, et il n'était couvert
 * par aucun test : les specs existantes déclarent un compte avant de regarder
 * l'écran. Une régression a fait planter la page en observation (écran mort du
 * navigateur, pas une erreur applicative) sans qu'aucun test ne tombe.
 *
 * Les deux moitiés comptent. Côté créateur, la page est son point d'entrée
 * d'onboarding ; en observation, c'est ce que l'admin ouvre pour l'aider —
 * précisément quand elle n'a encore rien déclaré.
 */
test.describe("Comptes — créateur sans aucun compte déclaré", () => {
  test("la page s'affiche pour le créateur ET en observation admin", async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const email = `e2e-nocompte-${ts}@repackit.test`;
    const password = "nocompte-12345";

    const { token, creatorId } = await convex.mutation(
      api.creators.inviteCreator,
      { name: `${MARKER} Sans compte ${ts}`, email },
    );

    // ── Côté CRÉATEUR : sa propre page, sans aucun compte ────────────────────
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const creatorPage = await ctx.newPage();
    const creatorErrors: string[] = [];
    creatorPage.on("pageerror", (e) => creatorErrors.push(e.message));
    try {
      await creatorPage.goto(`/join/${token}`);
      await creatorPage.getByLabel(/mot de passe|password/i).fill(password);
      await creatorPage
        .getByRole("button", { name: /activer mon compte|activate/i })
        .click();
      await creatorPage.waitForURL(/\/app/, { timeout: 30_000 });

      await creatorPage.goto("/app/comptes");
      // L'en-tête rend, donc la page a monté — le titre vient du catalogue.
      await expect(
        creatorPage.getByRole("heading", { level: 1 }),
      ).toBeVisible({ timeout: 15_000 });
      // Le bouton du guide warmup est là MÊME SANS COMPTE : c'est justement
      // quand on n'a rien déclaré qu'on lit le protocole.
      await expect(
        creatorPage.getByRole("button", { name: /guide warmup|warm-up guide/i }),
      ).toBeVisible();
      expect(creatorErrors, "aucune exception côté créateur").toEqual([]);
    } finally {
      await ctx.close();
    }

    // ── En OBSERVATION admin : la même page, même créateur, zéro compte ──────
    const adminErrors: string[] = [];
    page.on("pageerror", (e) => adminErrors.push(e.message));
    const projectSlug = "e2e-test";
    await page.goto(`/admin/voir/${projectSlug}/${creatorId}/comptes`);

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    // Le guide s'ouvre AUSSI en observation : c'est la même page, elle ne peut
    // pas dépendre de qui la regarde.
    const bouton = page.getByRole("button", {
      name: /guide warmup|warm-up guide/i,
    });
    await expect(bouton).toBeVisible();
    await bouton.click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Une exception non rattrapée ici, c'est l'écran mort du navigateur.
    expect(adminErrors, "aucune exception en observation").toEqual([]);
  });
});
