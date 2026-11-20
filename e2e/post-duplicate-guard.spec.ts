import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { minuitParis } from "./helpers/paris-day";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
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
const midi = (j: string) => {
  const [y, m, d] = j.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12);
};

/**
 * UN POST, UNE PUBLICATION — constat du 19/11/2026 : 38 liens rattachés à
 * plusieurs publications (48 en trop), le viral de Kelly compté sur deux
 * formats, le même reel de Naia payé au fixe sur sept missions.
 *
 * L'unitaire (lib/post-duplicate-guard.test.ts) tient la règle ; cette spec
 * tient le CÂBLAGE :
 *  1. la saisie refuse un lien dont la vidéo est déjà rattachée — même sous une
 *     autre forme — et laisse passer une autre vidéo ;
 *  2. « Corriger le lien » refuse la vidéo d'une autre mission, et ne re-cible
 *     pas sur la même vidéo ;
 *  3. un lien court qui se RÉSOUT en vidéo déjà rattachée marque la
 *     publication : relevés effacés, relevé suivant sauté, fixe retiré de la
 *     paie, sortie des posts suivis ;
 *  4. l'admin le lit dans le panneau de mission — avec le nom de l'autre
 *     créatrice (cas réel : Marine avait collé la vidéo de Sarah) ; « Corriger
 *     le lien » refuse la vidéo d'une autre mission, puis répare ;
 *  5. un doublon d'AVANT la garde : clé posée par la tâche de rattrapage,
 *     aperçu MCP sans écriture, puis `marquer_doublons` journalisé.
 */
