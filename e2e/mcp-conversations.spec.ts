import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import type { Page } from "@playwright/test";
import sharp from "sharp";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const admin = createE2eClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? "");

type Rpc = { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };

async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}

/** Une clé créée dans l'écran, interrupteur « Conversations » allumé. */
async function cle(page: Page, nom: string) {
  await page.goto(adminPath("/comptes"));
  await page.getByRole("button", { name: "Connecter Claude" }).click();
  await page.getByLabel("Nom de la clé").fill(nom);
  await page.getByRole("button", { name: "Créer une clé" }).click();
  const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
  const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
  await page.getByRole("button", { name: "J’ai copié la clé" }).click();
  const interrupteur = page.getByRole("switch", { name: `Modifications des conversations pour ${nom}` });
  await interrupteur.click();
  await expect(interrupteur).toBeChecked();
  await page.keyboard.press("Escape");
  const appel = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc(url, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
    return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
  };
  const defaire = async (outil: string) => {
    const liste = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as { rang: number; outil: string; etat: string }[];
    const cible = liste.find((m) => m.outil === outil && m.etat === "se défait");
    expect(cible, `aucune modification « ${outil} » défaisable`).toBeDefined();
    return appel("defaire", { rang: cible!.rang, outil });
  };
  return { appel, defaire };
}

/**
 * CONVERSATIONS PAR CLAUDE — Claude écrit, l'app dessine : le lien rendu par
 * `creer_conversation` ouvre l'écran sur le brouillon, une réécriture par Claude
 * s'y voit EN DIRECT, et chaque écriture se défait.
 */
