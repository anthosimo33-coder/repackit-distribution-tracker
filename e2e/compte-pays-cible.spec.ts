import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * PAYS CIBLÉ — 250 pays, trouvés en tapant.
 *
 * Le champ n'en proposait que dix ; le parc réel en déborde (Serbie, Bosnie,
 * Croatie, Suisse…) et on écrivait « Non défini » faute de pouvoir écrire la
 * vérité. Ce qui est vérifié ici n'est pas que la liste est plus longue, mais
 * qu'un pays qui en était ABSENT se choisit et se PERSISTE.
 */
async function ouvrirEdition(page: import("@playwright/test").Page, handle: string) {
  await page.goto(adminPath("/comptes"));
  const row = page.getByRole("row").filter({ hasText: handle });
  await row.getByRole("button").last().click();
  await page.getByRole("menuitem", { name: "Modifier" }).click();
  return page.getByRole("combobox", { name: "Pays ciblé" });
}

async function paysEnBase(compteId: string) {
  const all = await convex.query(api.comptes.listComptes, {});
  return all.find((c) => c._id === compteId)?.targetCountry;
}

test("un pays hors des dix d'avant se choisit et se persiste", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ts = Date.now();
  const handle = `@test_e2e_pays${ts}`;
  const compteId = await convex.mutation(api.comptes.createCompte, {
    handle,
    plateforme: "TikTok",
    notes: "[E2E_TEST] pays ciblé",
  });

  const picker = await ouvrirEdition(page, handle);
  await expect(picker).toBeVisible();
  await expect(picker).toHaveText(/Non défini/);
  await picker.click();
  // La RECHERCHE est le geste : à 250 pays, dérouler n'est plus une option.
  await page.getByPlaceholder("Cherche un pays ou un code…").fill("Serb");
  await page.getByRole("option", { name: /Serbie/ }).click();
  await expect(picker).toHaveText(/Serbie/);
  await page.getByRole("button", { name: /^enregistrer$/i }).click();

  // Autorité : la base. Le serveur a ACCEPTÉ un code qu'il refusait avant.
  await expect.poll(() => paysEnBase(compteId), { timeout: 10_000 }).toBe("RS");
});

test("le code ISO trouve le pays aussi bien que son nom", async ({ page }) => {
  // Quelqu'un qui vient de l'analytics pense en codes (Whop rend « BA ») : il ne
  // doit pas avoir à traduire de tête avant de chercher.
  test.setTimeout(120_000);
  const ts = Date.now();
  const handle = `@test_e2e_code${ts}`;
  const compteId = await convex.mutation(api.comptes.createCompte, {
    handle,
    plateforme: "TikTok",
    notes: "[E2E_TEST] pays par code",
  });

  const picker = await ouvrirEdition(page, handle);
  await picker.click();
  await page.getByPlaceholder("Cherche un pays ou un code…").fill("BA");
  await page.getByRole("option", { name: /Bosnie/ }).click();
  await page.getByRole("button", { name: /^enregistrer$/i }).click();

  await expect.poll(() => paysEnBase(compteId), { timeout: 10_000 }).toBe("BA");
});
