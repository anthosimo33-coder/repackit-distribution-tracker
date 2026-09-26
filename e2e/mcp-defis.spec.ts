import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

type Sortie = { text: string; isError: boolean };
async function outil(url: string, token: string, args: Record<string, unknown>): Promise<Sortie> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "defis", arguments: args } }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { text: result.content[0].text, isError: result.isError === true };
}

type Detail = {
  defi: string;
  statut: string;
  participantes: number;
  victoires: number;
  termine: boolean;
  recompense: { type: string; montantParGagnante?: number | null };
  classement: { rang: number; createatrice: string; score: number; videosComptees: number; aFranchiLObjectif: boolean }[];
  victoiresActees: { position: number; createatrice: string; scoreAuMomentDeGagner: number }[];
  gagneraientMaintenant: { createatrice: string; score: number }[];
};

/**
 * Outil MCP `defis` — l'écran Défis, par les MÊMES lectures (`listChallenges`,
 * `getChallenge`, `previewChallengeWinners`).
 *
 * Un défi « les 2 premières » à 30 000 vues cumulées, trois participantes :
 * Kelly 12 400 + 21 300 = 33 700, Marine 31 250 (franchissent), Inès 8 900.
 */
test.describe("Outil MCP defis", () => {
  test("liste, classement, qui gagnerait maintenant, puis les victoires actées", async ({ page }) => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const creatrice = async (prenom: string) => {
      const c = await createCreatorSession(convexUrl!, {
        name: `[E2E_TEST] ${prenom} ${ts}`,
        email: `e2e-mcp-defi-${prenom.toLowerCase()}-${ts}@repackit.test`,
        password: `defi-${prenom.toLowerCase()}-12345`,
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: c.creatorId,
        platform: "TikTok",
        handle: `@${prenom.toLowerCase()}.defi_${ts}`,
      });
      return { ...c, target, nom: `[E2E_TEST] ${prenom} ${ts}` };
    };
    const [kelly, marine, ines] = [await creatrice("Kelly"), await creatrice("Marine"), await creatrice("Ines")];
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] MCP Défi ${ts}`,
      montantFixe: 0,
      nbVideosCible: 1,
      tauxCPM: 2,
    });
    const nomDefi = `[E2E_TEST] Défi rentrée ${ts}`;
    const { challengeId } = await admin.mutation(api.challenges.createChallenge, {
      name: nomDefi,
      targetViews: 30_000,
      mode: "cumulative",
      reward: { type: "cash", amount: 200 },
      winnerRule: { kind: "topN", n: 2 },
      deadline: ts + 14 * DAY,
      pricingId,
      script: "[E2E_TEST] script du défi.",
    });
    await admin.mutation(api.challenges.setChallengeParticipants, {
      id: challengeId,
      creatorIds: [kelly.creatorId, marine.creatorId, ines.creatorId],
    });
    await admin.mutation(api.challenges.openChallenge, { id: challengeId });
    let n = 0;
    const publier = async (who: typeof kelly, vues: number) => {
      const { assignmentId } = await who.client.mutation(api.challengePortal.startChallengeVideo, {
        projectId: who.projectId,
        challengeId,
        targets: [who.target as { platform: "TikTok"; accountId: Id<"comptes"> }],
      });
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, { secret: E2E_SECRET, id: assignmentId, status: "to_publish" });
      const postUrl = `https://www.tiktok.com/@e2edefi/video/78${ts}${n++}`;
      await admin.mutation(api.assignments.confirmPublicationAsAdmin, { id: assignmentId, urls: [{ platform: "TikTok", url: postUrl }] });
      const pub = (await admin.query(api.publications.listPublications, {})).find((p) => p.postUrl === postUrl)!;
      await admin.mutation(api.metricSnapshots.createSnapshot, { publicationId: pub._id, vues, likes: Math.round(vues / 28), capturedAt: Date.now() });
    };
    await publier(kelly, 12_400);
    await publier(kelly, 21_300);
    await publier(marine, 31_250);
    await publier(ines, 8_900);

    // ── Une clé, depuis l'écran ─────────────────────────────────────────────
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(`E2E défis ${ts}`);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];

    // ── Avant l'évaluation : le classement, et qui gagnerait maintenant ─────
    const avant = await outil(url, token, { projet: "e2e-test", defi: `Défi rentrée ${ts}` });
    expect(avant.isError, avant.text).toBe(false);
    const d0 = JSON.parse(avant.text) as Detail;
    expect(d0).toMatchObject({ defi: nomDefi, statut: "ouvert", participantes: 3, victoires: 0, termine: false });
    expect(d0.recompense).toEqual({ type: "argent", montantParGagnante: 200 });
    expect(d0.classement.map((c) => [c.rang, c.createatrice, c.score, c.videosComptees, c.aFranchiLObjectif])).toEqual([
      [1, kelly.nom, 33_700, 2, true],
      [2, marine.nom, 31_250, 1, true],
      [3, ines.nom, 8_900, 1, false],
    ]);
    expect(d0.gagneraientMaintenant.map((g) => g.createatrice).sort()).toEqual([kelly.nom, marine.nom].sort());

    // Le classement de l'écran, champ par champ.
    const ecran = (await admin.query(api.challenges.getChallenge, { id: challengeId }))!;
    expect(d0.classement.map((c) => [c.createatrice, c.score])).toEqual(ecran.ranking.map((r) => [r.name, r.score]));

    // ── Victoires actées (le relevé nocturne) : places prises, défi terminé ─
    expect((await admin.mutation(api.challengeSync.evaluateChallengeNow, { id: challengeId })).won).toBe(2);
    const apres = JSON.parse((await outil(url, token, { projet: "e2e-test", defi: nomDefi })).text) as Detail & {
      victoires: number;
    };
    expect(apres).toMatchObject({ victoires: 2, termine: true });
    expect(apres.victoiresActees.map((v) => v.position)).toEqual([1, 2]);
    expect(apres.victoiresActees.map((v) => v.createatrice).sort()).toEqual([kelly.nom, marine.nom].sort());
    expect(apres.gagneraientMaintenant).toEqual([]);

    // ── La liste : le défi y est, avec ses compteurs ───────────────────────
    const liste = JSON.parse((await outil(url, token, { projet: "e2e-test" })).text) as { defis: Detail[] };
    expect(liste.defis).toContainEqual(expect.objectContaining({ defi: nomDefi, participantes: 3, victoires: 2, termine: true }));

    // ── Un nom qui en désigne deux : refus, avec les choix ─────────────────
    await admin.mutation(api.challenges.createChallenge, {
      name: `${nomDefi} — bis`,
      targetViews: 30_000,
      mode: "cumulative",
      reward: { type: "nature", libelle: "iPhone 17", coutReel: 1_129 },
      winnerRule: { kind: "first" },
      deadline: ts + 14 * DAY,
      pricingId,
      script: "[E2E_TEST] bis.",
    });
    const ambigu = await outil(url, token, { projet: "e2e-test", defi: `Défi rentrée ${ts}` });
    expect(ambigu.isError).toBe(true);
    expect(ambigu.text).toContain(`${nomDefi} — bis`);
  });
});
