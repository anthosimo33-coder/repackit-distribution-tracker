import { test, expect, type Browser, type Page } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const rawUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!rawUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const url: string = rawUrl;
const admin = createE2eClient(url);
const DAY = 86_400_000;

/**
 * LE BLOC DÉFI — les CINQ ÉTATS, pas seulement le cas nominal.
 *
 * Un bloc qui n'est vérifié que quand tout va bien laisse ses cas limites muets
 * ou faux, et ce sont eux qu'une créatrice rencontre au pire moment : le jour où
 * le défi se termine, ou le jour où quelqu'un d'autre gagne.
 *
 * Les cinq états couverts :
 *   1. invitée, aucune vidéo → elle voit le défi, à zéro ;
 *   2. en cours, une autre a gagné mais il reste des places ;
 *   3. elle a gagné ;
 *   4. deadline passée, personne n'a franchi → « rien n'est versé », dit ;
 *   5. deadline passée avec des gagnantes.
 *
 * Plus l'invariant d'affichage : le classement est REPLIÉ à l'arrivée.
 */

/**
 * Une créatrice RIVALE — créée SANS navigateur.
 *
 * Elle n'a rien à regarder : lui ouvrir une page ne servirait qu'à emporter la
 * session de celle qu'on observe (cf. l'avertissement ci-dessous).
 */
async function rivalCreator(ts: number, name: string, tag: string) {
  const sess = await createCreatorSession(url, {
    name,
    email: `bloc-${tag}-${ts}@repackit.test`,
    password: `bloc-${tag}-12345`,
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: sess.creatorId,
    platform: "TikTok",
    handle: `@bloc${tag}${ts}`,
  });
  return { creatorId: sess.creatorId, target };
}

/**
 * Crée la créatrice OBSERVÉE et la connecte dans un CONTEXTE NAVIGATEUR À ELLE.
 *
 * ⚠️ Un contexte neuf, et pas la `page` par défaut du test : dès qu'un autre
 * compte est ouvert dans le même run (la rivale, via `createCreatorSession`), la
 * page par défaut se retrouve connectée en tant que CETTE autre personne. Le
 * bloc affichait alors l'état de la mauvaise créatrice — un « Tu as gagné 🎉 »
 * sur l'écran de celle qui n'avait rien gagné — et deux cas tombaient pour une
 * raison étrangère à ce qu'ils vérifient. Diagnostiqué en lisant le « Bonjour
 * … » de la page, pas déduit. C'est l'arrangement de
 * `creator-dashboard-action.spec.ts`, et voilà pourquoi il l'utilise.
 */
async function creatorInBrowser(
  browser: Browser,
  ts: number,
  name: string,
  tag: string,
) {
  const email = `bloc-${tag}-${ts}@repackit.test`;
  const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
    name,
    email,
  });
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await ctx.newPage();
  await page.goto(`/join/${token}`);
  await page.getByLabel("Mot de passe").fill(`bloc-${tag}-12345`);
  await page.getByRole("button", { name: /activer mon compte/i }).click();
  await page.waitForURL("**/app", { timeout: 30_000 });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId,
    platform: "TikTok",
    handle: `@bloc${tag}${ts}`,
  });
  return { creatorId, target, page };
}

