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

/**
 * « Comment ça marche » v2 — système de modules markdown par projet.
 *
 * Couvre : scoping projet strict (CRUD + lecture), invisibilité des brouillons
 * côté créateur, tri par order + reorder, view-as (même contenu que le
 * créateur, session créateur rejetée du chemin admin), et le flux UI admin
 * (CRUD via dialog) + rendu créateur (markdown → contenu rendu, brouillon caché).
 */
test.describe("Guide modules — scoping, published/draft, order, view-as", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.guideModules.cleanupTestGuideModules, {
      secret: E2E_SECRET,
    });
  });

  test("published/draft, tri par order + reorder, scoping projet, view-as", async () => {
    const ts = Date.now();
    const projectA = await convex.getProjectId();

    // Créateur RÉEL du projet A (pour exercer la creatorQuery listMyModules).
    const creator = await createCreatorSession(convexUrl, {
      name: `${MARKER} GM Creator ${ts}`,
      email: `e2e-gm-creator-${ts}@repackit.test`,
      password: "gm-creator-12345",
    });

    // 2 modules published + 1 draft (ordre de création = order croissant).
    const m1 = await convex.mutation(api.guideModules.createModule, {
      title: `${MARKER} M1 ${ts}`,
      contentMarkdown: "# M1\n\nContenu **un**.",
      status: "published",
    });
    const m2 = await convex.mutation(api.guideModules.createModule, {
      title: `${MARKER} M2 ${ts}`,
      contentMarkdown: "Contenu deux.",
      status: "published",
    });
    await convex.mutation(api.guideModules.createModule, {
      title: `${MARKER} Draft ${ts}`,
      contentMarkdown: "Caché.",
      status: "draft",
    });

    // Admin voit les 3 (published + draft), triés par order.
    const adminList = await convex.query(
      api.guideModules.listModulesForAdmin,
      {},
    );
    const adminMine = adminList.filter((m) => m.title.includes(`${ts}`));
    expect(adminMine).toHaveLength(3);

    // Créateur : SEULEMENT les 2 published, triés par order (M1 puis M2).
    const creatorList = await creator.client.query(
      api.guideModules.listMyModules,
      { projectId: creator.projectId },
    );
    const creatorMine = creatorList.filter((m) => m.title.includes(`${ts}`));
    expect(creatorMine.map((m) => m._id)).toEqual([m1, m2]);
    // Le brouillon n'apparaît jamais.
    expect(creatorMine.some((m) => m.title.includes("Draft"))).toBe(false);

    // Reorder : monter M2 → l'échange d'order place M2 avant M1 côté créateur.
    await convex.mutation(api.guideModules.moveModule, {
      id: m2,
      direction: "up",
    });
    const reordered = (
      await creator.client.query(api.guideModules.listMyModules, {
        projectId: creator.projectId,
      })
    ).filter((m) => m.title.includes(`${ts}`));
    expect(reordered.map((m) => m._id)).toEqual([m2, m1]);

    // --- Scoping projet : 2e projet B + module published dans B ---
    const slugB = `e2e-gm-${ts}`;
    const { projectId: projectB } = await convex.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug: slugB, name: `GM B ${ts}` },
    );
    const mB = await convex.mutation(api.guideModules.createModule, {
      projectId: projectB,
      title: `${MARKER} MB ${ts}`,
      contentMarkdown: "Projet B.",
      status: "published",
    });

    // Le créateur de A ne voit jamais le module de B.
    const stillA = (
      await creator.client.query(api.guideModules.listMyModules, {
        projectId: creator.projectId,
      })
    ).filter((m) => m.title.includes(`${ts}`));
    expect(stillA.some((m) => m._id === mB)).toBe(false);

    // Éditer le module de B depuis le contexte projet A → introuvable (no leak).
    await expect(
      convex.mutation(api.guideModules.updateModule, {
        projectId: projectA,
        id: mB,
        title: "hack",
      }),
    ).rejects.toThrow(/introuvable/i);
    // Supprimer le module de A depuis le contexte projet B → introuvable.
    await expect(
      convex.mutation(api.guideModules.deleteModule, {
        projectId: projectB,
        id: m1,
      }),
    ).rejects.toThrow(/introuvable/i);

    // --- View-as : même contenu published que le créateur ---
    const viewAs = await convex.query(api.guideModules.listModulesAsAdmin, {
      projectId: projectA,
      creatorId: creator.creatorId,
    });
    expect(viewAs.map((m) => m._id)).toEqual([m2, m1]); // published, triés

    // Une session CRÉATEUR est rejetée du chemin admin view-as ET des mutations admin.
    await expect(
      creator.client.query(api.guideModules.listModulesAsAdmin, {
        projectId: creator.projectId,
        creatorId: creator.creatorId,
      }),
    ).rejects.toThrow(/administrateur|refusé/i);
    await expect(
      creator.client.mutation(api.guideModules.createModule, {
        projectId: creator.projectId,
        title: "nope",
        contentMarkdown: "x",
        status: "published",
      }),
    ).rejects.toThrow(/administrateur|refusé/i);

    // creatorId de A passé avec le projet B → introuvable dans ce projet (no leak).
    await expect(
      convex.query(api.guideModules.listModulesAsAdmin, {
        projectId: projectB,
        creatorId: creator.creatorId,
      }),
    ).rejects.toThrow(/introuvable dans ce projet/i);

    await convex.mutation(api.projects.e2eDeleteProject, {
      secret: E2E_SECRET,
      slug: slugB,
    });
  });

  test("UI admin : créer → liste → supprimer un module", async ({ page }) => {
    const ts = Date.now();
    const title = `${MARKER} UI ${ts}`;

    await page.goto(adminPath("/guide"));
    await expect(
      page.getByRole("heading", { name: /comment ça marche/i }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: /nouveau module/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/titre \*/i).fill(title);
    await dialog
      .getByLabel(/contenu \(markdown\)/i)
      .fill("# Salut\n\nUn paragraphe **gras**.");
    // Aperçu live : le gras est rendu.
    await expect(dialog.getByText("gras")).toBeVisible();
    await dialog.getByRole("button", { name: /^créer$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    const row = page.locator("ul > li").filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row.getByText(/^publié$/i)).toBeVisible();

    // Supprimer via AlertDialog.
    await row.getByRole("button", { name: new RegExp(`supprimer ${title}`, "i") }).click();
    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: /^supprimer$/i }).click();
    await expect(alert).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.locator("ul > li").filter({ hasText: title }),
    ).not.toBeVisible();
  });

  test("UI créateur : voit le module published rendu, brouillon caché", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();

    // Admin crée 1 module published (markdown riche) + 1 brouillon.
    await convex.mutation(api.guideModules.createModule, {
      title: `${MARKER} Pub ${ts}`,
      contentMarkdown:
        "# Bien démarrer\n\nLis le **guide** puis ouvre [RepackIt](https://repackit.test).\n\n- point un\n- point deux",
      status: "published",
    });
    await convex.mutation(api.guideModules.createModule, {
      title: `${MARKER} Secret ${ts}`,
      contentMarkdown: "Brouillon invisible.",
      status: "draft",
    });

    // Invite + onboarde un créateur RÉEL (session navigateur).
    const email = `e2e-gm-ui-${ts}@repackit.test`;
    const password = "gm-ui-creator-12345";
    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name: `${MARKER} GM UI ${ts}`,
      email,
    });

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    try {
      await page.goto(`/join/${token}`);
      await page.getByLabel("Mot de passe").fill(password);
      await page.getByRole("button", { name: /activer mon compte/i }).click();
      await page.waitForURL("**/app", { timeout: 20_000 });

      await page.goto("/app/guide");
      // Titre du module published visible.
      await expect(
        page.getByText(`${MARKER} Pub ${ts}`),
      ).toBeVisible({ timeout: 10_000 });
      // Markdown rendu : gras, liste, et lien en nouvel onglet.
      await expect(page.getByText("guide", { exact: false })).toBeVisible();
      await expect(page.getByText("point un")).toBeVisible();
      const link = page.getByRole("link", { name: "RepackIt" });
      await expect(link).toHaveAttribute("href", "https://repackit.test");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
      // Brouillon JAMAIS visible côté créateur.
      await expect(page.getByText(`${MARKER} Secret ${ts}`)).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
