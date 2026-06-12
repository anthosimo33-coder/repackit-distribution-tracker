import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Modif 2 — duplicateCarousel + parentCarouselId.
 *
 * Couvre :
 *   - Flow nominal : créer original → dropdown → dialog → submit → nouveau
 *     draft visible avec mêmes slides.
 *   - Propagation parentAncre : duplicat d'un duplicat pointe vers l'ORIGINAL,
 *     pas vers le duplicat intermédiaire. Vérification via ConvexHttpClient
 *     (pas exposé dans l'UI à ce stade — Modif 5 introduira la vue).
 */
test.describe("Tracker — Dupliquer un carrousel", () => {
  test("flow nominal + propagation parentAncre sur sous-duplicat", async ({
    page,
  }) => {
    // Cleanup défensif : un run précédent peut avoir laissé des duplicats avec
    // notes="" (mutation duplicateCarousel ne propage pas les notes), ce qui
    // empêche le helper cleanup de supprimer les comptes (orphan ref) et les
    // archive. Du coup l'UI listComptes(actifOnly:true) renvoie vide. On nettoie
    // ici en ciblant les pubs sans marker dont le compte commence par notre
    // préfixe de test, puis on réactive les comptes archivés.
    const stalePubs = await convex.query(api.publications.listPublications, {});
    for (const p of stalePubs) {
      if (
        p.compte === "@test_e2e_dup_src" ||
        p.compte === "@test_e2e_dup_dst"
      ) {
        await convex.mutation(api.publications.deletePublication, {
          id: p._id,
        });
      }
    }
    const allComptes = await convex.query(api.comptes.listComptes, {});
    for (const c of allComptes) {
      if (
        (c.handle === "@test_e2e_dup_src" || c.handle === "@test_e2e_dup_dst") &&
        !c.actif
      ) {
        await convex.mutation(api.comptes.updateCompte, {
          id: c._id,
          actif: true,
        });
      }
    }

    // Pré-requis : 2 comptes TikTok pour pouvoir distinguer original/duplicat
    await page.goto(adminPath("/comptes"));
    for (const handle of ["test_e2e_dup_src", "test_e2e_dup_dst"]) {
      if (
        (await page
          .getByRole("cell", { name: `@${handle}` })
          .count()) === 0
      ) {
        await page
          .getByRole("button", { name: /ajouter un compte/i }).first()
          .click();
        await page.getByLabel("Handle").fill(handle);
        await page.getByRole("combobox").first().click();
        await page.getByRole("option", { name: "TikTok" }).click();
        await page.getByLabel("Notes").fill("[E2E_TEST] duplicate");
        await page.getByRole("button", { name: /^ajouter$/i }).click();
        await expect(
          page.getByRole("cell", { name: `@${handle}` }),
        ).toBeVisible();
      }
    }

    // Batch C : setup direct via Convex (vs ancien UI /nouveau).
    const hookText = `Hook duplicate E2E ${Date.now()}`;
    const slideText = `Slide originale ${Date.now()}`;
    const carouselId = await convex.query(
      api.publications.getNextCarouselId,
      {},
    );
    await convex.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText,
      mecanique: "Erreur",
      niveau: "Broad-A",
      mediaType: "carousel",
      format: "A",
      nbSlides: 7,
      slides: Array.from({ length: 7 }, (_, i) => ({
        position: i + 1,
        texte: i === 0 ? slideText : "",
      })),
      angleTonal: "Psycho",
      langue: "FR",
      plateformes: ["TikTok"],
      compte: "@test_e2e_dup_src",
      datePubli: Date.now(),
      notes: "[E2E_TEST] duplicate",
    });

    await page.goto(adminPath("/carrousels"));

    // Récupère carouselId de l'original via ConvexHttpClient (le client a déjà
    // accès, on évite de gratter la cellule du tracker pour rester explicite).
    const allPubs = await convex.query(api.publications.listPublications, {});
    const original = allPubs.find((p) => p.hookText === hookText);
    if (!original) throw new Error("Carrousel original introuvable post-création");
    expect(original.parentCarouselId).toBeUndefined();

    // 1) Duplicate via UI : dropdown → Dupliquer → dialog → Confirmer
    const row = page.getByRole("row").filter({ hasText: hookText });
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: /^dupliquer$/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const confirmBtn = dialog.getByRole("button", { name: /^confirmer$/i });
    await expect(confirmBtn).toBeDisabled();

    // Plateforme TikTok puis compte test_e2e_dup_dst.
    // Les Select shadcn sont 2 comboboxes du dialog (Plateforme cible, Compte cible).
    const dialogCombos = dialog.getByRole("combobox");
    await dialogCombos.nth(0).click();

    // Batch 1 Shorts — assert que le dropdown plateforme cible est filtré
    // selon le mediaType de la source. Source carousel (mediaType undefined
    // → coerce "carousel" via getMediaType) → YouTube doit être absent (pas
    // de carrousels sur YouTube). TikTok + Instagram doivent être présents.
    // Couvre le filtrage UI ALLOWED_PLATFORMS_FOR_CAROUSEL côté tracker.
    await expect(
      page.getByRole("option", { name: "YouTube", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("option", { name: "TikTok", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Instagram", exact: true }),
    ).toBeVisible();

    await page.getByRole("option", { name: "TikTok" }).click();
    await dialogCombos.nth(1).click();
    await page.getByRole("option", { name: /test_e2e_dup_dst/i }).click();

    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();
    await expect(dialog).toBeHidden();

    // Le nouveau draft apparaît avec le même hookText. Section "À venir"
    // affiche désormais 2 rows pour ce hookText (l'original draft + le duplicat).
    await expect(
      page.getByRole("row").filter({ hasText: hookText }),
    ).toHaveCount(2);

    // 2) Vérifie via ConvexHttpClient : duplicat → parentCarouselId = original.
    // Note : le handle compte est normalisé à la création avec préfixe "@"
    // (cf normalizeHandle dans app/comptes/page.tsx). Les comparaisons côté
    // DB se font donc sur "@test_e2e_dup_dst", pas "test_e2e_dup_dst".
    const afterFirstDup = await convex.query(
      api.publications.listPublications,
      {},
    );
    const dups = afterFirstDup
      .filter((p) => p.hookText === hookText)
      .filter((p) => p.carouselId !== original.carouselId);
    expect(dups).toHaveLength(1);
    const firstDup = dups[0];
    expect(firstDup.parentCarouselId).toBe(original.carouselId);
    expect(firstDup.compte).toBe("@test_e2e_dup_dst");
    expect(firstDup.plateforme).toBe("TikTok");
    expect(firstDup.postUrl ?? "").toBe(""); // draft
    // Batch 1 Shorts : slides est désormais optional côté schéma. La source
    // est un carrousel (mediaType undefined → coerce "carousel") donc slides
    // est forcément présent — non-null assertion explicite pour TSC.
    expect(firstDup.slides![0].texte).toBe(slideText); // mêmes slides

    // 3) Dupliquer LE DUPLICAT — sous-duplicat doit pointer vers ORIGINAL
    //    (pas vers firstDup). Vérification via ConvexHttpClient direct, plus
    //    simple que de retrouver la bonne row dans le DOM.
    await convex.mutation(api.publications.duplicateCarousel, {
      sourceCarouselId: firstDup.carouselId,
      targetCompte: "@test_e2e_dup_src",
      targetPlateforme: "TikTok",
    });

    const afterSecondDup = await convex.query(
      api.publications.listPublications,
      {},
    );
    const allDups = afterSecondDup
      .filter((p) => p.hookText === hookText)
      .filter((p) => p.carouselId !== original.carouselId);
    expect(allDups).toHaveLength(2);
    for (const d of allDups) {
      // Tous les descendants pointent vers l'original — pas de chaînage.
      expect(d.parentCarouselId).toBe(original.carouselId);
    }

    // Cleanup explicite des duplicats : la mutation duplicateCarousel met
    // notes="" (cf décision : nouveau draft, pas de marker hérité), donc
    // helpers/cleanup.ts ne les nettoie pas via le filtre "[E2E_TEST]". Sans
    // ce cleanup, les comptes restent référencés et passent en archivés au
    // teardown, ce qui casse le test au run suivant (Select compte vide).
    for (const d of allDups) {
      await convex.mutation(api.publications.deletePublication, { id: d._id });
    }
  });
});
