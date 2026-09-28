import { test, expect } from "./fixtures/auth-fixture";
import { adminPath, createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);
const DAY = 86_400_000;

/**
 * BONUS PAR VIDÉO — bout en bout, sur de l'ARGENT.
 *
 * Le moteur (evaluateVideoBonus) est couvert par les unitaires ; ce que cette
 * spec ajoute est la CHAÎNE, avec les trois règles tranchées au lancement :
 *   1. la grille est lue EN DIRECT : posée APRÈS la publication, elle paie une
 *      vidéo déjà publiée dont le cycle n'est pas payé ;
 *   2. l'assiette est celle des paliers (promo rémunérée) : un post warmup
 *      RÉMUNÉRÉ (cas Kelly) est payé au CPM mais ne touche pas de bonus ;
 *   3. le paiement GÈLE une ligne `video_bonus` par vidéo, et modifier la grille
 *      ensuite ne touche plus au cycle payé.
 *
 * Vues à la forme de la prod (relevés non ronds), barème CPM 1,1 comme Snytch.
 */
test("grille par vidéo : rétroactive sur le non-payé, promo seule, gelée au paiement", async () => {
  test.setTimeout(240_000);
  const ts = Date.now();
  const creator = await createCreatorSession(url, {
    name: `[E2E_TEST] Bonus vidéo ${ts}`,
    email: `e2e-bonusvideo-${ts}@repackit.test`,
    password: "creator-bonusvideo-12345",
  });
  const projectId = creator.projectId;

  // Barème CPM pur, SANS bonus par vidéo au départ.
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] CPM bonus vidéo ${ts}`,
    montantFixe: 0,
    nbVideosCible: 60,
    tauxCPM: 1.1,
  });
  const formatId = await createFormatWithRate(admin, {
    name: `[E2E_TEST] Format bonus vidéo ${ts}`,
    type: "short",
    rateModel: { basePerPost: 0 },
  });

  /** Une vidéo assignée, publiée, relevée à `vues`. */
  async function videoPubliee(suffix: string, vues: number) {
    const handle = `@e2ebv${suffix}${ts}`;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle,
    });
    const avant = new Set(
      (await admin.query(api.assignments.listAssignments, {}))
        .filter((a) => a.formatId === formatId)
        .map((a) => a._id),
    );
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creator.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 5 * DAY,
      pricingId,
    });
    const assignmentId = (await admin.query(api.assignments.listAssignments, {}))
      .filter((a) => a.formatId === formatId && !avant.has(a._id))
      .map((a) => a._id)[0] as Id<"assignments">;
    expect(assignmentId).toBeTruthy();
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignmentId,
      status: "to_publish",
    });
    const { publicationIds } = await creator.client.mutation(
      api.assignments.confirmPublication,
      {
        projectId,
        id: assignmentId,
        urls: [
          {
            platform: "TikTok",
            url: `https://www.tiktok.com/${handle}/video/7300000000000${ts % 1000}${suffix === "promo" ? 1 : 2}`,
          },
        ],
      },
    );
    await admin.mutation(api.metricSnapshots.createSnapshot, {
      publicationId: publicationIds[0],
      capturedAt: Date.now(),
      vues,
      likes: Math.round(vues / 31),
    });
    return { assignmentId, publicationId: publicationIds[0] };
  }

  const promo = await videoPubliee("promo", 123_457);
  // Cas Kelly : post de chauffe RÉMUNÉRÉ, au-dessus de tous les seuils.
  const chauffe = await videoPubliee("chauffe", 212_334);
  await admin.mutation(api.publications.setPublicationWarmup, {
    publicationId: chauffe.publicationId,
    isWarmup: true,
  });
  await admin.mutation(api.publications.setPublicationRemuneration, {
    publicationId: chauffe.publicationId,
    remunere: true,
  });

  const cycle = async () => {
    const rows = await creator.client.query(api.payments.getMyPayments, {
      projectId,
    });
    return rows.find((p) => p.cycleIndex === 0)!;
  };

  // ── AVANT la grille : aucun bonus, le CPM paie les DEUX vidéos ────────────
  const sans = await cycle();
  expect(sans.pricingBreakdown.videoBonusTotal).toBe(0);
  expect(sans.pricingBreakdown.videoBonuses).toEqual([]);
  // 123 457 × 1,1 / 1000 = 135,80 ; la vidéo de chauffe rémunérée est PAYÉE,
  // plafonnée à 150 $ (212 334 × 1,1 / 1000 = 233,57 > 150).
  expect(sans.pricingBreakdown.cpmTotal).toBeCloseTo(135.8 + 150, 2);

  // ── Modèle PAR VIDÉO, non cumulable, appliqué au barème DÉJÀ utilisé ──────
  const { templateId } = await admin.mutation(api.pricing.createBonusTemplate, {
    name: `[E2E_TEST] Par vidéo ${ts}`,
    kind: "per_video",
    cumulative: false,
    tiers: [
      { seuilVues: 100_000, rewardType: "cash", montant: 20 },
      { seuilVues: 50_000, rewardType: "cash", montant: 10 },
    ],
  });
  await admin.mutation(api.pricing.applyBonusTemplate, {
    templateId,
    pricingIds: [pricingId],
  });
  const nonCumul = await cycle();
  // Présence : la vidéo promo, publiée AVANT la grille, touche le seuil 100 k.
  // Absence appariée : la vidéo de chauffe rémunérée, à 212 334 vues, rien.
  expect(nonCumul.pricingBreakdown.videoBonuses).toEqual([
    { assignmentId: promo.assignmentId, views: 123_457, montant: 20 },
  ]);
  expect(nonCumul.pricingBreakdown.videoBonusTotal).toBe(20);
  // Le bonus S'AJOUTE : le CPM ne bouge pas, le dû prend 20.
  expect(nonCumul.pricingBreakdown.cpmTotal).toBeCloseTo(sans.pricingBreakdown.cpmTotal, 2);
  expect(nonCumul.totalDue).toBeCloseTo(sans.totalDue + 20, 2);

  // ── Même grille, CUMULABLE : 10 + 20 ───────────────────────────────────────
  await admin.mutation(api.pricing.updateBonusTemplate, {
    id: templateId,
    name: `[E2E_TEST] Par vidéo ${ts}`,
    kind: "per_video",
    cumulative: true,
    tiers: [
      { seuilVues: 50_000, rewardType: "cash", montant: 10 },
      { seuilVues: 100_000, rewardType: "cash", montant: 20 },
    ],
  });
  // Modifier un modèle ne change AUCUN barème tant qu'on ne le réapplique pas.
  expect((await cycle()).pricingBreakdown.videoBonusTotal).toBe(20);
  await admin.mutation(api.pricing.applyBonusTemplate, {
    templateId,
    pricingIds: [pricingId],
  });
  const cumul = await cycle();
  expect(cumul.pricingBreakdown.videoBonusTotal).toBe(30);
  // HORS PLAFOND : la vidéo promo touche 135,80 de CPM + 30 de bonus = 165,80,
  // au-dessus des 150 $ par vidéo — et rien n'est rogné.
  expect(cumul.totalDue).toBeCloseTo(135.8 + 150 + 30, 2);

  // ── PAIEMENT : une ligne `video_bonus` gelée, par vidéo ────────────────────
  await admin.mutation(api.payments.markCyclePaid, {
    creatorId: creator.creatorId,
    cycleIndex: cumul.cycleIndex,
  });
  const paye = await cycle();
  expect(paye.status).toBe("paid");
  const lignes = paye.lineItems.filter((li) => li.kind === "video_bonus");
  expect(lignes).toHaveLength(1);
  expect(lignes[0].assignmentId).toBe(promo.assignmentId);
  expect(lignes[0].amount).toBe(30);
  expect(lignes[0].detail?.views).toBe(123_457);
  expect(paye.pricingBreakdown.videoBonusTotal).toBe(30);
  expect(paye.totalDue).toBeCloseTo(cumul.totalDue, 2);

  // ── Grille changée APRÈS paiement : le cycle payé ne bouge pas ─────────────
  await admin.mutation(api.pricing.updatePricing, {
    id: pricingId,
    name: `[E2E_TEST] CPM bonus vidéo ${ts}`,
    montantFixe: 0,
    nbVideosCible: 60,
    tauxCPM: 1.1,
    videoBonus: { tiers: [{ seuilVues: 50_000, montant: 99.5 }], cumulative: false },
  });
  const apres = await cycle();
  expect(apres.lineItems.filter((li) => li.kind === "video_bonus")[0].amount).toBe(30);
  expect(apres.totalDue).toBeCloseTo(paye.totalDue, 2);

  await admin.mutation(api.pricing.deleteBonusTemplate, { id: templateId });
  await admin.mutation(api.assignments.cleanupTestAssignments, {
    secret: E2E_SECRET,
  });
});

