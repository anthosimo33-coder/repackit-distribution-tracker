import { ConvexHttpClient } from "convex/browser";
import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function outil(url: string, token: string, name: string, args: Record<string, unknown>) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError === true, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text);
}

/**
 * RECRUES À TRANCHER — la carte du Dashboard (convex/recruitTrial.ts), de la
 * base jusqu'au clic, et l'outil MCP `dashboard` qui lit le même calcul.
 *
 * Quatre créatrices, comme sur Snytch le 08/10/2026 :
 *  - « Sarah » : 10 vidéos TikTok + Instagram, la 10e il y a 9 jours, aucune
 *    publication à 10 000 (meilleure 1 393) → ARRÊTER ;
 *  - « Quentin » : 3 vidéos, un reel Instagram à 15 347 (216 sur TikTok) →
 *    GARDER, sans attendre la 10e ;
 *  - « Elena » : 10 vidéos, la 10e il y a 8 jours, la dernière jamais relevée
 *    → verdict SUSPENDU, pas « arrêter » ;
 *  - « Thania » : 9 vidéos anciennes sous le seuil → ABSENTE (rien à trancher) ;
 *  - « Mewen » : 2 vidéos, la 2e publiée il y a 6 h — 8 912 au relevé de nuit,
 *    10 450 au relevé rapide → GARDER : le relevé le plus récent porte le
 *    verdict.
 */
