import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Page } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

type Rpc = { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}
const jourParis = (n: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + n * DAY));
const jourDe = (ts: number | undefined) =>
  ts === undefined ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));

/** Une clé « Missions » créée dans l'écran, et de quoi appeler ses outils. */
async function cleMissions(page: Page, nom: string) {
  await page.goto(adminPath("/comptes"));
  await page.getByRole("button", { name: "Connecter Claude" }).click();
  await page.getByLabel("Nom de la clé").fill(nom);
  await page.getByRole("button", { name: "Créer une clé" }).click();
  const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
  const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
  await page.getByRole("button", { name: "J’ai copié la clé" }).click();
  const interrupteur = page.getByRole("switch", { name: `Modifications des missions pour ${nom}` });
  await interrupteur.click();
  await expect(interrupteur).toBeChecked();
  const appel = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc(url, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
    return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
  };
  return { appel };
}

/**
 * OUTIL MCP `videos_exemples_mission` — incident du 03/11/2026 : des missions
 * « Collage » montraient une vidéo à reproduire d'un autre format (la vidéo
 * rejouée, les démos de l'ancienne campagne), que la créatrice risquait de
 * refaire au lieu du Collage. L'outil lit, retire (une, « toutes », « hors
 * campagne ») et ajoute, en lot TOUT OU RIEN, sans email, journalisé et
 * défaisable ; `planning` montre les vidéos à reproduire.
 */
