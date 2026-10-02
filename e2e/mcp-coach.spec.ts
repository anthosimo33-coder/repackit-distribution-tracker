import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { ConvexHttpClient } from "convex/browser";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

type Rpc = { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] }; error?: { message: string } };
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
/** Midi (à peu près) à Paris, le jour `n` : un jour prévu sans ambiguïté de fuseau. */
const midi = (n: number) => Date.parse(`${jourParis(n)}T10:00:00Z`);

async function uploadFakeVideo(client: ConvexHttpClient): Promise<Id<"_storage">> {
  const uploadUrl = await client.mutation(api.storage.generateUploadUrl, {});
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]) });
  if (!res.ok) throw new Error(`upload échoué (HTTP ${res.status})`);
  return ((await res.json()) as { storageId: Id<"_storage"> }).storageId;
}

/**
 * LE COACH — `bilan_createatrice` rend la période d'une créatrice en chiffres
 * (ponctualité, posts et vues à J+7, refus et motifs, ce qui l'attend) ; un
 * message se PROPOSE (l'équipe lit le texte exact et l'applique d'un clic) ou,
 * interrupteur « Messages » allumé, s'envoie directement. Un tous les 3 jours par
 * créatrice ; un message ne se défait pas.
 */
test.describe("MCP — le coach", () => {
  test("bilan d'une créatrice ; message proposé puis appliqué, envoyé direct ; un tous les 3 jours ; jamais défait", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const P = E2E_PROJECT_SLUG;
    const nom = `Kelly Martin ${ts}`;
    const kelly = await createCreatorSession(convexUrl, { name: `[E2E_TEST] ${nom}`, email: `e2e-mcp-coach-${ts}@repackit.test`, password: "kelly-12345" });
    const handle = `@kellymartin${ts}`;
    const cible = await availableTarget({ e2eClient: admin, creatorId: kelly.creatorId, platform: "TikTok", handle });
    const formatId = await createFormatWithRate(admin, { name: `[E2E_TEST] Format coach ${ts}`, type: "short", rateModel: { basePerPost: 10, viewBonusPer1k: 2 } });
    await admin.mutation(api.assignments.assignFormat, { formatId, creatorId: kelly.creatorId, targets: [cible], postsPerCreator: 4, dueDate: ts + 7 * DAY });
    const [m1, m2, m3, m4] = (await admin.query(api.assignments.listAssignments, {}))
      .filter((a) => a.creatorId === kelly.creatorId)
      .sort((a, b) => a._creationTime - b._creationTime);
    for (const [m, n] of [[m1, -10], [m2, -5], [m3, -4], [m4, 2]] as const) {
      await admin.mutation(api.assignments.setAssignmentPostDate, { id: m._id, postDate: midi(n) });
    }
    // m1 : publiée le jour prévu, mesurée à J+7.
    const publieeLe = midi(-10);
    const lien = `https://www.tiktok.com/${handle}/video/${((BigInt(Math.floor(publieeLe / 1000)) << BigInt(32)) + BigInt(7)).toString()}`;
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, { id: m1._id, urls: [{ platform: "TikTok", url: lien }], publishedAt: publieeLe, allowBackdate: true });
    const pub = (await admin.query(api.publications.listPublications, {})).find((p) => p.postUrl === lien)!;
    await admin.mutation(api.metricSnapshots.createSnapshot, { publicationId: pub._id, capturedAt: pub.datePubli + 7 * DAY + 3_600_000, vues: 5400, likes: 270 });
    // m3 : vidéo envoyée puis refusée, avec un motif.
    const motif = `Le texte incrusté est coupé en bas : remonte-le ${ts}.`;
    await kelly.client.mutation(api.assignments.startAssignment, { projectId: kelly.projectId, id: m3._id });
    await kelly.client.mutation(api.assignments.submitVideo, { projectId: kelly.projectId, id: m3._id, storageId: await uploadFakeVideo(kelly.client), mimeType: "video/mp4" });
    await admin.mutation(api.assignments.reviewVideoReject, { id: m3._id, feedback: motif });
    // Une deuxième créatrice, sans mission : pour l'envoi direct.
    const nomInes = `Inès Garnier ${ts}`;
    await createCreatorSession(convexUrl, { name: `[E2E_TEST] ${nomInes}`, email: `e2e-mcp-coach-ines-${ts}@repackit.test`, password: "ines-12345" });

    // ── Une clé en lecture seule : le bilan, pas l'envoi ──────────────────────
    const nomCle = `E2E coach ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    const noms = async () => ((await rpc(url, token, "tools/list")).result?.tools ?? []).map((t) => t.name);
    expect(await noms()).toContain("bilan_createatrice");
    expect(await noms()).not.toContain("envoyer_message_createatrice");
    const appel = async (name: string, args: Record<string, unknown>) => {
      const r = await rpc(url, token, "tools/call", { name, arguments: { projet: P, ...args } });
      return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
    };
    const bilan = async (args: Record<string, unknown>) => {
      const r = await appel("bilan_createatrice", { createatrice: nom, ...args });
      expect(r.erreur, r.texte).toBe(false);
      return JSON.parse(r.texte);
    };

    // ── Le bilan sur 13 jours ─────────────────────────────────────────────────
    const b = await bilan({ du: jourParis(-12), au: jourParis(0) });
    expect(b).toMatchObject({ createatrice: `[E2E_TEST] ${nom}`, prenom: "Kelly", langue: "français", statut: "onboarding", periode: { du: jourParis(-12), au: jourParis(0) } });
    expect(b.missions).toEqual({
      prevues: 3,
      aLHeure: 1,
      horsDate: 0,
      manquees: 2,
      encoreAVenir: 0,
      detail: [
        { jour: jourParis(-10), statut: "à l'heure" },
        { jour: jourParis(-5), statut: "manquée" },
        { jour: jourParis(-4), statut: "manquée" },
      ],
    });
    expect(b.posts).toEqual([expect.objectContaining({ jour: jourParis(-10), lien, vues: 5400, vuesJ7: 5400 })]);
    expect(b.posts[0].compte).toContain("TikTok");
    expect(b.meilleurPost).toMatchObject({ lien, vuesJ7: 5400 });
    expect(b.medianeVues30j).toMatchObject({ elle: 5400, sesPosts: 1 });
    expect(typeof b.medianeVues30j.projet).toBe("number");
    expect(b.videosRefusees).toEqual([{ le: jourParis(0), motif }]);
    expect(b.aVenir).toEqual({ nombre: 1, jours: [jourParis(2)] });
    expect(b.dernierMessage).toBeNull();
    expect(b.prochainMessagePossibleLe).toBeUndefined();
    expect(b.lecture.join(" ")).toContain("Ne cite jamais une autre créatrice");
    // Période par défaut : les 7 derniers jours (ni la publication de J-10, ni sa mission).
    const d7 = await bilan({});
    expect(d7.periode).toEqual({ du: jourParis(-6), au: jourParis(0) });
    expect(d7.missions).toMatchObject({ prevues: 2, aLHeure: 0, manquees: 2 });
    expect(d7.posts).toEqual([]);
    // Erreurs de désignation et de dates.
    expect((await appel("bilan_createatrice", { createatrice: `Inconnue ${ts}` })).texte).toContain(`Inconnue ${ts}`);
    expect((await appel("bilan_createatrice", { createatrice: nom, du: jourParis(0), au: jourParis(-3) })).texte).toContain("« du » doit précéder « au »");
    // En lecture seule, l'envoi n'existe pas.
    expect((await appel("envoyer_message_createatrice", { createatrice: nom, objet: "Ta semaine", message: "x".repeat(60) })).erreur).toBe(true);

    // ── Proposer : l'équipe lit le TEXTE EXACT et l'applique d'un clic ────────
    const objet = `Ta semaine, Kelly ${ts}`;
    const message = `Salut Kelly,\n\nTon post du ${jourParis(-10)} a fait 5 400 vues à J+7 : c'est ton meilleur, garde ce rythme.\n\nDeux missions sont passées sans publication — si un jour ne te va pas, dis-le avant, on le déplace.\n\nProchaine mission le ${jourParis(2)}.`;
    const resume = `Écrire à ${nom} : « ${objet} »`;
    const p = await appel("proposer", {
      outil: "envoyer_message_createatrice",
      arguments: { createatrice: nom, objet, message },
      resume,
      pourquoi: "Bilan de la semaine : un post à 5 400 vues à J+7, deux missions manquées.",
    });
    expect(p.erreur, p.texte).toBe(false);
    await page.goto(adminPath("/dashboard"));
    const ligne = page.getByTestId("propositions-claude").getByTestId("proposition").filter({ hasText: resume });
    await expect(ligne).toContainText("Écrire à une créatrice");
    const apercu = ligne.getByTestId("proposition-apercu");
    await expect(apercu).toContainText("Le message qui partira par email");
    await expect(apercu).toContainText(objet);
    await expect(apercu).toContainText("Deux missions sont passées sans publication");
    await ligne.getByRole("button", { name: "Appliquer" }).click();
    await expect(page.getByText(/Appliquée :/)).toBeVisible();
    await expect(ligne).toHaveCount(0);
    const apres = await bilan({});
    expect(apres.dernierMessage).toEqual({ le: jourParis(0), objet });
    expect(apres.prochainMessagePossibleLe).toBe(jourParis(3));

    // ── Interrupteur « Messages » : l'envoi direct apparaît ───────────────────
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    const interrupteur = page.getByRole("switch", { name: `Modifications des messages pour ${nomCle}` });
    await interrupteur.click();
    await expect(interrupteur).toBeChecked();
    expect(await noms()).toContain("envoyer_message_createatrice");

    // Un tous les 3 jours : Kelly vient d'en recevoir un.
    const encore = await appel("envoyer_message_createatrice", { createatrice: nom, objet: "Encore moi", message });
    expect(encore.erreur).toBe(true);
    expect(encore.texte).toContain("un tous les 3 jours");
    // Trop court : refusé, rien n'est envoyé.
    expect((await appel("envoyer_message_createatrice", { createatrice: nomInes, objet: "Coucou", message: "Salut Inès !" })).texte).toContain("quelques phrases");
    const ines = await appel("envoyer_message_createatrice", {
      createatrice: nomInes,
      objet: `Bienvenue Inès ${ts}`,
      message: "Salut Inès,\n\nTes premières missions arrivent cette semaine : regarde bien les vidéos exemples avant de tourner.\n\nÀ très vite !",
    });
    expect(ines.erreur, ines.texte).toBe(false);
    expect(JSON.parse(ines.texte).fait).toContain(`${nomInes} : « Bienvenue Inès ${ts} »`);

    // ── Le journal : les deux envois, aucun ne se défait ──────────────────────
    const modifs = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as { rang: number; outil: string; fait: string; etat: string }[];
    const envois = modifs.filter((x) => x.outil === "envoyer_message_createatrice" && x.fait.includes(String(ts)));
    expect(envois).toHaveLength(2);
    expect(envois.every((x) => x.etat !== "se défait")).toBe(true);
    expect((await appel("defaire", { rang: envois[0].rang, outil: "envoyer_message_createatrice" })).texte).toContain("un message envoyé ne se reprend pas");
  });
});
