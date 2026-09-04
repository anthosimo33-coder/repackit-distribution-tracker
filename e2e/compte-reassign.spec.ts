import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * RÉASSIGNATION d'un compte (updateCompte.creatorId) — serveur, sans UI fragile.
 *
 * Invariant central : réassigner est PROSPECTIF. L'éligibilité future bascule
 * (« Mes comptes », cibles d'assignment) mais l'HISTORIQUE ne bouge pas — la
 * publication passée reste rapprochée par HANDLE, l'assignment garde SON
 * creatorId, et la paie déjà accumulée de l'ancienne propriétaire est identique
 * au centime après la bascule.
 *
 * Couvre aussi les gardes serveur : « géré ⇒ créatrice » évaluée sur l'ÉTAT
 * CIBLE (détacher un compte géré est refusé), créatrice hors projet refusée, et
 * isolation (un créateur ne peut pas réassigner).
 */
test.describe("Comptes — réassignation de créatrice", () => {
  test("bascule d'éligibilité, historique + paie figés, gardes serveur", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const A = await createCreatorSession(url, {
      name: `[E2E_TEST] ReassignA ${ts}`,
      email: `e2e-creator-reassignA-${ts}@repackit.test`,
      password: "creator-reassign-12345",
    });
    const B = await createCreatorSession(url, {
      name: `[E2E_TEST] ReassignB ${ts}`,
      email: `e2e-creator-reassignB-${ts}@repackit.test`,
      password: "creator-reassign-12345",
    });
    const projectId = A.projectId;
    expect(B.projectId).toBe(projectId); // même projet e2e

    // ── Compte de A, avec HISTORIQUE (1 post publié) + 1 mission EN COURS. ────
    const handle = `@e2ereassign${ts}`;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: A.creatorId,
      platform: "TikTok",
      handle,
    });
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] ReassignFmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 12 },
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: A.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 5 * DAY,
    });
    const firstId = (await admin.query(api.assignments.listAssignments, {}))
      .filter((a) => a.formatId === formatId && a.creatorId === A.creatorId)
      .map((a) => a._id)[0];
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: firstId,
      status: "to_publish",
    });
    const { publicationIds } = await A.client.mutation(
      api.assignments.confirmPublication,
      {
        projectId,
        id: firstId,
        urls: [
          {
            platform: "TikTok",
            url: `https://www.tiktok.com/@e2ereassign${ts}/video/7300000000000${ts % 1000}`,
          },
        ],
      },
    );
    expect(publicationIds.length).toBe(1);
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: publicationIds[0],
      capturedAt: Date.now(),
      vues: 42_000,
      likes: 900,
    });
    // Mission ENCORE EN COURS sur le même compte (todo).
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: A.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 9 * DAY,
    });

    // 1. Récap AVANT : le compte est utilisé, 1 publication, 1 mission en cours.
    const usageBefore = await admin.query(api.comptes.getCompteUsage, {
      id: target.accountId,
    });
    expect(usageBefore.inUse).toBe(true);
    expect(usageBefore.publications).toBe(1);
    expect(usageBefore.openAssignments).toBe(1);
    expect(usageBefore.views).toBe(42_000);

    // Paie accumulée de A AVANT la bascule (référence de non-régression).
    const payBefore = await A.client.query(api.payments.getMyPayments, {
      projectId,
    });
    const totalBefore = payBefore.reduce((s, p) => s + p.totalDue, 0);
    expect(totalBefore).toBeGreaterThan(0);

    // Éligibilité AVANT : le compte est à A, pas à B.
    expect(
      (await A.client.query(api.comptes.listMyComptes, { projectId })).some(
        (c) => c._id === target.accountId,
      ),
    ).toBe(true);
    expect(
      (await B.client.query(api.comptes.listMyComptes, { projectId })).some(
        (c) => c._id === target.accountId,
      ),
    ).toBe(false);

    // 2. RÉASSIGNATION A → B.
    await admin.mutation(api.comptes.updateCompte, {
      id: target.accountId,
      creatorId: B.creatorId,
    });

    // 3. L'éligibilité a basculé (portail + sélecteurs de cibles).
    expect(
      (await A.client.query(api.comptes.listMyComptes, { projectId })).some(
        (c) => c._id === target.accountId,
      ),
    ).toBe(false);
    expect(
      (await B.client.query(api.comptes.listMyComptes, { projectId })).some(
        (c) => c._id === target.accountId,
      ),
    ).toBe(true);
    const availA = await admin.query(api.comptes.listCreatorAvailableComptes, {
      creatorId: A.creatorId,
    });
    expect(availA.some((c) => c._id === target.accountId)).toBe(false);
    const availB = await admin.query(api.comptes.listCreatorAvailableComptes, {
      creatorId: B.creatorId,
    });
    expect(availB.find((c) => c._id === target.accountId)?.available).toBe(true);
    const row = (await admin.query(api.comptes.listComptes, {})).find(
      (c) => c._id === target.accountId,
    )!;
    expect(row.creatorId).toBe(B.creatorId);
    expect(row.creator?.name).toContain("ReassignB");

    // 4. HISTORIQUE FIGÉ — la publication passée reste attribuée à A.
    const published = await admin.query(api.assignments.listPublished, {});
    const kept = published.find((p) => p._id === firstId)!;
    expect(kept.creatorName).toContain("ReassignA");
    expect(kept.targets[0].accountHandle).toBe(handle);
    const pubs = (await admin.query(api.publications.listPublications, {})).filter(
      (p) => p.compte === handle,
    );
    expect(pubs.length).toBe(1);
    // L'assignment EN COURS reste à A lui aussi (aucune réécriture rétroactive).
    const stillA = (await admin.query(api.assignments.listAssignments, {}))
      .filter((a) => a.formatId === formatId)
      .every((a) => a.creatorId === A.creatorId);
    expect(stillA).toBe(true);
    // La compta de A est identique au centime ; B n'a rien gagné au passage.
    const payAfter = await A.client.query(api.payments.getMyPayments, {
      projectId,
    });
    expect(payAfter.reduce((s, p) => s + p.totalDue, 0)).toBe(totalBefore);
    const payB = await B.client.query(api.payments.getMyPayments, {
      projectId,
    });
    expect(payB.reduce((s, p) => s + p.totalDue, 0)).toBe(0);
    // Le récap de références n'a pas bougé (le compte porte le même historique).
    const usageAfter = await admin.query(api.comptes.getCompteUsage, {
      id: target.accountId,
    });
    expect(usageAfter.publications).toBe(1);
    expect(usageAfter.openAssignments).toBe(1);

    // 5. GARDES SERVEUR.
    // 5a. Compte GÉRÉ : détacher la créatrice sans lever le mode → REJET.
    await admin.mutation(api.comptes.updateCompte, {
      id: target.accountId,
      managedByAdmin: true,
    });
    await expect(
      admin.mutation(api.comptes.updateCompte, {
        id: target.accountId,
        creatorId: null,
      }),
    ).rejects.toThrow(/rattaché à une créatrice/i);
    // Lever le mode DANS le même appel est en revanche accepté → compte interne.
    await admin.mutation(api.comptes.updateCompte, {
      id: target.accountId,
      creatorId: null,
      managedByAdmin: false,
    });
    const internal = (await admin.query(api.comptes.listComptes, {})).find(
      (c) => c._id === target.accountId,
    )!;
    expect(internal.creatorId).toBeUndefined();
    expect(
      (await B.client.query(api.comptes.listMyComptes, { projectId })).some(
        (c) => c._id === target.accountId,
      ),
    ).toBe(false);
    // 5b. Repasser en « géré » sans créatrice → REJET (invariant symétrique).
    await expect(
      admin.mutation(api.comptes.updateCompte, {
        id: target.accountId,
        managedByAdmin: true,
      }),
    ).rejects.toThrow(/rattaché à une créatrice/i);

    // 5c. CROSS-TENANT : rattacher le compte à une créatrice d'un AUTRE projet
    //     → REJET (sinon fuite d'un compte vers un autre tenant).
    const { projectId: otherProjectId } = await admin.mutation(
      api.projects.e2eEnsureProjectBySlug,
      {
        secret: E2E_SECRET,
        slug: "e2e-reassign-other",
        name: "Reassign Other",
      },
    );
    const { creatorId: foreignCreatorId } = await admin.mutation(
      api.creators.inviteCreator,
      {
        projectId: otherProjectId,
        name: `[E2E_TEST] ReassignForeign ${ts}`,
        email: `e2e-creator-reassign-foreign-${ts}@repackit.test`,
      },
    );
    await expect(
      admin.mutation(api.comptes.updateCompte, {
        id: target.accountId,
        creatorId: foreignCreatorId,
      }),
    ).rejects.toThrow(/introuvable dans le projet/i);

    // 5d. ISOLATION : un créateur ne peut pas réassigner un compte.
    await expect(
      B.client.mutation(api.comptes.updateCompte, {
        projectId,
        id: target.accountId,
        creatorId: B.creatorId,
      }),
    ).rejects.toThrow();
  });
});
