import { test, expect } from "@playwright/test";
import { test as authedTest } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  adminPath,
  createE2eClient,
  E2E_EMAIL,
  E2E_PASSWORD,
  E2E_SECRET,
} from "./helpers/authed-client";
import { managerPayPeriodOf, managerPeriodStatus } from "../convex/managerCpm";
import { availableTarget } from "./helpers/targets";
import { createCreatorSession } from "./helpers/creator-client";
import { createFormatWithRate } from "./helpers/formats";
import { defaultManagerPermissions } from "../convex/permissions";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const DAY = 86_400_000;

/**
 * RÉMUNÉRATION D'UN MANAGER AU CPM — sur les vues des créatrices qu'il gère.
 *
 * Vérifié depuis une VRAIE session manager : ce qu'il lit, ce que le serveur
 * refuse de le laisser écrire, et ce que l'écran lui affiche. Vues de forme
 * réelle (48 317, 103 559), taux à décimales, jamais des nombres ronds.
 *
 * Chaque absence est doublée d'une présence (règle #47/#49) : « Inès ne rapporte
 * rien » ne prouve rien si le relevé est vide pour une autre raison.
 */

async function codeDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "PAS DE REFUS";
  } catch (e) {
    if (e instanceof ConvexError) {
      const d = e.data as { code?: string } | string;
      return typeof d === "object" && d.code ? d.code : String(d);
    }
    return String(e);
  }
}

