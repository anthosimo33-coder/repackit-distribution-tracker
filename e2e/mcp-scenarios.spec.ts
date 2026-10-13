import path from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import type { Page } from "@playwright/test";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const BIBLE_C2 = JSON.parse(
  readFileSync(path.resolve(__dirname, "../docs/scenarios/bibles/bible_C2.json"), "utf8"),
) as Record<string, unknown>;

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
  const noms = async () => ((await rpc(url, token, "tools/list")).result?.tools ?? []).map((t) => t.name);
  // Lecture : toujours là ; écriture : seulement avec l'interrupteur.
  expect(await noms()).toEqual(expect.arrayContaining(["scenarios", "lire_scenario", "tester_scenario"]));
  expect(await noms()).not.toContain("creer_scenario");
  const interrupteur = page.getByRole("switch", { name: `Modifications des scripts pour ${nom}` });
  await interrupteur.click();
  await expect(interrupteur).toBeChecked();
  expect(await noms()).toEqual(
    expect.arrayContaining(["creer_scenario", "modifier_scenario", "activer_scenario", "scenarios_campagne", "ajouter_notifs"]),
  );
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
 * SCÉNARIOS PAR CLAUDE (étape 4) — créer une bible en brouillon (vérifiée champ
 * par champ), la lire, la tester pour un prénom (stats + liens qui génèrent et
 * téléchargent la conv dans le navigateur), l'activer, cocher son thème sur une
 * campagne — et tout défaire. Plus les deux trous comblés : `ajouter_notifs` et
 * les champs du hook libre sur `ajouter_hooks`.
 */
