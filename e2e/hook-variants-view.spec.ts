import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Modif 5 — Popover variantes sur HookCard + deeplink /tracker?carouselId.
 *
 * Setup direct via ConvexHttpClient pour rester déterministe (pas de
 * dépendance à l'UI biblio qui pourrait évoluer). Le test couvre :
 *   - Affichage du bouton "Voir les X variantes" (couplé au badge variantsCount)
 *   - Popover qui charge la liste (lazy useQuery)
 *   - Click variante → router.push vers /tracker?carouselId=…
 *   - Bannière "Filtré sur C00X · Effacer" sur tracker
 *   - Effacer → URL nettoyée
 */
test.describe("Hooks — Vue variantes via Popover", () => {
  test("badge → popover → click variante → tracker filtré → effacer", async ({
    page,
  }) => {
    // Cleanup défensif des orphans + comptes archivés (mutation duplicate met
    // notes="" donc le helper cleanup ne les supprime pas, idem que pour
    // duplicate-carousel.spec.ts).
    const stalePubs = await convex.query(api.publications.listPublications, {});
    for (const p of stalePubs) {
      if (
        p.compte === "@test_e2e_var_view_src" ||
        p.compte === "@test_e2e_var_view_dst" ||
        p.notes === "[E2E_TEST] variants view"
      ) {
        await convex.mutation(api.publications.deletePublication, {
          id: p._id,
        });
      }
    }
    const allComptes = await convex.query(api.comptes.listComptes, {});
    for (const c of allComptes) {
      if (
        (c.handle === "@test_e2e_var_view_src" ||
          c.handle === "@test_e2e_var_view_dst") &&
        !c.actif
      ) {
        await convex.mutation(api.comptes.updateCompte, {
          id: c._id,
          actif: true,
        });
      }
    }

    // Existence déterminée côté SERVEUR (allComptes ci-dessus), pas via le 1er
    // rendu de la table : getByRole('cell').count() ne s'auto-attend pas et
    // renvoyait 0 si la table n'était pas encore chargée (course aggravée par
    // le listComptes désormais enrichi de la perf) → faux « créer » →
    // « existe déjà ». Cf TD-018 (attendre l'état, pas le 1er rendu).
    const existingHandles = new Set(allComptes.map((c) => c.handle));

    // Pré-requis : 2 comptes TikTok (création UI pour profiter du normalizeHandle)
    await page.goto(adminPath("/comptes"));
    for (const handle of ["test_e2e_var_view_src", "test_e2e_var_view_dst"]) {
      if (!existingHandles.has(`@${handle}`)) {
        await page
          .getByRole("button", { name: /ajouter un compte/i }).first()
          .click();
        await page.getByLabel("Handle").fill(handle);
        await page.getByRole("combobox").first().click();
        await page.getByRole("option", { name: "TikTok" }).click();
        await page.getByLabel("Notes").fill("[E2E_TEST] variants view");
        await page.getByRole("button", { name: /^ajouter$/i }).click();
        await expect(
          page.getByRole("cell", { name: `@${handle}` }),
        ).toBeVisible();
      }
    }

    // Setup : pick a hook FR + crée 1 publication originale + 1 duplicat.
    const hooksFR = await convex.query(api.hooks.listHooks, { langue: "FR" });
    const targetHook = hooksFR[0];
    if (!targetHook) throw new Error("Aucun hook FR disponible pour le test");

    const nextCid = await convex.query(api.publications.getNextCarouselId, {});
    await convex.mutation(api.publications.createPublication, {
      carouselId: nextCid,
      hookId: targetHook._id,
      hookText: targetHook.text,
      mecanique: targetHook.mecanique,
      niveau: targetHook.niveau,
      format: "A",
      nbSlides: 1,
      slides: [{ position: 1, texte: targetHook.text }],
      angleTonal: "Psycho",
      langue: targetHook.langue,
      plateformes: ["TikTok"],
      compte: "@test_e2e_var_view_src",
      datePubli: Date.now(),
      notes: "[E2E_TEST] variants view",
    });
    const dupResult = await convex.mutation(
      api.publications.duplicateCarousel,
      {
        sourceCarouselId: nextCid,
        targetCompte: "@test_e2e_var_view_dst",
        targetPlateforme: "TikTok",
      },
    );
    const dupCid = dupResult.carouselId;

    // UI : aller sur /biblio-hooks, filtrer par texte du hook pour réduire
    // le DOM, puis trouver la card et son bouton "Voir les X variantes".
    await page.goto(adminPath("/biblio-hooks"));
    await page.getByLabel("Recherche").fill(targetHook.text);
    // Bouton variantes : "Voir les X variantes" — X dépend des éventuelles
    // duplications pré-existantes pour ce hook (peut être > 2 si d'autres
    // tests/data ont laissé des groupes). On accepte tout entier >= 2.
    // Batch 3 Modif 6 — le bouton est désormais suffixé "carrousel" ou
    // "Shorts" selon le mediaType. Le test crée un carrousel + dup, donc
    // on cible le bouton "carrousel".
    // `.first()` : la recherche peut laisser plusieurs cards si d'autres hooks
    // contiennent le même texte — sans lui, le locator est ambigu (strict mode).
    const variantsBtn = page
      .getByRole("button", { name: /voir les \d+ variantes carrousel/i })
      .first();
    await expect(variantsBtn).toBeVisible({ timeout: 15_000 });

    // Popover ouvert : liste contient AU MOINS nos 2 carouselIds.
    const popover = page.locator('[data-slot="popover-content"]').last();

    // TD-018 — ne PAS asserter sur le 1er rendu. Deux courses coexistent ici :
    //  1. le clic peut tomber pendant un re-render de la liste (le libellé du
    //     bouton porte un COMPTEUR qui change quand getHookVariants se
    //     rafraîchit) → le popover ne s'ouvre jamais ;
    //  2. le popover peut s'ouvrir AVANT que la publication tout juste créée
    //     soit propagée par la query réactive → il s'affiche sans nos ids.
    // On réessaie donc l'ouverture jusqu'à ce que le CONTENU attendu soit là,
    // au lieu d'attendre une visibilité ponctuelle. Le clic n'est rejoué que si
    // le popover est fermé (le trigger est un toggle : re-cliquer le fermerait).
    await expect(async () => {
      if (!(await popover.isVisible())) {
        await variantsBtn.click();
      }
      await expect(popover).toBeVisible({ timeout: 2_000 });
      await expect(popover.getByText(nextCid, { exact: false })).toBeVisible({
        timeout: 2_000,
      });
      await expect(popover.getByText(dupCid, { exact: false })).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });

    // Click sur NOTRE variante → navigation /carrousels?carouselId=… (Batch B :
    // HookVariantsPopover route directement vers la page format au lieu de
    // /tracker?carouselId qui passait par le redirect catch-all).
    //
    // ⚠️ On cible l'entrée par SON carouselId, pas `.first()`. Le popover liste
    // TOUTES les variantes du hook : en suite complète, d'autres specs en ont
    // laissé, la 1ère entrée n'est donc pas la nôtre et l'attente échouait
    // (timeout de 30 s, déterministe sur deux runs). Cibler l'id rend le test
    // indépendant du contenu laissé par les autres — et l'assertion d'URL
    // vérifie du même coup qu'on a bien atterri sur CE carrousel.
    // toBeEnabled : attend que l'entrée soit réellement actionnable (le popover
    // se re-rend au fil des résolutions de métriques).
    // Même raison qu'à l'ouverture (TD-018) : on retente le GESTE ENTIER jusqu'à
    // ce que la navigation ait eu lieu, au lieu d'attendre une stabilité
    // ponctuelle. Le popover se re-rend au fil des résolutions de métriques, donc
    // l'entrée peut être détachée entre la résolution du locator et le clic — ce
    // qui faisait expirer `click()` après 30 s en suite complète (là où d'autres
    // specs ont laissé des variantes, donc plus de re-renders).
    await expect(async () => {
      if (!(await popover.isVisible())) await variantsBtn.click();
      const ourEntry = popover
        .locator("button")
        .filter({ hasText: nextCid })
        .first();
      await ourEntry.scrollIntoViewIfNeeded({ timeout: 2_000 });
      await ourEntry.click({ timeout: 2_000 });
      await expect(page).toHaveURL(
        new RegExp(`/carrousels\\?carouselId=${nextCid}`),
        { timeout: 3_000 },
      );
    }).toPass({ timeout: 30_000 });

    // Bannière visible + Effacer
    const banner = page.getByText(/filtré sur le carrousel/i);
    await expect(banner).toBeVisible();
    await page
      .getByRole("button", { name: /^effacer$/i })
      .click();
    // URL nettoyée (pas de carouselId param)
    await expect(page).toHaveURL(/\/carrousels(?:\?(?!carouselId).*)?$/);
    await expect(banner).toBeHidden();

    // Cleanup explicite des 2 publications créées (notes="" sur le duplicat
    // empêche le helper cleanup de le toucher).
    const afterPubs = await convex.query(api.publications.listPublications, {});
    for (const p of afterPubs) {
      if (
        p.compte === "@test_e2e_var_view_src" ||
        p.compte === "@test_e2e_var_view_dst"
      ) {
        await convex.mutation(api.publications.deletePublication, {
          id: p._id,
        });
      }
    }
  });
});
