import { ConvexHttpClient } from "convex/browser";
import { createHash, randomBytes } from "node:crypto";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
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

async function outil(url: string, token: string, args: Record<string, unknown>) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dashboard", arguments: args } }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  expect(result.isError === true, result.content[0].text).toBe(false);
  return JSON.parse(result.content[0].text);
}

/** Une clé posée directement pour un utilisateur sans session dans la spec. */
async function clePour(email: string, name: string): Promise<string> {
  const token = `jv_${randomBytes(32).toString("base64url")}`;
  await admin.mutation(api.mcpTokens.e2eInsertMcpToken, {
    secret: E2E_SECRET,
    email,
    name,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    prefix: token.slice(0, 10),
  });
  return token;
}

/**
 * Outil MCP `dashboard` — l'accueil de l'app, par les MÊMES calculs
 * (convex/dashboardActions pour les cartes, decisionDashboard + groupRecentPosts
 * pour « À décider » et les 48 h).
 *
 * Une créatrice, sept vidéos au CPM : cinq publiées il y a 2,5 à 6,5 jours, toutes
 * sous les seuils (≤ 2 450 vues, ~2 % de likes) → alarme de compte ; une publiée il
 * y a 6 h (2 310 vues, elle « monte ») ; une en attente de validation. Deux comptes
 * en warmup : l'un démarré il y a 4 jours sans un seul check (en retard), l'autre
 * il y a 9 jours avec ses 7 checks (terminé, à valider).
 */
