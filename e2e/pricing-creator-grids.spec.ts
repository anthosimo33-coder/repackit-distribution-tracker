import { test, expect } from "@playwright/test";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * LA GRILLE D'UNE CRÉATRICE, POSÉE DEPUIS L'ÉCRAN BARÈMES — et relue par la
 * modale d'assignation, qui la pré-sélectionne.
 *
 * Les deux moitiés comptent autant : poser la grille sans que l'assignation la
 * lise ne fait gagner aucun clic au manager, et la pré-sélectionner sans pouvoir
 * la poser en lot laisse le geste là où il était (fiche par fiche).
 */

const bareme = (nom: string, montantFixe: number) =>
  admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] ${nom}`,
    montantFixe,
    nbVideosCible: 30,
    tauxCPM: 0,
  });

test.describe("Barèmes — la grille suit la créatrice", () => {
  test("poser un lot de créatrices sur une grille, puis en retirer une", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const { pricingId: grilleA } = await bareme(`Grille A ${ts}`, 400);
    const { pricingId: grilleB } = await bareme(`Grille B ${ts}`, 500);
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Grille Alpha ${ts}`,
      email: `e2e-grille-a-${ts}@repackit.test`,
      password: "creator-grille-a-12345",
    });
    const B = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Grille Beta ${ts}`,
      email: `e2e-grille-b-${ts}@repackit.test`,
      password: "creator-grille-b-12345",
    });

    const grilleDe = async (id: Id<"creators">) =>
      (await admin.query(api.pricing.listCreatorPricingGrids, {})).find(
        (c) => c._id === id,
      )!;

    // L'ÉTAT DE DÉPART, sans lequel la suite ne prouve rien : une fiche neuve ne
    // porte aucune grille en propre.
    expect((await grilleDe(A.creatorId)).pricingId).toBeNull();

    const pose = await admin.mutation(api.pricing.setPricingCreators, {
      pricingId: grilleA,
      creatorIds: [A.creatorId, B.creatorId],
    });
    expect(pose).toEqual({ added: 2, removed: 0 });
    expect((await grilleDe(A.creatorId)).pricingId).toBe(grilleA);
    expect((await grilleDe(B.creatorId)).effectivePricingId).toBe(grilleA);
    // Posée en propre ⇒ elle n'hérite plus de rien : un changement de défaut du
    // projet ne la déplacera pas.
    expect((await grilleDe(B.creatorId)).inherited).toBe(false);

    // L'ENSEMBLE VOULU, pas un ajout : B disparaît de la liste, donc B sort de la
    // grille — sans toucher A.
    const retrait = await admin.mutation(api.pricing.setPricingCreators, {
      pricingId: grilleA,
      creatorIds: [A.creatorId],
    });
    expect(retrait).toEqual({ added: 0, removed: 1 });
    expect((await grilleDe(A.creatorId)).pricingId).toBe(grilleA);
    expect((await grilleDe(B.creatorId)).pricingId).toBeNull();

    // Une AUTRE grille ne déloge jamais celle de A : seules les fiches pointant
    // sur la grille éditée sont candidates au retrait.
    await admin.mutation(api.pricing.setPricingCreators, {
      pricingId: grilleB,
      creatorIds: [B.creatorId],
    });
    expect((await grilleDe(A.creatorId)).pricingId).toBe(grilleA);
    expect((await grilleDe(B.creatorId)).pricingId).toBe(grilleB);
  });

  test("la modale d'assignation lit la grille de la créatrice", async () => {
    test.setTimeout(150_000);
    const ts = Date.now() + 1;
    const { pricingId } = await bareme(`Grille Lue ${ts}`, 700);
    const C = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Grille Gamma ${ts}`,
      email: `e2e-grille-c-${ts}@repackit.test`,
      password: "creator-grille-c-12345",
    });

    const vueAssignation = async () =>
      (await admin.query(api.assignments.listAssignableCreators, {})).find(
        (c) => c._id === C.creatorId,
      )!;

    // Avant : le champ existe et vaut « aucune grille » — c'est l'état que la
    // modale traduit par « choisis un barème ». (Le projet e2e n'a pas de grille
    // par défaut ; en poser une la ferait hériter, ce que couvre `inherited`.)
    expect((await vueAssignation()).pricingId).toBeNull();

    await admin.mutation(api.pricing.setPricingCreators, {
      pricingId,
      creatorIds: [C.creatorId],
    });

    const apres = await vueAssignation();
    expect(apres.pricingId).toBe(pricingId);
    expect(apres.pricingName).toBe(`[E2E_TEST] Grille Lue ${ts}`);

    // Archiver le barème le retire de la pré-sélection : il n'est plus dans la
    // liste du sélecteur, et un id absent de la liste afficherait un champ vide.
    await admin.mutation(api.pricing.archivePricing, {
      id: pricingId,
      archived: true,
    });
    expect((await vueAssignation()).pricingId).toBeNull();
  });

  test("un talent n'a pas de barème : la pose est REFUSÉE", async () => {
    test.setTimeout(150_000);
    const ts = Date.now() + 2;
    const { pricingId } = await bareme(`Grille Talent ${ts}`, 300);
    const { creatorId } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Grille Delta ${ts}`,
      email: `e2e-grille-d-${ts}@repackit.test`,
      kind: "talent",
    });

    // Un talent est payé au forfait de cycle (`cycleRetainer`), champ disjoint du
    // barème : lui en poser un écrirait une condition de paie que rien ne lit.
    await expect(
      admin.mutation(api.pricing.setPricingCreators, {
        pricingId,
        creatorIds: [creatorId],
      }),
    ).rejects.toThrow(/pas un créateur partenaire/);

    // Et il n'apparaît pas dans la liste de la modale.
    const grids = await admin.query(api.pricing.listCreatorPricingGrids, {});
    expect(grids.map((c) => c._id)).not.toContain(creatorId);
  });
});