test("écran Barèmes : créer un modèle PAR VIDÉO, lire l'exemple, l'appliquer", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ts = Date.now();
  const nom = `[E2E_TEST] Grille vidéo UI ${ts}`;
  const bareme = `[E2E_TEST] Barème UI ${ts}`;
  await admin.mutation(api.pricing.createPricing, {
    name: bareme,
    montantFixe: 0,
    nbVideosCible: 30,
    tauxCPM: 1,
  });

  await page.goto(adminPath("/pricings"));
  await page.getByRole("button", { name: "Nouveau modèle" }).click();
  const dialog = page.getByRole("dialog");
  // Le TYPE est la première question.
  await dialog.getByRole("radio", { name: /Bonus par vidéo/ }).check();
  await dialog.getByLabel("Nom du modèle").fill(nom);
  await dialog.locator("#vb-seuil-0").fill("50000");
  await dialog.locator("#vb-montant-0").fill("10");
  await dialog.getByRole("button", { name: "+ Seuil" }).click();
  await dialog.locator("#vb-seuil-1").fill("100000");
  await dialog.locator("#vb-montant-1").fill("20");

  // L'EXEMPLE, avant d'enregistrer : non cumulable, 123 457 vues → 20.
  await dialog.getByLabel("Tester :").fill("123457");
  await expect(dialog.getByTestId("video-bonus-test-result")).toContainText("20");
  await expect(dialog.getByTestId("video-bonus-test-result")).not.toContainText("30");
  // Cocher « se cumulent » change le résultat : 10 + 20.
  await dialog.getByRole("checkbox", { name: "Les bonus se cumulent" }).click();
  await expect(dialog.getByTestId("video-bonus-test-result")).toContainText("30");

  await dialog.getByRole("button", { name: "Créer" }).click();
  await expect(page.getByText("Modèle créé")).toBeVisible();

  // Le modèle apparaît, typé, et s'applique à un barème existant.
  const ligne = page.locator("div", { has: page.getByRole("button", { name: nom }) }).last();
  await expect(ligne.getByText("Par vidéo")).toBeVisible();
  await ligne.getByRole("button", { name: "Appliquer…" }).click();
  const apply = page.getByRole("dialog");
  await apply.getByText(bareme).click();
  await apply.getByRole("button", { name: /Appliquer à 1 barème/ }).click();
  await expect(page.getByText(/Modèle appliqué à 1 barème/)).toBeVisible();

  // Côté serveur : la grille est bien recopiée dans le barème, cumulable.
  const p = (await admin.query(api.pricing.listPricings, {})).find(
    (x) => x.name === bareme,
  )!;
  expect(p.videoBonus).toEqual({
    tiers: [
      { seuilVues: 50_000, montant: 10 },
      { seuilVues: 100_000, montant: 20 },
    ],
    cumulative: true,
  });

  const tpl = (await admin.query(api.pricing.listBonusTemplates, {})).find(
    (t) => t.name === nom,
  );
  if (tpl) await admin.mutation(api.pricing.deleteBonusTemplate, { id: tpl._id });
  await admin.mutation(api.pricing.cleanupTestPricings, { secret: E2E_SECRET });
});
