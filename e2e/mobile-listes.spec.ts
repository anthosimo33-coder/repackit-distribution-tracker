import { test, expect } from "./fixtures/auth-fixture";
import type { Page } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { createE2eClient, adminPath, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";
config({ path: ".env.local" });
const admin = createE2eClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * LES LISTES DE L'ESPACE D'ÉQUIPE, SUR UN TÉLÉPHONE.
 *
 * Sous 768 px, Comptes et Créateurs passent de TABLEAU à CARTES
 * (`useIsMobile`). Le mode d'échec n'est pas un écran cassé : c'est un tableau
 * de 700 à 1 400 px qui DÉFILE dans sa carte — la page ne déborde pas, rien ne
 * rougit, et sur le téléphone on ne lit que deux colonnes. D'où l'assertion :
 * aucune zone de la page ne défile horizontalement.
 *
 * Entrées à la FORME de la prod : un handle long, un nom composé à rallonge —
 * c'est ce qui fait déborder une carte mal bornée (la grille de cartes
 * Créateurs débordait de 84 px avant `grid-cols-1`).
 *
 * Toute la suite tourne en Desktop Chrome : cette spec est la seule à regarder
 * ces écrans à 390 px.
 */
test.use({ viewport: { width: 390, height: 844 } });

/** Zones qui défilent horizontalement sous `main` (main compris). */
async function zonesQuiDefilent(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return ["<main> absent"];
    return [main, ...Array.from(main.querySelectorAll("*"))]
      .filter((el) => {
        const ox = getComputedStyle(el).overflowX;
        const scrolls = el === main || ox === "auto" || ox === "scroll";
        return scrolls && el.scrollWidth > el.clientWidth + 1;
      })
      .map(
        (el) =>
          `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}"> ${el.scrollWidth}>${el.clientWidth}`,
      );
  });
}

test.describe("Listes admin à 390 px — cartes, pas de tableau qui défile", () => {
  test("Comptes : le compte est une carte, rien ne défile", async ({ page }) => {
    const ts = Date.now();
    const handle = `@e2e_mobile_compte_au_handle_tres_long_${ts}`;
    await admin.mutation(api.comptes.createCompte, {
      handle,
      plateforme: "TikTok",
      notes: "[E2E_TEST] mobile listes",
    });

    await page.goto(adminPath("/comptes"));
    // PRÉSENCE d'abord : sans elle, « aucune zone ne défile » passerait sur un
    // écran vide.
    await expect(page.getByText(handle)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("table")).toHaveCount(0);
    expect(await zonesQuiDefilent(page)).toEqual([]);
  });

  test("Créateurs : la fiche est une carte, rien ne défile", async ({ page }) => {
    const ts = Date.now();
    const name = `[E2E_TEST] Marie-Clémentine Longuenom-Deschamps ${ts}`;
    const { creatorId } = await admin.mutation(api.creators.inviteCreator, {
      name,
      email: `e2e-creator-mobile-listes-${ts}@repackit.test`,
    });
    // Une ancre de paie la fait entrer au CLASSEMENT DU CYCLE : le bandeau
    // « tête du cycle » s'affiche au-dessus de la liste. C'est lui qui défilait
    // dans une bande de 150 px — trouvé par cette spec quand une AUTRE spec
    // avait laissé un classement en base. On le sème ici exprès.
    await admin.mutation(api.creators.e2eSetPayAnchor, {
      secret: E2E_SECRET,
      creatorId,
      firstPostAt: ts - 3 * 86_400_000,
    });

    await page.goto(adminPath("/createurs"));
    await expect(page.getByRole("link", { name })).toBeVisible({
      timeout: 15_000,
    });
    // PRÉSENCE du bandeau : sans elle, l'assertion de défilement ne dirait rien
    // de lui.
    await expect(
      page.getByRole("button", { name: /classement complet/i }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    expect(await zonesQuiDefilent(page)).toEqual([]);
  });
});