async function makeChallenge(
  ts: number,
  tag: string,
  opts: {
    winnerRule: { kind: "first" } | { kind: "topN"; n: number } | { kind: "all" };
    targetViews?: number;
  },
) {
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] Bloc CPM ${tag} ${ts}`,
    montantFixe: 0,
    nbVideosCible: 1,
    tauxCPM: 2,
  });
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Bloc camp ${tag} ${ts}`,
  });
  const add = (kind: "hook" | "flux" | "cta", label: string) =>
    admin.mutation(api.scripts.createBrick, {
      campaignId,
      kind,
      label,
      content: `${label} texte`,
      ...(kind === "hook" ? { tier: "S" as const } : {}),
    });
  const h1 = await add("hook", `${tag} H1`);
  const flux = await add("flux", `${tag} F1`);
  const cta = await add("cta", `${tag} C1`);
  const { challengeId } = await admin.mutation(api.challenges.createChallenge, {
    name: `[E2E_TEST] Bloc ${tag} ${ts}`,
    targetViews: opts.targetViews ?? 50_000,
    mode: "cumulative",
    reward: { type: "cash", amount: 200 },
    winnerRule: opts.winnerRule,
    deadline: Date.now() + 10 * DAY,
    pricingId,
    material: {
      campaignId,
      hookBrickIds: [h1],
      fluxBrickId: flux,
      ctaBrickId: cta,
    },
  });
  return challengeId;
}

let seq = 0;
async function publishFor(
  challengeId: Id<"challenges">,
  creatorId: Id<"creators">,
  target: { platform: "TikTok" | "Instagram" | "YouTube"; accountId: Id<"comptes"> },
  vues: number,
) {
  seq += 1;
  const { assignmentId } = await admin.mutation(
    api.challenges.assignChallengeVideo,
    { challengeId, creatorId, targets: [target] },
  );
  await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
    secret: E2E_SECRET,
    id: assignmentId,
    status: "to_publish",
  });
  const postUrl = `https://www.tiktok.com/@bloc/video/${Date.now()}${seq}`;
  await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
    id: assignmentId,
    urls: [{ platform: "TikTok", url: postUrl }],
  });
  const pub = (
    await admin.query(api.publications.listPublications, {})
  ).find((p) => p.postUrl === postUrl)!;
  await admin.mutation(api.metricSnapshots.createSnapshot, {
    publicationId: pub._id,
    vues,
    likes: Math.round(vues / 28),
    capturedAt: Date.now(),
  });
}

