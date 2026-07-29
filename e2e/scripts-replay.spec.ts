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

/** Campagne 2 hooks × 1 flux × 2 cta = 4 combos. Renvoie campaignId + brickIds. */
async function makeCampaign(ts: number) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Replay ${ts}`,
  });
  const add = (
    kind: "hook" | "flux" | "cta",
    label: string,
    content: string,
    tier?: "S" | "A",
  ) =>
    admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind,
      label,
      content,
      ...(tier ? { tier } : {}),
    });
  await add("hook", "H-S", "Hook S contenu", "S");
  await add("hook", "H-A", "Hook A contenu", "A");
  await add("flux", "F1", "Flux 1 contenu");
  await add("cta", "T1", "Cta 1 contenu");
  await add("cta", "T2", "Cta 2 contenu");
  const camp = await admin.query(api.scripts.getCampaign, { id: campaignId });
  const byLabel = (l: string) => camp!.bricks.find((b) => b.label === l)!._id;
  return {
    campaignId,
    hookS: byLabel("H-S"),
    hookA: byLabel("H-A"),
    flux1: byLabel("F1"),
    cta1: byLabel("T1"),
  };
}

test.describe("Rejeu — combinaison imposée", () => {
  test("impose un combo, reste dans le pool auto, réutilisable, variante liée, créatrice inchangée", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] ReplayCreator ${ts}`,
      email: `e2e-replay-${ts}@repackit.test`,
      password: "replay-12345",
    });
    const projectId = creator.projectId;
    const c = await makeCampaign(ts);

    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Pricing ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2erep${ts}`,
    });

    // Disponibilité AVANT : 4 combos uniques (2 hooks × 1 flux × 2 cta).
    const avail0 = await admin.query(api.scripts.availableCombosForAssignment, {
      campaignId: c.campaignId,
      creatorId: creator.creatorId,
      platforms: ["TikTok"],
    });
    expect(avail0.available).toBe(4);

    // IMPOSE un combo précis (hookS + flux1 + cta1), 1 vidéo.
    const imposed = {
      hookBrickId: c.hookS,
      fluxBrickId: c.flux1,
      ctaBrickId: c.cta1,
    };
    const r1 = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId: c.campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      imposedCombo: imposed,
    });
    expect(r1.created).toBe(1);

    const rowsOf = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (x) =>
          x.scriptCombo?.campaignId === c.campaignId &&
          x.creatorId === creator.creatorId,
      );
    let rows = await rowsOf();
    expect(rows.length).toBe(1);
    const source = rows[0];
    // Combo EXACT imposé + flag + comboKey attendu (attribuable comme un auto).
    expect(source.scriptCombo?.hookBrickId).toBe(c.hookS);
    expect(source.scriptCombo?.fluxBrickId).toBe(c.flux1);
    expect(source.scriptCombo?.ctaBrickId).toBe(c.cta1);
    expect(source.comboImposed).toBe(true);
    expect(source.comboKey).toBe(`${c.hookS}:${c.flux1}:${c.cta1}`);

    // RESTE dans le pool auto : la dispo n'a PAS baissé (l'imposé ne consomme rien).
    const avail1 = await admin.query(api.scripts.availableCombosForAssignment, {
      campaignId: c.campaignId,
      creatorId: creator.creatorId,
      platforms: ["TikTok"],
    });
    expect(avail1.available).toBe(4);

    // RÉUTILISATION libre : ré-imposer le MÊME combo au MÊME créateur → aucun blocage.
    const r2 = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId: c.campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      imposedCombo: imposed,
    });
    expect(r2.created).toBe(1);
    expect((await rowsOf()).length).toBe(2);

    // getReplaySource (depuis l'assignation source) : 3 briques + lignage + figé.
    const replaySrc = await admin.query(api.scripts.getReplaySource, {
      assignmentId: source._id,
    });
    expect(replaySrc?.bricks.hookBrickId).toBe(c.hookS);
    expect(replaySrc?.bricks.fluxBrickId).toBe(c.flux1);
    expect(replaySrc?.bricks.ctaBrickId).toBe(c.cta1);
    expect(replaySrc?.sourceAssignmentId).toBe(source._id);
    expect(replaySrc?.sourceAssembledScript).toBeTruthy();
    expect(replaySrc?.campaignId).toBe(c.campaignId);

    // VARIANTE (1 brique changée : hookA) + lignage replayedFrom vers la source.
    const variant = {
      hookBrickId: c.hookA,
      fluxBrickId: c.flux1,
      ctaBrickId: c.cta1,
    };
    const r3 = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId: c.campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      imposedCombo: variant,
      replayedFrom: source._id,
    });
    expect(r3.created).toBe(1);
    rows = await rowsOf();
    const variantRow = rows.find(
      (x) => x.comboKey === `${c.hookA}:${c.flux1}:${c.cta1}`,
    );
    expect(variantRow).toBeTruthy();
    expect(variantRow!.comboImposed).toBe(true);
    // La variante (comboKey DIFFÉRENT) reste reliée à son origine.
    expect(variantRow!.replayedFrom).toBe(source._id);

    // CÔTÉ CRÉATRICE inchangé : script monté visible, décomposition ET métadonnées
    // de rejeu (comboImposed/replayedFrom) JAMAIS exposées.
    const mine = await creator.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: source._id,
    });
    expect(mine).toBeTruthy();
    expect(mine!.assembledScript).toBeTruthy();
    const asRecord = mine!.assignment as Record<string, unknown>;
    expect(asRecord.scriptCombo).toBeUndefined();
    expect(asRecord.comboKey).toBeUndefined();
    expect(asRecord.comboImposed).toBeUndefined();
    expect(asRecord.replayedFrom).toBeUndefined();
  });
});
