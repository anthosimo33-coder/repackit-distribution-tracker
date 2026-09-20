import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * `/` — page d'accueil PUBLIQUE pour un visiteur, routage par rôle pour un
 * compte connecté. Les deux branches dans le même fichier : l'une ne peut pas
 * passer parce que l'autre a disparu (une page d'accueil servie à tout le
 * monde, ou une redirection /login pour tout le monde, casse l'un des deux).
 */
test.describe("Accueil — public sans session, routage par rôle connecté", () => {
  test("visiteur : la page d'accueil s'affiche sur /, sans redirection", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Filme. Publie.");
    expect(new URL(page.url()).pathname).toBe("/");
    // Le mur de vidéos est là, avec les vues de chaque vidéo.
    await expect(page.getByLabel(/Vidéo de Kelly pour Snytch, 750\sk vues/)).toHaveCount(1);
    // Le bouton mène bien à la connexion.
    await page.getByRole("link", { name: "se connecter" }).first().click();
    await page.waitForURL("**/login");
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
    await context.close();
  });

  test("connecté : / route vers l'espace, jamais la page d'accueil", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForURL((url) => url.pathname !== "/", { timeout: 20_000 });
    await expect(page.getByText("Filme. Publie.")).toHaveCount(0);
  });

  test("mouvement réduit : rien n'est invisible, rien ne défile", async ({ browser }) => {
    // Les apparitions au défilement cachent le contenu tant qu'il n'est pas vu.
    // Avec `prefers-reduced-motion`, ce mécanisme doit être NEUTRALISÉ : sinon
    // un visiteur qui a désactivé les animations verrait une page vide.
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll("[data-reveal]")].filter(
        (el) => Number(getComputedStyle(el).opacity) < 0.99,
      ).length,
    );
    const reveals = await page.locator("[data-reveal]").count();
    expect(reveals).toBeGreaterThan(10);
    expect(hidden).toBe(0);
    // Le mur de vidéos ne défile pas non plus.
    const marquee = await page
      .locator("[aria-label]")
      .first()
      .evaluate(() => {
        const track = document.querySelector("video")?.closest("div")?.parentElement;
        return track ? getComputedStyle(track).animationName : "none";
      });
    expect(marquee).toBe("none");
    await context.close();
  });

  test("mobile : les six cartes sont dans un rail qui se glisse", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto("/");
    // Le rail existe et déborde horizontalement (sinon il n'y a rien à glisser),
    // sans jamais faire déborder la PAGE.
    const rail = page.locator("[class*='rail']").first();
    const box = await rail.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      page: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(box.scroll).toBeGreaterThan(box.client + 200);
    expect(box.page).toBe(box.inner);
    await context.close();
  });

  test("vitrine : les chiffres du studio sont rendus, sans erreur serveur", async ({
    browser,
  }) => {
    // CE TEST EXISTE POUR UN DÉFAUT RÉEL. Le bloc de chiffres n'est rendu que
    // si le projet vitrine a des vidéos ; sans publication en base, il était
    // absent des tests et une erreur de rendu y est passée jusqu'en production
    // (500 sur `/`, le 20/09/2026). On sème donc une vraie publication, puis on
    // vérifie que la page la publie ET qu'aucune erreur serveur ne remonte.
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Vitrine ${ts}`,
      email: `e2e-creator-vitrine-${ts}@repackit.test`,
      password: "vitrine-home-12345",
    });
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Vitrine ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });
    const handle = `@e2evitrine${ts % 100000}`;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: formatId as Id<"formats">,
      creatorId: creator.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 2 * 86_400_000,
    });
    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a.formatId === formatId && a.creatorId === creator.creatorId,
    )!;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: row._id,
      status: "to_publish",
    });
    const { publicationIds } = await creator.client.mutation(
      api.assignments.confirmPublication,
      {
        projectId: creator.projectId,
        id: row._id,
        urls: [
          {
            platform: "TikTok",
            url: `https://www.tiktok.com/${handle}/video/76872011080323${ts % 10000}`,
          },
        ],
      },
    );
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: publicationIds[0],
      capturedAt: Date.now(),
      vues: 48_300,
      likes: 3_900,
    });

    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    // Le bloc de chiffres est bien là, avec des valeurs (jamais des zéros).
    const stats = page.getByRole("definition").first();
    await expect(page.getByText("Vidéos publiées")).toBeVisible();
    await expect(stats).not.toHaveText("0");
    await expect(page.getByText("Vues cumulées").first()).toBeVisible();
    // Et aucune erreur de rendu serveur n'est remontée dans la page.
    await expect(page.locator("#__next_error__")).toHaveCount(0);

    await context.close();
    await admin.mutation(api.assignments.cleanupTestAssignments, { secret: E2E_SECRET });
    await admin.mutation(api.payments.cleanupTestPayments, { secret: E2E_SECRET });
    await admin.mutation(api.creators.cleanupTestCreators, { secret: E2E_SECRET });
  });
});