test.describe("Bloc défi créatrice — les cinq états", () => {
  test("invitée sans vidéo : elle voit le défi, à zéro, classement REPLIÉ", async ({ browser }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const me = await creatorInBrowser(browser, ts, "Orlane", "vide");
    const page = me.page;
    const challengeId = await makeChallenge(ts, "Vide", {
      winnerRule: { kind: "first" },
    });
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [me.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });

    await page.reload();
    const card = page.getByTestId("challenge-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    // À zéro, mais PRÉSENTE : un défi doit se lire dès son ouverture.
    await expect(page.getByTestId("challenge-my-score")).toContainText("0");
    // Le classement est REPLIÉ — ce qu'elle voit d'abord, c'est SON score.
    await expect(page.getByTestId("challenge-leaderboard")).toHaveCount(0);
    // …et il s'ouvre au clic. Contrôle de PRÉSENCE apparié : sans lui,
    // « absent » serait aussi vrai si le classement n'existait pas du tout.
    await page.getByTestId("challenge-toggle-board").click();
    await expect(page.getByTestId("challenge-leaderboard")).toBeVisible();
    // Aucune issue à annoncer : rien de joué.
    await expect(page.getByTestId("challenge-i-won")).toHaveCount(0);
    await expect(page.getByTestId("challenge-over")).toHaveCount(0);
    await expect(page.getByTestId("challenge-others-won")).toHaveCount(0);
  });

  test("une AUTRE a gagné, il reste des places", async ({ browser }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const me = await creatorInBrowser(browser, ts, "Orlane", "autre");
    const page = me.page;
    const challengeId = await makeChallenge(ts, "Autre", {
      winnerRule: { kind: "topN", n: 3 },
    });
    // La gagnante : une créatrice à part, qui franchit. Créée SANS navigateur —
    // elle n'a rien à regarder, et lui ouvrir une page suffirait à emporter la
    // session de celle qu'on observe.
    const rivale = await rivalCreator(ts, "Kelly", "rivale");

    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [me.creatorId, rivale.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });
    await publishFor(challengeId, rivale.creatorId, rivale.target, 163_000);
    await publishFor(challengeId, me.creatorId, me.target, 15_000);
    await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });
    await page.reload();
    await expect(page.getByTestId("challenge-card")).toBeVisible({
      timeout: 30_000,
    });
    // Une place prise sur trois : on le dit, ET on dit qu'il en reste — c'est
    // l'information qui la fait continuer plutôt que renoncer.
    await expect(page.getByTestId("challenge-others-won")).toContainText(
      /1 place prise/i,
    );
    await expect(page.getByTestId("challenge-i-won")).toHaveCount(0);
    // Elle peut toujours produire.
    await expect(page.getByTestId("challenge-submit")).toBeVisible();
  });

  test("ELLE a gagné", async ({ browser }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const me = await creatorInBrowser(browser, ts, "Orlane", "gagne");
    const page = me.page;
    const challengeId = await makeChallenge(ts, "Gagne", {
      winnerRule: { kind: "first" },
      targetViews: 40_000,
    });
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [me.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });
    await publishFor(challengeId, me.creatorId, me.target, 51_200);
    await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });

    await page.reload();
    await expect(page.getByTestId("challenge-i-won")).toBeVisible({
      timeout: 30_000,
    });
    // La carte bascule en habillage clair : la victoire se voit sans lire.
    await expect(page.getByTestId("challenge-my-score")).toContainText("51");
  });

  test("deadline passée, PERSONNE n'a franchi : « rien n'est versé »", async ({ browser }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const me = await creatorInBrowser(browser, ts, "Orlane", "sansgagnante");
    const page = me.page;
    const challengeId = await makeChallenge(ts, "SansGagnante", {
      winnerRule: { kind: "all" },
      targetViews: 500_000,
    });
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [me.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });
    await publishFor(challengeId, me.creatorId, me.target, 8_177);
    // On rembobine la deadline : le défi est terminé, la barre jamais franchie.
    await admin.mutation(api.challenges.e2eSetChallengeDeadline, {
      secret: E2E_SECRET,
      id: challengeId,
      deadline: Date.now() - DAY,
    });
    await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });

    await page.reload();
    const over = page.getByTestId("challenge-over");
    await expect(over).toBeVisible({ timeout: 30_000 });
    // Le silence laisserait croire à un oubli : on DIT que rien n'est versé.
    await expect(over).toContainText(/rien n'est versé/i);
    // Et on ne lui propose plus de produire pour un défi fini.
    await expect(page.getByTestId("challenge-submit")).toHaveCount(0);
  });

  test("deadline passée AVEC des gagnantes", async ({ browser }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const me = await creatorInBrowser(browser, ts, "Orlane", "finiavec");
    const page = me.page;
    const challengeId = await makeChallenge(ts, "FiniAvec", {
      winnerRule: { kind: "all" },
      targetViews: 40_000,
    });
    const rivale = await rivalCreator(ts, "Kelly", "finirivale");
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [me.creatorId, rivale.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });
    await publishFor(challengeId, rivale.creatorId, rivale.target, 163_000);
    await publishFor(challengeId, me.creatorId, me.target, 12_400);
    await admin.mutation(api.challengeSync.evaluateChallengeNow, {
      id: challengeId,
    });
    await admin.mutation(api.challenges.e2eSetChallengeDeadline, {
      secret: E2E_SECRET,
      id: challengeId,
      deadline: Date.now() - DAY,
    });

    await page.reload();
    const over = page.getByTestId("challenge-over");
    await expect(over).toBeVisible({ timeout: 30_000 });
    await expect(over).toContainText(/1 gagnante/i);
    // CONTRÔLE apparié : ce n'est PAS le message « personne n'a franchi ».
    await expect(over).not.toContainText(/rien n'est versé/i);
    await expect(page.getByTestId("challenge-i-won")).toHaveCount(0);
  });
});
