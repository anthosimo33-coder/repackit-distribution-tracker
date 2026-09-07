import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

/**
 * BANC DE MONTAGE — l'écran d'une campagne, refondu.
 *
 * Ce que la spec verrouille, et qui n'existait pas avant :
 *  1. ONGLETS — les flux ne vivent plus sous la pile des hooks ; changer
 *     d'onglet change ce que la liste montre (absence ADOSSÉE à une présence) ;
 *  2. RECHERCHE — plein texte, insensible à la casse ET aux accents (les hooks
 *     sont écrits en majuscules accentuées : une recherche qui les exige ne sert
 *     à rien) ;
 *  3. ÉDITION DANS LE VOLET — plus de modale : on clique une ligne, on écrit à
 *     droite, on enregistre, et c'est ÉCRIT EN BASE (relecture serveur, pas
 *     seulement un texte à l'écran) ;
 *  4. CONSIGNE — écrite depuis ce volet, elle marque la ligne et part dans
 *     l'aperçu « ce que verra la créatrice » ;
 *  5. SÉLECTION MULTIPLE — cocher deux lignes et les désactiver d'un geste ne
 *     touche QUE ces deux-là (contrôle de non-contagion sur la troisième).
 *
 * ⚠️ La base e2e est partagée : chaque assertion porte sur NOS briques (par
 * identifiant ou par texte horodaté), jamais sur un décompte global.
 */
