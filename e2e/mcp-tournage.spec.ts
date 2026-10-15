import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import type { Page } from "@playwright/test";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { parisDayKey } from "../convex/viewsDaily";
import { veille } from "../convex/scenarioTournageRegles";
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
  expect(noms).toContain("preparer_tournages");
  expect(noms).toContain("liens_tournage");
  expect(noms).toContain("tournages");
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

const BIBLE_C2 = readFileSync(path.resolve(__dirname, "../docs/scenarios/bibles/bible_C2.json"), "utf8");
const DAY = 86_400_000;

/**
 * MODE TOURNAGE PAR CLAUDE — lire l'état des paires créatrice × histoire,
 * préparer les fichiers figés, coller les liens BLUSH (tout ou rien), défaire.
 * La mission de la créatrice suit : rien avant le lien, le lien ensuite.
 */
test.describe("MCP — mode tournage", () => {
  test("tournages, preparer_tournages, liens_tournage, défaire", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const { appel, defaire } = await cle(page, `E2E tournage ${ts}`);
    const code = `M${ts.toString(36).toUpperCase()}`.slice(0, 12);
    const theme = `Tournage MCP ${ts}`;
    await admin.mutation(api.scenarios.creerScenario, { bible: BIBLE_C2.replace('"id": "C2"', `"id": "${code}"`), theme });
    const campaignId = await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] Tournage MCP ${ts}` });
    for (const [kind, content] of [
      ["hook", `On s'est disputés ${ts}`],
      ["flux", `Montre la conv ${ts}`],
      ["cta", `je vois ça que maintenant ${ts}`],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, { campaignId, kind, label: kind, content });
    }
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] Barème tournage MCP ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const nom = `Kelly Martin [E2E_TEST] ${ts}`;
    const kelly = await createCreatorSession(convexUrl, { name: nom, email: `e2e-tournage-mcp-${ts}@repackit.test`, password: "tournmcp-12345" });
    const target = await availableTarget({ e2eClient: admin, creatorId: kelly.creatorId, platform: "TikTok", handle: `@e2etournmcp${ts}` });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: kelly.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      conversationTheme: theme,
    });
    const mission = (await admin.query(api.assignments.listAssignments, {})).find((a) => a.creatorId === kelly.creatorId)!;
    const tournageMission = async () =>
      (await kelly.client.query(api.assignments.getMyAssignment, { projectId: kelly.projectId, id: mission._id as Id<"assignments"> }))!
        .scriptConversation!.tournage;
    type Paire = { histoire: string; etat: string; lien?: string; fichier?: string; missionsQuiAttendent?: number };
    const paire = async (): Promise<Paire> => {
      const r = JSON.parse((await appel("tournages", { createatrice: nom })).texte) as {
        ecran: string;
        createatrices: { createatrice: string; histoires: Paire[] }[];
      };
      expect(r.ecran).toContain("/scenarios/tournage");
      expect(r.createatrices.map((c) => c.createatrice)).toEqual([nom]);
      return r.createatrices[0]!.histoires.find((h) => h.histoire.startsWith(`${code} ·`))!;
    };

    // ── Rien de préparé : la mission attend.
    expect(await paire()).toMatchObject({ etat: "à préparer", missionsQuiAttendent: 1 });

    // ── Préparer CE fichier.
    const prep = await appel("preparer_tournages", { createatrice: nom, histoires: [code] });
    expect(prep.erreur, prep.texte).toBe(false);
    expect(JSON.parse(prep.texte).fait).toContain(`1 fichier de tournage préparé (${code})`);
    const [a, m, j] = veille(parisDayKey(Date.now())).split("-");
    // L'API BLUSH (la fausse, en e2e) a reçu la demande : le lien est en création.
    expect(await paire()).toMatchObject({ etat: "lien en création", missionsQuiAttendent: 1 });
    expect((await paire()).fichier).toContain(`finit le ${a}-${m}-${j}`);
    expect(await tournageMission()).toBeNull();
    // Repréparer : rien de nouveau, le fichier reste.
    expect(JSON.parse((await appel("preparer_tournages", { createatrice: nom, histoires: [code] })).texte).fait).toContain("rien de nouveau");

    // ── Tout ou rien : un faux lien et une histoire inconnue, et rien n'est collé.
    const lien = `https://askblush.com/tournage/mcp-${ts}`;
    const rate = await appel("liens_tournage", {
      liens: [
        { createatrice: nom, histoire: code, lien },
        { createatrice: nom, histoire: "ZZZ-inconnue", lien },
        { createatrice: nom, histoire: code, lien: "askblush.com/pas-un-lien" },
      ],
    });
    expect(rate.erreur).toBe(true);
    expect(rate.texte).toContain("Rien n'a été collé");
    expect((await paire()).etat).toBe("lien en création");

    // ── Le vrai lien : la mission le reçoit.
    const ok = await appel("liens_tournage", { liens: [{ createatrice: nom, histoire: code, lien }] });
    expect(ok.erreur, ok.texte).toBe(false);
    expect(await paire()).toMatchObject({ etat: "prêt", lien });
    expect((await paire()).missionsQuiAttendent).toBeUndefined();
    expect(await tournageMission()).toEqual({ lien, prenom: "Kelly" });

    // ── Défaire la préparation est refusé tant qu'un lien est collé.
    const refuse = await defaire("preparer_tournages");
    expect(refuse.erreur).toBe(true);
    expect(refuse.texte).toContain("lien collé");
    // Défaire le lien, puis la préparation.
    expect((await defaire("liens_tournage")).erreur).toBe(false);
    expect(await tournageMission()).toBeNull();
    expect((await paire()).etat).toBe("lien en création");
    expect((await defaire("preparer_tournages")).erreur).toBe(false);
    expect(await paire()).toMatchObject({ etat: "à préparer", missionsQuiAttendent: 1 });
  });
});
