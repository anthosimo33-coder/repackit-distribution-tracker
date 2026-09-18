import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { adminPath, createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createCreatorSession } from "./helpers/creator-client";
import { createFormatWithRate } from "./helpers/formats";
import { defaultManagerPermissions } from "../convex/permissions";
import { parisDayOf, parisDayStart } from "../convex/managerCpm";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * DATE D'EFFET D'UN TAUX DE MANAGER — le geste du 18/09/2026, dans l'écran.
 *
 * Neuf taux avaient été posés « depuis toujours » (le défaut d'alors) alors que
 * l'intention était « à partir d'hier ». On rejoue : taux posé sans date, puis,
 * dans « Rôles et droits », date d'hier dans « à partir du », Appliquer,
 * Enregistrer. Deux vidéos de la même créatrice, de part et d'autre de minuit :
 * celle d'avant-hier ne doit plus rapporter, celle d'aujourd'hui si.
 */
test("« à partir d'hier » : les vidéos d'avant sortent du relevé, celles d'après restent", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const ts = Date.now();
  const projectId = await admin.getProjectId();
  const hier = parisDayOf(ts - DAY);
  const minuitHier = parisDayStart(hier)!;

  const kelly = (
    await createCreatorSession(convexUrl!, {
      name: `[E2E_TEST] Kelly Moreau ${ts}`,
      email: `e2e-mcpmd-kelly-${ts}@repackit.test`,
      password: `mcpmd-${ts}`,
    })
  ).creatorId;
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] MgrCpmDate ${ts}`,
    montantFixe: 100,
    nbVideosCible: 60,
    tauxCPM: 2,
  });
  const formatId = await createFormatWithRate(admin, {
    name: `[E2E_TEST] Format MgrCpmDate ${ts}`,
    type: "short",
    rateModel: { basePerPost: 5 },
  });

  async function publie(creatorId: Id<"creators">, suffix: string, publishedAt: number, vues: number) {
    const handle = `@e2emcpmd${suffix}${ts}`;
    const target = await availableTarget({ e2eClient: admin, creatorId, platform: "TikTok", handle });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 5 * DAY,
      pricingId,
    });
    const mine = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.formatId === formatId && a.creatorId === creatorId && a.status !== "published",
    );
    const assignmentId = mine[mine.length - 1]._id;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignmentId,
      status: "to_publish",
    });
    const { publicationIds } = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: assignmentId,
      urls: [
        {
          platform: "TikTok",
          url: `https://www.tiktok.com/${handle}/video/76${suffix.length}${ts % 1_000_000}`,
        },
      ],
      publishedAt,
      allowBackdate: true,
    });
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: publicationIds[0],
      capturedAt: Math.min(ts - 10 * 60_000, publishedAt + HOUR),
      vues,
      likes: Math.round(vues / 21),
    });
  }
  // Avant-hier 21:40 (avant minuit d'hier) et aujourd'hui, une heure après
  // minuit d'hier au plus tôt : les deux côtés de la borne.
  await publie(kelly, "avant", minuitHier - 2 * HOUR - 20 * 60_000, 48_317);
  await publie(kelly, "apres", Math.max(minuitHier + HOUR, ts - 3 * HOUR), 12_086);

  // Manager, périmètre Kelly, taux 0,20 posé SANS date (= depuis toujours).
  const email = `e2e-mcpmd-manager-${ts}@repackit.test`;
  const { token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] Manager Date ${ts}`,
    email,
  });
  const mgr = new ConvexHttpClient(convexUrl!);
  const res = await mgr.action(api.auth.signIn, {
    provider: "password",
    params: { email, password: `mcpmd-m-${ts}`, flow: "signUp", inviteToken: token },
  });
  mgr.setAuth(res.tokens!.token);
  await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
    secret: E2E_SECRET,
    email,
    projectId,
    role: "manager",
    permissions: defaultManagerPermissions(),
  });
  const membershipId = (await admin.query(api.team.listMembers, {})).find((r) => r.email === email)!
    .membershipId;
  await admin.mutation(api.team.setMemberCreatorScope, { membershipId, creatorScope: [kelly] });
  await admin.mutation(api.team.setManagerCpms, {
    membershipId,
    entries: [{ creatorId: kelly, cpm: 0.2 }],
  });
  const avant = await mgr.query(api.managerPay.getMyManagerPay, { projectId });
  // Depuis toujours : les DEUX vidéos comptent (présence avant l'absence).
  expect(avant!.rows.reduce((s, r) => s + r.videos, 0)).toBe(2);

  // ── Le geste, dans l'écran ──────────────────────────────────────────────
  await page.goto(adminPath("/equipe"));
  const bloc = page
    .getByLabel("Rémunération au CPM")
    .filter({ has: page.getByText(`[E2E_TEST] Kelly Moreau ${ts}`) })
    // Un manager « toutes les créatrices » liste Kelly aussi : le nôtre n'a qu'elle.
    .filter({ hasText: "Appliquer aux 1 créatrice listée" });
  await expect(bloc).toHaveCount(1, { timeout: 30_000 });
  await expect(bloc.getByText("depuis toujours", { exact: true })).toBeVisible();
  await bloc.getByLabel("Date d'effet pour toutes les créatrices listées").fill(hier);
  await bloc.getByRole("button", { name: /Appliquer aux 1 créatrice listée/ }).click();
  await expect(bloc.getByLabel(`Date d'effet du taux ([E2E_TEST] Kelly Moreau ${ts})`)).toHaveValue(
    hier,
  );
  await bloc.getByRole("button", { name: "Enregistrer la rémunération" }).click();
  await expect(page.getByText(/Rémunération de .* mise à jour/)).toBeVisible({ timeout: 15_000 });

  // ── Le serveur : même taux, date corrigée EN PLACE ──────────────────────
  const apres = await mgr.query(api.managerPay.getMyManagerPay, { projectId });
  const k = apres!.creators.find((c) => c.creatorId === kelly)!;
  expect(k.history).toEqual([{ cpm: 0.2, from: minuitHier }]);
  // La vidéo d'avant-hier est sortie, celle d'après reste, à 0,20.
  const videos = apres!.rows.reduce((s, r) => s + r.videos, 0);
  expect(videos).toBe(1);
  expect(apres!.rows.reduce((s, r) => s + r.payableViews, 0)).toBe(12_086);
  expect(apres!.rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(2.4172, 6);

  // ── Une date dans le futur est refusée par le serveur ───────────────────
  let message = "";
  try {
    await admin.mutation(api.team.setManagerCpms, {
      membershipId,
      entries: [{ creatorId: kelly, cpm: 0.3, fromDay: parisDayOf(ts + 3 * DAY) }],
    });
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  expect(message).toContain(`Kelly Moreau ${ts}`);
  expect(message).toContain("futur");
});
