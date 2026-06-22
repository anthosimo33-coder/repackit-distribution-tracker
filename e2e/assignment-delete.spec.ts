import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * Suppression manuelle d'un assignment (hard-delete admin). Prouve SERVEUR :
 *  - le hard-delete LIBÈRE le comboKey → le combo redevient assignable (unicité) ;
 *  - garde-fou statut : published/paid non supprimables ;
 *  - admin only (le créateur ne peut pas supprimer) ;
 *  - idempotent (id déjà supprimé → no-op, pas de crash).
 * Campagne minimale : 2 hooks × 1 flux × 1 cta = 2 combos.
 */
async function makeCampaign(ts: number) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Del ${ts}`,
  });
  const add = (kind: "hook" | "flux" | "cta", label: string) =>
    admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind,
      label,
      content: `${label} contenu`,
      ...(kind === "hook" ? { tier: "S" as const } : {}),
    });
  await add("hook", "H1");
  await add("hook", "H2");
  await add("flux", "F1");
  await add("cta", "C1");
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] PricingDel ${ts}`,
    montantFixe: 100,
    nbVideosCible: 10,
    tauxCPM: 2,
  });
  return { campaignId, pricingId };
}

const rowsFor = (campaignId: string, creatorId: string) =>
  admin
    .query(api.assignments.listAssignments, {})
    .then((all) =>
      all.filter(
        (a) =>
          a.scriptCombo?.campaignId === campaignId && a.creatorId === creatorId,
      ),
    );

test.describe("Suppression d'assignment — hard-delete admin", () => {
  test("libère le combo (réassignable), idempotent", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const c = await createCreatorSession(url, {
      name: `[E2E_TEST] DelA ${ts}`,
      email: `e2e-del-a-${ts}@repackit.test`,
      password: "del-a-12345",
    });
    const { campaignId, pricingId } = await makeCampaign(ts);
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: c.creatorId,
      platform: "TikTok",
      handle: `@deltt${ts}`,
    });

    const assign = (videos: number) =>
      admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId: c.creatorId,
        targets: [target],
        videosPerCreator: videos,
        dueDate: ts + 7 * DAY,
        pricingId,
      });
    const avail = () =>
      admin.query(api.scripts.availableCombosForAssignment, {
        campaignId,
        creatorId: c.creatorId,
        platforms: ["TikTok"],
      });

    // 2 vidéos → les 2 combos pris sur TikTok ; plus aucun dispo.
    expect((await assign(2)).created).toBe(2);
    expect(await avail()).toEqual({ total: 2, available: 0 });

    // Hard-delete d'UN assignment → son combo est libéré.
    const before = await rowsFor(campaignId, c.creatorId);
    expect(before.length).toBe(2);
    const victim = before[0];
    const freedKey = victim.comboKey;
    const del = await admin.mutation(api.assignments.deleteAssignment, {
      id: victim._id,
    });
    expect(del).toMatchObject({ ok: true, alreadyGone: false });

    // La ligne a disparu ; 1 combo redevient disponible.
    const after = await rowsFor(campaignId, c.creatorId);
    expect(after.length).toBe(1);
    expect(after.some((a) => a._id === victim._id)).toBe(false);
    expect(await avail()).toEqual({ total: 2, available: 1 });

    // Réassignable : 1 vidéo → created 1, et c'est bien le combo libéré (le seul
    // dispo) → AUCUN conflit d'unicité.
    expect((await assign(1)).created).toBe(1);
    const reassigned = await rowsFor(campaignId, c.creatorId);
    expect(reassigned.length).toBe(2);
    expect(reassigned.some((a) => a.comboKey === freedKey)).toBe(true);

    // Idempotence : re-supprimer l'id déjà parti → no-op, pas d'erreur.
    const again = await admin.mutation(api.assignments.deleteAssignment, {
      id: victim._id,
    });
    expect(again).toMatchObject({ ok: true, alreadyGone: true });
  });

  test("garde-fou : un assignment publié ou payé n'est pas supprimable", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const c = await createCreatorSession(url, {
      name: `[E2E_TEST] DelGuard ${ts}`,
      email: `e2e-del-guard-${ts}@repackit.test`,
      password: "del-guard-123",
    });
    const { campaignId, pricingId } = await makeCampaign(ts);
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: c.creatorId,
      platform: "TikTok",
      handle: `@delguard${ts}`,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: c.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    const [row] = await rowsFor(campaignId, c.creatorId);

    for (const status of ["published", "paid"] as const) {
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: row._id,
        status,
      });
      await expect(
        admin.mutation(api.assignments.deleteAssignment, { id: row._id }),
      ).rejects.toThrow(/publié|payé/i);
    }

    // Repassé en pré-publication → supprimable de nouveau.
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: row._id,
      status: "todo",
    });
    expect(
      await admin.mutation(api.assignments.deleteAssignment, { id: row._id }),
    ).toMatchObject({ ok: true, alreadyGone: false });
  });

  test("admin only : le créateur ne peut pas supprimer un assignment", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const c = await createCreatorSession(url, {
      name: `[E2E_TEST] DelRole ${ts}`,
      email: `e2e-del-role-${ts}@repackit.test`,
      password: "del-role-123",
    });
    const { campaignId, pricingId } = await makeCampaign(ts);
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: c.creatorId,
      platform: "TikTok",
      handle: `@delrole${ts}`,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: c.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    const [row] = await rowsFor(campaignId, c.creatorId);

    // deleteAssignment est une adminMutation → le rôle créateur est refusé.
    await expect(
      c.client.mutation(api.assignments.deleteAssignment, {
        projectId: c.projectId,
        id: row._id as Id<"assignments">,
      }),
    ).rejects.toThrow(/administrateur|refusé/i);

    // L'assignment est toujours là (non supprimé par le créateur).
    expect((await rowsFor(campaignId, c.creatorId)).length).toBe(1);
  });
});
