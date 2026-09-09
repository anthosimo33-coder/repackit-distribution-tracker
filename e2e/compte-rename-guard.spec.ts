import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * RENOMMAGE D'UN COMPTE — le handle est réécrit sur les publications.
 *
 * Cette spec vérifiait auparavant le REFUS : `publications.compte` étant une
 * chaîne, renommer un compte ayant de l'historique aurait créé des publications
 * orphelines, donc le serveur bloquait. Le renommage emporte désormais ses
 * publications, et ce qui doit être prouvé a changé de camp — mais la propriété
 * de fond, elle, est la même : AUCUNE PUBLICATION ORPHELINE.
 *
 * Trois choses à tenir, et la troisième est la plus facile à casser :
 *   1. le renommage aboutit et emporte les publications du compte ;
 *   2. il est refusé quand la place est déjà prise sur la plateforme ;
 *   3. il n'emporte PAS les publications du même pseudo sur l'AUTRE plateforme.
 */
async function creerCompte(handle: string, plateforme: "TikTok" | "Instagram") {
  const all = await convex.query(api.comptes.listComptes, {});
  const found = all.find(
    (c) => c.handle === handle && c.plateforme === plateforme,
  );
  if (found) return found._id;
  return await convex.mutation(api.comptes.createCompte, {
    handle,
    plateforme,
    notes: "[E2E_TEST] rename",
  });
}

async function creerPublication(
  handle: string,
  plateforme: "TikTok" | "Instagram",
) {
  const carouselId = await convex.query(api.publications.getNextCarouselId, {});
  await convex.mutation(api.publications.createPublication, {
    carouselId,
    hookId: null,
    hookText: `Hook rename ${plateforme} E2E`,
    mecanique: "Erreur",
    niveau: "Broad-A",
    mediaType: "carousel",
    format: "A",
    nbSlides: 7,
    slides: Array.from({ length: 7 }, (_, i) => ({
      position: i + 1,
      texte: i === 0 ? "S1" : "",
    })),
    angleTonal: "Psycho",
    langue: "FR",
    plateformes: [plateforme],
    compte: handle,
    datePubli: Date.now(),
    notes: "[E2E_TEST] rename guard",
  });
}

/** Publications du projet portant ce handle, par plateforme. */
async function publicationsDe(handle: string) {
  const pubs = await convex.query(api.publications.listPublications, {});
  const mien = pubs.filter((p) => p.compte === handle);
  return {
    total: mien.length,
    tiktok: mien.filter((p) => p.plateforme === "TikTok").length,
    instagram: mien.filter((p) => p.plateforme === "Instagram").length,
  };
}

test.describe("Renommage d'un compte", () => {
  test("le renommage emporte les publications du compte", async ({ page }) => {
    const ts = Date.now();
    const avant = `@test_e2e_ren${ts}`;
    const apres = `@test_e2e_ren${ts}_ok`;
    await creerCompte(avant, "TikTok");
    await creerPublication(avant, "TikTok");
    await creerPublication(avant, "TikTok");

    await page.goto(adminPath("/comptes"));
    const row = page.getByRole("row").filter({ hasText: avant });
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Modifier" }).click();
    await page.getByLabel("Handle").fill(apres.slice(1));
    await page.getByRole("button", { name: /^enregistrer$/i }).click();

    await expect(
      page.getByRole("row").filter({ hasText: apres }),
    ).toBeVisible({ timeout: 8000 });

    // Autorité : la base. Le compte a changé de nom ET ses deux publications
    // ont suivi — aucune n'est restée sur l'ancien handle.
    const comptes = await convex.query(api.comptes.listComptes, {});
    expect(comptes.some((c) => c.handle === apres)).toBe(true);
    expect(comptes.some((c) => c.handle === avant)).toBe(false);
    expect((await publicationsDe(apres)).total).toBe(2);
    expect((await publicationsDe(avant)).total).toBe(0);
  });

  test("le renommage n'emporte PAS l'autre plateforme du même pseudo", async ({
    page,
  }) => {
    // Le cas `@ja.deotn` : un pseudo, deux comptes. Réécrire toutes les
    // publications d'un handle emporterait celles du compte voisin.
    const ts = Date.now();
    const partage = `@test_e2e_duo${ts}`;
    const apres = `@test_e2e_duo${ts}_tt`;
    await creerCompte(partage, "TikTok");
    await creerCompte(partage, "Instagram");
    await creerPublication(partage, "TikTok");
    await creerPublication(partage, "Instagram");
    await creerPublication(partage, "Instagram");

    await page.goto(adminPath("/comptes"));
    const ligneTikTok = page
      .getByRole("row")
      .filter({ hasText: partage })
      .filter({ hasText: "TikTok" });
    await ligneTikTok.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Modifier" }).click();
    await page.getByLabel("Handle").fill(apres.slice(1));
    await page.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(
      page.getByRole("row").filter({ hasText: apres }),
    ).toBeVisible({ timeout: 8000 });

    // La publication TikTok a suivi…
    const renomme = await publicationsDe(apres);
    expect(renomme.total).toBe(1);
    expect(renomme.tiktok).toBe(1);
    // …et les DEUX publications Instagram sont restées sur l'ancien handle.
    const reste = await publicationsDe(partage);
    expect(reste.total).toBe(2);
    expect(reste.instagram).toBe(2);
    expect(reste.tiktok).toBe(0);
  });

  test("le renommage est refusé si la place est déjà prise", async ({
    page,
  }) => {
    const ts = Date.now();
    const a = `@test_e2e_pris${ts}_a`;
    const b = `@test_e2e_pris${ts}_b`;
    await creerCompte(a, "TikTok");
    await creerCompte(b, "TikTok");
    await creerPublication(a, "TikTok");

    await page.goto(adminPath("/comptes"));
    const row = page.getByRole("row").filter({ hasText: a });
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Modifier" }).click();
    await page.getByLabel("Handle").fill(b.slice(1));
    await page.getByRole("button", { name: /^enregistrer$/i }).click();

    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /existe déjà sur TikTok/i }),
    ).toBeVisible();

    // Rien n'a bougé : ni le compte, ni sa publication.
    const comptes = await convex.query(api.comptes.listComptes, {});
    expect(comptes.filter((c) => c.handle === a)).toHaveLength(1);
    expect(comptes.filter((c) => c.handle === b)).toHaveLength(1);
    expect((await publicationsDe(a)).total).toBe(1);
  });
});
