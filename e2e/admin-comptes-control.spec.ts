import { test, expect } from "@playwright/test";
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
 * Chantier D — contrôle ADMIN complet des comptes (serveur) :
 *   - éditer pseudo / mots-clés (toujours) ;
 *   - changer la plateforme d'un compte VIERGE (warmup recalé) ; REJET si utilisé ;
 *   - supprimer un compte VIERGE ; REJET si utilisé (archivage à la place) ;
 *   - archiver → exclu des cibles d'assignment (isAccountAvailable) ;
 *   - ISOLATION : le créateur ne peut éditer/supprimer/archiver aucun compte.
 */
test.describe("Admin — contrôle des comptes", () => {
  test("éditer / changer plateforme (vierge) / supprimer-si-vierge / archiver / isolation", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const A = await createCreatorSession(url, {
      name: `[E2E_TEST] CtrlA ${ts}`,
      email: `e2e-creator-ctrl-${ts}@repackit.test`,
      password: "creator-ctrl-12345",
    });
    const projectId = A.projectId;

    // ── Compte VIERGE (déclaré par le créateur, Instagram warmup, aucune réf). ─
    const viergeId = await A.client.mutation(api.comptes.declareCompte, {
      projectId,
      plateforme: "Instagram",
      handle: `@e2ed_vierge${ts}`,
    });

    // 1. Éditer pseudo + mots-clés (toujours autorisé).
    await admin.mutation(api.comptes.updateCompte, {
      id: viergeId,
      handle: `@e2ed_renamed${ts}`,
    });
    await admin.mutation(api.comptes.updateWarmupProtocol, {
      id: viergeId,
      keywords: [`e2edkw${ts}`],
    });

    // 2. Changer la plateforme d'un compte VIERGE (Insta → TikTok) → OK + warmup
    //    recalé sur la durée TikTok (3) avec compteur de checks remis à zéro.
    await admin.mutation(api.comptes.updateCompte, {
      id: viergeId,
      plateforme: "TikTok",
    });
    const after = (await admin.query(api.comptes.listComptes, {})).find(
      (c) => c._id === viergeId,
    )!;
    expect(after.plateforme).toBe("TikTok");
    expect(after.warmupProtocol?.targetDays).toBe(3);
    expect(after.warmupProtocol?.dailyChecks.length).toBe(0);
    expect(after.inUse).toBe(false);

    // ── Compte UTILISÉ : cible d'un assignment. ──────────────────────────────
    const used = await availableTarget({
      e2eClient: admin,
      creatorId: A.creatorId,
      platform: "YouTube",
      handle: `@e2ed_used${ts}`,
    });
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] CtrlFmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10 },
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: A.creatorId,
      targets: [used],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    // getCompteUsage le voit utilisé.
    const usage = await admin.query(api.comptes.getCompteUsage, {
      id: used.accountId,
    });
    expect(usage.inUse).toBe(true);
    expect(usage.assignments).toBeGreaterThan(0);

    // 3. Changer la plateforme d'un compte UTILISÉ → REJET.
    await expect(
      admin.mutation(api.comptes.updateCompte, {
        id: used.accountId,
        plateforme: "TikTok",
      }),
    ).rejects.toThrow(/utilisé/i);

    // 4. Supprimer le compte VIERGE → OK ; supprimer le compte UTILISÉ → REJET.
    await admin.mutation(api.comptes.deleteCompte, { id: viergeId });
    expect(
      (await admin.query(api.comptes.listComptes, {})).some(
        (c) => c._id === viergeId,
      ),
    ).toBe(false);
    await expect(
      admin.mutation(api.comptes.deleteCompte, { id: used.accountId }),
    ).rejects.toThrow(/utilisé|archive/i);

    // 5. Archiver le compte utilisé → EXCLU des cibles d'assignment.
    await admin.mutation(api.comptes.archiveCompte, { id: used.accountId });
    const avail = await admin.query(api.comptes.listCreatorAvailableComptes, {
      creatorId: A.creatorId,
    });
    expect(avail.find((a) => a._id === used.accountId)?.available).toBe(false);

    // 6. ISOLATION : le créateur ne peut éditer/supprimer/archiver aucun compte.
    await expect(
      A.client.mutation(api.comptes.archiveCompte, {
        projectId,
        id: used.accountId,
      }),
    ).rejects.toThrow();
    await expect(
      A.client.mutation(api.comptes.deleteCompte, {
        projectId,
        id: used.accountId,
      }),
    ).rejects.toThrow();
    await expect(
      A.client.mutation(api.comptes.updateCompte, {
        projectId,
        id: used.accountId,
        handle: "@hack",
      }),
    ).rejects.toThrow();
  });
});
