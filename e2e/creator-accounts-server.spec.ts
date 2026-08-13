import { test, expect } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { createCreatorSession } from "./helpers/creator-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

/**
 * P5 — preuves SERVEUR du portail créateur : défauts de warmup par plateforme,
 * refus du double-check quotidien, isolation inter-créateurs (filtrage par
 * creatorId, pas juste l'UI).
 */
test.describe("Comptes créateurs — serveur", () => {
  test("défauts de warmup : 3 sur tiktok, 14 sur instagram", async () => {
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Defaults ${ts}`,
      email: `e2e-creator-def-${ts}@repackit.test`,
      password: "creator-def-12345",
    });

    const tkId = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2ewarmuptk${ts}`,
    });
    const igId = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "Instagram",
      handle: `@e2ewarmupig${ts}`,
    });

    const mine = await A.client.query(api.comptes.listMyComptes, {
      projectId: A.projectId,
    });
    const tk = mine.find((c) => c._id === tkId);
    const ig = mine.find((c) => c._id === igId);
    expect(tk?.status).toBe("warmup");
    expect(tk?.warmupProtocol?.targetDays).toBe(7);
    expect(ig?.warmupProtocol?.targetDays).toBe(14);
  });

  test("NON-RÉGRESSION : le document produit par declareCompte, champ par champ", async () => {
    // `declareCompte`, `declareManagedCompte` et `declareClipperCompte` partagent
    // désormais un cœur (declareCompteCore). Ce test fixe ce que la CRÉATRICE
    // PARTENAIRE obtient : si l'extraction dérive, c'est ici que ça casse, et pas
    // six mois plus tard sur un compte qui ne s'active pas.
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Doc ${ts}`,
      email: `e2e-creator-doc-${ts}@repackit.test`,
      password: "creator-doc-12345",
    });
    const handle = `@e2edeclare${ts}`;
    const id = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle,
      url: "  https://www.tiktok.com/@e2edeclare  ",
    });
    const compte = (
      await A.client.query(api.comptes.listMyComptes, {
        projectId: A.projectId,
      })
    ).find((c) => c._id === id);

    expect(compte).toBeTruthy();
    expect(compte!.handle).toBe(handle);
    expect(compte!.plateforme).toBe("TikTok");
    expect(compte!.status).toBe("warmup");
    expect(compte!.actif).toBe(false);
    expect(compte!.notes).toBe("");
    expect(compte!.creatorId).toBe(A.creatorId);
    // L'URL est trimée à l'écriture.
    expect(compte!.url).toBe("https://www.tiktok.com/@e2edeclare");
    // Protocole initialisé au défaut de la plateforme, aucun check posé.
    expect(compte!.warmupProtocol).toMatchObject({
      keywords: [],
      instructions: "",
      targetDays: 7,
      dailyChecks: [],
    });
    // Le compte n'est PAS géré par l'équipe : la clé doit être ABSENTE, pas posée
    // à undefined — c'est ce que le spread conditionnel du cœur garantit, et ce
    // que `warmupDueCount` et l'écran admin lisent.
    expect(compte!.managedByAdmin).toBeUndefined();
    // Aucune ancre de phase : c'est la validation admin qui la posera (PR 3).
    expect(compte!.validatedAt).toBeUndefined();
  });

  test("double-check quotidien refusé (même appelé directement)", async () => {
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Check ${ts}`,
      email: `e2e-creator-chk-${ts}@repackit.test`,
      password: "creator-chk-12345",
    });
    const id = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2ewarmupchk${ts}`,
    });

    const first = await A.client.mutation(api.comptes.markWarmupCheck, {
      projectId: A.projectId,
      id,
    });
    expect(first.totalChecks).toBe(1);

    await expect(
      A.client.mutation(api.comptes.markWarmupCheck, {
        projectId: A.projectId,
        id,
      }),
    ).rejects.toThrow(/déjà fait/i);
  });

  test("isolation : le créateur B ne voit pas les comptes de A", async () => {
    const ts = Date.now();
    const A = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Iso A ${ts}`,
      email: `e2e-creator-isoa-${ts}@repackit.test`,
      password: "creator-isoa-12345",
    });
    const B = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Iso B ${ts}`,
      email: `e2e-creator-isob-${ts}@repackit.test`,
      password: "creator-isob-12345",
    });

    const aId = await A.client.mutation(api.comptes.declareCompte, {
      projectId: A.projectId,
      plateforme: "TikTok",
      handle: `@e2ewarmupiso${ts}`,
    });

    // B (même projet) ne voit PAS le compte de A.
    const bMine = await B.client.query(api.comptes.listMyComptes, {
      projectId: B.projectId,
    });
    expect(bMine.some((c) => c._id === aId)).toBe(false);

    // B ne peut pas non plus cocher le warmup du compte de A.
    await expect(
      B.client.mutation(api.comptes.markWarmupCheck, {
        projectId: B.projectId,
        id: aId,
      }),
    ).rejects.toThrow(/introuvable/i);
  });
});
