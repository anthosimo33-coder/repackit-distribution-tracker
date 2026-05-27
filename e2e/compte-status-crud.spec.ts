import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);

test.describe("Compte status CRUD", () => {
  test("warmup via dialog (badge J+0/7) puis transition shadowban", async ({
    page,
  }) => {
    const ts = Date.now();
    const handle = `@e2e_status_${ts}`;
    // Créé sans status → défaut "actif".
    await convex.mutation(api.comptes.createCompte, {
      handle,
      plateforme: "TikTok",
      notes: "[E2E_TEST] status crud",
    });

    await page.goto("/comptes");
    const row = page.getByRole("row").filter({ hasText: handle });
    await expect(row).toBeVisible();

    // Ouvrir l'édition.
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Modifier" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Statut → Warmup : le date picker + l'info durée apparaissent.
    await dialog.getByRole("combobox", { name: "Statut" }).click();
    await page.getByRole("option", { name: "Warmup", exact: true }).click();
    await expect(
      dialog.getByText("Durée warmup pour TikTok : 7 jours"),
    ).toBeVisible();

    // Save (date par défaut = aujourd'hui).
    await dialog.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(dialog).toBeHidden();

    // Badge "Warmup J+0/7".
    await expect(row.getByText("Warmup J+0/7")).toBeVisible();

    // Réouvrir : statut warmup pré-rempli + date conservée + info durée.
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Modifier" }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Statut" })).toContainText(
      "Warmup",
    );
    await expect(
      dialog.getByText("Durée warmup pour TikTok : 7 jours"),
    ).toBeVisible();

    // Statut → Shadowban : le date picker disparaît.
    await dialog.getByRole("combobox", { name: "Statut" }).click();
    await page.getByRole("option", { name: "Shadowban", exact: true }).click();
    await expect(dialog.getByText(/Durée warmup pour/)).toBeHidden();
    await dialog.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(dialog).toBeHidden();

    // Badge rouge "Shadowban".
    await expect(row.getByText("Shadowban", { exact: true })).toBeVisible();
  });
});
