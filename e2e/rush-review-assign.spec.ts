import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * REVUE DES RUSHES & ASSIGNATION SCRIPT → RUSH.
 *
 * La spec la plus importante du fichier est l'INVARIANT D'ARGENT : une
 * assignation de clip ne doit JAMAIS porter de `pricingSnapshot`, sous peine de
 * double paiement (clip + CPM). Elle a été vue ROUGE avant d'être crue — en
 * faisant écrire un pricingSnapshot à la mutation, elle échoue ; sans lui elle
 * passe. Une spec qui garde une règle d'argent et qu'on n'a jamais vue échouer
 * ne garde rien.
 *
 * La dernière spec ferme la boucle du vocabulaire : après assignation, le talent
 * lit « Validé » à l'écran — jamais « Retenu », « Assigné », ni rien qui laisse
 * deviner qu'un script existe.
 */

const JOUR = 86_400_000;

/** Fiche + vrai signUp (assignFormat/assignScriptToRush exigent un onboardé). */
async function fiche(
  kind: "talent" | "clipper" | "partner",
  ts: number,
  suffix = "",
): Promise<{ creatorId: Id<"creators">; token: string; password: string; email: string }> {
  const email = `e2e-creator-${kind}-rush${suffix}-${ts}@repackit.test`;
  const password = `rush-${ts}`;
  const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${kind} rush${suffix} ${ts}`,
    email,
    kind,
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  expect(res.tokens?.token).toBeTruthy();
  return { creatorId, token, password, email };
}

/** Ouvre le dépôt sur le projet e2e (slug `e2e-test`, donc fermé par défaut). */
async function enableFileDrop() {
  await admin.mutation(api.projects.setTalentSettings, {
    fileDropEnabled: true,
  });
}

/** Session Convex d'une personne déjà inscrite. */
async function sessionFor(email: string, password: string) {
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signIn" },
  });
  client.setAuth(res.tokens!.token);
  return client;
}

/** Campagne montable sur un rush : hook + flux en « afficher », cta sans mode. */
async function campagneAffichable(ts: number, label = "") {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Rush ${label} ${ts}`,
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId,
    kind: "hook",
    label: `hook ${ts}`,
    content: `Accroche affichée ${ts}`,
    tier: "S",
    mode: "afficher",
  });
  await admin.mutation(api.scripts.createBrick, {
    campaignId,
    kind: "flux",
    label: `flux ${ts}`,
    content: `Corps affiché ${ts}`,
    mode: "afficher",
  });
  // Le cta n'a VOLONTAIREMENT pas de mode : c'est le cas réel (14/14 en prod),
  // et la garde doit l'ignorer.
  await admin.mutation(api.scripts.createBrick, {
    campaignId,
    kind: "cta",
    label: `cta ${ts}`,
    content: `Appel à l'action ${ts}`,
  });
  return campaignId;
}

/** Monte le décor complet : talent apparié, clippeur avec compte, rush déposé. */
async function decor(ts: number, suffix = "") {
  const projectId = await admin.getProjectId();
  await enableFileDrop();
  const talent = await fiche("talent", ts, suffix);
  const clipper = await fiche("clipper", ts + 1, suffix);

  await admin.mutation(api.creators.updateCreator, {
    id: talent.creatorId,
    clipperId: clipper.creatorId,
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: clipper.creatorId,
    platform: "TikTok",
    handle: `@e2erush${suffix}${ts}`,
    validatedAt: ts - 20 * JOUR,
  });

  const talentClient = await sessionFor(talent.email, talent.password);
  const { rushId } = await talentClient.mutation(api.rushes.confirmDeposit, {
    projectId,
    driveFileId: `drive-rush-${suffix}${ts}`,
    fileName: `prise-${suffix}${ts}.mov`,
    mimeType: "video/quicktime",
    sizeBytes: 31_457_280,
  });

  return { projectId, talent, clipper, target, rushId, talentClient };
}

