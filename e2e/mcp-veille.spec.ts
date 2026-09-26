import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { computeEngagement } from "../convex/radarApi";
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
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "veille", arguments: args } }),
  });
  const result = ((await r.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { text: result.content[0].text, isError: result.isError === true };
}
const ok = (s: Sortie) => {
  expect(s.isError, s.text).toBe(false);
  return JSON.parse(s.text);
};

/**
 * Outil MCP `veille` — l'écran Veille, par les MÊMES lectures (comptes suivis,
 * mur de vidéos, tendances par pays), sans rien relancer chez Apify.
 *
 * Projet DÉDIÉ : un compte suivi (4 vidéos : 2 populaires, 2 récentes) et deux
 * hashtags tendance en France, dont un avec une vidéo.
 */
test.describe("Outil MCP veille", () => {
  test("comptes suivis, mur de vidéos, tendances : les lectures de l'écran", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-veille-${ts}`;
    const nom = `E2E MCP Veille ${ts}`;
    const handle = `lea.coach_${ts}`;
    const prefixe = `#e2eveille${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    try {
      const video = (id: string, jours: number, views: number, likes: number, comments: number, shares: number, isPopular: boolean) => ({
        tiktokId: `${ts}${id}`,
        url: `https://www.tiktok.com/@${handle}/video/${ts}${id}`,
        publishedAt: ts - jours * DAY,
        caption: `[E2E_TEST] routine ${id}`,
        views,
        likes,
        comments,
        shares,
        saves: Math.round(likes / 9),
        hashtags: ["fitness", "routine"],
        isPopular,
      });
      await admin.mutation(api.radar.e2eSeedRadar, {
        secret: E2E_SECRET,
        projectId,
        handle,
        fans: 48_730,
        videos: [
          video("1", 30, 873_500, 61_240, 1_318, 2_207, true),
          video("2", 45, 1_284_000, 98_310, 2_904, 5_118, true),
          video("3", 5, 18_975, 1_204, 41, 17, false),
          video("4", 2, 41_230, 3_318, 127, 64, false),
        ],
        trend: {
          countryCode: "FR",
          hashtags: [
            { hashtag: `${prefixe}a`, rank: 1, posts: 12_400, videoViews: 3_218_000 },
            { hashtag: `${prefixe}b`, rank: 2, posts: 3_870, videoViews: 941_200 },
          ],
          videos: [{ hashtag: `${prefixe}a`, video: { ...video("9", 3, 512_300, 40_110, 820, 1_530, false), authorHandle: "autre.compte" } }],
        },
      });

      // ── Une clé, depuis l'écran ─────────────────────────────────────────────
      await page.goto(adminPath("/comptes"));
      await page.getByRole("button", { name: "Connecter Claude" }).click();
      await page.getByLabel("Nom de la clé").fill(`E2E veille ${ts}`);
      await page.getByRole("button", { name: "Créer une clé" }).click();
      const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
      const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];

      // ── Comptes suivis (vue par défaut) ─────────────────────────────────────
      const comptes = ok(await outil(url, token, { projet: slug }));
      expect(comptes.comptesSuivis).toBe(1);
      expect(comptes.comptes[0]).toMatchObject({ compte: handle, abonnes: 48_730, videos: 4 });

      // ── Le mur : populaires par vues, récentes par date ─────────────────────
      const mur = ok(await outil(url, token, { projet: slug, vue: "videos", compte: `@${handle}` }));
      expect(mur.populaires.map((v: { vues: number }) => v.vues)).toEqual([1_284_000, 873_500]);
      expect(mur.recentes.map((v: { vues: number }) => v.vues)).toEqual([41_230, 18_975]);
      // Engagement = (likes + commentaires + partages) ÷ vues, en %.
      expect(mur.populaires[0].engagementPct).toBe(
        Math.round(computeEngagement(1_284_000, 98_310, 2_904, 5_118) * 1000) / 10,
      );
      expect(mur.populaires[0].engagementPct).toBe(8.3);
      // Le même mur que l'écran, dans le même ordre.
      const ecran = await admin.query(api.radar.listRadarVideos, { projectId });
      expect([...mur.populaires, ...mur.recentes].map((v: { lien: string }) => v.lien)).toEqual(ecran.map((v) => v.url));

      const inconnu = await outil(url, token, { projet: slug, vue: "videos", compte: "@personne" });
      expect(inconnu.isError).toBe(true);
      expect(inconnu.text).toContain(handle);

      // ── Tendances FR, puis les vidéos d'un hashtag (avec ou sans « # ») ────
      const tendances = ok(await outil(url, token, { projet: slug, vue: "tendances", pays: "FR" }));
      const miens = tendances.hashtags.filter((h: { hashtag: string }) => h.hashtag.startsWith(prefixe));
      expect(miens.map((h: { rang: number; hashtag: string }) => [h.rang, h.hashtag])).toEqual([
        [1, `${prefixe}a`],
        [2, `${prefixe}b`],
      ]);
      const sansDiese = ok(
        await outil(url, token, { projet: slug, vue: "tendances", pays: "FR", hashtag: `${prefixe.slice(1)}a` }),
      );
      expect(sansDiese.hashtag).toBe(`${prefixe}a`);
      expect(sansDiese.videos.map((v: { vues: number; compte: string }) => [v.vues, v.compte])).toEqual([[512_300, "autre.compte"]]);

      const sansPays = await outil(url, token, { projet: slug, vue: "tendances" });
      expect(sansPays.isError).toBe(true);
    } finally {
      await admin.mutation(api.radar.e2eClearRadarTrends, { secret: E2E_SECRET, countryCode: "FR", prefixe });
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});