test.describe("MCP — conversations Instagram", () => {
  test("créer, ouvrir par le lien, lire, modifier en direct, défaire, supprimer et recréer", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const { appel, defaire } = await cle(page, `E2E conversations ${ts}`);
    const titre = `Conv e2e ${ts}`;

    const cree = await appel("creer_conversation", {
      titre,
      contact_nom: "Jeremy",
      heure: "11:52",
      messages: [
        { type: "date", texte: "AUJOURD'HUI 21:43" },
        { cote: "envoye", texte: "tu fais quoi ce soir ?" },
        { cote: "recu", texte: "rien et toi", reaction: "😂" },
      ],
    });
    expect(cree.erreur, cree.texte).toBe(false);
    const lien = JSON.parse(cree.texte).lien as string;
    expect(lien).toMatch(/\/admin\/e2e-test\/conversations\?c=/);

    // Le lien ouvre l'écran sur CE brouillon (origine retirée : le déploiement
    // de test peut ne pas connaître son adresse publique).
    await page.goto(lien.replace(/^https?:\/\/[^/]+/, ""));
    const apercu = page.getByRole("img", { name: "Aperçu de la capture" });
    await expect(apercu.getByText("tu fais quoi ce soir ?", { exact: true })).toBeVisible();
    await expect(apercu.getByText("Jeremy", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Titre")).toHaveValue(titre);

    // Lire, puis renvoyer la liste corrigée : l'écran ouvert suit sans recharger.
    const lu = JSON.parse((await appel("lire_conversation", { conversation: titre })).texte) as { messages: Array<Record<string, unknown>> };
    expect(lu.messages).toHaveLength(3);
    const messages = lu.messages.map((m) => {
      const copie = { ...m };
      delete copie.n;
      return copie;
    });
    messages[1] = { ...messages[1], texte: "t'es où ?" };
    const modif = await appel("modifier_conversation", { conversation: titre, messages });
    expect(modif.erreur, modif.texte).toBe(false);
    await expect(apercu.getByText("t'es où ?", { exact: true })).toBeVisible();
    await expect(apercu.getByText("tu fais quoi ce soir ?", { exact: true })).toHaveCount(0);

    // Défaire remet la version d'avant — toujours en direct.
    const d1 = await defaire("modifier_conversation");
    expect(d1.erreur, d1.texte).toBe(false);
    await expect(apercu.getByText("tu fais quoi ce soir ?", { exact: true })).toBeVisible();

    // Le titre désigne la conversation : un doublon est refusé.
    const doublon = await appel("creer_conversation", { titre, messages: [{ cote: "recu", texte: "x" }] });
    expect(doublon.erreur).toBe(true);
    expect(doublon.texte).toContain("s'appelle déjà");

    // Un lien qui n'est pas TikTok est refusé avant tout appel réseau.
    const tt = await appel("images_tiktok", { lien: "https://example.com/@compte/video/1" });
    expect(tt.erreur).toBe(true);
    expect(tt.texte).toContain("tiktok.com");

    // Supprimer, puis défaire : la conversation revient (nouveau lien).
    expect((await appel("supprimer_conversation", { conversation: titre })).erreur).toBe(false);
    const titres = async () => (JSON.parse((await appel("conversations", {})).texte).conversations as { titre: string }[]).map((c) => c.titre);
    expect(await titres()).not.toContain(titre);
    const d2 = await defaire("supprimer_conversation");
    expect(d2.erreur, d2.texte).toBe(false);
    expect(await titres()).toContain(titre);
  });

  test("éléments riches écrits par Claude : citation, vocal, appui long — l'écran les dessine", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { appel } = await cle(page, `E2E conv riche ${ts}`);
    const cree = await appel("creer_conversation", {
      titre: `Conv riche ${ts}`,
      langue: "en",
      messages: [
        { cote: "envoye", texte: "t’as hiberné carrément" },
        { cote: "recu", texte: "bah en vrai", reponse: { cote: "envoye", texte: "t’as hiberné carrément" } },
        { type: "vocal", cote: "recu", duree: 9 },
        { cote: "recu", texte: "Ta meuf ?", appui_long: true, heure: "14:35" },
      ],
    });
    expect(cree.erreur, cree.texte).toBe(false);
    await page.goto((JSON.parse(cree.texte).lien as string).replace(/^https?:\/\/[^/]+/, ""));
    const apercu = page.getByRole("img", { name: "Aperçu de la capture" });

    // La citation : l'étiquette, et le texte cité en plus de l'original.
    await expect(apercu.getByText("Replied to you", { exact: true })).toBeVisible();
    await expect(apercu.getByText("t’as hiberné carrément", { exact: true })).toHaveCount(2);
    // Le vocal : sa durée et le lien de transcription.
    await expect(apercu.getByText("0:09", { exact: true })).toBeVisible();
    await expect(apercu.getByText("View transcription", { exact: true })).toBeVisible();
    // L'appui long : le menu par-dessus la conversation floutée, à l'heure du message.
    await expect(apercu.getByText("Reply", { exact: true })).toBeVisible();
    await expect(apercu.getByText("14:35", { exact: true })).toBeVisible();
  });

  test("cartes par Claude : reel et story partagée dessinés ; une image du projet se garde, une inventée est refusée", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { appel } = await cle(page, `E2E conv cartes ${ts}`);

    // Une image du projet, déposée comme le fait l'écran.
    const bleu = await sharp({ create: { width: 360, height: 640, channels: 3, background: "#2050ff" } }).jpeg().toBuffer();
    const envoi = await fetch(await admin.mutation(api.instaConvImages.generateInstaConvUploadUrl, {}), {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: new Uint8Array(bleu),
    });
    const { storageId } = (await envoi.json()) as { storageId: Id<"_storage"> };
    const image = await admin.mutation(api.instaConvImages.registerInstaConvImage, { storageId, w: 360, h: 640 });

    // Un id qui n'est pas une image de ce projet ne passe pas.
    const invente = await appel("creer_conversation", { titre: `Cartes refus ${ts}`, messages: [{ type: "photo", cote: "envoye", image: "img:k17abcdefghijkl" }] });
    expect(invente.erreur).toBe(true);
    expect(invente.texte).toContain("inconnue dans ce projet");

    const titre = `Cartes ${ts}`;
    const cree = await appel("creer_conversation", {
      titre,
      langue: "en",
      messages: [
        { type: "reel", cote: "recu", compte: "plein_astuces_", certifie: true },
        { type: "story_partagee", cote: "recu", compte: "chloe.difrancesco", image: `img:${image.id}` },
      ],
    });
    expect(cree.erreur, cree.texte).toBe(false);
    await page.goto((JSON.parse(cree.texte).lien as string).replace(/^https?:\/\/[^/]+/, ""));
    const apercu = page.getByRole("img", { name: "Aperçu de la capture" });
    await expect(apercu.getByText("plein_astuces_", { exact: true })).toBeVisible();
    await expect(apercu.getByText("Sent @chloe.difrancesco's story", { exact: true })).toBeVisible();
    // Le reel sans image attend dans un cadre gris ; la story montre l'image du projet.
    await expect(apercu.locator('img[src*="/api/storage/"]')).toHaveCount(1);

    // Claude relit l'image sous la forme qu'il renverra pour la garder.
    const lu = JSON.parse((await appel("lire_conversation", { conversation: titre })).texte) as { messages: Array<Record<string, unknown>> };
    expect(lu.messages[1]).toMatchObject({ type: "story_partagee", compte: "chloe.difrancesco", image: `img:${image.id}` });
    expect(lu.messages[0]).toMatchObject({ type: "reel", compte: "plein_astuces_", certifie: true });
  });
});
