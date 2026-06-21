import { test, expect, adminPath } from "./fixtures/auth-fixture";
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
 * Admin scripts : (A) voir le SCRIPT MONTÉ figé d'un assignment en modale, et
 * (B) ajouter une vidéo modèle de DEUX façons — URL libre OU inspiration
 * existante (scopée projet) — avec dédoublonnage par URL.
 */
test.describe("Voir le script monté + vidéo modèle depuis inspiration", () => {
  test("script figé en modale ; modèle via inspiration ET via URL ; dédoublonnage", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] ScrInsp ${ts}`,
      email: `e2e-creator-scrinsp-${ts}@repackit.test`,
      password: "scrinsp-12345",
    });
    const projectId = creator.projectId;

    // Campagne minimale (1 hook/flux/cta) + pricing + cible + 1 assignation.
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] ScrInsp ${ts}`,
    });
    const addBrick = (
      kind: "hook" | "flux" | "cta",
      label: string,
      content: string,
      tier?: "S",
    ) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content,
        ...(tier ? { tier } : {}),
      });
    await addBrick("hook", "H", "HOOK CONTENU", "S");
    await addBrick("flux", "F", "FLUX CONTENU UNIQUE");
    await addBrick("cta", "C", "CTA CONTENU");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingSI ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2esi${ts}`,
    });
    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r.created).toBe(1);

    const findRow = async () =>
      (await admin.query(api.assignments.listAssignments, {})).find(
        (a) =>
          a.scriptCombo?.campaignId === campaignId &&
          a.creatorId === creator.creatorId,
      )!;
    const row = await findRow();
    const assignmentId = row._id;

    // PART A (données) : assembledScript FIGÉ présent, rendu créateur (sans ##),
    // hook→flux→cta enchaînés. C'est CE texte que la modale affiche (non re-dérivé).
    const script = row.scriptCombo!.assembledScript!;
    expect(script).toContain("HOOK CONTENU");
    expect(script).toContain("FLUX CONTENU UNIQUE");
    expect(script).not.toContain("## ");
    expect(script.indexOf("HOOK CONTENU")).toBeLessThan(
      script.indexOf("FLUX CONTENU UNIQUE"),
    );

    // PART B — inspiration VIDÉO du projet (scopée) piochable comme modèle.
    // Marquée [E2E_TEST] (notes + titre) → ramassée par cleanupTestInspirations
    // (sinon la row persiste sur le deployment de test partagé et casse
    // l'empty-state de inspirations-create.spec).
    const inspTitre = `[E2E_TEST] Insp Modèle ${ts}`;
    await admin.mutation(api.inspirations.createInspiration, {
      url: `https://www.tiktok.com/@insp/video/${ts}`,
      type: "video",
      plateforme: "TikTok",
      titre: inspTitre,
      notes: "[E2E_TEST] inspiration modèle e2e",
    });
    const inspsVideo = await admin.query(api.inspirations.listInspirations, {
      types: ["video"],
    });
    const insp = inspsVideo.find((i) => i.titre === inspTitre)!;
    expect(insp).toBeTruthy(); // scopée projet → visible côté admin

    // Voie INSPIRATION : reprend url + titre de l'inspiration.
    const viaInsp = await admin.mutation(
      api.assignments.addModelVideoToAssignment,
      { id: assignmentId, url: insp.url, title: insp.titre ?? undefined },
    );
    expect(viaInsp.duplicate).toBe(false);
    // Voie URL LIBRE.
    await admin.mutation(api.assignments.addModelVideoToAssignment, {
      id: assignmentId,
      url: `https://www.youtube.com/watch?v=ScrInsp${ts}`,
      title: "URL libre",
    });
    // Dédoublonnage : re-piocher la même inspiration → no-op (duplicate).
    const again = await admin.mutation(
      api.assignments.addModelVideoToAssignment,
      { id: assignmentId, url: insp.url },
    );
    expect(again.duplicate).toBe(true);

    const row2 = await findRow();
    expect(row2.modelVideos ?? []).toHaveLength(2);
    const fromInsp = row2.modelVideos!.find((m) => m.url === insp.url)!;
    expect(fromInsp.title).toBe(inspTitre);

    // Visibilité créateur : les 2 vidéos à reproduire.
    const mine = await creator.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: assignmentId,
    });
    expect(mine!.assignment.modelVideos ?? []).toHaveLength(2);

    // PART A (UI) : la modale « Voir le script » montre le script monté.
    await page.goto(adminPath("/assignments"));
    const rowLoc = page.locator("tr", {
      hasText: `[E2E_TEST] ScrInsp ${ts}`,
    });
    await rowLoc
      .getByRole("button", { name: /voir le script/i })
      .first()
      .click();
    await expect(page.getByText("FLUX CONTENU UNIQUE")).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText("HOOK CONTENU")).toBeVisible();
  });
});
