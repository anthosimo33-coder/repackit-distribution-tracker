import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

test.describe("StepPublication exclut les comptes non-actifs", () => {
  test("seul le compte actif est proposé dans le select compte", async ({
    page,
  }) => {
    const ts = Date.now();
    const actifH = `@e2e_pub_actif_${ts}`;
    const warmupH = `@e2e_pub_warmup_${ts}`;
    await convex.mutation(api.comptes.createCompte, {
      handle: actifH,
      plateforme: "TikTok",
      notes: "[E2E_TEST] pub exclusion actif",
    });
    await convex.mutation(api.comptes.createCompte, {
      handle: warmupH,
      plateforme: "TikTok",
      notes: "[E2E_TEST] pub exclusion warmup",
      status: "warmup",
      warmupStartedAt: Date.now(),
    });
    const icpName = `[E2E_TEST] pub excl ${ts}`;
    await convex.mutation(api.icps.createIcp, { nom: icpName });

    // Modal Nouveau Short pré-sélectionné.
    await page.goto("/shorts?nouveau=open&format=short");
    const dialog = page.getByRole("dialog", { name: /nouvelle publication/i });
    await expect(dialog).toBeVisible();

    // Step Hook (custom) + source.
    await dialog.getByRole("tab", { name: /custom/i }).click();
    await dialog.getByLabel("Texte du hook").fill(`Hook excl ${ts}`);
    const sourceCombo = dialog
      .locator("label")
      .filter({ hasText: /Source \(nom de fichier Drive\)/ })
      .locator("xpath=..")
      .getByRole("combobox");
    await sourceCombo.click();
    await page
      .getByPlaceholder("Cherche ou saisis une source…")
      .fill(`excl_source_${ts}`);
    await page.getByRole("option", { name: /utiliser/i }).click();
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step Contenu — sélectionner l'ICP.
    await dialog.getByRole("combobox").click();
    await page
      .getByRole("option", { name: new RegExp(`pub excl ${ts}`, "i") })
      .click();
    await dialog.getByRole("button", { name: /^suivant$/i }).click();

    // Step Publication — cocher TikTok.
    await dialog.getByRole("checkbox", { name: /tiktok/i }).check();
    const compteCombo = dialog
      .locator("label")
      .filter({ hasText: /^Compte$/ })
      .locator("xpath=..")
      .getByRole("combobox");
    await compteCombo.waitFor({ state: "visible", timeout: 5000 });
    await compteCombo.click();

    // Le compte actif est proposé, le compte en warmup ne l'est PAS.
    await expect(
      page.getByRole("option", { name: new RegExp(actifH, "i") }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: new RegExp(warmupH, "i") }),
    ).toHaveCount(0);
  });
});