test.describe("Banc de montage — écran d'une campagne de scripts", () => {
  test("onglets, recherche, édition dans le volet, consigne, sélection multiple", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();

    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Banc ${ts}`,
    });
    const add = (
      kind: "hook" | "flux" | "cta",
      label: string,
      content: string,
    ) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content,
      });

    // Textes de PRODUCTION : des hooks en majuscules accentuées (c'est la forme
    // réelle des accroches TikTok), pas « hook 1 / hook 2 » — la recherche sans
    // accents ne prouverait rien sur « hook 1 ».
    const hookVerif = `DEPUIS QUAND INSTAGRAM À CETTE FONCTIONNALITÉ ??? ${ts}`;
    const hookTrahison = `PARDON ??? depuis quand insta montre qui nous suit pas en retour 💀 ${ts}`;
    const hookRechute = `j'ai retéléchargé l'appli pour la troisième fois ce mois-ci ${ts}`;
    const fluxScan = `Tu déposes la vidéo, l'outil la compare aux plus virales du moment ${ts}`;

    const idVerif = await add("hook", `H-verif ${ts}`, hookVerif);
    const idTrahison = await add("hook", `H-trahison ${ts}`, hookTrahison);
    const idRechute = await add("hook", `H-rechute ${ts}`, hookRechute);
    await add("flux", `F-scan ${ts}`, fluxScan);
    await add("cta", `C-lead ${ts}`, `Commente « Go » ${ts}`);

    await page.goto(adminPath(`/scripts/${campaignId}`));
    await expect(page.getByTestId("combo-count")).toContainText("3", {
      timeout: 15_000,
    });

    // Toutes les assertions de LISTE sont scopées à la liste : le texte de la
    // brique sélectionnée apparaît aussi dans le volet d'édition et dans
    // l'aperçu — trois occurrences pour une seule brique. Chercher « dans la
    // page » rendrait le test vert quoi qu'affiche la liste.
    const liste = page.getByTestId("brick-list");
    const ligne = (texte: string) =>
      liste.getByTestId("brick-row").filter({ hasText: texte.slice(0, 40) });

    // ── 1. ONGLETS ──────────────────────────────────────────────────────────
    // L'écran ouvre sur les hooks : les trois sont là, le flux n'y est pas.
    await expect(ligne(hookVerif)).toHaveCount(1);
    await expect(ligne(hookTrahison)).toHaveCount(1);
    await expect(ligne(fluxScan)).toHaveCount(0);

    // Un clic sur l'onglet Flux INVERSE exactement ça — c'est ce qui remplace
    // le défilement à travers cinquante hooks.
    await page.getByRole("tab", { name: /^Flux/ }).click();
    await expect(ligne(fluxScan)).toHaveCount(1);
    await expect(ligne(hookVerif)).toHaveCount(0);
    await page.getByRole("tab", { name: /^Hook/ }).click();
    await expect(ligne(hookVerif)).toHaveCount(1);

    // ── 2. RECHERCHE, sans accents ni casse ─────────────────────────────────
    const search = page.getByLabel("Chercher une brique");
    await search.fill("fonctionnalite"); // ni majuscules, ni accent
    await expect(ligne(hookVerif)).toHaveCount(1);
    await expect(ligne(hookTrahison)).toHaveCount(0);
    await search.fill("");
    await expect(ligne(hookTrahison)).toHaveCount(1);

    // ── 3. ÉDITION DANS LE VOLET ────────────────────────────────────────────
    // Cliquer le TEXTE de la ligne charge la brique dans le volet de droite.
    await ligne(hookTrahison).getByRole("button").first().click();
    const contenu = page.locator("#brick-content");
    await expect(contenu).toHaveValue(hookTrahison);

    const corrige = `${hookTrahison} (corrigé)`;
    await contenu.fill(corrige);
    // Le bouton n'est actif QUE si quelque chose a bougé : sans ça, on ne
    // saurait pas distinguer « enregistré » de « rien à enregistrer ».
    await expect(page.getByTestId("brick-dirty")).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByTestId("brick-dirty")).toHaveCount(0);

    // Écrit EN BASE, pas seulement à l'écran.
    await expect
      .poll(
        async () => {
          const camp = await admin.query(api.scripts.getCampaign, {
            id: campaignId,
          });
          return camp!.bricks.find((b) => b._id === idTrahison)!.content;
        },
        { timeout: 15_000 },
      )
      .toBe(corrige);

    // ── 4. CONSIGNE écrite depuis le volet ──────────────────────────────────
    const consigne = `Filme l'écran de notifications AVANT de parler ${ts}`;
    await page.locator("#brick-instruction").fill(consigne);
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();

    // Elle marque la ligne — et SEULEMENT celle-là (les deux autres hooks n'ont
    // pas de consigne : un marqueur qui s'allume partout ne dit rien).
    await expect(ligne(corrige).getByTestId("brick-instruction-tag")).toBeVisible(
      { timeout: 15_000 },
    );
    await expect(liste.getByTestId("brick-instruction-tag")).toHaveCount(1);
    // …et part dans l'aperçu « ce que verra la créatrice », qui vit désormais
    // dans le volet (plus besoin d'ouvrir la modale d'aperçu pour la relire).
    await expect(page.getByTestId("editor-preview")).toContainText(consigne);
    await expect
      .poll(async () => {
        const camp = await admin.query(api.scripts.getCampaign, {
          id: campaignId,
        });
        return camp!.bricks.find((b) => b._id === idTrahison)!.instruction;
      })
      .toBe(consigne);

    // ── 5. SÉLECTION MULTIPLE ───────────────────────────────────────────────
    // Aucune barre d'actions tant que rien n'est coché (contrôle de présence
    // juste après : elle apparaît bien au premier clic).
    await expect(page.getByTestId("bulk-bar")).toHaveCount(0);
    await ligne(hookVerif).getByLabel("Sélectionner la brique").click();
    await ligne(corrige).getByLabel("Sélectionner la brique").click();
    await expect(page.getByTestId("bulk-bar")).toContainText("2");

    await page
      .getByTestId("bulk-bar")
      .getByRole("button", { name: "Désactiver" })
      .click();

    // Les DEUX cochées sont désactivées, la TROISIÈME n'a pas bougé : une
    // action en lot qui déborde sur le reste de la campagne serait pire que
    // trois clics séparés.
    await expect
      .poll(
        async () => {
          const camp = await admin.query(api.scripts.getCampaign, {
            id: campaignId,
          });
          const byId = new Map(camp!.bricks.map((b) => [b._id, b.active]));
          return [
            byId.get(idVerif),
            byId.get(idTrahison),
            byId.get(idRechute),
          ];
        },
        { timeout: 15_000 },
      )
      .toEqual([false, false, true]);
  });
});
