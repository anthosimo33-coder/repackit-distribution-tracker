import { test, expect } from "./fixtures/auth-fixture";
import { adminPath, createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);
const DAY = 86_400_000;

/**
 * MINIMUM DE VUES PAR VIDÉO — « une vidéo doit faire au moins 200 vues pour
 * être payée à son prix ». Bout en bout, sur de l'ARGENT.
 *
 * Le moteur est couvert par les unitaires ; ici, la CHAÎNE : le minimum saisi
 * sur le barème est figé dans le snapshot, relu par le calcul du cycle, et la
 * vidéo fautive est nommée à la créatrice. Trois états d'une MÊME vidéo, dans
 * le même cycle : pas encore mesurée (payée), 143 vues (fixe à 0), 212 vues
 * (fixe dû). Deux vidéos séparées auraient pu passer avec un minimum ignoré.
 */
test("une vidéo sous le minimum perd son fixe, le retrouve en passant la barre", async () => {
  test.setTimeout(180_000);
  const ts = Date.now();
  const creator = await createCreatorSession(url, {
    name: `[E2E_TEST] Minimum Vidéo ${ts}`,
    email: `e2e-minvues-${ts}@repackit.test`,
    password: "creator-minvues-12345",
  });
  const projectId = creator.projectId;

  // Le barème de la demande : 240 pour 30 vidéos (8 par vidéo), fixe seul,
  // minimum 200 vues par vidéo.
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] 8 par vidéo min 200 ${ts}`,
    montantFixe: 240,
    nbVideosCible: 30,
    tauxCPM: 0,
    minVuesParVideo: 200,
  });

  const formatId = await createFormatWithRate(admin, {
    name: `[E2E_TEST] Format minimum ${ts}`,
    type: "short",
    rateModel: { basePerPost: 5 },
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: creator.creatorId,
    platform: "TikTok",
    handle: `@e2eminvues${ts}`,
  });
  await admin.mutation(api.assignments.assignFormat, {
    formatId,
    creatorId: creator.creatorId,
    targets: [target],
    postsPerCreator: 1,
    dueDate: ts + 5 * DAY,
    pricingId,
  });
  const assignmentId = (await admin.query(api.assignments.listAssignments, {}))
    .filter((a) => a.formatId === formatId && a.creatorId === creator.creatorId)
    .map((a) => a._id)[0];
  expect(assignmentId).toBeTruthy();

  // Le minimum est FIGÉ dans le snapshot, comme le reste du barème.
  const fige = (await admin.query(api.assignments.listAssignments, {})).find(
    (a) => a._id === assignmentId,
  );
  expect(fige?.pricingSnapshot?.minVuesParVideo).toBe(200);

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
          url: `https://www.tiktok.com/@e2eminvues${ts}/video/7300000000002${ts % 1000}`,
        },
      ],
    },
  );
  expect(publicationIds.length).toBeGreaterThan(0);

  const cycle = async () => {
    const rows = await creator.client.query(api.payments.getMyPayments, {
      projectId,
    });
    return rows.find((p) => p.cycleIndex === 0)!;
  };

  // ── PAS ENCORE MESURÉE — aucun relevé : on ne refuse pas un fixe sur une
  //    ignorance. Elle est payée, et rien ne la marque sous le minimum.
  const nonMesuree = await cycle();
  expect(nonMesuree.pricingBreakdown.fixedTotal).toBe(8);
  expect(nonMesuree.pricingBreakdown.perPricing[0].videosSousMinimum).toBe(0);

  // ── 143 VUES — mesurée, sous la barre : fixe à zéro, et la vidéo est
  //    nommée à la créatrice (sinon « 1 vidéo sous 200 vues » ne se vérifie pas).
  await admin.mutation(api.metricSnapshots.createSnapshot, {
    publicationId: publicationIds[0],
    capturedAt: Date.now(),
    vues: 143,
    likes: 4,
  });
  const sous = await cycle();
  expect(sous.pricingBreakdown.fixedTotal).toBe(0);
  const gSous = sous.pricingBreakdown.perPricing[0];
  expect(gSous.minVuesParVideo).toBe(200);
  expect(gSous.videosSousMinimum).toBe(1);
  expect(gSous.montantFixe).toBe(240); // le contrat, pas le budget effectif
  const ligne = sous.pricingBreakdown.perAssignment.find(
    (a) => a.assignmentId === assignmentId,
  )!;
  expect(ligne.sousMinimum).toBe(true);
  expect(ligne.totalViews).toBe(143);
  expect(sous.bonusVideos.map((v) => v.assignmentId)).toContain(assignmentId);

  // ── 212 VUES — la même vidéo passe la barre : 240 / 30 = 8.
  await admin.mutation(api.metricSnapshots.createSnapshot, {
    publicationId: publicationIds[0],
    capturedAt: Date.now() + 1_000,
    vues: 212,
    likes: 6,
  });
  const apres = await cycle();
  expect(apres.pricingBreakdown.fixedTotal).toBe(8);
  expect(apres.pricingBreakdown.perPricing[0].videosSousMinimum).toBe(0);

  await admin.mutation(api.assignments.cleanupTestAssignments, {
    secret: E2E_SECRET,
  });
});

