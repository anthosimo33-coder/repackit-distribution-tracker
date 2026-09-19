import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const DAY = 86_400_000;

/**
 * VALIDATION DES COMPTES — le régime de publication devient un RÉGLAGE du projet.
 *
 * LE DÉFAUT QU'ELLE VERROUILLE. Le régime strict (« un compte ne publie qu'une
 * fois validé ») se choisissait par `slug === "snytch"`. Le projet de test
 * porte `e2e-test` : sous l'ancien code, passer ce projet en strict ne change
 * RIEN et les refus attendus ci-dessous ne viennent jamais (rouge).
 *
 * L'invariant tient à ce que l'attribution ET la publication lisent la même
 * règle : le test exerce les deux, sur la MÊME mission, avant et après bascule.
 */

/** 30 jours cochés, tous dans le passé (jamais « aujourd'hui »), format du champ. */
function pastChecks(n: number): string[] {
  const out: string[] = [];
  const base = Date.now() - 2 * DAY;
  for (let i = n; i >= 1; i--) {
    out.push(new Date(base - i * DAY).toISOString().slice(0, 10));
  }
  return out;
}

/** Un compte de créatrice au warmup TERMINÉ, jamais validé — le cas qui diverge. */
async function compteChaufféNonValidé(creatorId: Id<"creators">, handle: string) {
  const t = await availableTarget({
    e2eClient: admin,
    creatorId,
    platform: "TikTok",
    handle,
  });
  // Chemin admin réel : remettre en chauffe efface la validation.
  await admin.mutation(api.comptes.restartWarmup, { id: t.accountId });
  await admin.mutation(api.comptes.e2eSetWarmupChecks, {
    secret: E2E_SECRET,
    id: t.accountId,
    dailyChecks: pastChecks(30),
  });
  return t;
}

test.describe("Validation des comptes — réglage du projet", () => {
  test.afterAll(async () => {
    // Projet e2e PARTAGÉ : on le rend au régime souple, celui qu'il avait.
    await admin.mutation(api.projects.setAccountValidation, { mode: "lenient" });
  });

  test("strict bloque l'attribution ET la publication ; souple les laisse passer", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    await admin.mutation(api.projects.setAccountValidation, { mode: "lenient" });

    const fid = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Validation ${ts}`,
      type: "short",
      brief: "Brief",
      rateModel: { basePerPost: 50 },
    });
    const creator = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Camille Validation-Régime ${ts}`,
      email: `e2e-validation-regime-${ts}@repackit.test`,
      password: "validation-12345",
    });

    const avant = await admin.query(api.projects.getAccountValidationSettings, {});
    const handle = `@camille.regime_${ts}`;
    const cible = await compteChaufféNonValidé(creator.creatorId, handle);

    // ── SOUPLE : warmup terminé suffit.
    const dispoSouple = await admin.query(api.comptes.listCreatorAvailableComptes, {
      creatorId: creator.creatorId,
    });
    expect(dispoSouple.find((c) => c._id === cible.accountId)?.available).toBe(true);
    const r = await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: creator.creatorId,
      targets: [cible],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    expect(r.created).toBe(1);
    const mission = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a.formatId === fid,
    )!;

    // L'écran annonce l'impact AVANT la bascule : +1 compte, +1 mission.
    const impact = await admin.query(api.projects.getAccountValidationSettings, {});
    expect(impact.mode).toBe("lenient");
    expect(impact.affected.accounts).toBe(avant.affected.accounts + 1);
    expect(impact.affected.pendingAssignments).toBe(
      avant.affected.pendingAssignments + 1,
    );

    // ── STRICT : le même compte n'est plus ni ciblable ni publiable.
    await admin.mutation(api.projects.setAccountValidation, { mode: "strict" });
    const dispoStrict = await admin.query(api.comptes.listCreatorAvailableComptes, {
      creatorId: creator.creatorId,
    });
    expect(dispoStrict.find((c) => c._id === cible.accountId)?.available).toBe(false);
    await expect(
      admin.mutation(api.assignments.assignFormat, {
        formatId: fid,
        creatorId: creator.creatorId,
        targets: [cible],
        postsPerCreator: 1,
        dueDate: ts + 8 * DAY,
      }),
    ).rejects.toThrow(/n'est pas disponible/);
    const url = `https://www.tiktok.com/${handle}/video/7412345678901234567`;
    await expect(
      admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id: mission._id,
        urls: [{ platform: "TikTok", url }],
      }),
    ).rejects.toThrow(/n'est pas validé pour publier/);

    // ── Présence : une fois VALIDÉ, la même mission publie (le strict ne bloque
    // pas tout, il exige la validation).
    await admin.mutation(api.comptes.updateCompte, {
      id: cible.accountId,
      status: "actif",
    });
    const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: mission._id,
      urls: [{ platform: "TikTok", url }],
    });
    expect(pub.alreadyPublished).toBe(false);
  });

  test("l'interrupteur annonce l'impact, s'annule, puis bascule", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    await admin.mutation(api.projects.setAccountValidation, { mode: "lenient" });
    const creator = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Inès Interrupteur ${ts}`,
      email: `e2e-validation-switch-${ts}@repackit.test`,
      password: "validation-12345",
    });
    await compteChaufféNonValidé(creator.creatorId, `@ines.switch_${ts}`);

    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: /durées de warmup/i }).click();
    const interrupteur = page.getByRole("switch", {
      name: "Validation obligatoire avant publication",
    });
    await expect(interrupteur).toBeVisible({ timeout: 20_000 });
    await expect(interrupteur).not.toBeChecked();

    // ANNULER : rien n'est écrit.
    await interrupteur.click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation.getByText("Exiger la validation des comptes ?")).toBeVisible();
    await expect(
      confirmation.getByText(/ne pourr(a|ont) plus recevoir de mission ni publier/),
    ).toBeVisible();
    await confirmation.getByRole("button", { name: "Annuler" }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(interrupteur).not.toBeChecked();
    expect(
      (await admin.query(api.projects.getAccountValidationSettings, {})).mode,
    ).toBe("lenient");

    // CONFIRMER : le régime change, et l'écran le montre.
    await interrupteur.click();
    await confirmation.getByRole("button", { name: "Confirmer" }).click();
    await expect(page.getByText("Règle enregistrée")).toBeVisible({ timeout: 10_000 });
    await expect(interrupteur).toBeChecked();
    expect(
      (await admin.query(api.projects.getAccountValidationSettings, {})).mode,
    ).toBe("strict");

    // Et dans l'autre sens, avec son propre message.
    await interrupteur.click();
    await expect(
      confirmation.getByText(/pourr(a|ont) recevoir des missions et publier immédiatement/),
    ).toBeVisible();
    await confirmation.getByRole("button", { name: "Confirmer" }).click();
    await expect(interrupteur).not.toBeChecked({ timeout: 10_000 });
  });
});
