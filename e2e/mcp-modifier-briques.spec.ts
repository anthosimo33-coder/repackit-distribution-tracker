import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import type { Page } from "@playwright/test";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

type Rpc = { result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }; error?: { message: string } };

async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}

/** Une clé créée dans l'écran, interrupteur « Scripts » allumé. */
async function cle(page: Page, nom: string) {
  await page.goto(adminPath("/comptes"));
  await page.getByRole("button", { name: "Connecter Claude" }).click();
  await page.getByLabel("Nom de la clé").fill(nom);
  await page.getByRole("button", { name: "Créer une clé" }).click();
  const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
  const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
  await page.getByRole("button", { name: "J’ai copié la clé" }).click();
  const interrupteur = page.getByRole("switch", { name: `Modifications des scripts pour ${nom}` });
  await interrupteur.click();
  await expect(interrupteur).toBeChecked();
  await page.keyboard.press("Escape");
  const noms = ((await rpc(url, token, "tools/list")).result?.tools ?? []).map((t) => t.name);
  expect(noms).toContain("modifier_briques");
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
 * MODIFIER LE TEXTE DE BRIQUES PAR CLAUDE — le geste « Modifier » de l'écran :
 * la brique garde son id (et ses stats), tout ou rien, alerte sur une durée
 * encore écrite en dur, et ça se défait. Cas réel : réécrire les briques BLUSH
 * avec les variables de la fiche ({DUREE}, {cest_normal}…).
 */
test.describe("MCP — modifier le texte de briques", () => {
  test("réécrire avec des variables, refuser l'ambigu, alerter sur le dur, défaire", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const { appel, defaire } = await cle(page, `E2E briques ${ts}`);
    const nom = `[E2E_TEST] Briques MCP ${ts}`;
    const campaignId = await admin.mutation(api.scripts.createCampaign, { name: nom });
    const creer = (kind: "hook" | "flux" | "cta", label: string, content: string, extra: Record<string, unknown> = {}) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content, ...extra });
    const h8 = await creer("hook", "Hook 8 ans", `8 ANS D'AMITIÉ ET JE DÉCOUVRE ÇA ??!! ${ts}`);
    await creer("hook", "Hook vu", `Il m'a laissée en vu deux jours ${ts}`, {
      libre: true,
      direction: "Tu ne sais plus quoi lui répondre",
      autresExemples: [`Je savais plus quoi lui répondre ${ts}`],
    });
    const flux = await creer("flux", "Flux S1", `1) Montre la conv (ex. « on est trop proches, c'est mignon »). ${ts}`);
    await creer("cta", "Cta 8 ans", `8 ans d'amitié et je vois ça que maintenant 😭 ${ts}`);
    const briques = async () => (await admin.query(api.scripts.getCampaign, { id: campaignId }))!.bricks;
    const contenu = async (id: Id<"scriptBricks">) => (await briques()).find((b) => b._id === id)!.content;

    // Tout ou rien : une brique introuvable, et rien n'a changé.
    const rate = await appel("modifier_briques", {
      campagne: nom,
      briques: [
        { brique: "Hook 8 ans", texte: `{DUREE} D'AMITIÉ ET JE DÉCOUVRE ÇA ??!! ${ts}` },
        { brique: "inexistante", texte: "x" },
      ],
    });
    expect(rate.erreur).toBe(true);
    expect(rate.texte).toContain("Rien n'a changé");
    expect(await contenu(h8)).toBe(`8 ANS D'AMITIÉ ET JE DÉCOUVRE ÇA ??!! ${ts}`);

    // Les vraies modifications : par libellé, par morceau de texte (+ role), hook libre.
    const ok = await appel("modifier_briques", {
      campagne: nom,
      briques: [
        { brique: "Hook 8 ans", texte: `{DUREE} D'AMITIÉ ET JE DÉCOUVRE ÇA ??!! ${ts}` },
        { brique: "on est trop proches", role: "flux", texte: `1) Montre la conv (ex. « {cest_normal} »). ${ts}` },
        { brique: "laissée en vu", texte: `Il m'a laissée en vu ${ts}`, exemples: [`J'ai envoyé mot pour mot ce que le site m'a dit ${ts}`] },
      ],
    });
    expect(ok.erreur, ok.texte).toBe(false);
    const r = JSON.parse(ok.texte) as { fait: string; attention?: string[] };
    expect(r.fait).toContain("3 briques modifiées");
    expect(r.attention).toBeUndefined();
    expect(await contenu(h8)).toBe(`{DUREE} D'AMITIÉ ET JE DÉCOUVRE ÇA ??!! ${ts}`);
    expect(await contenu(flux)).toBe(`1) Montre la conv (ex. « {cest_normal} »). ${ts}`);
    const libre = (await briques()).find((b) => b.label === "Hook vu")!;
    expect(libre).toMatchObject({
      content: `Il m'a laissée en vu ${ts}`,
      libre: true,
      direction: "Tu ne sais plus quoi lui répondre",
      autresExemples: [`J'ai envoyé mot pour mot ce que le site m'a dit ${ts}`],
    });
    // Le même id : la brique (et ses stats) est la même.
    expect((await briques()).map((b) => b._id)).toContain(h8);

    // Une durée encore en dur, une variable mal écrite : écrit, mais signalé.
    const dur = await appel("modifier_briques", {
      campagne: nom,
      briques: [{ brique: "Cta 8 ans", texte: `3 ans avec {lui} et {prenom} 😭 ${ts}` }],
    });
    const rd = JSON.parse(dur.texte) as { attention: string[] };
    expect(rd.attention.join(" ")).toContain("« 3 ans » écrit en dur");
    expect(rd.attention.join(" ")).toContain("variable inconnue {prenom}");

    // Défaire : le texte d'avant revient, brique par brique.
    expect((await defaire("modifier_briques")).erreur).toBe(false);
    expect((await briques()).find((b) => b.label === "Cta 8 ans")!.content).toBe(`8 ans d'amitié et je vois ça que maintenant 😭 ${ts}`);
    expect((await defaire("modifier_briques")).erreur).toBe(false);
    expect(await contenu(h8)).toBe(`8 ANS D'AMITIÉ ET JE DÉCOUVRE ÇA ??!! ${ts}`);
    expect((await briques()).find((b) => b.label === "Hook vu")!.autresExemples).toEqual([`Je savais plus quoi lui répondre ${ts}`]);
  });
});
