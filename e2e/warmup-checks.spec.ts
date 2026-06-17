import { test, expect } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { createCreatorSession } from "./helpers/creator-client";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const e2e = createE2eClient(convexUrl);

const DAY = 86_400_000;
const ymd = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/**
 * Chantier B — preuves SERVEUR : le warmup progresse par CHECKS RÉELS (pas le
 * calendaire), rater un jour n'avance pas le compteur, la complétion se fait à N
 * checks, et la notif `countMyWarmupDue` reflète « à faire / à rattraper
 * aujourd'hui » (isolée par créateur).
 */
test.describe("Warmup — progression par checks réels", () => {
  test("compteur par checks + rattrapage + complétion + notif + isolation", async () => {
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] WarmupChecks A ${ts}`,
      email: `e2e-warmup-checks-a-${ts}@repackit.test`,
      password: "creator-wca-12345",
    });
    const due = () =>
      A.client.query(api.comptes.countMyWarmupDue, { projectId: A.projectId });

    // TikTok (durée 3). Fraîchement déclaré (0 check) → DÛ aujourd'hui.
    const id = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2ewc${ts}`,
    });
    expect(await due()).toBe(1);

    // Cocher aujourd'hui → plus dû (coché aujourd'hui, warmup pas fini).
    const first = await A.client.mutation(api.comptes.markWarmupCheck, {
      projectId: A.projectId,
      id,
    });
    expect(first.totalChecks).toBe(1);
    expect(await due()).toBe(0);

    // RATTRAPAGE : simuler « coché il y a 2 j seulement, rien aujourd'hui »
    // (1 check, durée 3 → pas fini, pas coché aujourd'hui) → redevient DÛ.
    await e2e.mutation(api.comptes.e2eSetWarmupChecks, {
      secret: E2E_SECRET,
      id,
      dailyChecks: [ymd(ts - 2 * DAY)],
    });
    expect(await due()).toBe(1);

    // RATER UN JOUR N'AVANCE PAS : 2 checks à des dates NON consécutives (J-3, J-1)
    // → 2/3 (pas 3 : le jour sauté ne compte pas) → check encore autorisé.
    await e2e.mutation(api.comptes.e2eSetWarmupChecks, {
      secret: E2E_SECRET,
      id,
      dailyChecks: [ymd(ts - 3 * DAY), ymd(ts - 1 * DAY)],
    });
    const third = await A.client.mutation(api.comptes.markWarmupCheck, {
      projectId: A.projectId,
      id,
    });
    // 2 checks + aujourd'hui = 3 (le compteur a avancé d'1 sur le check réel).
    expect(third.totalChecks).toBe(3);

    // TERMINÉ (3/3) → plus dû, et markWarmupCheck refuse un check de plus.
    expect(await due()).toBe(0);
    await expect(
      A.client.mutation(api.comptes.markWarmupCheck, {
        projectId: A.projectId,
        id,
      }),
    ).rejects.toThrow(/terminé/i);

    // ISOLATION : un 2e créateur ne compte QUE ses propres warmups.
    const B = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] WarmupChecks B ${ts}`,
      email: `e2e-warmup-checks-b-${ts}@repackit.test`,
      password: "creator-wcb-12345",
    });
    await B.client.mutation(api.comptes.declareCompte, {
      projectId: B.projectId,
      plateforme: "TikTok",
      handle: `@e2ewcb${ts}`,
    });
    // B a 1 compte dû ; le compte (terminé) de A ne gonfle pas le compteur de B.
    expect(
      await B.client.query(api.comptes.countMyWarmupDue, {
        projectId: B.projectId,
      }),
    ).toBe(1);
    // Et A reste à 0 (son seul compte est terminé) — pas pollué par B.
    expect(await due()).toBe(0);
  });
});
