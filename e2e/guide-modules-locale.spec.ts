import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const MARKER = "[E2E_TEST]";

/** Le bandeau, MOT POUR MOT — c'est le texte que lit la créatrice US. */
const BANNER_EN = "This guide is only available in French for now.";
/** Sa contrepartie FR au catalogue : elle ne doit JAMAIS s'afficher. */
const BANNER_FR = "Ce guide n’est disponible qu’en français pour le moment.";

/**
 * GUIDE BILINGUE — un jeu de modules par langue, repli sur le français.
 *
 * Les trois cas qui définissent le comportement :
 *   1. lecteur EN sans jeu EN  → guide FR + bandeau anglais ;
 *   2. lecteur EN avec jeu EN  → guide EN, bandeau disparu ;
 *   3. lecteur FR              → guide FR, JAMAIS de bandeau.
 *
 * Le cas 2 est joué dans le MÊME test que le cas 1, sur la même page ouverte :
 * c'est la seule façon de prouver que le bandeau disparaît TOUT SEUL le jour où
 * un module anglais existe, sans rien lever à la main. C'est aussi le contrôle
 * POSITIF du locator : l'assertion d'absence qui suit porte sur un locator qu'on
 * vient de voir trouver le bandeau trois lignes plus haut.
 */
test.describe("Guide — un jeu de modules par langue, repli FR", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.guideModules.cleanupTestGuideModules, {
      secret: E2E_SECRET,
    });
  });

  test("serveur : jeu servi et langue servie selon la langue demandée", async () => {
    const ts = Date.now();
    const creator = await createCreatorSession(convexUrl, {
      name: `${MARKER} GML Srv ${ts}`,
      email: `e2e-gml-srv-${ts}@repackit.test`,
      password: "gml-srv-12345",
    });

    // Jeu FR — créé SANS `locale`, comme les 11 modules de la prod.
    const fr1 = await convex.mutation(api.guideModules.createModule, {
      title: `${MARKER} Comment tu es payé ${ts}`,
      contentMarkdown: "Tu es payé au CPM, plus un fixe mensuel.",
      status: "published",
    });
    await convex.mutation(api.guideModules.createModule, {
      title: `${MARKER} Warmup & shadowban ${ts}`,
      contentMarkdown: "Chauffe le compte avant de poster.",
      status: "published",
    });

    const mine = (locale: string) =>
      creator.client.query(api.guideModules.listMyModules, {
        projectId: creator.projectId,
        locale,
      });

    // (1) Lecteur EN, aucun module EN → repli, et la langue SERVIE le dit.
    const before = await mine("en");
    expect(before.requestedLocale).toBe("en");
    expect(before.servedLocale).toBe("fr");
    expect(before.modules.map((m) => m._id)).toEqual([fr1, before.modules[1]._id]);
    expect(before.modules).toHaveLength(2);

    // (2) Un module EN apparaît → le jeu EN prend la main, sans repli.
    const en1 = await convex.mutation(api.guideModules.createModule, {
      title: `${MARKER} How you get paid ${ts}`,
      contentMarkdown: "You are paid per 1,000 views, plus a monthly base.",
      status: "published",
      locale: "en",
    });
    const after = await mine("en");
    expect(after.servedLocale).toBe("en");
    expect(after.modules.map((m) => m._id)).toEqual([en1]);

    // (3) Le lecteur FR ne bouge pas d'un pouce — le jeu EN lui est invisible.
    const asFr = await mine("fr");
    expect(asFr.requestedLocale).toBe("fr");
    expect(asFr.servedLocale).toBe("fr");
    expect(asFr.modules.some((m) => m._id === en1)).toBe(false);
    expect(asFr.modules).toHaveLength(2);

    // (4) L'ORDRE est par jeu : le module EN est le 1er de SON jeu (order 0),
    // il n'hérite pas du rang suivant du jeu français.
    expect(after.modules[0].order).toBe(0);

    // (5) Langue absente ou inconnue ⇒ le défaut, jamais une erreur.
    const noLocale = await creator.client.query(api.guideModules.listMyModules, {
      projectId: creator.projectId,
    });
    expect(noLocale.servedLocale).toBe("fr");
    expect(noLocale.modules).toHaveLength(2);

    // Une langue non livrée est REFUSÉE À L'ÉCRITURE (à l'inverse de la
    // lecture) : un module rangé dans une langue qui n'existe pas serait
    // invisible pour tout le monde, sans rien à l'écran pour le dire.
    await expect(
      convex.mutation(api.guideModules.createModule, {
        title: `${MARKER} Nope ${ts}`,
        contentMarkdown: "x",
        status: "published",
        locale: "de",
      }),
    ).rejects.toThrow(/langue inconnue/i);
  });

  test("lecteur EN : repli FR + bandeau, puis jeu EN → guide EN sans bandeau", async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const frTitle = `${MARKER} Création de tes comptes ${ts}`;
    const enTitle = `${MARKER} Setting up your accounts ${ts}`;

    await convex.mutation(api.guideModules.createModule, {
      title: frTitle,
      contentMarkdown: "Crée **trois** comptes TikTok avant de commencer.",
      status: "published",
    });

    // Invitation EN → cookie NEXT_LOCALE posé par /join, puis users.locale.
    const email = `e2e-gml-en-${ts}@repackit.test`;
    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name: `${MARKER} GML EN ${ts}`,
      email,
      locale: "en",
    });

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      locale: "fr-FR", // navigateur FRANÇAIS : seule l'invitation bascule en EN
    });
    const page = await ctx.newPage();
    try {
      await page.goto(`/join/${token}`);
      await page.getByLabel(/mot de passe|password/i).fill("gml-en-12345");
      await page
        .getByRole("button", { name: /activer mon compte|activate/i })
        .click();
      await page.waitForURL(/\/app/, { timeout: 30_000 });

      await page.goto("/app/guide");
      await expect
        .poll(async () => page.locator("html").getAttribute("lang"))
        .toBe("en");

      // (1) REPLI : le module FRANÇAIS est bien celui qui s'affiche…
      const frHeader = page.getByRole("button", { name: frTitle });
      await expect(frHeader).toBeVisible({ timeout: 15_000 });
      // …et le bandeau le dit, EN ANGLAIS (la langue du lecteur).
      const banner = page.getByText(BANNER_EN);
      await expect(banner).toBeVisible();

      // (2) Un jeu EN apparaît PENDANT que la page est ouverte : le guide
      // bascule et le bandeau tombe TOUT SEUL (Convex est réactif) — personne
      // n'a de drapeau à baisser le jour de la traduction.
      await convex.mutation(api.guideModules.createModule, {
        title: enTitle,
        contentMarkdown: "Create **three** TikTok accounts before you start.",
        status: "published",
        locale: "en",
      });
      await expect(page.getByRole("button", { name: enTitle })).toBeVisible({
        timeout: 15_000,
      });
      // Absences — le MÊME locator `banner` était visible 10 lignes plus haut.
      await expect(banner).toHaveCount(0);
      await expect(frHeader).toHaveCount(0);

      // Le contenu rendu est bien celui du module anglais.
      await page.getByRole("button", { name: enTitle }).click();
      await expect(page.locator("strong", { hasText: "three" })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("CONTRE-TEST — lecteur FR : guide FR, jamais de bandeau", async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const frTitle = `${MARKER} Règles & exigences de post ${ts}`;
    const enTitle = `${MARKER} Posting rules ${ts}`;

    // Les DEUX jeux existent : c'est ce qui rend le contre-test probant. Un
    // lecteur français ne doit pas voir l'anglais, même disponible.
    await convex.mutation(api.guideModules.createModule, {
      title: frTitle,
      contentMarkdown: "Poste entre 18 h et 21 h, heure de Paris.",
      status: "published",
    });
    await convex.mutation(api.guideModules.createModule, {
      title: enTitle,
      contentMarkdown: "Post between 6pm and 9pm Paris time.",
      status: "published",
      locale: "en",
    });

    const email = `e2e-gml-fr-${ts}@repackit.test`;
    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name: `${MARKER} GML FR ${ts}`,
      email,
    });

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      locale: "fr-FR",
    });
    const page = await ctx.newPage();
    try {
      await page.goto(`/join/${token}`);
      await page.getByLabel(/mot de passe|password/i).fill("gml-fr-12345");
      await page
        .getByRole("button", { name: /activer mon compte|activate/i })
        .click();
      await page.waitForURL(/\/app/, { timeout: 30_000 });

      await page.goto("/app/guide");
      await expect
        .poll(async () => page.locator("html").getAttribute("lang"))
        .toBe("fr");

      await expect(page.getByRole("button", { name: frTitle })).toBeVisible({
        timeout: 15_000,
      });
      // Le jeu anglais existe et reste invisible.
      await expect(page.getByRole("button", { name: enTitle })).toHaveCount(0);
      // Aucun bandeau, ni dans une langue ni dans l'autre. La valeur FR du
      // catalogue existe pour la parité des deux fichiers — pas pour l'écran.
      await expect(page.getByText(BANNER_EN)).toHaveCount(0);
      await expect(page.getByText(BANNER_FR)).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test("UI admin : deux jeux visibles, créer un module EN ne touche pas au FR", async ({
    page,
  }) => {
    const ts = Date.now();
    const frTitle = `${MARKER} FR admin ${ts}`;
    const enTitle = `${MARKER} EN admin ${ts}`;

    await convex.mutation(api.guideModules.createModule, {
      title: frTitle,
      contentMarkdown: "Contenu français.",
      status: "published",
    });

    await page.goto(adminPath("/guide"));
    await expect(
      page.getByRole("heading", { name: /comment ça marche/i }),
    ).toBeVisible();

    // Les DEUX blocs sont là, celui d'anglais annonce son jeu vide.
    const frSection = page.locator("section").filter({ hasText: "Guide Français" });
    const enSection = page.locator("section").filter({ hasText: "Guide English" });
    await expect(frSection.locator("li").filter({ hasText: frTitle })).toBeVisible({
      timeout: 10_000,
    });
    await expect(enSection.getByText(/aucun module dans cette langue/i)).toBeVisible();

    // Créer depuis le bloc anglais : la langue est PRÉ-RÉGLÉE, rien à choisir.
    await page
      .getByRole("button", { name: "Nouveau module — guide English" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Langue")).toHaveText(/english/i);
    await dialog.getByLabel(/titre \*/i).fill(enTitle);
    await dialog.getByLabel(/contenu \(markdown\)/i).fill("English content.");
    await dialog.getByRole("button", { name: /^créer$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Il atterrit dans le bloc anglais, et le bloc français n'a pas bougé.
    await expect(enSection.locator("li").filter({ hasText: enTitle })).toBeVisible({
      timeout: 5000,
    });
    await expect(frSection.locator("li").filter({ hasText: enTitle })).toHaveCount(0);
    await expect(frSection.locator("li").filter({ hasText: frTitle })).toBeVisible();
  });
});