test.describe("MCP — videos_exemples_mission", () => {
  test("lire, retirer hors campagne, ajouter une Inspiration, tout ou rien, défaire ; refusé sur une mission publiée", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const nom = `Ilona Collage ${ts}`;
    const handle = `@ilona${ts}`;
    const c = await createCreatorSession(convexUrl, { name: `[E2E_TEST] ${nom}`, email: `e2e-videos-ex-${ts}@repackit.test`, password: "videos-123456" });
    await availableTarget({ e2eClient: admin, creatorId: c.creatorId, platform: "TikTok", handle });
    const url = (x: number) => `https://www.tiktok.com/@e2e/video/${x}${ts}`;
    const campagne = `Collage ${ts}`;
    const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${campagne}` })) as Id<"scriptCampaigns">;
    // Trois hooks : une combinaison par mission (jamais deux fois la même).
    for (const [kind, label, content] of [
      ["hook", "Hook 1", `Hook collage un ${ts}`],
      ["hook", "Hook 2", `Hook collage deux ${ts}`],
      ["hook", "Hook 3", `Hook collage trois ${ts}`],
      ["flux", "Flux", "Ma réaction, puis la vidéo de fond en entier."],
      ["cta", "CTA", "3 ans ensemble et je vois ça que maintenant"],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    }
    // LA bonne vidéo : celle de la campagne, copiée sur chaque mission.
    await admin.mutation(api.scripts.addCampaignModelVideo, { campaignId, url: url(1), title: "Vidéo collage" });
    await admin.mutation(api.inspirations.createInspiration, { url: url(5), type: "video", plateforme: "TikTok", titre: `Inspi gagnante ${ts}` });
    const bareme = `Barème vidéos ${ts}`;
    await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] ${bareme}`, montantFixe: 50, nbVideosCible: 5, tauxCPM: 1.1 });
    const { appel } = await cleMissions(page, `E2E vidéos ${ts}`);
    const [J3, J4, J5] = [jourParis(3), jourParis(4), jourParis(5)];
    const a = await appel("assigner_scripts", { campagne, createatrices: [nom], jours: [J3, J4, J5], bareme });
    expect(a.erreur, a.texte).toBe(false);
    const missionDu = async (jour: string) =>
      (await admin.query(api.assignments.listAssignments, {})).find((x) => x.creatorId === c.creatorId && jourDe(x.postDate) === jour)!;
    const urls = async (jour: string) => ((await missionDu(jour)).modelVideos ?? []).map((mv) => mv.url);
    // Hors format, comme la vidéo qu'attache `rejouer_script`.
    await admin.mutation(api.assignments.addModelVideoToAssignment, { id: (await missionDu(J3))._id, url: url(2), title: "Face contre la table" });
    await admin.mutation(api.assignments.addModelVideoToAssignment, { id: (await missionDu(J3))._id, url: url(3) });
    expect(await urls(J3)).toEqual([url(1), url(2), url(3)]);
    expect(await urls(J4)).toEqual([url(1)]);
    expect(await urls(J5)).toEqual([url(1)]);

    // ── Lire, et `planning` les montre ─────────────────────────────────────────
    const lu = await appel("videos_exemples_mission", { createatrice: nom, jour: J3 });
    expect(lu.erreur, lu.texte).toBe(false);
    expect(lu.texte).toContain(`vidéos à reproduire : « Vidéo collage » (${url(1)}), « Face contre la table » (${url(2)}), ${url(3)}`);
    const planning = await appel("planning", { createatrice: nom, jours: 10 });
    expect(planning.erreur, planning.texte).toBe(false);
    const aVenir = (JSON.parse(planning.texte) as { aVenir: { posts: { jourPrevu: string; videosAReproduire?: string[] }[] } }).aVenir.posts;
    expect(aVenir.find((x) => x.jourPrevu === J3)?.videosAReproduire).toEqual([`Vidéo collage (${url(1)})`, `Face contre la table (${url(2)})`, url(3)]);

    // ── Tout ou rien : la ligne 2 vise une vidéo absente → rien d'écrit ───────
    const avant3 = await missionDu(J3);
    const avant4 = await missionDu(J4);
    const refus = await appel("videos_exemples_mission", {
      missions: [
        { createatrice: nom, jour: J3, retirer: "hors campagne" },
        { createatrice: nom, jour: J4, retirer: "introuvable" },
      ],
    });
    expect(refus.erreur).toBe(true);
    expect(refus.texte).toContain("Ligne 2");
    expect(refus.texte).toContain("« introuvable » introuvable");
    expect(refus.texte).toContain("Rien n'a été écrit.");
    expect(await missionDu(J3)).toEqual(avant3);

    // ── Retirer hors campagne + ajouter une Inspiration (son titre suit) ──────
    const lot = await appel("videos_exemples_mission", {
      missions: [
        { createatrice: nom, jour: J3, retirer: "hors campagne" },
        { createatrice: nom, jour: J4, ajouter: url(5) },
      ],
    });
    expect(lot.erreur, lot.texte).toBe(false);
    expect(lot.texte).toContain(`retirées : « Face contre la table » (${url(2)}), ${url(3)} — restent « Vidéo collage » (${url(1)})`);
    expect(lot.texte).toContain(`ajoutée : « Inspi gagnante ${ts} » (${url(5)})`);
    expect(await urls(J3)).toEqual([url(1)]);
    expect(await urls(J4)).toEqual([url(1), url(5)]);
    // Rien d'autre ne bouge : script, consigne, dates, dossiers.
    const apres3 = await missionDu(J3);
    expect({ ...apres3, modelVideos: undefined }).toEqual({ ...avant3, modelVideos: undefined });

    // ── Défaire remet les deux missions à l'identique ─────────────────────────
    const liste = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as { rang: number; outil: string; etat: string }[];
    const ligne = liste.find((m) => m.outil === "videos_exemples_mission")!;
    expect(ligne.etat).toBe("se défait");
    const d = await appel("defaire", { rang: ligne.rang, outil: "videos_exemples_mission" });
    expect(d.erreur, d.texte).toBe(false);
    expect(await missionDu(J3)).toEqual(avant3);
    expect(await missionDu(J4)).toEqual(avant4);

    // ── Une par son titre ; puis toutes ; un doublon ne change rien ───────────
    const une = await appel("videos_exemples_mission", { createatrice: nom, jour: J3, retirer: "contre la table" });
    expect(une.erreur, une.texte).toBe(false);
    expect(await urls(J3)).toEqual([url(1), url(3)]);
    const toutes = await appel("videos_exemples_mission", { createatrice: nom, jour: J3, retirer: "toutes" });
    expect(toutes.erreur, toutes.texte).toBe(false);
    expect((await missionDu(J3)).modelVideos).toBeUndefined();
    const doublon = await appel("videos_exemples_mission", { createatrice: nom, jour: J4, ajouter: url(1) });
    expect(doublon.erreur, doublon.texte).toBe(false);
    expect(doublon.texte).toContain("déjà là");
    expect(doublon.texte).toContain("Rien n'a changé");

    // ── Publiée : se lit, mais ne se modifie plus ──────────────────────────────
    const m5 = await missionDu(J5);
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, { secret: E2E_SECRET, id: m5._id, status: "to_publish" });
    await c.client.mutation(api.assignments.confirmPublication, {
      projectId: c.projectId,
      id: m5._id,
      urls: [{ platform: "TikTok", url: `https://www.tiktok.com/${handle}/video/7${ts}` }],
    });
    expect((await appel("videos_exemples_mission", { createatrice: nom, jour: J5 })).erreur).toBe(false);
    const publiee = await appel("videos_exemples_mission", { createatrice: nom, jour: J5, retirer: "toutes" });
    expect(publiee.erreur).toBe(true);
    expect(publiee.texte).toContain("déjà publiée");
    expect(await urls(J5)).toEqual([url(1)]);
  });
});
