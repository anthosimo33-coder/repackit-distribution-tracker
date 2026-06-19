import { test, expect } from "@playwright/test";
import {
  E2E_EMAIL,
  E2E_PASSWORD,
  E2E_PROJECT_SLUG,
} from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

/**
 * Chantier BRANDING — login brandé par projet (/[slug]/login) + /login
 * générique « Jarvis Creator Studio », sans jamais lister les projets.
 * Couvre :
 *   1. /[slug]/login affiche le NOM du projet (résolu par la query publique) ;
 *   2. login depuis /[slug]/login route par rôle (admin → /admin) ;
 *   3. slug inconnu → « Projet introuvable » propre ;
 *   4. /login générique affiche « Jarvis Creator Studio », aucun nom de projet.
 *
 * Contextes navigateur VIERGES : ces pages sont publiques (pré-session).
 */
test.describe("Branding — login par projet + login générique Jarvis", () => {
  test("slug → nom projet + login rôle ; slug inconnu → introuvable ; /login → Jarvis", async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    // ── 1. /[slug]/login affiche le nom du projet e2e ────────────────────────
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const p = await ctx.newPage();
    await p.goto(`/${E2E_PROJECT_SLUG}/login`);
    // Le projet e2e s'appelle « E2E Test » (cf ensureE2eProject).
    await expect(p.getByText("E2E Test").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(p.getByLabel("Email")).toBeVisible();
    await expect(p.getByLabel("Mot de passe")).toBeVisible();

    // ── 2. login admin depuis /[slug]/login → /admin (routing par rôle) ──────
    await p.getByLabel("Email").fill(E2E_EMAIL);
    await p.getByLabel("Mot de passe").fill(E2E_PASSWORD);
    await p.getByRole("button", { name: /se connecter/i }).click();
    await p.waitForURL("**/admin/**", { timeout: 20_000 });
    await ctx.close();

    // ── 3. slug inconnu → « Projet introuvable » ─────────────────────────────
    const ctx2 = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const p2 = await ctx2.newPage();
    await p2.goto("/slug-inexistant-zzz/login");
    await expect(p2.getByText(/projet introuvable/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(p2.getByLabel("Mot de passe")).toHaveCount(0);
    await ctx2.close();

    // ── 4. /login générique → « Jarvis Creator Studio », aucun projet ────────
    const ctx3 = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const p3 = await ctx3.newPage();
    await p3.goto("/login");
    await expect(p3.getByText(/jarvis creator studio/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(p3.getByText("E2E Test")).toHaveCount(0);
    await ctx3.close();
  });
});
