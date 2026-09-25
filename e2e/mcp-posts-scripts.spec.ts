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

async function outil(url: string, token: string, name: string, args: Record<string, unknown>): Promise<Sortie> {
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
  return { text: result.content[0].text, isError: result.isError === true };
}

/**
 * Outils MCP `meilleurs_posts` et `scripts` — Claude lit ce que montrent la
 * liste du Tracker et l'écran Analytics d'une campagne, par les MÊMES fonctions.
 *
 * Campagne à la forme de l'écran : 3 hooks × 2 flux × 2 CTA, 9 vidéos publiées,
 * vues relevées à J+3 et J+7 (différentes, pour que la fenêtre se voie).
 */
test.describe("Outils MCP meilleurs_posts et scripts", () => {
  test("mêmes verdicts, combos et classement que les écrans", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const nomCampagne = `[E2E_TEST] Decision MCP ${ts}`;
    const creator = await createCreatorSession(convexUrl!, {
      name: `[E2E_TEST] Nadia Ferreira ${ts}`,
      email: `e2e-mcp-scripts-${ts}@repackit.test`,
      password: "mcp-scripts-12345",
    });
    const campaignId = await admin.mutation(api.scripts.createCampaign, { name: nomCampagne });
    for (const [kind, label] of [
      ["hook", "H-1 « Personne ne te dit ça »"],
      ["hook", "H-2 « J'ai testé 30 jours »"],
      ["hook", "H-3 « Arrête de faire ça »"],
      ["flux", "F1 démo"],
      ["flux", "F2 avant/après"],
      ["cta", "T1 lien en bio"],
      ["cta", "T2 commente"],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content: `${label} contenu` });
    }
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] MCP scripts ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const cible = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@nadia.ferreira_${ts}`,
    });
    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [cible],
      videosPerCreator: 9,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r.created).toBe(9);
    const lignes = (await admin.query(api.assignments.listAssignments, {})).filter(
      (x) => x.scriptCombo?.campaignId === campaignId,
    );
    const publications: Id<"publications">[] = [];
    for (const [i, ligne] of lignes.entries()) {
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: ligne._id,
        status: "to_publish",
      });
      const res = await creator.client.mutation(api.assignments.confirmPublication, {
        projectId: creator.projectId,
        id: ligne._id,
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@nadia.ferreira_${ts}/video/73${ts}${i}` }],
      });
      publications.push(res.publicationIds[0]);
    }
    const base = Date.now();
    for (const [i, publicationId] of publications.entries()) {
      // Vues à la forme de la prod (pas des multiples ronds) ; J+7 ≈ 8 × J+3.
      await admin.mutation(api.metricSnapshots.createSnapshot, {
        publicationId,
        capturedAt: base + 3 * DAY,
        vues: 1_137 * (i + 1),
        likes: 41 * (i + 1),
      });
      await admin.mutation(api.metricSnapshots.createSnapshot, {
        publicationId,
        capturedAt: base + 7 * DAY,
        vues: 9_083 * (i + 1),
        likes: 297 * (i + 1),
      });
    }

    // ── Une clé, depuis l'écran ─────────────────────────────────────────────
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(`E2E scripts ${ts}`);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
      .match(/jarvia (\S+\/mcp) /)![1];

    // ── scripts, sans campagne : la liste ───────────────────────────────────
    const liste = JSON.parse((await outil(url, token, "scripts", { projet: "e2e-test" })).text) as {
      campagnes: { nom: string; statut: string; assignations: number }[];
    };
    expect(liste.campagnes).toContainEqual({ nom: nomCampagne, statut: "active", assignations: 9 });

    // ── scripts, la campagne à J+7 : EXACTEMENT l'écran Analytics ───────────
    // Le nom COMPLET désigne la campagne sans ambiguïté.
    const sortie7 = await outil(url, token, "scripts", { projet: "e2e-test", campagne: nomCampagne });
    expect(sortie7.isError, sortie7.text).toBe(false);
    const j7 = JSON.parse(sortie7.text) as {
      campagne: { nom: string };
      postsMesures: number;
      decisions: { dimension: string; briques: { brique: string; verdict: string; posts: number; vuesMediane: number | null }[] }[];
      meilleursCombos: { hook: string; flux: string; cta: string; posts: number; vuesMediane: number | null }[];
    };
    expect(j7.campagne.nom).toBe(nomCampagne);
    const ecran = await admin.query(api.scriptDecision.campaignDecisions, { campaignId, window: "j7" });
    expect(j7.postsMesures).toBe(ecran.totalPosts);
    expect(j7.postsMesures).toBe(9);
    const verdicts = { a_pousser: "à pousser", a_couper: "à couper", neutre: "neutre", en_test: "en test (pas encore jugeable)" } as const;
    expect(j7.decisions).toEqual(
      ecran.dimensions.map((d) => ({
        dimension: d.kind,
        briques: d.decisions.map((b) => ({
          brique: b.label,
          verdict: verdicts[b.verdict],
          raison: b.reason,
          posts: b.postCount,
          vuesMediane: b.viewsMedian === null ? null : Math.round(b.viewsMedian),
          medianeDesAutres: b.peerMedian === null ? null : Math.round(b.peerMedian),
        })),
      })),
    );
    // 9 posts : sous le seuil de 50, rien n'est encore jugeable — et l'outil le dit.
    expect(j7.decisions.flatMap((d) => d.briques).every((b) => b.verdict.startsWith("en test"))).toBe(true);
    const combosEcran = await admin.query(api.scriptAnalytics.perfByCombo, { campaignId, window: "j7" });
    expect(j7.meilleursCombos.map((c) => [c.hook, c.flux, c.cta, c.vuesMediane])).toEqual(
      combosEcran.slice(0, 10).map((c) => [c.hookLabel, c.fluxLabel, c.ctaLabel, c.viewsMedian === null ? null : Math.round(c.viewsMedian)]),
    );
    // Le meilleur combo est celui de la 9e vidéo : 9 × 9 083 vues à J+7.
    expect(j7.meilleursCombos[0].vuesMediane).toBe(81_747);

    // ── La fenêtre compte : à J+3, les médianes sont celles de J+3 ──────────
    const j3 = JSON.parse((await outil(url, token, "scripts", { projet: "e2e-test", campagne: nomCampagne, fenetre: "j3" })).text) as typeof j7;
    expect(j3.meilleursCombos[0].vuesMediane).toBe(10_233); // 9 × 1 137

    // ── Un nom qui désigne DEUX campagnes : refus, avec les deux choix ──────
    // Présence d'abord : ce nom partiel désignait la seule campagne jusqu'ici.
    const avant = await outil(url, token, "scripts", { projet: "e2e-test", campagne: `Decision MCP ${ts}` });
    expect(avant.isError).toBe(false);
    await admin.mutation(api.scripts.createCampaign, { name: `${nomCampagne} — relance` });
    const ambigu = await outil(url, token, "scripts", { projet: "e2e-test", campagne: `Decision MCP ${ts}` });
    expect(ambigu.isError).toBe(true);
    expect(ambigu.text).toMatch(/introuvable ou ambiguë/);
    expect(ambigu.text).toContain(`${nomCampagne} — relance`);

    // ── meilleurs_posts : le classement de la liste du Tracker ──────────────
    const top = JSON.parse(
      (await outil(url, token, "meilleurs_posts", { projet: "e2e-test", campagne: nomCampagne, limite: 3 })).text,
    ) as { total: number; posts: { vues: number; likes: number; compte: string; createatrice: string; campagne: string }[] };
    expect(top.total).toBe(9);
    expect(top.posts.map((p) => p.vues)).toEqual([81_747, 72_664, 63_581]); // 9, 8, 7 × 9 083
    expect(top.posts[0]).toMatchObject({
      compte: `@nadia.ferreira_${ts}`,
      createatrice: `[E2E_TEST] Nadia Ferreira ${ts}`,
      campagne: nomCampagne,
      likes: 2_673,
    });
    const tracker = (await admin.query(api.trackerData.listTrackerPosts, { campaignIds: [campaignId] }))
      .sort((a, b) => b.vues - a.vues)
      .slice(0, 3)
      .map((p) => p.vues);
    expect(top.posts.map((p) => p.vues)).toEqual(tracker);

    const pires = JSON.parse(
      (await outil(url, token, "meilleurs_posts", { projet: "e2e-test", campagne: nomCampagne, ordre: "pires", limite: 2 })).text,
    ) as { posts: { vues: number }[] };
    expect(pires.posts.map((p) => p.vues)).toEqual([9_083, 18_166]);
  });
});
