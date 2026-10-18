import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { minuitParis } from "./helpers/paris-day";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * LIEN D'UN AUTRE COMPTE — le reel collé n'est pas à elle.
 *
 * Le cas réel du 18/10/2026 : @quentin.snytch colle un reel de
 * @princiaconfort. L'URL `/reel/<code>/` ne porte pas le handle ; seul l'item
 * Apify dit à qui est le post. Le relevé rapide a écrit 359 638 puis 371 878
 * vues, affichées sur le Dashboard comme les siennes ; le relevé de nuit les
 * aurait portées en paie.
 *
 * L'unitaire (lib/instagram-owner.test.ts) tient la règle ; cette spec tient le
 * CÂBLAGE, là où vivent les défauts :
 *  1. compte jamais confirmé → le reel étranger est relevé (rien n'est prouvé) ;
 *  2. le post de la créatrice (propriétaire = son @) confirme le compte —
 *     appris par la mutation de relevé elle-même ;
 *  3. ensuite, le reel étranger n'écrit plus RIEN, ni la nuit ni au relevé
 *     rapide, et la publication est marquée ; un run sans propriétaire ne lève
 *     pas le drapeau ;
 *  4. l'admin le voit sur le Dashboard (48 h) et dans le panneau de mission ;
 *  5. « Corriger le lien » lève le drapeau, et le bon reel se relève.
 */
test.describe("Relevé Instagram — lien d'un autre compte", () => {
  test("refusé une fois le compte confirmé, signalé à l'admin, réparé par « Corriger le lien »", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] Quentin Snytch ${ts}`;
    const C = await createCreatorSession(convexUrl, {
      name: creatorName,
      email: `e2e-owner-guard-${ts}@repackit.test`,
      password: "owner-guard-12345",
    });
    // Forme de la prod : un point dans le @, suffixé.
    const handle = `@quentin.snytch${ts}`;
    const self = { ownerUsername: `quentin.snytch${ts}`, ownerId: `266${ts}` };
    const princia = { ownerUsername: "princiaconfort", ownerId: "78077867125" };
    const tInsta = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "Instagram",
      handle,
    });

    // ── La mission dont le lien est faux ───────────────────────────────────
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] OwnerGuard ${ts}`,
    });
    const addBrick = (kind: "hook" | "flux" | "cta", label: string, content: string) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    await addBrick("hook", "H", `hook ${ts}`);
    await addBrick("flux", "F", "flux contenu");
    await addBrick("cta", "C", "cta contenu");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingOwnerGuard ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: C.creatorId,
      targets: [tInsta],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      postDates: [minuitParis()],
    });
    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a.creatorId === C.creatorId,
    );
    if (!row) throw new Error("assignation de test introuvable");
    const lienFaux = `https://www.instagram.com/reel/Del5${ts}/`;
    const confirmed = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: row._id,
      urls: [{ platform: "Instagram", url: lienFaux }],
    });
    const B = confirmed.publicationIds[0];
    expect(B).toBeTruthy();

    // ── Une AUTRE publication du même compte : le vrai post de la créatrice ─
    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] OwnerGuard ${ts}`,
    })) as Id<"icps">;
    const { ids } = await admin.mutation(api.publications.createPublication, {
      carouselId: await admin.query(api.publications.getNextCarouselId, {}),
      hookId: null,
      hookText: `[E2E] OwnerGuard ${ts}`,
      mecanique: "Erreur",
      niveau: "Broad-A",
      mediaType: "short",
      script: "script",
      angleTonal: "Psycho",
      langue: "FR",
      icpId,
      plateformes: ["Instagram"],
      compte: handle,
      datePubli: ts - 30 * HOUR,
      notes: "[E2E_TEST] instagram-owner-guard",
    });
    const A = ids[0] as Id<"publications">;
    await admin.mutation(api.publications.updateMetrics, {
      id: A,
      postUrl: `https://www.instagram.com/reel/Own${ts}/`,
    });

    const pubOf = async (id: Id<"publications">) =>
      (await admin.query(api.publications.listPublications, {})).find((p) => p._id === id)!;
    const datePubliB = (await pubOf(B)).datePubli;
    const early = (
      readings: { publicationId: Id<"publications">; vues: number; owner: typeof self; postedAt: number }[],
      capturedAt: number,
    ) =>
      admin.mutation(api.earlyReadings.e2eRecordEarlyPass, {
        secret: E2E_SECRET,
        readings: readings.map((r) => ({
          publicationId: r.publicationId,
          capturedAt,
          postedAt: r.postedAt,
          postedAtSource: "datePubli" as const,
          vues: r.vues,
          source: "instagram" as const,
          owner: r.owner,
        })),
        attempts: readings.map((r) => ({
          publicationId: r.publicationId,
          at: capturedAt,
          outcome: "read" as const,
        })),
      });
    const nightly = (
      publicationId: Id<"publications">,
      vues: number,
      owner: { ownerUsername: string | null; ownerId: string | null },
    ) =>
      admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId,
        vues,
        likes: 21_400,
        capturedAt: Date.now(),
        source: "instagram",
        ...owner,
      });

    // ── 1. Compte JAMAIS confirmé : rien n'est prouvé, le reel est relevé ───
    // C'est exactement le relevé rapide du 18/10 — la règle « refuser
    // seulement le prouvé faux » le laisse passer tant que le compte n'a pas
    // d'identité confirmée.
    expect(await early([{ publicationId: B, vues: 359_638, owner: princia, postedAt: datePubliB }], Date.now())).toBe(1);

    // ── 2. Le post de la créatrice confirme le compte ───────────────────────
    expect((await nightly(A, 12_340, self)).action).toBe("inserted");
    expect((await pubOf(A)).vuesLatest).toBe(12_340);

    // ── 3. Le reel étranger n'écrit plus RIEN ───────────────────────────────
    expect((await nightly(B, 371_878, princia)).action).toBe("foreign_owner");
    expect(
      await admin.query(api.metricSnapshots.listSnapshotsByPublication, { publicationId: B }),
    ).toHaveLength(0);
    const marquee = await pubOf(B);
    expect(marquee.vuesLatest ?? null).toBeNull();
    expect(marquee.foreignOwner?.username).toBe("princiaconfort");
    expect(marquee.lastCollectFailureReason).toBe("lien d'un autre compte (@princiaconfort)");
    // Relevé rapide : refusé lui aussi — et dans le MÊME passage, le post de la
    // créatrice est écrit (présence : le passage n'a pas tout jeté).
    expect(
      await early(
        [
          { publicationId: B, vues: 371_878, owner: princia, postedAt: datePubliB },
          { publicationId: A, vues: 12_980, owner: self, postedAt: ts - 30 * HOUR },
        ],
        Date.now() + 11 * 60_000,
      ),
    ).toBe(1);
    // Un run où l'actor omet le propriétaire ne fait pas entrer le reel.
    expect((await nightly(B, 371_878, { ownerUsername: null, ownerId: null })).action).toBe(
      "foreign_owner",
    );

    // ── 4a. Dashboard « Posts des dernières 48 h » ──────────────────────────
    await admin.mutation(api.dashboardDecisions.e2eRefreshDecisionsCache, {
      secret: E2E_SECRET,
      projectId: await admin.getProjectId(),
    });
    const d = await admin.query(api.dashboardDecisions.decisionDashboard, {});
    const sigB = d.posts48h.find((p) => p.publicationId === B);
    const sigA = d.posts48h.find((p) => p.publicationId === A);
    expect(sigB?.foreignOwner).toBe("princiaconfort");
    // Le relevé écrit à l'étape 1 décrit le reel de quelqu'un d'autre : il ne
    // compte pas pour elle.
    expect(sigB?.vues).toBe(0);
    expect(sigA?.foreignOwner).toBeNull();
    expect(sigA?.vues).toBeGreaterThanOrEqual(12_340);

    await page.goto(adminPath("/dashboard"));
    await expect(page.getByRole("heading", { name: "Posts des dernières 48 h" })).toBeVisible();
    await expect(page.getByTestId(`post48h-foreign-owner-${B}`)).toHaveText(
      "Lien d'un autre compte (@princiaconfort)",
    );
    // Absence sur le vrai post, quand sa ligne est bien rendue.
    await expect(page.getByTestId(`post48h-foreign-owner-${A}`)).toHaveCount(0);

    // ── 4b. Panneau de la mission, à côté de « Corriger le lien » ───────────
    await page.goto(adminPath("/assignments"));
    await expect(page.getByText(/\d+ \/ \d+ livrable/)).toBeVisible();
    await page.locator("button").filter({ hasText: "Tous créateurs" }).click();
    await page.locator('[role="option"]').filter({ hasText: creatorName }).click();
    await page.keyboard.press("Escape");
    await page
      .getByTitle(new RegExp(creatorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .click();
    const sheet = page.getByTestId("assignment-detail-sheet");
    await expect(sheet.getByTestId("detail-publication-published")).toBeVisible();
    const note = sheet.getByTestId("detail-foreign-owner-Instagram");
    await expect(note).toContainText("Lien d'un autre compte (@princiaconfort)");

    // ── 5. « Corriger le lien » lève le drapeau ─────────────────────────────
    const bonLien = `https://www.instagram.com/reel/Good${ts}/`;
    await sheet.getByTestId("correct-url-Instagram").click();
    const dialog = page.getByRole("dialog", { name: "Corriger le lien Instagram" });
    await dialog.getByRole("textbox", { name: "Nouveau lien Instagram" }).fill(bonLien);
    await dialog.getByRole("button", { name: "Corriger", exact: true }).click();
    await expect(page.getByText(/Lien corrigé/)).toBeVisible();
    await expect(note).toHaveCount(0);

    const reparee = await pubOf(B);
    expect(reparee.postUrl).toBe(bonLien);
    expect(reparee.foreignOwner).toBeUndefined();
    expect(reparee.lastCollectFailureReason).toBeUndefined();
    expect(await admin.query(api.assignments.getPublishedLinkFlags, { id: row._id })).toEqual([]);
    // Le bon reel (à elle) se relève normalement.
    expect((await nightly(B, 8_210, self)).action).toBe("inserted");
    expect((await pubOf(B)).vuesLatest).toBe(8_210);
  });
});
