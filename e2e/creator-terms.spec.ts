import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
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
 * « MON CONTRAT » — la créatrice relit le barème qui la PAIE.
 *
 * Ce que la spec tient :
 *   - le barème servi est celui rattaché à SA fiche, pas celui d'une autre, et
 *     son nom interne ne sort pas ;
 *   - la page ne montre que ce que le contrat contient (pas de bloc « vues »
 *     sur un CPM à 0) et rappelle les règles qui s'y appliquent ;
 *   - la position du cycle vient du moteur de paie : la meilleure vidéo, le
 *     palier franchi, ce qu'il manque pour le suivant ;
 *   - on y arrive depuis Gains (carte) et depuis Mes paiements (lien).
 *
 * Forme de la prod : le barème de Juliette (fixe 700 / 60 vidéos, CPM 0, grille
 * par vidéo non cumulable), une vidéo relevée à un nombre de vues non rond.
 */
test("Mon contrat : le barème de la fiche, sa position, et les portes d'entrée", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const ts = Date.now();
  const a = await createCreatorSession(url, {
    name: `[E2E_TEST] Contrat A ${ts}`,
    email: `e2e-contrat-a-${ts}@repackit.test`,
    password: "contrat-a-12345",
  });
  const b = await createCreatorSession(url, {
    name: `[E2E_TEST] Contrat B ${ts}`,
    email: `e2e-contrat-b-${ts}@repackit.test`,
    password: "contrat-b-12345",
  });
  const projectId = a.projectId;

  const nomInterne = `[E2E_TEST] Juliette Nouveau Contrat ${ts}`;
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: nomInterne,
    montantFixe: 700,
    nbVideosCible: 60,
    tauxCPM: 0,
    // Saisie dans le désordre : la page la rend triée.
    videoBonus: {
      cumulative: false,
      tiers: [
        { seuilVues: 100_000, montant: 80 },
        { seuilVues: 10_000, montant: 10 },
        { seuilVues: 50_000, montant: 40 },
        { seuilVues: 250_000, montant: 150 },
        { seuilVues: 500_000, montant: 250 },
        { seuilVues: 1_000_000, montant: 400 },
      ],
    },
  });
  const { pricingId: autre } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] CPM Kelly ${ts}`,
    montantFixe: 0,
    nbVideosCible: 30,
    tauxCPM: 1.25,
  });
  await admin.mutation(api.creators.updateCreatorPayTerms, {
    id: a.creatorId,
    bonusPricingId: pricingId,
  });
  await admin.mutation(api.creators.updateCreatorPayTerms, {
    id: b.creatorId,
    bonusPricingId: autre,
  });

  // ── SERVEUR : chacune son barème ──────────────────────────────────────────
  const termsA = await a.client.query(api.creatorTerms.getMyTerms, { projectId });
  expect(termsA.pricing).toMatchObject({
    pricingId,
    montantFixe: 700,
    nbVideosCible: 60,
    tauxCPM: 0,
    seuilVuesFixe: 0,
    hasCumulTiers: false,
    videoBonus: {
      cumulative: false,
      tiers: [
        { seuilVues: 10_000, montant: 10 },
        { seuilVues: 50_000, montant: 40 },
        { seuilVues: 100_000, montant: 80 },
        { seuilVues: 250_000, montant: 150 },
        { seuilVues: 500_000, montant: 250 },
        { seuilVues: 1_000_000, montant: 400 },
      ],
    },
  });
  // Le nom du barème est le libellé de l'équipe : il ne sort pas.
  expect(JSON.stringify(termsA)).not.toContain(nomInterne);
  const termsB = await b.client.query(api.creatorTerms.getMyTerms, { projectId });
  expect(termsB.pricing?.pricingId).toBe(autre);
  expect(termsB.pricing?.tauxCPM).toBe(1.25);
  expect(termsB.pricing?.videoBonus).toBeNull();

  // ── Une vidéo publiée sur ce barème, relevée à 123 457 vues ───────────────
  const formatId = await createFormatWithRate(admin, {
    name: `[E2E_TEST] Format contrat ${ts}`,
    type: "short",
    rateModel: { basePerPost: 0 },
  });
  const handle = `@e2econtrat${ts}`;
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: a.creatorId,
    platform: "TikTok",
    handle,
  });
  await admin.mutation(api.assignments.assignFormat, {
    formatId,
    creatorId: a.creatorId,
    targets: [target],
    postsPerCreator: 1,
    dueDate: ts + 5 * DAY,
    pricingId,
  });
  const assignmentId = (await admin.query(api.assignments.listAssignments, {})).find(
    (x) => x.formatId === formatId,
  )!._id as Id<"assignments">;
  await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
    secret: E2E_SECRET,
    id: assignmentId,
    status: "to_publish",
  });
  const { publicationIds } = await a.client.mutation(api.assignments.confirmPublication, {
    projectId,
    id: assignmentId,
    urls: [{ platform: "TikTok", url: `https://www.tiktok.com/${handle}/video/73000000000${ts % 100000}` }],
  });
  await admin.mutation(api.metricSnapshots.createSnapshot, {
    publicationId: publicationIds[0],
    capturedAt: Date.now(),
    vues: 123_457,
    likes: 3_982,
  });

  // ── ÉCRAN « Mon contrat » (vue admin de l'espace, même écran) ─────────────
  const base = `/admin/voir/e2e-test/${a.creatorId}`;
  await page.goto(`${base}/contrat`);
  await expect(page.getByRole("heading", { level: 1, name: "Mon contrat" })).toBeVisible({
    timeout: 20_000,
  });

  const fixe = page.getByTestId("terms-fixe");
  await expect(fixe).toContainText("700");
  await expect(fixe).toContainText("pour 60 vidéos");
  await expect(fixe).toContainText("11,67");
  await expect(fixe).toContainText("1 / 60 ce cycle");
  // CPM à 0 : pas de bloc « vues », pas de règle de plafond.
  await expect(page.getByTestId("terms-cpm")).toHaveCount(0);

  const grille = page.getByTestId("terms-video-bonus");
  await expect(grille.locator('li[data-state="done"]')).toHaveCount(3);
  const prochain = grille.locator('li[data-state="next"]');
  await expect(prochain).toHaveCount(1);
  await expect(prochain).toContainText("250 000 vues");
  await expect(prochain).toContainText("encore 126 543");
  await expect(page.getByTestId("terms-best-video")).toContainText(
    `[E2E_TEST] Format contrat ${ts}, 123 457 vues`,
  );

  const regles = await page
    .getByTestId("terms-rules")
    .locator("li[data-rule]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-rule")));
  expect(regles).toEqual([
    "platformsAdd",
    "window30",
    "warmupNoBonus",
    "highestTierOnly",
    "paidEvery30",
  ]);
  await expect(page.getByText(nomInterne)).toHaveCount(0);

  // ── PORTES D'ENTRÉE : la carte de Gains, le lien de Mes paiements ─────────
  await page.goto(`${base}/gains`);
  const carte = page.getByTestId("gains-contract");
  await expect(carte).toContainText("700 / 60 vidéos");
  await expect(carte).toContainText("Bonus jusqu'à 400 / vidéo");
  await carte.click();
  await expect(page).toHaveURL(new RegExp(`${base}/contrat$`));

  await page.goto(`${base}/paiements`);
  await expect(page.getByTestId("see-grid")).toHaveAttribute("href", `${base}/contrat`);

  await admin.mutation(api.assignments.cleanupTestAssignments, { secret: E2E_SECRET });
});
