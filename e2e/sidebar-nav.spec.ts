import { test, expect, adminPath } from "./fixtures/auth-fixture";

/**
 * Smoke test de la nav admin REGROUPÉE (refonte sidebar).
 *  - les groupes PILOTAGE / CONTENU sont visibles (labels uppercase purs, pas
 *    de role heading) ;
 *  - la section « Archives » (Carrousels, Shorts, ScreenRecorder, Biblio Hooks)
 *    a été RETIRÉE du menu : ni toggle « Archives », ni liens legacy dans la
 *    sidebar. Les routes restent accessibles par URL directe (hors nav) ;
 *  - Inspirations (dans le groupe Contenu) navigue toujours vers /inspirations.
 * Indirectement : vérifie qu'aucune route n'a été cassée par la refonte.
 */
test.describe("Sidebar — nav regroupée (sans Archives)", () => {
  test("groupes visibles, Archives retirées du menu, nav Inspirations", async ({
    page,
  }) => {
    await page.goto(adminPath("/dashboard"));

    // Labels de groupe non ambigus (n'existent pas aussi comme item de nav).
    await expect(page.getByText("Pilotage", { exact: true })).toBeVisible();
    await expect(page.getByText("Contenu", { exact: true })).toBeVisible();

    // Section Archives retirée : ni toggle repliable, ni lien legacy dans la
    // sidebar (les routes /carrousels… existent toujours mais hors menu).
    await expect(
      page.getByRole("button", { name: /archives/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /carrousels/i }),
    ).toHaveCount(0);

    // Inspirations (groupe Contenu) existe et navigue vers /inspirations.
    const inspirationsLink = page
      .getByRole("link", { name: /inspirations/i })
      .first();
    await expect(inspirationsLink).toBeVisible();
    await inspirationsLink.click();

    await expect(page).toHaveURL(/\/inspirations/);
    await expect(
      page.getByRole("heading", { name: /^inspirations$/i }),
    ).toBeVisible();
  });

  /**
   * LES GROUPES, ET CE QU'ILS CONTIENNENT.
   *
   * ⚠️ VÉRIFIER QUE « PRODUCTION » EST VISIBLE NE PROUVE RIEN : un en-tête
   * ajouté au mauvais endroit, ou une entrée restée dans Pilotage, passerait.
   * Ce qui compte est l'APPARTENANCE, et elle se lit dans l'ORDRE du menu :
   * une entrée appartient au dernier en-tête rencontré au-dessus d'elle.
   */
  test("chaque entrée est sous le bon en-tête de groupe", async ({ page }) => {
    await page.goto(adminPath("/dashboard"));
    await expect(page.getByText("Production", { exact: true })).toBeVisible();

    const lignes = (await page.locator("nav").first().innerText())
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    // Les en-têtes sont rendus en CAPITALES par CSS (`uppercase`), et
    // `innerText` rend le texte TRANSFORMÉ — pas celui du catalogue de
    // messages. On compare donc sur la forme affichée.
    const entetes = [
      "PILOTAGE",
      "PRODUCTION",
      "CRÉATEURS",
      "CONTENU",
      "ARGENT",
      "VEILLE",
      "ADMINISTRATION",
    ];
    const groupeDe = (entree: string) => {
      const i = lignes.indexOf(entree);
      if (i === -1) return null;
      let courant: string | null = null;
      for (let j = 0; j < i; j++) {
        if (entetes.includes(lignes[j])) courant = lignes[j];
      }
      return courant;
    };

    // Pilotage ne garde que ce qu'on REGARDE…
    expect(groupeDe("Dashboard")).toBe("PILOTAGE");
    expect(groupeDe("Analytics")).toBe("PILOTAGE");
    // …le flux quotidien est ailleurs…
    expect(groupeDe("Validation")).toBe("PRODUCTION");
    expect(groupeDe("Assignments")).toBe("PRODUCTION");
    expect(groupeDe("Défis")).toBe("PRODUCTION");
    // …l'argent aussi, sous le nom qu'il porte dans le catalogue de droits…
    expect(groupeDe("Pricings")).toBe("ARGENT");
    expect(groupeDe("Paiements")).toBe("ARGENT");
    // …et les réglages sont descendus en bas.
    expect(groupeDe("Notifications")).toBe("ADMINISTRATION");
  });
});