test.describe("Recrues à trancher", () => {
  test("la carte propose, le clic enregistre (et s'annule), Claude lit la même liste", async ({ page }) => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const slug = `e2e-recrues-${ts}`;
    const nom = `E2E Recrues ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] Recrues ${ts}`,
        montantFixe: 100,
        nbVideosCible: 10,
        tauxCPM: 0,
      });
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] Recrues ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });

      /**
       * Une créatrice, ses comptes, et `vues.length` vidéos publiées une par jour
       * à partir de `debutJours` jours avant. Chaque vidéo : [vues TikTok, vues
       * Instagram] — `null` = publication jamais relevée, `undefined` = pas
       * publiée sur Instagram.
       */
      async function creatrice(prenom: string, vues: [number | null, (number | null)?][], debutJours: number) {
        const publications: Id<"publications">[][] = [];
        const email = `e2e-recrue-${prenom.toLowerCase()}-${ts}@repackit.test`;
        const name = `[E2E_TEST] ${prenom} Lefèvre ${ts}`;
        const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, { projectId, name, email });
        await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
          provider: "password",
          params: { email, password: `recrue-${ts}-12345`, flow: "signUp", inviteToken: token },
        });
        const tt = `@${prenom.toLowerCase()}.snytch_${ts}`;
        const ig = `@${prenom.toLowerCase()}_snytch_${ts}`;
        const targets = [
          await availableTarget({ e2eClient: admin, creatorId, platform: "TikTok", handle: tt }),
          await availableTarget({ e2eClient: admin, creatorId, platform: "Instagram", handle: ig }),
        ];
        await admin.mutation(api.assignments.assignFormat, {
          projectId,
          formatId,
          creatorId,
          targets,
          postsPerCreator: vues.length,
          dueDate: ts + 7 * DAY,
          pricingId,
        });
        const lignes = (await admin.query(api.assignments.listAssignments, { projectId })).filter(
          (a) => a.creatorId === creatorId,
        );
        expect(lignes).toHaveLength(vues.length);
        for (const [i, [vTt, vIg]] of vues.entries()) {
          const publieLe = ts - (debutJours - i) * DAY - 37 * 60_000;
          const urls: { platform: "TikTok" | "Instagram"; url: string }[] = [
            { platform: "TikTok", url: `https://www.tiktok.com/${tt}/video/75${ts}${i}` },
          ];
          if (vIg !== undefined) urls.push({ platform: "Instagram", url: `https://www.instagram.com/reel/C${ts}${i}x/` });
          const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
            projectId,
            id: lignes[i]._id,
            urls,
            publishedAt: publieLe,
            allowBackdate: true,
          });
          const ids = (pub.publicationIds ?? []) as Id<"publications">[];
          publications.push(ids);
          for (const [k, v] of [vTt, vIg].entries()) {
            if (v === null || v === undefined) continue;
            await admin.mutation(api.metricSnapshots.createSnapshot, {
              projectId,
              publicationId: ids[k],
              vues: v,
              likes: Math.round(v * 0.07),
              // Relevé de nuit 20 h après la publication — jamais dans le futur.
              capturedAt: Math.min(publieLe + 20 * HOUR, ts - 2 * HOUR),
            });
          }
        }
        return { creatorId, name, publications };
      }

      const sarah = await creatrice(
        "Sarah",
        [[811, 1_346], [1_393, 98], [790, 247], [711, 163], [478, 148], [353, 141], [344, 135], [320, 120], [281, 0], [1_199, 1_173]],
        18,
      );
      const quentin = await creatrice("Quentin", [[816, 270], [216, 15_347], [1_630, 2_551]], 5);
      const elena = await creatrice(
        "Elena",
        [[412, 5_955], [389, 208], [512, 233], [298, 410], [377, 129], [455, 301], [268, 187], [301, 222], [349, 180], [433, null]],
        17,
      );
      const thania = await creatrice(
        "Thania",
        [[936, 64], [890, 67], [4_187, 309], [3_462, 256], [1_208, 91], [793, 126], [1_398, 175], [281, 46], [316, 52]],
        30,
      );

      // Mewen : 2e vidéo à 6 h, publiée à 0,25 j (6 h) avant — 8 912 la nuit.
      const mewen = await creatrice("Mewen", [[1_410, 109], [8_912, 1_937]], 0.25 + 1);
      const avantRapide = await (async () => {
        await admin.mutation(api.dashboardDecisions.e2eRefreshDecisionsCache, { secret: E2E_SECRET, projectId });
        return admin.query(api.dashboardDecisions.decisionDashboard, { projectId });
      })();
      expect(avantRapide.recruits.some((r) => r.creatorId === mewen.creatorId)).toBe(false);
      // Relevé RAPIDE, écrit par le même chemin que le cron : 10 450 vues.
      const releveRapide = ts - 30 * 60_000;
      await admin.mutation(api.earlyReadings.e2eRecordEarlyPass, {
        secret: E2E_SECRET,
        readings: [
          {
            publicationId: mewen.publications[1][0],
            capturedAt: releveRapide,
            postedAt: ts - 6 * HOUR - 37 * 60_000,
            postedAtSource: "datePubli",
            vues: 10_450,
            likes: 1_098,
            comments: 12,
            saves: 31,
            source: "tiktok",
          },
        ],
        attempts: [{ publicationId: mewen.publications[1][0], at: releveRapide, outcome: "read" }],
      });

      // Le cron de cache (30 min) peut avoir figé l'état d'avant : on recalcule.
      await admin.mutation(api.dashboardDecisions.e2eRefreshDecisionsCache, { secret: E2E_SECRET, projectId });
      const d = await admin.query(api.dashboardDecisions.decisionDashboard, { projectId });
      expect(d.recruits.map((r) => [r.creatorName, r.proposed])).toEqual([
        [mewen.name, "keep"],
        [quentin.name, "keep"],
        [sarah.name, "stop"],
        [elena.name, "incomplete"],
      ]);
      expect(d.recruits[0].best).toMatchObject({ vues: 10_450, plateforme: "TikTok" });
      // Une seule publication porte le verdict — jamais la somme des plateformes.
      expect(d.recruits[1].best).toMatchObject({ vues: 15_347, plateforme: "Instagram" });
      expect(d.recruits[2].best).toMatchObject({ vues: 1_393, plateforme: "TikTok" });
      expect(d.recruits[2]).toMatchObject({ videos: 10, unmeasured: 0 });
      expect(d.recruits[3]).toMatchObject({ videos: 10, unmeasured: 1 });
      expect(d.recruits.some((r) => r.creatorId === thania.creatorId)).toBe(false);

      // ── Le digest Telegram du matin : éteint par défaut, puis la même liste ──
      const eteint = await admin.mutation(api.notifications.e2eCollectDigest, { secret: E2E_SECRET, projectId });
      expect(eteint?.sections.recruesATrancher).toEqual([]);
      await admin.mutation(api.notifications.setNotifySettings, {
        projectId,
        chatId: "-1001234567890",
        enabledEvents: ["digest_recrues_a_trancher"],
      });
      const digest = await admin.mutation(api.notifications.e2eCollectDigest, { secret: E2E_SECRET, projectId });
      expect(digest?.sections.recruesATrancher).toEqual([
        { creatorName: mewen.name, proposition: "garder" },
        { creatorName: quentin.name, proposition: "garder" },
        { creatorName: sarah.name, proposition: "arrêter" },
        { creatorName: elena.name, proposition: "suspendu" },
      ]);

      // ── L'écran ─────────────────────────────────────────────────────────────
      await page.goto(`/admin/${slug}/dashboard`);
      await expect(page.getByText("Recrues à trancher")).toBeVisible();
      // Une ligne du groupe « Recrues à trancher » — le nom de la créatrice
      // figure aussi dans ses alarmes de compte, d'où le conteneur.
      const ligne = (name: string) =>
        page
          .getByTestId("recrues-a-trancher")
          .locator("div.flex.items-center.justify-between.gap-3.py-2\\.5")
          .filter({ hasText: name });
      await expect(ligne(sarah.name)).toContainText(/Proposé : arrêter — 10 vidéos, la meilleure publication à 1\s?393 vues \(TikTok/);
      await expect(ligne(quentin.name)).toContainText(/Proposé : garder — 15\s?347 vues sur Instagram/);
      await expect(ligne(elena.name)).toContainText(/Verdict suspendu — 1 publication du test sans relevé/);
      await expect(ligne(thania.name)).toHaveCount(0);

      // Arrêter Sarah : enregistré, la ligne sort tout de suite.
      await ligne(sarah.name).getByRole("button", { name: "Arrêter" }).click();
      await expect(page.getByText(`${sarah.name} — décision enregistrée : arrêter`)).toBeVisible();
      await expect(ligne(sarah.name)).toHaveCount(0);
      const apres = (await admin.query(api.creators.listCreators, { projectId })).find((c) => c._id === sarah.creatorId);
      expect(apres?.trialDecision?.decision).toBe("stop");
      // Rien d'autre n'a bougé : la fiche reste active.
      expect(apres?.status).not.toBe("churned");
      expect(apres?.status).not.toBe("paused");

      // « Annuler » remet la décision à vide et la ligne revient.
      await page.getByRole("button", { name: "Annuler" }).click();
      await expect(ligne(sarah.name)).toBeVisible();
      const annule = (await admin.query(api.creators.listCreators, { projectId })).find((c) => c._id === sarah.creatorId);
      expect(annule?.trialDecision).toBeNull();

      // Garder Quentin, pour que Claude lise une décision enregistrée.
      await ligne(quentin.name).getByRole("button", { name: "Garder" }).click();
      await expect(ligne(quentin.name)).toHaveCount(0);

      // ── Claude lit la même chose ────────────────────────────────────────────
      await page.goto(`/admin/${slug}/comptes`);
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E recrues ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];

      const dash = await outil(url, token, "dashboard", { projet: slug });
      expect(dash.aDecider.recruesATrancher.map((r: { createatrice: string; proposition: string }) => [r.createatrice, r.proposition])).toEqual([
        [mewen.name, "garder"],
        [sarah.name, "arrêter"],
        [elena.name, "suspendu : mesure incomplète"],
      ]);
      expect(dash.aDecider.recruesATrancher[1]).toMatchObject({
        videosDuTest: 10,
        publicationsSansReleve: 0,
        meilleurePublication: { vues: 1_393, plateforme: "TikTok" },
      });
      const fiches = await outil(url, token, "createatrices", { projet: slug });
      const q = fiches.createatrices.find((c: { nom: string }) => c.nom === quentin.name);
      expect(q.decisionDeFinDeTest).toMatchObject({ decision: "garder" });
      const s = fiches.createatrices.find((c: { nom: string }) => c.nom === sarah.name);
      expect(s.decisionDeFinDeTest).toBeNull();
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});