test.describe("Lien de post en double", () => {
  test("refusé à la saisie, marqué après résolution, retiré de la paie, réparé, et marqué par l'outil MCP", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    // Sarah publie ; Marine collera la vidéo de Sarah (cas réel du 22/08).
    const sarah = `Sarah Doublon ${ts}`;
    const marine = `Marine Doublon ${ts}`;
    const hSarah = `@sarahkl02.${ts}`;
    const hMarine = `@marine.bn07.${ts}`;
    const cS = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] ${sarah}`,
      email: `e2e-doublon-s-${ts}@repackit.test`,
      password: "doublon-123456",
    });
    const cM = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] ${marine}`,
      email: `e2e-doublon-m-${ts}@repackit.test`,
      password: "doublon-123456",
    });
    const tS = await availableTarget({ e2eClient: admin, creatorId: cS.creatorId, platform: "TikTok", handle: hSarah });
    const tM = await availableTarget({ e2eClient: admin, creatorId: cM.creatorId, platform: "TikTok", handle: hMarine });

    const campaignId = (await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Doublons ${ts}`,
    })) as Id<"scriptCampaigns">;
    for (const [kind, label, content] of [
      ["hook", "Hook 1", `Il m'a dit qu'il dormait ${ts}`],
      ["hook", "Hook 2", `Elle était « juste une amie » ${ts}`],
      ["hook", "Hook 3", `Son téléphone face contre la table ${ts}`],
      ["flux", "Flux", "Je scanne son compte avec l'appli."],
      ["cta", "CTA", "Le lien est dans ma bio."],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    }
    // 10 € par vidéo : le fixe dit combien de vidéos la paie compte.
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Barème doublons ${ts}`,
      montantFixe: 70,
      nbVideosCible: 7,
      tauxCPM: 0,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: cS.creatorId,
      targets: [tS],
      videosPerCreator: 2,
      dueDate: ts + 7 * DAY,
      pricingId,
      postDates: [midi(jourParis(2)), midi(jourParis(3))],
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: cM.creatorId,
      targets: [tM],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      postDates: [minuitParis()],
    });
    const lesMissions = await admin.query(api.assignments.listAssignments, {});
    const [m1, m2] = lesMissions
      .filter((a) => a.creatorId === cS.creatorId)
      .sort((a, b) => (a.postDate ?? 0) - (b.postDate ?? 0));
    const m3 = lesMissions.find((a) => a.creatorId === cM.creatorId)!;
    expect(m1 && m2 && m3).toBeTruthy();

    // Ids TikTok plausibles (date décodable), forme de la prod : @ suffixé, paramètres de partage.
    const id = (n: number) => ((BigInt(Math.floor(ts / 1000)) << BigInt(32)) + BigInt(n)).toString();
    const lien = (n: number, suffixe = "") => `https://www.tiktok.com/${hSarah}/video/${id(n)}${suffixe}`;
    const publier = (m: { _id: Id<"assignments"> }, url: string) =>
      admin.mutation(api.assignments.confirmPublicationAsAdmin, { id: m._id, urls: [{ platform: "TikTok", url }] });

    // ── 1. Saisie : la même vidéo refusée, une autre vidéo acceptée ─────────
    const p1 = (await publier(m1, lien(1))).publicationIds[0];
    await expect(publier(m2, lien(1, "?_r=1&_t=ZN-8zG3bXq0nKp"))).rejects.toThrow(/ERR_POST_URL_ALREADY_LINKED/);
    const p2 = (await publier(m2, lien(2))).publicationIds[0];
    expect(p2).toBeTruthy();

    // ── 2. Correction : pas la vidéo d'une autre mission ; même vidéo = rien ─
    await expect(
      admin.mutation(api.assignments.correctPublishedUrl, { id: m2._id, platform: "TikTok", url: lien(1) }),
    ).rejects.toThrow(/ERR_POST_URL_ALREADY_LINKED/);
    const memeVideo = await admin.mutation(api.assignments.correctPublishedUrl, {
      id: m2._id,
      platform: "TikTok",
      url: lien(2, "?_r=1"),
    });
    expect(memeVideo.changed).toBe(false);

    // ── 3. Marine colle un lien court sans résolution : la saisie passe… ────
    const court = `https://vm.tiktok.com/ZSe2e${ts.toString(36)}/`;
    const p3 = (await publier(m3, court)).publicationIds[0];
    const pubOf = async (pid: Id<"publications">) =>
      (await admin.query(api.publications.listPublications, {})).find((p) => p._id === pid)!;
    const nuit = (pid: Id<"publications">, vues: number) =>
      admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId: pid,
        vues,
        likes: 120,
        capturedAt: Date.now(),
        source: "tiktok",
      });
    expect((await nuit(p1, 1_323)).action).toBe("inserted");
    expect((await nuit(p3, 1_317)).action).toBe("inserted");

    // Clé MCP « Publications » (paiements, meilleurs_posts, marquer_doublons).
    const nomCle = `E2E doublons ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    const interrupteur = page.getByRole("switch", { name: `Modifications des publications pour ${nomCle}` });
    await interrupteur.click();
    await expect(interrupteur).toBeChecked();
    const appel = async (name: string, args: Record<string, unknown>) => {
      const r = await rpc(url, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
      return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
    };
    const fixeDe = async (createatrice: string): Promise<number> => {
      const r = await appel("paiements", { createatrice, reglees: 0 });
      expect(r.erreur, r.texte).toBe(false);
      const cycles = (JSON.parse(r.texte).parCreatrice[0]?.cycles ?? []) as { detail: { fixe: number } }[];
      return cycles.reduce((s, x) => s + x.detail.fixe, 0);
    };
    const postsSuivis = async (): Promise<string[]> => {
      const r = await appel("meilleurs_posts", { warmup: "inclure", limite: 100, du: jourParis(-1), au: jourParis(5) });
      expect(r.erreur, r.texte).toBe(false);
      return (JSON.parse(r.texte).posts as { url: string }[]).map((p) => p.url);
    };
    // Avant la résolution : la mission de Marine compte au fixe.
    expect(await fixeDe(marine)).toBe(10);

    // …puis la résolution révèle la vidéo de Sarah : la publication de Marine est marquée.
    expect(
      await admin.mutation(api.postUrlResolution.e2eResolveShortlink, {
        secret: E2E_SECRET,
        publicationId: p3,
        shortlink: court,
        canonicalUrl: lien(1, "?_r=1"),
      }),
    ).toBe(true);
    const marquee = await pubOf(p3);
    expect(marquee.duplicateOf?.publicationId).toBe(p1);
    expect(marquee.vuesLatest ?? null).toBeNull();
    expect(marquee.lastCollectFailureReason).toBe("lien déjà rattaché à une autre mission");
    expect(await admin.query(api.metricSnapshots.listSnapshotsByPublication, { publicationId: p3 })).toHaveLength(0);
    // Présence : la publication gardée a toujours ses vues et son relevé.
    expect((await pubOf(p1)).vuesLatest).toBe(1_323);
    expect(await admin.query(api.metricSnapshots.listSnapshotsByPublication, { publicationId: p1 })).toHaveLength(1);
    // Le relevé suivant saute le doublon, pas la gardée.
    expect((await nuit(p3, 1_400)).action).toBe("skipped");
    expect((await nuit(p1, 1_400)).action).toBe("updated");
    // Paie : la mission de Marine ne compte plus au fixe ; Sarah, si.
    expect(await fixeDe(marine)).toBe(0);
    expect(await fixeDe(sarah)).toBe(20);
    // Posts suivis (Tracker, `meilleurs_posts`) : la vidéo de Sarah une seule fois.
    const suivis = await postsSuivis();
    expect(suivis.filter((l) => l.includes(id(1)))).toHaveLength(1);
    expect(suivis.filter((l) => l.includes(id(2)))).toHaveLength(1);

    // ── 4. Panneau de la mission de Marine : la note, le refus, la réparation ─
    await page.goto(adminPath("/assignments"));
    await expect(page.getByText(/\d+ \/ \d+ livrable/)).toBeVisible();
    await page.locator("button").filter({ hasText: "Tous créateurs" }).click();
    await page.locator('[role="option"]').filter({ hasText: marine }).click();
    await page.keyboard.press("Escape");
    await page.getByTitle(new RegExp(marine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).click();
    const sheet = page.getByTestId("assignment-detail-sheet");
    await expect(sheet.getByTestId("detail-publication-published")).toBeVisible();
    const note = sheet.getByTestId("detail-duplicate-link-TikTok");
    await expect(note).toContainText(`Lien déjà rattaché à une autre mission ([E2E_TEST] ${sarah})`);
    // Vers la vidéo d'une AUTRE mission : refusé, message traduit.
    await sheet.getByTestId("correct-url-TikTok").click();
    const dialog = page.getByRole("dialog", { name: "Corriger le lien TikTok" });
    await dialog.getByRole("textbox", { name: "Nouveau lien TikTok" }).fill(lien(2));
    await dialog.getByRole("button", { name: "Corriger", exact: true }).click();
    await expect(page.getByText("Ce lien TikTok est déjà celui d'une autre mission.").first()).toBeVisible();
    // Le lien de SA vidéo : le drapeau tombe, le relevé et la paie reprennent.
    const saVideo = `https://www.tiktok.com/${hMarine}/video/${id(3)}`;
    await dialog.getByRole("textbox", { name: "Nouveau lien TikTok" }).fill(saVideo);
    await dialog.getByRole("button", { name: "Corriger", exact: true }).click();
    await expect(page.getByText(/Lien corrigé/)).toBeVisible();
    await expect(note).toHaveCount(0);
    expect((await pubOf(p3)).duplicateOf).toBeUndefined();
    expect((await nuit(p3, 812)).action).toBe("inserted");
    expect(await fixeDe(marine)).toBe(10);

    // ── 5. Un doublon d'AVANT la garde : rattrapage de clé, aperçu, marquage ─
    await admin.mutation(api.postDuplicates.e2eLegacyPostUrl, { secret: E2E_SECRET, publicationId: p2, url: lien(1, "?_r=1") });
    expect((await pubOf(p2)).postKey).toBeUndefined();
    await admin.mutation(api.postDuplicates.e2eBackfillPostKeys, { secret: E2E_SECRET });
    expect((await pubOf(p2)).postKey).toBe(`tiktok:${id(1)}`);
    expect((await nuit(p2, 1_330)).action).not.toBe("skipped");

    const apercu = await appel("marquer_doublons", {});
    expect(apercu.erreur, apercu.texte).toBe(false);
    const lignes = JSON.parse(apercu.texte).liens as { lien: string; garde: string; aMarquer: string[] }[];
    const la = lignes.find((l) => l.lien.includes(id(1)));
    expect(la, apercu.texte).toBeDefined();
    expect(la!.aMarquer).toHaveLength(1);
    // L'aperçu n'écrit rien.
    expect((await pubOf(p2)).duplicateOf).toBeUndefined();
    expect(await admin.query(api.metricSnapshots.listSnapshotsByPublication, { publicationId: p2 })).not.toHaveLength(0);

    const fait = await appel("marquer_doublons", { liens: [lien(1, "?_r=1&_t=ZN-9B7zsPjiAVS")] });
    expect(fait.erreur, fait.texte).toBe(false);
    expect((await pubOf(p2)).duplicateOf?.publicationId).toBe(p1);
    expect(await admin.query(api.metricSnapshots.listSnapshotsByPublication, { publicationId: p2 })).toHaveLength(0);
    expect(await fixeDe(sarah)).toBe(10);
    // Journalisé, et dit qu'il ne se défait pas.
    const journal = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as { outil: string; etat: string }[];
    expect(journal.find((m) => m.outil === "marquer_doublons")?.etat).toContain("ne se défait pas");
    // Rappeler sur un lien déjà marqué ne marque rien de plus.
    const encore = await appel("marquer_doublons", { liens: [lien(1)] });
    expect(encore.erreur, encore.texte).toBe(false);
    expect((JSON.parse(encore.texte).fait as string[]).join(" ")).toContain("déjà marqué");
    // Un lien qui n'est pas en double est refusé, sans rien écrire.
    const unique = await appel("marquer_doublons", { liens: [saVideo] });
    expect(unique.erreur).toBe(true);
    expect(unique.texte).toContain("qu'à une publication");
  });
});