test.describe("Outil MCP dashboard", () => {
  test("cartes d'action, alarme de compte, posts des 48 h ; un bloc manquant ne masque que sa section", async ({ page }) => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const slug = `e2e-mcp-dash-${ts}`;
    const nom = `E2E MCP Dashboard ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: 0.86,
      });
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] MCP Dash ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 2,
      });
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] MCP Dash ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });
      const email = `e2e-mcp-dash-${ts}@repackit.test`;
      const nomCreatrice = `[E2E_TEST] Inès Moreau ${ts}`;
      const { creatorId, token: invite } = await admin.mutation(api.creators.inviteCreator, {
        projectId,
        name: nomCreatrice,
        email,
      });
      await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
        provider: "password",
        params: { email, password: `dash-${ts}-12345`, flow: "signUp", inviteToken: invite },
      });
      const handle = `@ines.moreau_${ts}`;
      const target = await availableTarget({ e2eClient: admin, creatorId, platform: "TikTok", handle });
      await admin.mutation(api.assignments.assignFormat, {
        projectId,
        formatId,
        creatorId,
        targets: [target],
        postsPerCreator: 7,
        dueDate: ts + 7 * DAY,
        pricingId,
      });
      const lignes = (await admin.query(api.assignments.listAssignments, { projectId })).filter(
        (a) => a.creatorId === creatorId,
      );
      expect(lignes).toHaveLength(7);
      // [heures avant, vues, likes] — cinq anciens sous les seuils, un récent.
      const posts: [number, number, number][] = [
        [156, 1_210, 24],
        [132, 870, 17],
        [108, 2_450, 49],
        [84, 640, 13],
        [60, 1_980, 39],
        [6, 2_310, 51],
      ];
      const publications: Id<"publications">[] = [];
      for (const [i, [heures, vues, likes]] of posts.entries()) {
        const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
          projectId,
          id: lignes[i]._id,
          urls: [{ platform: "TikTok", url: `https://www.tiktok.com/${handle}/video/75${ts}${i}` }],
          publishedAt: ts - heures * HOUR,
          allowBackdate: true,
        });
        publications.push((pub.publicationIds ?? [])[0] as Id<"publications">);
        await admin.mutation(api.metricSnapshots.createSnapshot, {
          projectId,
          publicationId: (pub.publicationIds ?? [])[0] as Id<"publications">,
          vues,
          likes,
          capturedAt: ts - Math.min(heures - 1, 2) * HOUR,
        });
      }
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: lignes[6]._id,
        status: "video_submitted",
      });

      // Deux comptes en warmup.
      const enRetard = `@warm.late_${ts}`;
      await admin.mutation(api.comptes.createCompte, {
        projectId,
        handle: enRetard,
        plateforme: "TikTok",
        notes: "[E2E_TEST] warmup en retard",
        status: "warmup",
        warmupStartedAt: ts - 4 * DAY,
      });
      const pret = `@warm.done_${ts}`;
      const pretId = await admin.mutation(api.comptes.createCompte, {
        projectId,
        handle: pret,
        plateforme: "TikTok",
        notes: "[E2E_TEST] warmup terminé",
        status: "warmup",
        warmupStartedAt: ts - 9 * DAY,
      });
      const jourParis = (ms: number) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ms));
      await admin.mutation(api.comptes.e2eSetWarmupChecks, {
        secret: E2E_SECRET,
        id: pretId,
        dailyChecks: [9, 8, 7, 6, 5, 4, 3, 2, 1].map((d) => jourParis(ts - d * DAY)),
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E dashboard ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];

      const d = await outil(url, token, { projet: slug });
      // ── Les cartes d'action ─────────────────────────────────────────────────
      expect(d.actions.aValider).toBe(1);
      expect(d.actions.warmupsEnRetard).toEqual({ comptes: 1, liste: [`${enRetard} (TikTok)`] });
      expect(d.actions.warmupsAValider).toEqual({ comptes: 1, liste: [`${pret} (TikTok)`] });
      const du = await admin.query(api.payments.getDueTotal, { projectId });
      // Le dû PAR DEVISE (jamais fondu), et le total ramené dans celle du projet.
      expect(d.actions.du).toEqual({
        parDevise: du.byCurrency.map((t) => ({ devise: t.currency, montant: t.amount })),
        valeur: du.dueTotal,
        devise: "usd",
      });

      // ── À décider : l'alarme de compte, les cinq posts sous les seuils ──────
      expect(d.aDecider.alarmesCompte).toEqual([
        {
          compte: handle,
          createatrice: nomCreatrice,
          postsConsecutifsSousLesSeuils: 5,
          action: "stop promos, warmup prouvé pendant 5-7 jours",
        },
      ]);
      expect(d.aDecider.portesOuvertes).toEqual([]);

      // ── Les 48 h : un post, qui monte, compte en alarme ─────────────────────
      expect(d.posts48h).toHaveLength(1);
      expect(d.posts48h[0]).toMatchObject({ createatrice: nomCreatrice, etat: "alarme", posts: 1, vues: 2_310 });
      expect(d.posts48h[0].detail[0]).toMatchObject({
        compte: handle,
        vues: 2_310,
        vuesGagnees24h: 2_310,
        likeRatePct: 2.2,
        verdict: "monte",
        releve: "nuit",
      });

      // ── RELEVÉ RAPIDE : plus récent que la nuit, il porte les chiffres ──────
      // Écrit par le MÊME chemin que le cron (sans TikTok ni Apify). Il a 30 min ;
      // le relevé de nuit, 2 h. Vues, likes ET saves viennent de lui.
      const releveRapide = ts - 30 * 60_000;
      const ecrits = await admin.mutation(api.earlyReadings.e2eRecordEarlyPass, {
        secret: E2E_SECRET,
        readings: [
          {
            publicationId: publications[5],
            capturedAt: releveRapide,
            postedAt: ts - 6 * HOUR,
            postedAtSource: "datePubli",
            vues: 4_870,
            likes: 132,
            comments: 7,
            saves: 9,
            source: "tiktok",
          },
        ],
        attempts: [{ publicationId: publications[5], at: releveRapide, outcome: "read" }],
      });
      expect(ecrits).toBe(1);
      // Le cron de cache (30 min) peut avoir figé l'état d'avant : on recalcule.
      await admin.mutation(api.dashboardDecisions.e2eRefreshDecisionsCache, { secret: E2E_SECRET, projectId });
      const frais = await outil(url, token, { projet: slug });
      expect(frais.posts48h[0]).toMatchObject({ posts: 1, vues: 4_870 });
      expect(frais.posts48h[0].detail[0]).toMatchObject({
        vues: 4_870,
        vuesGagnees24h: 4_870, // moins de 24 h : toutes ses vues sont récentes
        likeRatePct: 2.7, // 132 ÷ 4 870 — PAS 51 likes de la nuit ÷ 4 870
        enregistrements: 9,
        verdict: "monte",
        releve: "rapide",
      });

      // ── Un manager SANS le bloc paiements : « Dû » masqué, le reste présent ─
      const manager = `e2e-mcp-dash-manager-${ts}@repackit.test`;
      await admin.mutation(api.projects.e2eEnsureMemberUser, { secret: E2E_SECRET, email: manager, projectId, role: "admin" });
      await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
        secret: E2E_SECRET,
        email: manager,
        projectId,
        role: "manager",
        permissions: ["assignments.manage", "accounts.manage", "creators.read", "content.analytics"],
      });
      const m = await outil(url, await clePour(manager, "manager dash"), { projet: slug });
      expect(m.actions.du).toEqual({ nonAccessible: expect.any(String) });
      expect(m.actions.aValider).toBe(1);
      expect(m.aDecider.alarmesCompte).toHaveLength(1);

      // ── L'écran dit la même chose ───────────────────────────────────────────
      await page.goto(`/admin/${slug}/dashboard`);
      await expect(page.getByText(/5 posts consécutifs sous les seuils/)).toBeVisible();
      // Le post porte les chiffres du relevé rapide, DATÉS à son heure (pas « 23h30 »).
      const paris = (ms: number, o: Intl.DateTimeFormatOptions) =>
        new Date(ms).toLocaleString("fr-FR", { timeZone: "Europe/Paris", ...o });
      const memeJour =
        paris(releveRapide, { day: "2-digit", month: "2-digit" }) === paris(Date.now(), { day: "2-digit", month: "2-digit" });
      const libelle = memeJour
        ? `vues · ${paris(releveRapide, { hour: "2-digit", minute: "2-digit" })}`
        : `vues · au ${paris(releveRapide, { day: "2-digit", month: "2-digit" })}`;
      const metrique = page.getByText(libelle, { exact: true });
      await expect(metrique).toBeVisible();
      await expect(metrique.locator("..")).toContainText(/4\s?870/);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});