test.describe("Manager — rémunération au CPM", () => {
  test("le superadmin pose un CPM par créatrice ; le manager voit ses vues et sa paie", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const projectId = await admin.getProjectId();

    // ── Deux créatrices, une vidéo publiée chacune, avec des vues ────────────
    // Onboardées (inscription faite) : sinon elles ne sont pas assignables.
    const creatrice = async (nom: string) =>
      (
        await createCreatorSession(convexUrl!, {
          name: `[E2E_TEST] ${nom} ${ts}`,
          email: `e2e-mcpm-${nom.toLowerCase().replace(/\s+/g, ".")}-${ts}@repackit.test`,
          password: `mcpm-creatrice-${ts}`,
        })
      ).creatorId;
    const kelly = await creatrice("Kelly Moreau");
    const ines = await creatrice("Ines Petrovic");

    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] MgrCpm ${ts}`,
      montantFixe: 100,
      nbVideosCible: 60,
      tauxCPM: 2,
    });
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Format MgrCpm ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });

    async function publieAvecVues(
      creatorId: Id<"creators">,
      suffix: string,
      vues: number,
    ) {
      const handle = `@e2emcpm${suffix}${ts}`;
      const target = await availableTarget({
        e2eClient: admin,
        creatorId,
        platform: "TikTok",
        handle,
      });
      await admin.mutation(api.assignments.assignFormat, {
        formatId,
        creatorId,
        targets: [target],
        postsPerCreator: 1,
        dueDate: ts + 5 * DAY,
        pricingId,
      });
      const mine = (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) => a.formatId === formatId && a.creatorId === creatorId,
      );
      const assignmentId = mine[mine.length - 1]._id;
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: assignmentId,
        status: "to_publish",
      });
      const publishedAt = ts - 3 * DAY;
      const { publicationIds } = await admin.mutation(
        api.assignments.confirmPublicationAsAdmin,
        {
          id: assignmentId,
          urls: [
            {
              platform: "TikTok",
              url: `https://www.tiktok.com/${handle}/video/75${suffix.length}${ts % 1_000_000}`,
            },
          ],
          publishedAt,
          allowBackdate: true,
        },
      );
      await admin.mutation(api.metricSnapshots.createSnapshot, {
        publicationId: publicationIds[0],
        capturedAt: publishedAt + 2 * DAY,
        vues,
        likes: Math.round(vues / 21),
      });
      return { pubId: publicationIds[0], publishedAt };
    }
    const pubKelly = await publieAvecVues(kelly, "kelly", 48_317);
    await publieAvecVues(ines, "ines", 103_559);
    // Mois de publication tel que le serveur le calcule (UTC) — jamais « le mois
    // courant » supposé : à J-3, un test lancé le 2 du mois tomberait sur le précédent.
    const mois = managerPayPeriodOf(pubKelly.publishedAt);

    // ── Un manager qui gère les deux ─────────────────────────────────────────
    const email = `e2e-mcpm-manager-${ts}@repackit.test`;
    const password = `mcpm-${ts}`;
    const { token } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Manager Cpm ${ts}`,
      email,
    });
    const mgr = new ConvexHttpClient(convexUrl!);
    const res = await mgr.action(api.auth.signIn, {
      provider: "password",
      params: { email, password, flow: "signUp", inviteToken: token },
    });
    mgr.setAuth(res.tokens!.token);
    await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
      secret: E2E_SECRET,
      email,
      projectId,
      role: "manager",
      permissions: defaultManagerPermissions(),
    });
    const membershipId = (await admin.query(api.team.listMembers, {})).find(
      (r) => r.email === email,
    )!.membershipId;
    await admin.mutation(api.team.setMemberCreatorScope, {
      membershipId,
      creatorScope: [kelly, ines],
    });

    // ── 1. Aucun taux : il est manager, mais rien ne lui rapporte ────────────
    const avant = await mgr.query(api.managerPay.getMyManagerPay, { projectId });
    expect(avant).not.toBeNull(); // manager reconnu…
    expect(avant!.creators).toEqual([]); // …sans aucun taux

    // ── 2. Il ne peut PAS se fixer son propre taux ───────────────────────────
    expect(
      await codeDe(
        mgr.mutation(api.team.setManagerCpms, {
          projectId,
          membershipId,
          entries: [{ creatorId: kelly, cpm: 5 }],
        }),
      ),
    ).toBe("ERR_SUPERADMIN_ONLY");

    // Taux hors bornes refusés côté serveur, même par le superadmin.
    for (const cpm of [0, -0.2, 80]) {
      expect(
        await codeDe(
          admin.mutation(api.team.setManagerCpms, {
            membershipId,
            entries: [{ creatorId: kelly, cpm }],
          }),
        ),
      ).not.toBe("PAS DE REFUS");
    }

    // ── 3. 0,20 pour Kelly seulement ─────────────────────────────────────────
    await admin.mutation(api.team.setManagerCpms, {
      membershipId,
      entries: [{ creatorId: kelly, cpm: 0.2 }],
    });
    const seul = await mgr.query(api.managerPay.getMyManagerPay, { projectId });
    expect(seul!.creators.map((c) => c.creatorId)).toEqual([kelly]); // présence
    expect(seul!.rows.some((r) => r.creatorId === ines)).toBe(false); // absence
    const kellyRow = seul!.rows.find((r) => r.creatorId === kelly)!;
    expect(kellyRow.videos).toBe(1);
    expect(kellyRow.payableViews).toBe(48_317);
    expect(kellyRow.amount).toBeCloseTo(9.6634, 6);

    // ── 4. Inès à 0,35 : chacune à SON taux ──────────────────────────────────
    await admin.mutation(api.team.setManagerCpms, {
      membershipId,
      entries: [
        { creatorId: kelly, cpm: 0.2 },
        { creatorId: ines, cpm: 0.35 },
      ],
    });
    const deux = await mgr.query(api.managerPay.getMyManagerPay, { projectId });
    const total = deux!.rows.reduce((s, r) => s + r.amount, 0);
    expect(total).toBeCloseTo(9.6634 + 36.24565, 6);

    // La lecture du superadmin et celle du manager sont LA MÊME.
    const vuParSuperadmin = await admin.query(api.managerPay.getManagerPay, {
      membershipId,
    });
    expect(vuParSuperadmin).toEqual(deux);

    // Le changement de taux est au journal, lisible par le nom.
    const journal = await admin.query(api.team.listChanges, {
      userId: (await admin.query(api.team.listMembers, {})).find((r) => r.email === email)!
        .userId,
    });
    expect(journal.some((l) => /^CPM 0,35 .*Ines Petrovic/.test(l.permission))).toBe(true);

    // ── 5. Dans le navigateur : l'entrée de menu et le relevé ────────────────
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await ctx.newPage();
    await p.goto("/login");
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Mot de passe").fill(password);
    await p.getByRole("button", { name: /se connecter/i }).click();
    await p.waitForURL("**/admin/**/dashboard", { timeout: 30_000 });

    const nav = p.getByRole("navigation");
    await nav.getByRole("link", { name: "Ma rémunération", exact: true }).click();
    await p.waitForURL("**/ma-remuneration", { timeout: 20_000 });
    await expect(p.getByRole("heading", { name: "Ma rémunération" })).toBeVisible({
      timeout: 20_000,
    });
    // Les deux créatrices, leurs vues, et le total (45,91 = 9,66 + 36,25).
    await expect(p.getByRole("cell", { name: `[E2E_TEST] Kelly Moreau ${ts}` })).toBeVisible();
    await expect(p.getByRole("cell", { name: `[E2E_TEST] Ines Petrovic ${ts}` })).toBeVisible();
    await expect(p.getByText(/103\s?559/).first()).toBeVisible();
    await expect(p.getByText(/45,91/).first()).toBeVisible();
    // Rien de versé : le mois est « À payer » (présence du statut avant qu'il change).
    await expect(p.getByText("À payer", { exact: true })).toBeVisible();
    // Et le manager n'a AUCUN bouton de paiement sur sa propre paie.
    await expect(p.getByRole("button", { name: "Marquer payé" })).toHaveCount(0);
    const slug = new URL(p.url()).pathname.split("/")[2];

    // ── 6. Le superadmin marque le mois payé, avec le VRAI bouton ─────────────
    const sctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const sp = await sctx.newPage();
    await sp.goto("/login");
    await sp.getByLabel("Email").fill(E2E_EMAIL);
    await sp.getByLabel("Mot de passe").fill(E2E_PASSWORD);
    await sp.getByRole("button", { name: /se connecter/i }).click();
    await sp.waitForURL("**/admin/**", { timeout: 30_000 });
    await sp.goto(`/admin/${slug}/equipe`);
    const bloc = sp
      .getByLabel("Rémunération au CPM")
      .filter({ hasText: "2 taux posés" })
      .filter({ has: sp.getByText(`[E2E_TEST] Kelly Moreau ${ts}`) });
    await expect(bloc).toHaveCount(1, { timeout: 30_000 });
    await bloc.getByRole("button", { name: "Voir son relevé" }).click();
    await bloc.getByRole("button", { name: "Marquer payé" }).click();
    await expect(sp.getByRole("alertdialog")).toContainText("45,91");
    await sp.getByRole("alertdialog").getByRole("button", { name: "Marquer payé" }).click();
    await expect(bloc.getByText("Payé", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(bloc.getByRole("button", { name: "Marquer payé" })).toHaveCount(0);
    await sctx.close();

    // ── 7. Côté serveur : versé, au centime, et seulement par le superadmin ───
    const apres = await mgr.query(api.managerPay.getMyManagerPay, { projectId });
    const actifs = apres!.payouts.filter((x) => !x.cancelled);
    expect(actifs).toHaveLength(1);
    expect(actifs[0].amount).toBe(45.91);
    expect(managerPeriodStatus(apres!.rows, apres!.payouts, mois).state).toBe("paid");
    // Rien à payer ⇒ refus (pas de second versement du même dû).
    expect(
      await codeDe(
        admin.mutation(api.managerPay.markManagerPeriodPaid, {
          membershipId,
          period: mois,
          expectedAmount: 45.91,
        }),
      ),
    ).not.toBe("PAS DE REFUS");

    // Les vidéos de Kelly continuent de monter : 52 000 vues ⇒ dû 46,65, reste 0,74.
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: pubKelly.pubId,
      capturedAt: pubKelly.publishedAt + 2.5 * DAY,
      vues: 52_000,
      likes: 2_476,
    });
    const complement = await mgr.query(api.managerPay.getMyManagerPay, { projectId });
    const st = managerPeriodStatus(complement!.rows, complement!.payouts, mois);
    expect(st.state).toBe("partial");
    expect(st.remaining).toBe(0.74);

    // Le manager ne peut pas se marquer payé.
    expect(
      await codeDe(
        mgr.mutation(api.managerPay.markManagerPeriodPaid, {
          projectId,
          membershipId,
          period: mois,
          expectedAmount: 0.74,
        }),
      ),
    ).toBe("ERR_SUPERADMIN_ONLY");
    // Un montant périmé (celui d'avant les nouvelles vues) est refusé…
    expect(
      await codeDe(
        admin.mutation(api.managerPay.markManagerPeriodPaid, {
          membershipId,
          period: mois,
          expectedAmount: 45.91,
        }),
      ),
    ).not.toBe("PAS DE REFUS");
    // …le bon est accepté.
    await admin.mutation(api.managerPay.markManagerPeriodPaid, {
      membershipId,
      period: mois,
      expectedAmount: 0.74,
    });
    const solde = await mgr.query(api.managerPay.getMyManagerPay, { projectId });
    expect(managerPeriodStatus(solde!.rows, solde!.payouts, mois).state).toBe("paid");

    // Annuler le premier versement : le mois redevient dû de 45,91.
    const premier = solde!.payouts.find((x) => x.amount === 45.91)!;
    await admin.mutation(api.managerPay.cancelManagerPayout, { payoutId: premier._id });
    const annule = await mgr.query(api.managerPay.getMyManagerPay, { projectId });
    const stAnnule = managerPeriodStatus(annule!.rows, annule!.payouts, mois);
    expect(stAnnule.paid).toBe(0.74);
    expect(stAnnule.remaining).toBe(45.91);
    expect(annule!.payouts.find((x) => x._id === premier._id)!.cancelled).toBe(true);

    // ── 8. Le manager voit le reste et le versement annulé, barré ─────────────
    await p.reload();
    await expect(p.getByText("Reste 45,91")).toBeVisible({ timeout: 20_000 });
    await expect(p.getByText("annulé", { exact: true })).toBeVisible();

    await ctx.close();
  });

});

test.describe("Manager — rémunération au CPM (menu)", () => {
  authedTest("l'entrée « Ma rémunération » n'est proposée qu'aux managers", async ({ page }) => {
    // Session e2e = compte d'ÉQUIPE non manager : il ne voit pas l'entrée…
    await page.goto(adminPath("/dashboard"));
    const nav = page.getByRole("navigation");
    // …alors que son menu est bien chargé (présence avant l'absence).
    await expect(nav.getByRole("link", { name: "Paiements", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(nav.getByRole("link", { name: "Ma rémunération", exact: true })).toHaveCount(0);
  });
});
