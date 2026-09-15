import { test, expect } from "./fixtures/auth-fixture";
import type { Locator } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { createE2eClient, adminPath } from "./helpers/authed-client";
import { config } from "dotenv";
config({ path: ".env.local" });
const admin = createE2eClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * LES MODALES, SUR UN TÉLÉPHONE — deux pièges du composant partagé `Dialog`.
 *
 * 1. `DialogContent` est une GRILLE. Sans colonne déclarée, sa colonne prend la
 *    largeur min-content de l'enfant le plus large : un sélecteur au long
 *    libellé, un calendrier, et la modale entière sort de l'écran. On a vu
 *    Nouvelle publication (étape Hook) et Assigner une campagne déborder de
 *    25 à 30 px à 360 px. Correctif : `grid-cols-[minmax(0,1fr)]`.
 * 2. Un handle ou une URL SANS ESPACE ne passe pas à la ligne : « Réassigner
 *    @un_handle_de_quarante_caracteres » débordait de 90 px. Correctif :
 *    `[overflow-wrap:anywhere]` sur le contenu.
 *
 * Toute la suite tourne en Desktop Chrome : cette spec regarde ces deux cas à
 * 360 px, la largeur des petits Android.
 */
test.use({ viewport: { width: 360, height: 800 } });

/** La modale défile-t-elle horizontalement, ou sort-elle de l'écran ? */
async function debordement(dialog: Locator): Promise<string | null> {
  return dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (el.scrollWidth > el.clientWidth + 1)
      return `défile en X : ${el.scrollWidth} > ${el.clientWidth}`;
    if (r.left < -1 || r.right > window.innerWidth + 1)
      return `hors écran : ${Math.round(r.left)} → ${Math.round(r.right)}`;
    return null;
  });
}

test.describe("Modales à 360 px — rien ne sort de l'écran", () => {
  test("Nouvelle publication, étape Hook d'un Short", async ({ page }) => {
    await page.goto(adminPath("/shorts?nouveau=open&format=short"));
    const dialog = page.getByRole("dialog", { name: /nouvelle publication/i });
    // PRÉSENCE : on est bien à l'étape qui débordait, pas sur un écran vide.
    await expect(dialog.getByText(/étape 2/i)).toBeVisible({ timeout: 15_000 });
    expect(await debordement(dialog)).toBeNull();
  });

  test("Réassigner un compte au handle sans espace", async ({ page }) => {
    const ts = Date.now();
    // Forme de la prod : un handle long, d'un seul tenant, suffixé.
    const handle = `@e2e_compte_au_handle_vraiment_tres_long_${ts}`;
    const compteId = await admin.mutation(api.comptes.createCompte, {
      handle,
      plateforme: "TikTok",
      notes: "[E2E_TEST] mobile modales",
    });

    await page.goto(adminPath(`/comptes/${compteId}`));
    await page.getByRole("button", { name: "Actions" }).first().click({ timeout: 15_000 });
    await page.getByRole("menuitem", { name: /réassigner/i }).click();
    const dialog = page.getByRole("dialog", { name: /réassigner/i });
    await expect(dialog.getByText(handle).first()).toBeVisible();
    expect(await debordement(dialog)).toBeNull();
  });
});
