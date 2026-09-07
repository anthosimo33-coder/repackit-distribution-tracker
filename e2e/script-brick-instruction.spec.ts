import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * CONSIGNE PAR BRIQUE (`scriptBricks.instruction`) — la consigne de tournage
 * attachée à un bloc du script, écrite par l'admin et LUE PAR LA CRÉATRICE sous
 * ce bloc. Distincte des deux consignes qui existaient déjà :
 *   - `assignments.instructions` = consigne d'UNE assignation (une créatrice,
 *     une vidéo) ; celle-ci suit le TEXTE, donc toutes ses assignations ;
 *   - `overlayText` = texte à INCRUSTER dans la vidéo ; celle-ci ne se dit ni ne
 *     s'affiche : elle explique comment tourner.
 *
 * Ce que la spec verrouille :
 *  1. la consigne voyage jusqu'à la créatrice, par SLOT, et seulement pour les
 *     briques qui en portent une (contrôle d'absence ADOSSÉ à une présence) ;
 *  2. elle est lue LIVE : corriger une consigne fausse répare les missions DÉJÀ
 *     assignées — c'est l'inverse du texte du script, figé à l'assignation ;
 *  3. elle n'entre JAMAIS dans le script monté (rien n'en part dans la vidéo ni
 *     dans la description) ;
 *  4. vider le champ EFFACE la consigne (une saisie blanche vaut absence) ;
 *  5. la créatrice ne reçoit toujours aucune décomposition (pas d'id de brique,
 *     pas de campagne) : la consigne porte un slot et un texte, rien d'autre.
 */
test.describe("Consigne par brique de script", () => {
  test("suit le slot jusqu'à la créatrice, se corrige à chaud, reste hors du script", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] ConsigneC ${ts}`,
      email: `e2e-creator-consigne-${ts}@repackit.test`,
      password: "consigne-12345",
    });
    const projectId = creator.projectId;

    // Textes de PRODUCTION : un hook parlé, une consigne qui nomme l'élément à
    // filmer, une description avec un CTA. Des « brique 1 / consigne 1 » ne
    // prouveraient rien sur la troncature ni sur les accents.
    const hookTexte =
      "Je veux pas être parano, donc plutôt que de lui prendre la tête, je vais juste vérifier un truc.";
    const consigneHook =
      "Filme l'écran de son téléphone posé sur la table — c'est l'élément précis qui justifie la vérification.";
    const consigneCta = "Épingle ce commentaire dès la publication.";

    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Consigne ${ts}`,
    });
    const hookId = await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "hook",
      label: "Depuis QUAND",
      content: hookTexte,
      instruction: consigneHook,
    });
    // Le FLUX n'en porte PAS : c'est le contrôle d'absence de la spec, et il
    // n'a de valeur que parce que les deux autres, eux, en portent une.
    const fluxId = await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "flux",
      label: "Flux 2 — scan & clone",
      content:
        "Tu déposes la vidéo, l'outil la compare aux plus virales du moment et te sort le titre et la miniature.",
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "cta",
      label: "CTA capture de lead",
      content: "Commente « Go » si tu veux la marche à suivre complète.",
      instruction: consigneCta,
    });

    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingConsigne ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2econsigne${ts}`,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });

    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) =>
        a.scriptCombo?.campaignId === campaignId &&
        a.creatorId === creator.creatorId,
    )!;
    expect(row).toBeTruthy();

    const mine = async () =>
      (await creator.client.query(api.assignments.getMyAssignment, {
        projectId,
        id: row._id,
      }))!;

    // ── 1. La consigne arrive, par SLOT, et seulement là où il y en a une ────
    const vue = await mine();
    expect(vue.scriptInstructions).toEqual([
      { slot: "hook", text: consigneHook },
      { slot: "cta", text: consigneCta },
    ]);
    // Contrôle d'absence ADOSSÉ à la présence ci-dessus : le flux, qui n'en a
    // pas, n'apparaît pas — et ce n'est pas parce que la liste serait vide.
    expect(vue.scriptInstructions.map((i) => i.slot)).not.toContain("flux");

    // ── 2. Rien de la décomposition ne fuit avec la consigne ────────────────
    const brut = JSON.stringify(vue.scriptInstructions);
    expect(brut).not.toContain(hookId);
    expect(brut).not.toContain(fluxId);
    expect(brut).not.toContain(campaignId);

    // ── 3. La consigne n'est PAS du script ──────────────────────────────────
    // Présence : le texte du hook, lui, est bien dans le script monté.
    expect(vue.assembledScript).toContain(hookTexte);
    expect(vue.assembledScript).not.toContain(consigneHook);
    expect(vue.assembledScript).not.toContain(consigneCta);

    // ── 4. LIVE : corriger la consigne répare la mission DÉJÀ assignée ──────
    // C'est la décision de conception à verrouiller : le texte du script est
    // figé à l'assignation, la consigne ne l'est pas.
    const corrigee =
      "Filme l'écran VERROUILLÉ, pas la conversation — sinon la vidéo saute.";
    await admin.mutation(api.scripts.updateBrick, {
      id: hookId,
      instruction: corrigee,
    });
    const apres = await mine();
    expect(apres.scriptInstructions).toEqual([
      { slot: "hook", text: corrigee },
      { slot: "cta", text: consigneCta },
    ]);
    // Le script monté, lui, n'a pas bougé d'un octet.
    expect(apres.assembledScript).toBe(vue.assembledScript);

    // ── 5. Vider le champ EFFACE la consigne (blanc = absence) ──────────────
    await admin.mutation(api.scripts.updateBrick, {
      id: hookId,
      instruction: "   ",
    });
    const vide = await mine();
    expect(vide.scriptInstructions).toEqual([
      { slot: "cta", text: consigneCta },
    ]);
    const brique = (
      await admin.query(api.scripts.getCampaign, { id: campaignId })
    )!.bricks.find((b) => b._id === hookId)!;
    // ABSENCE en base, pas chaîne vide : un "" afficherait un encart vide.
    expect(brique.instruction).toBeUndefined();
  });
});
