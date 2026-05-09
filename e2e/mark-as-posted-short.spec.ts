import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = new ConvexHttpClient(convexUrl);

/**
 * Batch 2 Modif 4c — flow Marquer comme posté + édition métriques d'un Short.
 *
 * Couvre :
 *   - Mark as posted dialog reste agnostique (URL + confirm) → la pub Short
 *     passe en publié
 *   - PublicationEditDialog en mode short : saves caché, likes + subsGained
 *     visibles, commentsAudit caché (YouTube → !isInstagram)
 *   - Save persiste les valeurs likes + subsGained dans la DB
 *
 * Setup direct via ConvexHttpClient pour la rapidité, vérifications via UI.
 */
test.describe("Tracker — Marquer Short comme posté + édition métriques", () => {
  test("draft Short → URL → publié → likes + subsGained sauvegardés", async ({
    page,
  }) => {
    // Cleanup défensif (orphelins runs précédents)
    const stalePubs = await convex.query(api.publications.listPublications, {});
    for (const p of stalePubs) {
      if (p.compte === "@test_e2e_mark_short_yt") {
        await convex.mutation(api.publications.deletePublication, {
          id: p._id,
        });
      }
    }
    const stalleComptes = await convex.query(api.comptes.listComptes, {});
    for (const c of stalleComptes) {
      if (c.handle === "@test_e2e_mark_short_yt" && !c.actif) {
        await convex.mutation(api.comptes.updateCompte, {
          id: c._id,
          actif: true,
        });
      }
    }

    // Pré-requis : compte YouTube
    const compteExists = stalleComptes.find(
      (c) =>
        c.handle === "@test_e2e_mark_short_yt" && c.plateforme === "YouTube",
    );
    if (!compteExists) {
      await convex.mutation(api.comptes.createCompte, {
        handle: "@test_e2e_mark_short_yt",
        plateforme: "YouTube",
        notes: "[E2E_TEST] mark short YT",
      });
    }

    // 1 Short draft via mutation directe
    const hookText = `Hook mark short E2E ${Date.now()}`;
    const carouselId = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
    await convex.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText,
      mecanique: "Volume",
      niveau: "Broad-B",
      mediaType: "short",
      script: "Script E2E mark short",
      angleTonal: "Pédagogique",
      langue: "FR",
      plateformes: ["YouTube"],
      compte: "@test_e2e_mark_short_yt",
      datePubli: Date.now(),
      notes: "[E2E_TEST] mark short",
    });

    await page.goto("/tracker");
    // Filtre top-level Format → Short pour réduire le DOM
    await page
      .locator("label")
      .filter({ hasText: /^Format$/ })
      .first()
      .locator("xpath=..")
      .getByRole("combobox")
      .click();
    await page.getByRole("option", { name: "Short" }).click();

    // Row visible avec hookText. Ouvre le menu actions et clique "Marquer
    // comme posté".
    const row = page.getByRole("row").filter({ hasText: hookText });
    await expect(row).toBeVisible();
    await row.getByRole("button").last().click();
    await page
      .getByRole("menuitem", { name: /marquer comme posté/i })
      .click();

    const markDialog = page.getByRole("dialog");
    await expect(markDialog).toBeVisible();
    await markDialog
      .getByLabel("Lien de publication")
      .fill("https://www.youtube.com/shorts/abc123e2e");
    await markDialog
      .getByRole("button", { name: /^confirmer$/i })
      .click();
    await expect(markDialog).toBeHidden();

    // Re-locate la row (re-render après mutation) puis ouvre EditDialog via
    // "Mettre à jour stats".
    const updatedRow = page.getByRole("row").filter({ hasText: hookText });
    await expect(updatedRow).toBeVisible();
    await updatedRow.getByRole("button").last().click();
    await page
      .getByRole("menuitem", { name: /mettre à jour stats/i })
      .click();

    const editDialog = page.getByRole("dialog");
    await expect(editDialog).toBeVisible();

    // Mode short : saves caché, likes + subsGained visibles, commentsAudit
    // disabled (YouTube). Vérifie la présence des 3 fields short-specific.
    await expect(editDialog.getByLabel("Likes")).toBeVisible();
    await expect(editDialog.getByLabel("Subs gagnés")).toBeVisible();
    await expect(editDialog.getByLabel("Saves")).toHaveCount(0);
    await expect(editDialog.getByLabel("Comments AUDIT")).toBeDisabled();

    // Saisir métriques
    await editDialog.getByLabel("Vues J+7").fill("1000");
    await editDialog.getByLabel("Likes").fill("50");
    await editDialog.getByLabel("Subs gagnés").fill("10");
    await editDialog.getByRole("button", { name: /enregistrer/i }).click();
    await expect(editDialog).toBeHidden();

    // Vérifier persistence côté DB
    const finalPubs = await convex.query(
      api.publications.listPublications,
      {},
    );
    const saved = finalPubs.find((p) => p.hookText === hookText);
    expect(saved).toBeTruthy();
    expect(saved!.likes).toBe(50);
    expect(saved!.subsGained).toBe(10);
    expect(saved!.vuesJ7).toBe(1000);
    expect(saved!.saves).toBeNull();
    // commentsAudit : YouTube → null (cf inversion isInstagram)
    expect(saved!.commentsAudit).toBeNull();

    // Cleanup explicite
    if (saved) {
      await convex.mutation(api.publications.deletePublication, {
        id: saved._id,
      });
    }
  });
});
