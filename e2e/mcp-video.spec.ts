import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
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

type Contenu = { type: string; text?: string; data?: string };
type Rpc = { result?: { tools?: { name: string }[]; content?: Contenu[]; isError?: boolean }; error?: { message: string } };

async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}
async function appel(url: string, token: string, name: string, args: Record<string, unknown>) {
  const r = await rpc(url, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
  return {
    erreur: r.error !== undefined || r.result?.isError === true,
    contenu: r.result?.content ?? [],
    texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "",
  };
}

const jourParis = (n: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + n * DAY));

/**
 * CLAUDE REGARDE UNE VIDÉO SOUMISE, puis la valide ou la refuse.
 *
 * `regarder_video` est une LECTURE (toujours là) ; elle désigne la mission comme
 * `validation` la montre et rend le script attendu à côté des images. Ici la
 * vidéo n'existe pas chez Cloudflare (uid de test) : en transcodage, Claude le
 * dit ; « prête » mais illisible, Claude dit qu'aucune image n'a pu être lue —
 * jamais une image inventée. La lecture des images elle-même est couverte par
 * lib/mcp-video.test.ts (fetch injecté).
 *
 * `valider_video` / `refuser_video` n'apparaissent qu'avec « Publications », et
 * appellent les cœurs des boutons de l'écran.
 */
test.describe("MCP — regarder, valider, refuser une vidéo soumise", () => {
  test("images ou leur absence dite, puis refus motivé et validation", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const nom = `Inès Garnier ${ts}`;
    const ines = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] ${nom}`,
      email: `e2e-mcp-video-${ts}@repackit.test`,
      password: "ines-123456",
    });
    const handle = `@inesgarnier${ts}`;
    const cible = await availableTarget({ e2eClient: admin, creatorId: ines.creatorId, platform: "TikTok", handle });
    const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] Revue ${ts}` })) as Id<"scriptCampaigns">;
    await admin.mutation(api.scripts.createBrick, { campaignId, kind: "hook", label: "Hook classeur", content: `J'ai ouvert le classeur de ma sœur ${ts}` });
    await admin.mutation(api.scripts.createBrick, { campaignId, kind: "flux", label: "Flux scan", content: "Je scanne chaque carte avec l'appli." });
    await admin.mutation(api.scripts.createBrick, { campaignId, kind: "cta", label: "CTA bio", content: "Le lien est dans ma bio." });
    const { pricingId } = await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] Barème revue ${ts}`, montantFixe: 80, nbVideosCible: 8, tauxCPM: 1.75 });
    const J2 = jourParis(2);
    const [y, m, d] = J2.split("-").map(Number);
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: ines.creatorId,
      targets: [cible],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      // Midi UTC du jour visé : le même jour à Paris, quel que soit l'été/l'hiver.
      postDates: [Date.UTC(y, m - 1, d, 12)],
      overlayText: "Elle ne savait pas ce qu'elle avait",
    });
    const mission = async () =>
      (await admin.query(api.assignments.listAssignments, {})).find((a) => a.creatorId === ines.creatorId)!;
    const id = (await mission())._id;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, { secret: E2E_SECRET, id, status: "video_submitted" });
    await admin.mutation(api.assignments.e2eSetSubmittedVideoStream, { secret: E2E_SECRET, id, uid: `e2e-uid-${ts}`, status: "processing" });

    // ── Une clé, en lecture seule ─────────────────────────────────────────────
    const nomCle = `E2E vidéo ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    const noms = async () => ((await rpc(url, token, "tools/list")).result?.tools ?? []).map((t) => t.name);
    expect(await noms()).toContain("regarder_video");
    expect(await noms()).not.toContain("valider_video");

    // ── En transcodage : pas d'image, et la raison ────────────────────────────
    const enCours = await appel(url, token, "regarder_video", { createatrice: nom, jour: J2 });
    expect(enCours.erreur, enCours.texte).toBe(false);
    const lu = JSON.parse(enCours.texte);
    expect(lu).toMatchObject({ statut: "video_submitted", texteAIncruster: "Elle ne savait pas ce qu'elle avait", images: [] });
    expect(lu.scriptAttendu).toContain(`J'ai ouvert le classeur de ma sœur ${ts}`);
    expect(lu.mission).toContain(handle);
    expect(lu.pourquoi).toContain("transcodage");

    // ── « Prête » mais introuvable chez Cloudflare : aucune image inventée ────
    await admin.mutation(api.assignments.e2eSetSubmittedVideoStream, { secret: E2E_SECRET, id, uid: `e2e-uid-${ts}`, status: "ready" });
    const illisible = await appel(url, token, "regarder_video", { createatrice: nom, jour: J2 });
    expect(illisible.erreur, illisible.texte).toBe(false);
    expect(illisible.contenu.filter((c) => c.type === "image")).toHaveLength(0);
    expect(JSON.parse(illisible.texte).lecture.join(" ")).toContain("Aucune image n'a pu être lue");
    expect(JSON.parse(illisible.texte).imagesManquantes.length).toBeGreaterThan(0);

    // ── Une mission sans vidéo : le refus le dit ──────────────────────────────
    const autreJour = await appel(url, token, "regarder_video", { createatrice: nom, jour: jourParis(5) });
    expect(autreJour.erreur).toBe(true);
    expect(autreJour.texte).toContain(`Aucune mission de [E2E_TEST] ${nom}`);

    // ── Sans « Publications » : ni valider ni refuser ─────────────────────────
    const ferme = await appel(url, token, "valider_video", { createatrice: nom, jour: J2 });
    expect(ferme.erreur).toBe(true);
    expect((await mission()).status).toBe("video_submitted");

    const interrupteur = page.getByRole("switch", { name: `Modifications des publications pour ${nomCle}` });
    await interrupteur.click();
    await expect(interrupteur).toBeChecked();
    expect(await noms()).toContain("valider_video");

    // ── refuser_video : le motif arrive tel quel à la créatrice ───────────────
    const motif = "Le texte incrusté est coupé en haut de l'écran : remonte-le d'un cran et garde la carte bien dans le cadre.";
    const refus = await appel(url, token, "refuser_video", { createatrice: nom, jour: J2, motif });
    expect(refus.erreur, refus.texte).toBe(false);
    const refusee = await mission();
    expect(refusee.status).toBe("video_rejected");
    const vue = await ines.client.query(api.assignments.getMyAssignment, { projectId: ines.projectId, id });
    expect(vue!.assignment.videoReviewFeedback).toBe(motif);
    // Plus en revue : la valider est refusé, et dit pourquoi.
    const tropTot = await appel(url, token, "valider_video", { createatrice: nom, jour: J2 });
    expect(tropTot.erreur).toBe(true);
    expect(tropTot.texte).toContain("pas de vidéo en attente de revue");

    // ── Nouvelle soumission, puis valider_video ───────────────────────────────
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, { secret: E2E_SECRET, id, status: "video_submitted" });
    const ok = await appel(url, token, "valider_video", { createatrice: nom, jour: J2 });
    expect(ok.erreur, ok.texte).toBe(false);
    expect((await mission()).status).toBe("to_publish");
    const deux = await appel(url, token, "valider_video", { createatrice: nom, jour: J2 });
    expect(deux.texte).toContain("déjà validée");

    const journal = page.getByTestId("mcp-journal");
    await expect(journal).toContainText("Refuser une vidéo");
    await expect(journal).toContainText("Valider une vidéo");
    await expect(journal.getByRole("link", { name: /Validation/ }).first()).toHaveAttribute("href", adminPath("/validation"));
  });
});
