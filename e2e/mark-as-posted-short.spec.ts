import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

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

    // Refinement Shorts — un Short requiert désormais un ICP (validation
    // createPublication + PublicationEditDialog). On en crée un (marqué).
    const icpId = await convex.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] mark short ${Date.now()}`,
    });

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
      icpId,
      script: "Script E2E mark short",
      angleTonal: "Pédagogique",
      langue: "FR",
      plateformes: ["YouTube"],
      compte: "@test_e2e_mark_short_yt",
      datePubli: Date.now(),
      notes: "[E2E_TEST] mark short",
    });

    // Batch B — page /shorts filtre déjà implicitement par mediaType=short.
    // L'ancien filtre top-level Format disparaît avec le split de routes.
    await page.goto(adminPath("/shorts"));

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

    const editDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Mettre à jour" });
    await expect(editDialog).toBeVisible();
    // Comments AUDIT publication-level disabled (YouTube → !isInstagram).
    await expect(editDialog.getByLabel("Comments AUDIT")).toBeDisabled();

    // Ajoute un snapshot J+7. Mode short : likes + subs visibles, saves absent.
    await editDialog
      .getByRole("button", { name: /ajouter un snapshot/i })
      .click();
    const addDialog = page
      .getByRole("dialog")
      .filter({ hasText: "Nouveau snapshot" });
    await expect(addDialog.getByLabel(/^likes$/i)).toBeVisible();
    await expect(addDialog.getByLabel(/subs gagnés/i)).toBeVisible();
    await expect(addDialog.getByLabel(/^saves$/i)).toHaveCount(0);
    await addDialog.getByRole("button", { name: "J+7", exact: true }).click();
    await addDialog.getByLabel(/^vues$/i).fill("1000");
    await addDialog.getByLabel(/^likes$/i).fill("50");
    await addDialog.getByLabel(/subs gagnés/i).fill("10");
    await addDialog.getByRole("button", { name: /^enregistrer$/i }).click();
    await expect(addDialog).toBeHidden();
    await editDialog.getByRole("button", { name: /^fermer$/i }).click();
    await expect(editDialog).toBeHidden();

    // Persistence : snapshot + champs latest dénormalisés + displayMetrics.
    const finalPubs = await convex.query(
      api.publications.listPublications,
      {},
    );
    const saved = finalPubs.find((p) => p.hookText === hookText);
    expect(saved).toBeTruthy();
    expect(saved!.vuesLatest).toBe(1000);
    expect(saved!.likesLatest).toBe(50);
    expect(saved!.subsGainedLatest).toBe(10);
    // savesLatest non renseigné pour un Short.
    expect(saved!.savesLatest).toBeUndefined();
    expect(saved!.displayMetrics.vues).toBe(1000);
    const snaps = await convex.query(
      api.metricSnapshots.listSnapshotsByPublication,
      { publicationId: saved!._id },
    );
    expect(snaps.length).toBe(1);
    expect(snaps[0].likes).toBe(50);
    expect(snaps[0].subsGained).toBe(10);
    // commentsAudit : YouTube → reste null (publication-level, non saisi).
    expect(saved!.commentsAudit).toBeNull();

    // Cleanup explicite
    if (saved) {
      await convex.mutation(api.publications.deletePublication, {
        id: saved._id,
      });
    }
  });
});
