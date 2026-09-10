import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_PROJECT_SLUG } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

/**
 * « ⌘S enregistre — changer de ligne aussi » : la promesse écrite sous le
 * formulaire d'une brique. Elle tient à une seule chose — que l'écran appelle
 * la version COURANTE de l'enregistrement, pas celle publiée au premier rendu.
 *
 * Les deux cas ci-dessous sont les deux moitiés du même défaut, et ils échouent
 * DIFFÉREMMENT : sur une brique existante la saisie disparaît sans un mot ; sur
 * une brique neuve, l'écran réclame un nom qui est pourtant rempli et refuse de
 * changer de ligne. C'est le second qui prouve que l'enregistrement A ÉTÉ appelé
 * — avec un état vide — plutôt que simplement oublié.
 *
 * La VÉRIFICATION EST SERVEUR (`getCampaign`) : l'écran peut afficher un texte
 * qui n'est jamais parti en base, et c'est précisément le défaut d'origine.
 */

/** Les briques de la campagne, telles que le serveur les a réellement gardées. */
async function briquesEnBase(campaignId: Id<"scriptCampaigns">) {
  const camp = await admin.query(api.scripts.getCampaign, { id: campaignId });
  return camp!.bricks;
}

test.describe("Scripts — changer de brique enregistre la saisie", () => {
  test("brique existante : le texte modifié part en base", async ({ page }) => {
    test.setTimeout(150_000);
    // La CAUSE, pas seulement le symptôme : l'éditeur publiait son
    // enregistrement en mettant à jour l'écran parent PENDANT son rendu. React
    // le dit en console, et c'est ce même geste qui figeait la fonction sur les
    // valeurs initiales. On surveille donc ce message précis, pas la console
    // entière (elle porte d'autres bruits qui n'ont rien à voir).
    const renduCroise: string[] = [];
    page.on("console", (m) => {
      if (
        m.type() === "error" &&
        m.text().includes("while rendering a different component")
      ) {
        renduCroise.push(m.text());
      }
    });
    const ts = Date.now();
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Bascule ${ts}`,
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "hook",
      label: `Bascule Une ${ts}`,
      content: `contenu initial ${ts}`,
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "hook",
      label: `Bascule Deux ${ts}`,
      content: `contenu voisin ${ts}`,
    });

    await page.goto(`/admin/${E2E_PROJECT_SLUG}/scripts/${campaignId}`);
    await page.getByText(`Bascule Une ${ts}`).first().click();
    const zone = page.getByLabel("Édition de la brique sélectionnée");
    const texte = zone.getByLabel("Texte", { exact: false });
    await expect(texte).toHaveValue(`contenu initial ${ts}`);

    // Saisie NON enregistrée, puis clic sur la brique voisine.
    await texte.fill(`contenu corrigé ${ts}`);
    await expect(zone.getByTestId("brick-dirty")).toBeVisible();
    await page.getByText(`Bascule Deux ${ts}`).first().click();

    // La bascule a bien eu lieu (sinon « rien n'est perdu » serait vrai par
    // immobilité : l'écran n'aurait tout simplement pas changé de ligne).
    await expect(zone.getByLabel("Texte", { exact: false })).toHaveValue(
      `contenu voisin ${ts}`,
    );
    // La cause AVANT la conséquence : ce message signe la publication faite
    // pendant le rendu, celle qui fige la fonction d'enregistrement.
    expect(renduCroise).toEqual([]);
    await expect
      .poll(async () => {
        const bricks = await briquesEnBase(campaignId);
        return bricks.find((b) => b.label === `Bascule Une ${ts}`)?.content;
      })
      .toBe(`contenu corrigé ${ts}`);
  });

  test("brique neuve : elle est créée, sans réclamer un nom déjà saisi", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now() + 1;
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Bascule Neuve ${ts}`,
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "hook",
      label: `Voisine ${ts}`,
      content: `contenu voisin ${ts}`,
    });

    await page.goto(`/admin/${E2E_PROJECT_SLUG}/scripts/${campaignId}`);
    await page.getByRole("button", { name: "Ajouter" }).first().click();
    const zone = page.getByLabel("Édition de la brique sélectionnée");
    await zone.getByLabel("Nom court (interne)").fill(`Neuve ${ts}`);
    await zone.getByLabel("Texte", { exact: false }).fill(`contenu neuf ${ts}`);
    await page.getByText(`Voisine ${ts}`).first().click();

    // Le nom EST rempli : le réclamer serait lire un état périmé.
    await expect(page.getByText("Le nom court est requis")).toHaveCount(0);
    await expect
      .poll(async () => (await briquesEnBase(campaignId)).map((b) => b.label))
      .toContain(`Neuve ${ts}`);
  });
});
