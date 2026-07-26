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

/** Minuit local + N jours — même convention de stockage que le modal (jour). */
function dayMs(offsetDays: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() + offsetDays * DAY;
}

/**
 * Brique A — date de PUBLICATION planifiée (postDate), DISTINCTE de l'échéance de
 * production (dueDate). Vérifie : planification à la création (postDates
 * positionnels, une par vidéo), édition après coup (setAssignmentPostDate : change
 * + efface), garde d'autorisation (créateur ≠ admin), et non-régression (sans
 * postDates, aucune date de post). Server-level (la mutation UNITAIRE est celle
 * que le modal appelle en single ET en masse).
 */
test.describe("Scripts — dates de publication planifiées (brique A)", () => {
  test("postDates à la création + édition après coup + auth + non-régression", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] PostDateC ${ts}`,
      email: `e2e-creator-postdate-${ts}@repackit.test`,
      password: "postdate-12345",
    });
    const projectId = creator.projectId;

    // Campagne à 2 combos (2 hooks × 1 flux × 1 cta) + pricing + cible.
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] PostDate ${ts}`,
    });
    const addBrick = (kind: "hook" | "flux" | "cta", label: string) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} contenu`,
      });
    await addBrick("hook", "H1");
    await addBrick("hook", "H2");
    await addBrick("flux", "F");
    await addBrick("cta", "C");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingPD ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2epd${ts}`,
    });

    const d1 = dayMs(3);
    const d2 = dayMs(5);

    // ── PLANIFICATION à la création : 2 vidéos, 2 dates distinctes ────────────
    const res = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 2,
      dueDate: ts + 7 * DAY,
      pricingId,
      postDates: [d1, d2],
    });
    expect(res.created).toBe(2);

    const rowsOf = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) =>
          a.scriptCombo?.campaignId === campaignId &&
          a.creatorId === creator.creatorId,
      );
    const rows = await rowsOf();
    expect(rows).toHaveLength(2);
    // Chaque vidéo porte UNE des deux dates planifiées (positionnel {d1, d2}) ;
    // dueDate (production) reste distincte et inchangée sur les deux.
    const postDates = rows
      .map((r) => r.postDate)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(postDates).toEqual([d1, d2]);
    expect(rows.every((r) => r.dueDate === ts + 7 * DAY)).toBe(true);

    // ── ÉDITION APRÈS COUP : setAssignmentPostDate change puis efface ─────────
    const row = rows[0];
    const d3 = dayMs(10);
    await admin.mutation(api.assignments.setAssignmentPostDate, {
      id: row._id,
      postDate: d3,
    });
    expect((await rowsOf()).find((r) => r._id === row._id)!.postDate).toBe(d3);

    // Le champ remonte côté créateur (getMyAssignment) — réutilisé en brique D.
    const mine = await creator.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: row._id,
    });
    expect(mine!.assignment.postDate).toBe(d3);

    // Effacement → postDate absent.
    await admin.mutation(api.assignments.setAssignmentPostDate, { id: row._id });
    expect(
      (await rowsOf()).find((r) => r._id === row._id)!.postDate,
    ).toBeUndefined();

    // ── AUTORISATION : un créateur ne peut PAS éditer la date de post ─────────
    await expect(
      creator.client.mutation(api.assignments.setAssignmentPostDate, {
        projectId,
        id: row._id,
        postDate: d1,
      }),
    ).rejects.toThrow();

    // ── NON-RÉGRESSION : sans postDates, aucune date de post ─────────────────
    const creator2 = await createCreatorSession(url, {
      name: `[E2E_TEST] PostDateC2 ${ts}`,
      email: `e2e-creator-postdate2-${ts}@repackit.test`,
      password: "postdate2-12345",
    });
    const target2 = await availableTarget({
      e2eClient: admin,
      creatorId: creator2.creatorId,
      platform: "TikTok",
      handle: `@e2epd2${ts}`,
    });
    const resB = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator2.creatorId,
      targets: [target2],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(resB.created).toBe(1);
    const rowB = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) =>
        a.scriptCombo?.campaignId === campaignId &&
        a.creatorId === creator2.creatorId,
    )!;
    expect(rowB.postDate).toBeUndefined();
  });
});
