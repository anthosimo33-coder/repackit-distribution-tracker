import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { ConvexHttpClient } from "convex/browser";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;

async function uploadFakeVideo(client: ConvexHttpClient): Promise<Id<"_storage">> {
  const uploadUrl = await client.mutation(api.storage.generateUploadUrl, {});
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "video/mp4" },
    body: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]),
  });
  if (!res.ok) throw new Error(`upload échoué (HTTP ${res.status})`);
  return ((await res.json()) as { storageId: Id<"_storage"> }).storageId;
}

/**
 * TEMPS DE RÉPONSE DE LA VALIDATION — de l'entrée d'une vidéo dans la file
 * jusqu'à « Valider » / « Refuser ».
 *
 * Avant, ni l'envoi ni la validation n'étaient horodatés : impossible de
 * mesurer quoi que ce soit. La spec suit le vrai chemin : la créatrice ENVOIE
 * (l'heure d'entrée est posée par `submitVideo`), l'entrée est ANTIDATÉE pour
 * mesurer des heures sans les attendre, l'admin VALIDE à l'écran, et le refus
 * passe par la vraie mutation.
 *
 * Les specs tournent en série (un worker) : les compteurs se lisent en écart
 * avant/après, et la durée de 2 j 3 h n'est produite que par cette spec.
 */
test.describe("Validation — temps de réponse", () => {
  test("l'envoi est horodaté, la carte dit depuis quand, la décision est comptée", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Lina Moreau ${ts}`,
      email: `e2e-delai-validation-${ts}@repackit.test`,
      password: "creator-delai-12345",
    });
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Format délai ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@lina.moreau_${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creator.creatorId,
      targets: [target],
      postsPerCreator: 2,
      dueDate: ts + 7 * DAY,
    });
    const [lente, refusee] = (await admin.query(api.assignments.listAssignments, {})).filter(
      (x) => x.formatId === formatId && x.creatorId === creator.creatorId,
    );
    expect(refusee).toBeDefined();

    // ── 1. L'ENVOI pose l'entrée dans la file (le vrai `submitVideo`). ──
    const avantEnvoi = Date.now();
    for (const a of [lente, refusee]) {
      await creator.client.mutation(api.assignments.submitVideo, {
        projectId: creator.projectId,
        id: a._id,
        storageId: await uploadFakeVideo(creator.client),
        mimeType: "video/mp4",
      });
    }
    const file = await admin.query(api.assignments.listVideoSubmitted, {});
    for (const a of [lente, refusee]) {
      const ligne = file.find((r) => r._id === a._id)!;
      expect(ligne.inReviewSince).not.toBeNull();
      expect(ligne.inReviewSince!).toBeGreaterThanOrEqual(avantEnvoi);
      expect(ligne.inReviewSince!).toBeLessThanOrEqual(Date.now());
    }

    // ── 2. Entrées antidatées : 2 j 3 h et 5 h 20 d'attente. ──
    const avant = await admin.query(api.videoReviews.getReviewDelay, {});
    const entreeLente = Date.now() - (2 * DAY + 3 * H);
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: lente._id,
      status: "video_submitted",
      inReviewSince: entreeLente,
    });
    const entreeRefusee = Date.now() - (5 * H + 20 * MIN);
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: refusee._id,
      status: "video_submitted",
      inReviewSince: entreeRefusee,
    });

    // ── 3. L'écran dit depuis quand chacune attend, et la plus longue. ──
    await page.goto(adminPath("/validation"));
    await expect(page.getByTestId(`waiting-since-${lente._id}`)).toHaveText("Envoyée il y a 2 j 3 h", {
      timeout: 20_000,
    });
    await expect(page.getByTestId(`waiting-since-${refusee._id}`)).toHaveText(/^Envoyée il y a 5 h 2[01]$/);
    await expect(page.getByTestId("review-delay-attente")).toContainText("2 j 3 h");
    // Rien n'est encore décidé : la durée de la spec n'est dans aucune case du
    // tableau (elle n'apparaît que dans les phrases d'attente ci-dessus).
    await expect(page.getByText("2 j 3 h", { exact: true })).toHaveCount(0);

    // ── 4. Valider À L'ÉCRAN ; refuser par la vraie mutation. ──
    await page.getByTestId(`approve-${lente._id}`).click();
    await expect(page.getByTestId(`approve-${lente._id}`)).toHaveCount(0, { timeout: 15_000 });
    await admin.mutation(api.assignments.reviewVideoReject, {
      id: refusee._id,
      feedback: "Le hook arrive après 4 secondes : commence directement par la phrase.",
    });

    // ── 5. Les deux décisions sont comptées, avec leur vraie attente. ──
    const apres = await admin.query(api.videoReviews.getReviewDelay, {});
    expect(apres.septJours.videos).toBe(avant.septJours.videos + 2);
    expect(apres.septJours.validees).toBe(avant.septJours.validees + 1);
    expect(apres.septJours.refusees).toBe(avant.septJours.refusees + 1);
    expect(apres.septJours.plusLongMs!).toBeGreaterThanOrEqual(2 * DAY + 3 * H);
    expect(apres.septJours.plusLongMs!).toBeLessThan(2 * DAY + 3 * H + 5 * MIN);
    expect(apres.mesureDepuis).not.toBeNull();

    // L'écran le montre (réactif, sans recharger) : 7 jours, compteur et plus long.
    await expect(page.getByTestId("review-delay-7j-videos")).toHaveText(String(avant.septJours.videos + 2), {
      timeout: 15_000,
    });
    await expect(page.getByTestId("review-delay-7j-plus-long")).toHaveText("2 j 3 h");
    await expect(page.getByTestId("review-delay-30j-plus-long")).toHaveText("2 j 3 h");
    // Une décision prise quitte la file : sa mission n'attend plus.
    await expect(page.getByTestId(`waiting-since-${refusee._id}`)).toHaveCount(0);
  });
});