test.describe("MCP — scénarios de conversation", () => {
  test("créer, lire, tester (lien = téléchargement), activer, cocher le thème — et défaire", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const { appel, defaire } = await cle(page, `E2E scénarios ${ts}`);
    const code = `K${ts.toString(36).toUpperCase()}`.slice(0, 12);
    const theme = `Il revient ${ts}`;

    // ── Une bible fausse est refusée, champ par champ, sans rien écrire.
    const fausse = await appel("creer_scenario", { bible: { ...BIBLE_C2, id: code, type: "voisin" }, theme });
    expect(fausse.erreur).toBe(true);
    expect(fausse.texte).toContain("Bible refusée");
    expect(fausse.texte).toContain("type : type");

    // ── Créée en brouillon, désignée par son code.
    const cree = await appel("creer_scenario", { bible: { ...BIBLE_C2, id: code }, theme });
    expect(cree.erreur, cree.texte).toBe(false);
    const c = JSON.parse(cree.texte) as { fait: string; code: string; lien: string; pourDefaire: string };
    expect(c.code).toBe(code);
    expect(c.fait).toContain("créé en brouillon");
    expect(c.lien).toMatch(new RegExp(`/admin/${E2E_PROJECT_SLUG}/scenarios/`));

    const liste = JSON.parse((await appel("scenarios", {})).texte) as { themes: string[]; scenarios: { code: string; statut: string; theme: string }[] };
    expect(liste.scenarios.find((s) => s.code === code)).toMatchObject({ statut: "brouillon", theme });
    expect(liste.themes).toContain(theme);
    const lu = JSON.parse((await appel("lire_scenario", { scenario: code.toLowerCase() })).texte) as { bible: { id: string; lui: string } };
    expect(lu.bible.id).toBe(code);
    expect(lu.bible.lui).toBe("Yanis");

    // ── Tester : le moteur des missions, dates de la bible → l'écran choc tel qu'écrit.
    const t = JSON.parse((await appel("tester_scenario", { scenario: code, prenom: "Kelly", dates: "bible" })).texte) as {
      fichier: string;
      stats: { messages: number; record: { jour: string } };
      fin: string[];
      liens: { txt: string; zip: string; png?: string };
    };
    expect(t.fichier).toBe("WhatsApp Chat - Kelly, Yanis.txt");
    expect(t.stats.messages).toBeGreaterThan(5_300);
    expect(t.stats.messages).toBeLessThan(6_500);
    expect(t.stats.record.jour).toBe("2026-02-14");
    expect(t.fin).toHaveLength(5);
    expect(t.fin.at(-1)).toMatch(/22:33:05\] Kelly: t'as raison pardon$/);
    expect(t.liens.zip).toContain("telecharger=zip");
    expect(t.liens.png).toBeUndefined();
    expect(t.liens.txt).toContain("tester=Kelly");
    expect(t.liens.txt).toContain("telecharger=txt");

    // Le lien télécharge CETTE conv à l'ouverture, puis quitte `telecharger`.
    const telechargement = page.waitForEvent("download");
    await page.goto(t.liens.txt.replace(/^https?:\/\/[^/]+/, ""));
    const fichier = await telechargement;
    expect(fichier.suggestedFilename()).toBe("WhatsApp Chat - Kelly, Yanis.txt");
    const texte = readFileSync((await fichier.path())!, "utf8");
    expect(texte.trimEnd().split(/\r?\n/).at(-1)).toBe(t.fin.at(-1));
    await expect(page).not.toHaveURL(/telecharger=/);
    await expect(page.getByTestId("scenario-stats")).toContainText("Kelly");

    // ── Modifier le thème, puis défaire : le thème d'avant revient.
    const autre = `Autre ${ts}`;
    const modif = await appel("modifier_scenario", { scenario: code, theme: autre });
    expect(modif.erreur, modif.texte).toBe(false);
    const scenarioDb = async () => (await admin.query(api.scenarios.listScenarios, {})).find((s) => s.code === code);
    expect((await scenarioDb())?.theme).toBe(autre);
    expect((await defaire("modifier_scenario")).erreur).toBe(false);
    expect((await scenarioDb())?.theme).toBe(theme);

    // ── Activer, puis cocher son thème sur une campagne (casse ignorée).
    expect((await appel("activer_scenario", { scenario: code, statut: "actif" })).erreur).toBe(false);
    const campaignId = await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] Scénarios MCP ${ts}` });
    const inconnu = await appel("scenarios_campagne", { campagne: `Scénarios MCP ${ts}`, themes: [`Inventé ${ts}`] });
    expect(inconnu.erreur).toBe(true);
    expect(inconnu.texte).toContain("aucun scénario du projet");
    const coche = await appel("scenarios_campagne", { campagne: `Scénarios MCP ${ts}`, themes: [theme.toUpperCase()] });
    expect(coche.erreur, coche.texte).toBe(false);
    expect(JSON.parse(coche.texte).enRotation).toEqual([code]);
    const campagne = async () => (await admin.query(api.scripts.getCampaign, { id: campaignId }))!;
    expect(await campagne()).toMatchObject({ conversationEnabled: true, conversationThemes: [theme] });
    // L'écran de la campagne le montre coché.
    await page.goto(adminPath(`/scripts/${campaignId}`));
    await expect(
      page.getByTestId("conversation-themes").getByRole("checkbox", { name: new RegExp(`^${theme}(\\s|$)`) }),
    ).toBeChecked({ timeout: 15_000 });

    // ── Tout se défait, dans l'ordre inverse.
    expect((await defaire("scenarios_campagne")).erreur).toBe(false);
    expect(await campagne()).toMatchObject({ conversationEnabled: false, conversationThemes: [] });
    expect((await defaire("activer_scenario")).erreur).toBe(false);
    expect((await scenarioDb())?.statut).toBe("brouillon");
    expect((await defaire("creer_scenario")).erreur).toBe(false);
    expect(await scenarioDb()).toBeUndefined();
  });

  test("ajouter_notifs (désactivées, doublons, défaire) et hook libre par `exemples`", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const { appel, defaire } = await cle(page, `E2E notifs ${ts}`);
    const nom = `[E2E_TEST] Notifs MCP ${ts}`;
    const campaignId = await admin.mutation(api.scripts.createCampaign, { name: nom });
    const briques = async (kind: string) =>
      (await admin.query(api.scripts.getCampaign, { id: campaignId }))!.bricks.filter((b) => b.kind === kind);

    const n = await appel("ajouter_notifs", {
      campagne: nom,
      notifs: [{ texte: `Yanis : « t'es où ? » ${ts}` }, { texte: `Maman : appelle-moi ${ts}`, consigne: "En haut de l'écran" }],
    });
    expect(n.erreur, n.texte).toBe(false);
    const r = JSON.parse(n.texte) as { fait: string; attention?: string };
    expect(r.fait).toContain("2 notifs ajoutées (désactivées)");
    expect(r.attention).toContain("Notif dans la vidéo");
    const notifs = await briques("notif");
    expect(notifs.map((b) => b.active)).toEqual([false, false]);
    expect(notifs.find((b) => b.content.startsWith("Maman"))?.instruction).toBe("En haut de l'écran");
    const doublon = JSON.parse((await appel("ajouter_notifs", { campagne: nom, notifs: [{ texte: `yanis : « T'ES OÙ ? » ${ts}` }] })).texte);
    expect(doublon.dejaPresents).toHaveLength(1);
    expect((await defaire("ajouter_notifs")).erreur).toBe(false);
    expect(await briques("notif")).toHaveLength(0);

    // Hook libre : `exemples` (nom de la spec) rend le hook libre et garde les exemples.
    const h = await appel("ajouter_hooks", {
      campagne: nom,
      hooks: [{ texte: `Il m'a remplacée en 3 jours ${ts}`, direction: "Le choc de la découverte", exemples: [`3 jours. Trois. ${ts}`] }],
    });
    expect(h.erreur, h.texte).toBe(false);
    const [hook] = await briques("hook");
    expect(hook).toMatchObject({ libre: true, direction: "Le choc de la découverte", autresExemples: [`3 jours. Trois. ${ts}`] });
  });
});
