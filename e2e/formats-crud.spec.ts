import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * P6 — CRUD format via l'UI + rendu d'un exemple URL (YouTube → iframe) dans
 * l'aperçu créateur. L'exemple + le brief sont posés serveur (déterministe),
 * la création et la suppression passent par l'UI.
 */
test.describe("Formats — CRUD + exemple URL", () => {
  test("créer → exemple YouTube rendu dans l'aperçu → supprimer", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ts = Date.now();
    const name = `[E2E_TEST] CRUD ${ts}`;

    // Créer via le dialog.
    await page.goto(adminPath("/formats"));
    await page.getByRole("button", { name: /nouveau format/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nom *", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Créer", exact: true }).click();

    // Redirigé vers la fiche détail (éditeur).
    await page.waitForURL(/\/formats\/[a-z0-9]+$/i, { timeout: 15_000 });
    const formatId = page.url().split("/formats/")[1] as Id<"formats">;
    await expect(page.getByText("Brief (markdown)")).toBeVisible();

    // Pose brief + exemple YouTube côté serveur (déterministe).
    await convex.mutation(api.formats.updateFormat, {
      id: formatId,
      brief: `Brief de test ${ts}`,
      exampleVideos: [
        {
          kind: "url",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          platform: "youtube",
          title: "Exemple YouTube",
        },
      ],
    });

    // Onglet Aperçu créateur → brief + iframe YouTube visibles.
    await page.reload();
    await page.getByRole("tab", { name: /aperçu créateur/i }).click();
    await expect(page.getByText(`Brief de test ${ts}`)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("youtube-embed")).toBeVisible();

    // Supprimer via l'UI.
    await page
      .getByRole("button", { name: /^supprimer$/i })
      .first()
      .click();
    const alert = page.getByRole("alertdialog");
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: /^supprimer$/i }).click();
    await page.waitForURL(/\/formats$/, { timeout: 10_000 });

    // Absent côté serveur.
    const list = await convex.query(api.formats.listFormats, {});
    expect(list.some((f) => f._id === formatId)).toBe(false);
  });
});
