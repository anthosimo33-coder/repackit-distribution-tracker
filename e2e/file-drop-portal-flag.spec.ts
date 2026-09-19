import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

/**
 * DÉPÔT DE FICHIERS — le portail suit l'interrupteur du PROJET, plus le slug.
 *
 * LE DÉFAUT QU'ELLE VERROUILLE. Le serveur lisait déjà `fileDropEnabled`, mais
 * « Mes fichiers » (Moi) et l'écran /app/fichiers testaient `slug === "snytch"`.
 * Allumer le dépôt sur un autre projet ouvrait donc le serveur… derrière un
 * écran caché. Le projet de test porte `e2e-test` : sous l'ancien code, la
 * branche « allumé » de ce test est ROUGE (lien absent).
 *
 * Deux tests opposés sur la MÊME condition : l'absence seule ne prouverait rien.
 */
test.describe("Dépôt de fichiers — le portail suit le réglage du projet", () => {
  test.afterAll(async () => {
    // Rendre l'état courant du projet partagé (d'autres specs le reposent).
    await admin.mutation(api.projects.setTalentSettings, { fileDropEnabled: false });
  });

  test("allumé → lien et écran de dépôt ; éteint → ni lien ni dépôt", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const email = `e2e-creator-filedrop-${ts}@repackit.test`;
    const password = `filedrop-${ts}`;
    await createCreatorSession(url, {
      name: `[E2E_TEST] Dépôt Flag ${ts}`,
      email,
      password,
    });

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel(/e-?mail/i).fill(email);
    await page.getByLabel(/mot de passe/i).fill(password);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await page.waitForURL("**/app", { timeout: 30_000 });

    const lien = page.getByRole("link", { name: "Mes fichiers", exact: true });
    const indispo = page.getByText(
      "Le dépôt de fichiers n'est pas disponible pour ce projet.",
    );

    // ── ALLUMÉ (projet qui n'est PAS Snytch) : le lien existe et mène au dépôt.
    await admin.mutation(api.projects.setTalentSettings, { fileDropEnabled: true });
    await page.goto("/app/moi");
    await expect(lien).toBeVisible({ timeout: 20_000 });
    await lien.click();
    await page.waitForURL("**/app/fichiers", { timeout: 20_000 });
    await expect(
      page.getByRole("heading", { level: 1, name: "Dépôt de contenu" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(indispo).toHaveCount(0);

    // ── ÉTEINT : plus de lien, et l'écran refuse (même page, réglage inverse).
    await admin.mutation(api.projects.setTalentSettings, { fileDropEnabled: false });
    await page.goto("/app/moi");
    // Présence d'un voisin AVANT l'absence : la page est bien rendue.
    await expect(
      page.getByRole("link", { name: "Comment ça marche", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(lien).toHaveCount(0);
    await page.goto("/app/fichiers");
    await expect(indispo).toBeVisible({ timeout: 20_000 });

    await ctx.close();
  });

  test("dossier Drive : le lien collé est lu, l'illisible refusé, retirer efface", async () => {
    const id = "0AbC-dEf_1234567890ghIJklMNopqRsTu";
    await expect(
      admin.mutation(api.projects.setTalentSettings, {
        driveRootFolderId: "https://drive.google.com/drive/my-drive",
      }),
    ).rejects.toThrow(/ERR_DRIVE_FOLDER_INVALID|illisible/);

    await admin.mutation(api.projects.setTalentSettings, {
      driveRootFolderId: `https://drive.google.com/drive/u/0/folders/${id}?usp=sharing`,
    });
    const pose = await admin.query(api.projects.getTalentSettings, {});
    expect(pose.driveRootFolderId).toBe(id);
    expect(pose.driveRootConfigured).toBe(true);

    await admin.mutation(api.projects.setTalentSettings, { driveRootFolderId: null });
    const retire = await admin.query(api.projects.getTalentSettings, {});
    expect(retire.driveRootFolderId).toBeNull();
    // e2e-test n'est pas Snytch : sans racine propre, AUCUNE racine (pas l'env).
    expect(retire.driveRootConfigured).toBe(false);
  });
});
