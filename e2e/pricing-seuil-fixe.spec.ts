import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
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
 * FIXE CONDITIONNÉ À UN VOLUME DE VUES — bout en bout, sur de l'ARGENT.
 *
 * « 700 $ pour 60 vidéos, à condition de 100 000 vues cumulées sur le mois. »
 * Le moteur est couvert par les unitaires ; ce que cette spec ajoute est la
 * CHAÎNE : le seuil saisi sur le barème est-il figé dans le snapshot, relu par
 * le calcul du cycle, et rendu à la créatrice dans son espace ?
 *
 * ⚠️ LE CAS QUI COMPTE EST LE PASSAGE. On ne vérifie pas deux états séparés mais
 * la BASCULE d'un même cycle : sous le seuil il vaut 0, les vues montent, il
 * vaut 700. Deux cycles distincts auraient pu passer avec un seuil ignoré.
 */
test("le fixe vaut 0 sous le seuil, et bascule quand les vues arrivent", async () => {
  test.setTimeout(180_000);
  const ts = Date.now();
  const creator = await createCreatorSession(url, {
    name: `[E2E_TEST] Seuil ${ts}`,
    email: `e2e-seuil-${ts}@repackit.test`,
    password: "creator-seuil-12345",
  });
  const projectId = creator.projectId;

  // Barème du contrat : fixe SEUL (pas de CPM), conditionné à 100 000 vues.
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Contrat conditionné ${ts}`,
    montantFixe: 700,
    nbVideosCible: 60,
    tauxCPM: 0,
    seuilVuesFixe: 100_000,
  });

  const formatId = await createFormatWithRate(admin, {
    name: `[E2E_TEST] Format seuil ${ts}`,
    type: "short",
    rateModel: { basePerPost: 5 },
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: creator.creatorId,
    platform: "TikTok",
    handle: `@e2eseuil${ts}`,
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

  // Le seuil est FIGÉ dans le snapshot, comme le reste du barème.
  const fige = (await admin.query(api.assignments.listAssignments, {})).find(
    (a) => a._id === assignmentId,
  );
  expect(fige?.pricingSnapshot?.seuilVuesFixe).toBe(100_000);

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
          url: `https://www.tiktok.com/@e2eseuil${ts}/video/7300000000000${ts % 1000}`,
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

  // ── SOUS LE SEUIL — 99 000 vues, à mille près. Le travail est livré, la
  //    vidéo publiée, et pourtant rien n'est dû : c'est le contrat.
  await admin.mutation(api.metricSnapshots.createSnapshot, {
    publicationId: publicationIds[0],
    capturedAt: Date.now(),
    vues: 99_000,
    likes: 3_000,
  });
  const avant = await cycle();
  expect(avant.pricingBreakdown.fixedTotal).toBe(0);
  expect(avant.pricingBreakdown.total).toBe(0);
  // …et la créatrice VOIT pourquoi : le groupe porte son seuil, ses vues, et
  // le contrat annoncé — « 0 sur 700 », jamais « 0 sur 0 ».
  const gAvant = avant.pricingBreakdown.perPricing[0];
  expect(gAvant.seuilVuesFixe).toBe(100_000);
  expect(gAvant.groupViews).toBe(99_000);
  expect(gAvant.fixeBloque).toBe(true);
  expect(gAvant.montantFixe).toBe(700);

  // ── LES VUES ARRIVENT — 101 000. Le même cycle bascule.
  await admin.mutation(api.metricSnapshots.createSnapshot, {
    publicationId: publicationIds[0],
    capturedAt: Date.now() + 1_000,
    vues: 101_000,
    likes: 3_100,
  });
  const apres = await cycle();
  // Une vidéo sur 60 → 700/60 = 11,67 $. Le seuil DÉBLOQUE le fixe, il ne le
  // multiplie pas : le pro rata des vidéos livrées s'applique comme avant.
  expect(apres.pricingBreakdown.fixedTotal).toBe(11.67);
  const gApres = apres.pricingBreakdown.perPricing[0];
  expect(gApres.fixeBloque).toBe(false);
  expect(gApres.groupViews).toBe(101_000);

  await admin.mutation(api.assignments.cleanupTestAssignments, {
    secret: E2E_SECRET,
  });
});

test("un barème SANS seuil paie exactement comme avant", async () => {
  // Contre-épreuve : sans elle, un moteur qui bloquerait tout passerait le cas
  // précédent aussi bien qu'un moteur juste.
  test.setTimeout(180_000);
  const ts = Date.now();
  const creator = await createCreatorSession(url, {
    name: `[E2E_TEST] SansSeuil ${ts}`,
    email: `e2e-sanseuil-${ts}@repackit.test`,
    password: "creator-sanseuil-12345",
  });
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Contrat libre ${ts}`,
    montantFixe: 700,
    nbVideosCible: 60,
    tauxCPM: 0,
  });
  const formatId = await createFormatWithRate(admin, {
    name: `[E2E_TEST] Format sans seuil ${ts}`,
    type: "short",
    rateModel: { basePerPost: 5 },
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: creator.creatorId,
    platform: "TikTok",
    handle: `@e2esanseuil${ts}`,
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
  await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
    secret: E2E_SECRET,
    id: assignmentId,
    status: "to_publish",
  });
  const { publicationIds } = await creator.client.mutation(
    api.assignments.confirmPublication,
    {
      projectId: creator.projectId,
      id: assignmentId,
      urls: [
        {
          platform: "TikTok",
          url: `https://www.tiktok.com/@e2esanseuil${ts}/video/7300000000001${ts % 1000}`,
        },
      ],
    },
  );
  await admin.mutation(api.metricSnapshots.createSnapshot, {
    publicationId: publicationIds[0],
    capturedAt: Date.now(),
    vues: 12,
    likes: 1,
  });
  const cur = (
    await creator.client.query(api.payments.getMyPayments, {
      projectId: creator.projectId,
    })
  ).find((p) => p.cycleIndex === 0)!;
  // Douze vues, et le fixe est dû quand même : aucun seuil ne le conditionne.
  expect(cur.pricingBreakdown.fixedTotal).toBe(11.67);
  expect(cur.pricingBreakdown.perPricing[0].seuilVuesFixe).toBe(0);
  expect(cur.pricingBreakdown.perPricing[0].fixeBloque).toBe(false);

  await admin.mutation(api.assignments.cleanupTestAssignments, {
    secret: E2E_SECRET,
  });
});