test.describe("Rushes — revue admin et assignation d'un script", () => {
  test("la file de revue rend le rush, son talent et son clippeur apparié", async () => {
    const ts = Date.now();
    const { rushId, clipper } = await decor(ts);

    const rows = await admin.query(api.rushes.listRushesForReview, {});
    const row = rows.find((r) => r.id === rushId)!;
    expect(row).toBeTruthy();
    expect(row.status).toBe("deposited");
    expect(row.clipperId).toBe(clipper.creatorId);
    expect(row.talentName).toContain("[E2E_TEST]");

    const count = await admin.query(api.rushes.countRushesToReview, {});
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("assignation : le rush passe « assigned », le clip revient au CLIPPEUR", async () => {
    const ts = Date.now();
    const { rushId, clipper, target, talentClient, projectId } = await decor(ts);
    const campaignId = await campagneAffichable(ts);

    const { assignmentId } = await admin.mutation(
      api.scripts.assignScriptToRush,
      {
        rushId,
        campaignId,
        targets: [target],
        dueDate: ts + 3 * JOUR,
        instructions: "Coupe le silence à la fin.",
      },
    );

    const assignments = await admin.query(api.assignments.listAssignments, {});
    const a = assignments.find((x) => x._id === assignmentId)!;
    expect(a).toBeTruthy();
    // D1 : le payé et le publieur, c'est le clippeur — jamais le talent.
    expect(a.creatorId).toBe(clipper.creatorId);
    expect(a.scriptCombo?.assembledScript).toContain(`Accroche affichée ${ts}`);
    expect(a.targets).toHaveLength(1);

    // Le rush est retenu et pointe SON assignation.
    const rows = await admin.query(api.rushes.listRushesForReview, {});
    const row = rows.find((r) => r.id === rushId)!;
    expect(row.status).toBe("assigned");
    expect(row.assignmentId).toBe(assignmentId);

    // Côté talent : le statut a bougé, et rien du flux clip n'a fuité.
    const mine = await talentClient.query(api.rushes.listMyRushes, { projectId });
    const vu = mine.find((r) => r._id === rushId)!;
    expect(vu.status).toBe("assigned");
    expect(JSON.stringify(vu)).not.toContain(assignmentId);
  });

  test("INVARIANT D'ARGENT : un clip ne porte JAMAIS de pricingSnapshot", async () => {
    // Le chemin du double paiement : computeLivePricingBreakdown ramasse tout
    // assignment porteur d'un pricingSnapshot et lui applique fixe + CPM, alors
    // que le clippeur est payé un montant fixe par clip.
    const ts = Date.now();
    const { rushId, target } = await decor(ts);
    const campaignId = await campagneAffichable(ts);

    const { assignmentId } = await admin.mutation(
      api.scripts.assignScriptToRush,
      { rushId, campaignId, targets: [target], dueDate: ts + 3 * JOUR },
    );

    const assignments = await admin.query(api.assignments.listAssignments, {});
    const a = assignments.find((x) => x._id === assignmentId)!;
    expect(a.pricingSnapshot).toBeUndefined();
    // Le placeholder neutre est bien là (le schéma l'exige) et vaut zéro.
    expect(a.rateSnapshot?.basePerPost).toBe(0);
  });

  test("garde D7 : un hook à DIRE est refusé, en nommant la brique", async () => {
    const ts = Date.now();
    const { rushId, target } = await decor(ts);

    // Campagne dont le SEUL hook est à dire à l'oral → aucun combo montable.
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Rush parlé ${ts}`,
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "hook",
      label: `hook parlé ${ts}`,
      content: `Hook à dire ${ts}`,
      mode: "dire",
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "flux",
      label: `flux ${ts}`,
      content: `Corps affiché ${ts}`,
      mode: "afficher",
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "cta",
      label: `cta ${ts}`,
      content: `CTA ${ts}`,
    });

    // Le message NOMME la brique et le geste — pas « aucun combo disponible ».
    await expect(
      admin.mutation(api.scripts.assignScriptToRush, {
        rushId,
        campaignId,
        targets: [target],
        dueDate: ts + 3 * JOUR,
      }),
    ).rejects.toThrow(/Hook à dire/);
    await expect(
      admin.mutation(api.scripts.assignScriptToRush, {
        rushId,
        campaignId,
        targets: [target],
        dueDate: ts + 3 * JOUR,
      }),
    ).rejects.toThrow(/Afficher à l'écran/);
  });

  test("garde D7 : un hook SANS MODE est refusé, un cta sans mode ne gêne pas", async () => {
    const ts = Date.now();
    const { rushId, target } = await decor(ts);

    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Rush non étiqueté ${ts}`,
    });
    // Hook SANS mode — le cas des 7 hooks de la prod. Refusé, pas toléré.
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "hook",
      label: `hook nu ${ts}`,
      content: `Hook non étiqueté ${ts}`,
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "flux",
      label: `flux ${ts}`,
      content: `Corps affiché ${ts}`,
      mode: "afficher",
    });
    await admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind: "cta",
      label: `cta ${ts}`,
      content: `CTA ${ts}`,
    });

    await expect(
      admin.mutation(api.scripts.assignScriptToRush, {
        rushId,
        campaignId,
        targets: [target],
        dueDate: ts + 3 * JOUR,
      }),
    ).rejects.toThrow(/mode n'est pas renseigné/i);

    // Le MÊME décor avec un hook à afficher passe — donc c'est bien le mode du
    // hook qui bloquait, et le cta sans mode (présent dans les deux campagnes)
    // n'a jamais gêné. Sans cette moitié, la garde pourrait refuser 100 % des
    // scripts sans qu'on le voie.
    const ok = await campagneAffichable(ts, "bis");
    const res = await admin.mutation(api.scripts.assignScriptToRush, {
      rushId,
      campaignId: ok,
      targets: [target],
      dueDate: ts + 3 * JOUR,
    });
    expect(res.assignmentId).toBeTruthy();
  });

  test("talent non apparié : refus qui NOMME le geste manquant", async () => {
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    await enableFileDrop();
    const talent = await fiche("talent", ts, "seul");
    const clipper = await fiche("clipper", ts + 1, "seul");
    // Volontairement PAS d'appariement.
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: clipper.creatorId,
      platform: "TikTok",
      handle: `@e2erushseul${ts}`,
      validatedAt: ts - 20 * JOUR,
    });
    const talentClient = await sessionFor(talent.email, talent.password);
    const { rushId } = await talentClient.mutation(api.rushes.confirmDeposit, {
      projectId,
      driveFileId: `drive-seul-${ts}`,
      fileName: "seul.mov",
      mimeType: "video/quicktime",
      sizeBytes: 1,
    });
    const campaignId = await campagneAffichable(ts, "seul");

    await expect(
      admin.mutation(api.scripts.assignScriptToRush, {
        rushId,
        campaignId,
        targets: [target],
        dueDate: ts + 3 * JOUR,
      }),
    ).rejects.toThrow(/apparié à aucun clippeur/i);
  });

  test("appariement : refusé sur une fiche qui n'est pas un talent, ou vers un non-clippeur", async () => {
    const ts = Date.now();
    const talent = await fiche("talent", ts, "app");
    const clipper = await fiche("clipper", ts + 1, "app");
    const partner = await fiche("partner", ts + 2, "app");

    // Un partenaire n'a pas de clippeur.
    await expect(
      admin.mutation(api.creators.updateCreator, {
        id: partner.creatorId,
        clipperId: clipper.creatorId,
      }),
    ).rejects.toThrow(/Seul un talent/i);

    // Et on ne rattache pas un talent à quelqu'un qui n'est pas clippeur.
    await expect(
      admin.mutation(api.creators.updateCreator, {
        id: talent.creatorId,
        clipperId: partner.creatorId,
      }),
    ).rejects.toThrow(/n'est pas un clippeur/i);
  });

  test("NON-RÉGRESSION : assignScriptCampaign pose TOUJOURS un pricingSnapshot", async () => {
    // Le flux partenaire n'a pas bougé : c'est justement parce qu'il porte un
    // pricingSnapshot que le clip ne doit pas en porter.
    const ts = Date.now();
    const partner = await fiche("partner", ts, "nonreg");
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: partner.creatorId,
      platform: "TikTok",
      handle: `@e2erushnonreg${ts}`,
    });
    const campaignId = await campagneAffichable(ts, "nonreg");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Barème rush ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 1,
    });

    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: partner.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 3 * JOUR,
      pricingId,
    });
    expect(r.created).toBe(1);

    const assignments = await admin.query(api.assignments.listAssignments, {});
    const a = assignments.find(
      (x) => x.creatorId === partner.creatorId && x.scriptCombo !== undefined,
    )!;
    expect(a.pricingSnapshot).toBeDefined();
  });

  test("après assignation, le talent lit « Validé » — et aucun mot du flux clip", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();
    await admin.mutation(api.projects.setTalentSettings, {
      fileDropEnabled: true,
    });

    // Le token étant à usage unique, c'est le NAVIGATEUR qui le consomme.
    const email = `e2e-creator-talent-ui-rush-${ts}@repackit.test`;
    const password = `rush-ui-${ts}`;
    const { creatorId: talentId, token } = await admin.mutation(
      api.creators.inviteCreator,
      { name: `[E2E_TEST] talent ui rush ${ts}`, email, kind: "talent" },
    );
    const clipper = await fiche("clipper", ts + 1, "ui");
    await admin.mutation(api.creators.updateCreator, {
      id: talentId,
      clipperId: clipper.creatorId,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: clipper.creatorId,
      platform: "TikTok",
      handle: `@e2erushui${ts}`,
      validatedAt: ts - 20 * JOUR,
    });

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 390, height: 844 },
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/talent", { timeout: 20_000 });

    const talentClient = await sessionFor(email, password);
    const { rushId } = await talentClient.mutation(api.rushes.confirmDeposit, {
      projectId,
      driveFileId: `drive-ui-rush-${ts}`,
      fileName: "ma-prise-ui.mov",
      mimeType: "video/quicktime",
      sizeBytes: 33_500_000,
    });

    const campaignId = await campagneAffichable(ts, "ui");
    await admin.mutation(api.scripts.assignScriptToRush, {
      rushId,
      campaignId,
      targets: [target],
      dueDate: ts + 3 * JOUR,
    });

    await page.reload();
    await expect(page.getByText("ma-prise-ui.mov")).toBeVisible({
      timeout: 15_000,
    });
    // Le chemin complet : statut serveur `assigned` → libellé « Validé ».
    await expect(page.getByText("Validé", { exact: true })).toBeVisible();
    // Et rien qui laisse deviner qu'un script, un compte ou un clippeur existe.
    await expect(page.getByText(/retenu|assign|script|clipp/i)).toHaveCount(0);
    await expect(page.getByText(`Accroche affichée ${ts}`)).toHaveCount(0);

    await ctx.close();
    expect(E2E_SECRET.length).toBeGreaterThan(0);
  });
});