test("écran Barèmes : activer le minimum (200 par défaut), le modifier, le retirer", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ts = Date.now();
  const nom = `[E2E_TEST] Barème minimum UI ${ts}`;

  await page.goto(adminPath("/pricings"));
  await page.getByRole("button", { name: "Nouveau pricing" }).click();
  const modale = page.getByRole("dialog");
  await modale.getByLabel("Nom").fill(nom);
  await modale.getByLabel(/^Montant fixe/).fill("240");
  await modale.getByLabel("Nb vidéos cible").fill("30");
  await modale.getByLabel(/^CPM/).fill("0");

  // Éteint par défaut : aucun champ de nombre tant qu'on n'active pas.
  await expect(modale.getByLabel("Nombre minimum de vues par vidéo")).toHaveCount(0);
  await modale.getByRole("switch", { name: "Minimum de vues par vidéo" }).click();
  const champ = modale.getByLabel("Nombre minimum de vues par vidéo");
  // 200 pré-rempli, la valeur demandée.
  await expect(champ).toHaveValue("200");
  await expect(modale.getByText(/199 vues → .*0[,.]00.* de fixe · 200 vues → .*8[,.]00/)).toBeVisible();
  await champ.fill("250");
  await modale.getByRole("button", { name: "Créer" }).click();
  await expect(modale).toHaveCount(0, { timeout: 15_000 });

  const cree = (await admin.query(api.pricing.listPricings, {})).find((p) => p.name === nom)!;
  expect(cree.minVuesParVideo).toBe(250);
  // La ligne de la liste le dit.
  await expect(page.getByText("min. 250 vues / vidéo")).toBeVisible();

  // Rouvert : l'interrupteur est allumé, la valeur relue — puis on le retire.
  await page.getByRole("button", { name: nom, exact: true }).click();
  const edition = page.getByRole("dialog");
  await expect(edition.getByLabel("Nombre minimum de vues par vidéo")).toHaveValue("250");
  await edition.getByRole("switch", { name: "Minimum de vues par vidéo" }).click();
  await edition.getByRole("button", { name: "Enregistrer" }).click();
  await expect(edition).toHaveCount(0, { timeout: 15_000 });

  const retire = (await admin.query(api.pricing.listPricings, {})).find((p) => p.name === nom)!;
  expect(retire.minVuesParVideo).toBe(0);
  await expect(page.getByText("min. 250 vues / vidéo")).toHaveCount(0);

  await admin.mutation(api.pricing.cleanupTestPricings, { secret: E2E_SECRET });
});
