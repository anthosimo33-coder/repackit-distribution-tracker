import { createHash, randomBytes } from "node:crypto";
import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Serveur MCP Jarvia — de la clé créée dans l'écran jusqu'aux réponses des
 * outils, par de VRAIES requêtes HTTP sur `<site>/mcp`.
 *
 * La promesse à tenir : Claude ne voit que ce que la personne voit dans l'app.
 * D'où trois porteurs de clé — le superadmin e2e (tout), un manager qui a le
 * bloc Créateurs mais PAS Comptes, un admin d'un AUTRE projet — et une
 * créatrice, qui n'obtient pas de clé du tout.
 */

type Rpc = { status: number; json: Record<string, unknown> | null };

async function rpc(url: string, token: string | null, body: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
}

const appel = (id: number, name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

/** Texte renvoyé par un outil (et son drapeau d'erreur). */
function sortie(r: Rpc): { text: string; isError: boolean } {
  const result = r.json?.result as { content: { text: string }[]; isError?: boolean };
  return { text: result.content[0].text, isError: result.isError === true };
}

/** Une clé posée directement pour un utilisateur sans session dans la spec. */
async function clePour(email: string, name: string): Promise<string> {
  const token = `jv_${randomBytes(32).toString("base64url")}`;
  await admin.mutation(api.mcpTokens.e2eInsertMcpToken, {
    secret: E2E_SECRET,
    email,
    name,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    prefix: token.slice(0, 10),
  });
  return token;
}

test.describe("Serveur MCP Jarvia", () => {
  test("clé créée dans l'écran → outils lisibles par HTTP → révoquée, plus rien", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const handle = `@e2emcp${ts}`;
    await admin.mutation(api.comptes.createCompte, {
      handle,
      plateforme: "TikTok",
      notes: "[E2E_TEST] mcp",
      targetCountry: "IS",
    });

    // ── La clé, depuis le pied de la barre latérale ─────────────────────────
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await expect(page.getByRole("heading", { name: "Connecter Claude à l’app" })).toBeVisible();
    const nomCle = `E2E clé ${ts}`;
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const cleEnClair = page.getByTestId("mcp-cle-en-clair");
    await expect(cleEnClair).toHaveText(/^jv_[A-Za-z0-9_-]{40,}$/);
    const token = (await cleEnClair.textContent())!.trim();

    // La commande Claude Code porte l'adresse du serveur ET la clé.
    const commande = page.locator("pre").filter({ hasText: "claude mcp add" });
    await expect(commande).toContainText(token);
    const url = (await commande.textContent())!.match(/jarvia (\S+\/mcp) /)![1];

    // ── Le protocole ────────────────────────────────────────────────────────
    const init = await rpc(url, token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } },
    });
    expect(init.status).toBe(200);
    expect(init.json).toMatchObject({ result: { protocolVersion: "2025-06-18", serverInfo: { name: "jarvia" } } });

    const liste = await rpc(url, token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const noms = (liste.json!.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(noms).toEqual(["projets", "comptes", "createatrices", "ponctualite", "rentabilite", "vues", "meilleurs_posts", "scripts", "revenus", "economie_unitaire", "retention", "marches", "paiements", "planning", "validation", "regarder_video", "defis", "veille", "fiabilite", "parcours", "offres", "acquisition", "dashboard", "sante_produit", "compta", "proposer", "propositions"]);

    // ── Les données : le compte semé, filtré par pays ───────────────────────
    const comptes = sortie(await rpc(url, token, appel(3, "comptes", { projet: "e2e-test", pays: "IS" })));
    expect(comptes.isError).toBe(false);
    const lu = JSON.parse(comptes.text) as { comptes: { handle: string; pays: string; statut: string }[] };
    expect(lu.comptes).toContainEqual(
      expect.objectContaining({ handle, pays: "IS", statut: "actif" }),
    );
    // Aucun compte d'un autre pays ne passe le filtre.
    expect(lu.comptes.every((c) => c.pays === "IS")).toBe(true);

    const ponctualite = sortie(await rpc(url, token, appel(4, "ponctualite", { projet: "e2e-test" })));
    expect(ponctualite.isError).toBe(false);

    // ── L'écran liste la clé, puis la révoque ───────────────────────────────
    const ligne = page.getByRole("listitem").filter({ hasText: nomCle });
    await expect(ligne).toContainText(token.slice(0, 10));
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    await ligne.getByRole("button", { name: "Révoquer" }).click();
    await expect(ligne).toHaveCount(0);

    // Présence juste au-dessus (200), absence ici : la même clé est refusée.
    const apres = await rpc(url, token, { jsonrpc: "2.0", id: 5, method: "ping" });
    expect(apres.status).toBe(401);
  });

  test("les droits de l'app, pas un de plus", async ({ page }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const e2eProjectId = await admin.getProjectId();

    // L'adresse du serveur, lue dans l'écran (seule source côté client).
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(`E2E adresse ${ts}`);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!
      .match(/jarvia (\S+\/mcp) /)![1];

    // 1. Manager du projet e2e : Créateurs OUI, Comptes NON.
    const manager = `e2e-mcp-manager-${ts}@repackit.test`;
    await admin.mutation(api.projects.e2eEnsureMemberUser, {
      secret: E2E_SECRET,
      email: manager,
      projectId: e2eProjectId,
      role: "admin",
    });
    await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
      secret: E2E_SECRET,
      email: manager,
      projectId: e2eProjectId,
      role: "manager",
      permissions: ["creators.read"],
    });
    const cleManager = await clePour(manager, "manager");
    const creatrices = sortie(await rpc(url, cleManager, appel(1, "createatrices", { projet: "e2e-test" })));
    // PRÉSENCE : son bloc lui ouvre bien l'outil…
    expect(creatrices.isError).toBe(false);
    expect(JSON.parse(creatrices.text)).toMatchObject({ projet: "e2e-test" });
    // …ABSENCE : le bloc qu'il n'a pas le lui ferme, comme dans l'app.
    const comptes = sortie(await rpc(url, cleManager, appel(2, "comptes", { projet: "e2e-test" })));
    expect(comptes.isError).toBe(true);
    expect(comptes.text).toMatch(/^Refusé : /);
    // L'argent aussi : sans le bloc business, pas de revenu ni de marge.
    const rentab = sortie(await rpc(url, cleManager, appel(6, "rentabilite", { projet: "e2e-test" })));
    expect(rentab.isError).toBe(true);
    expect(rentab.text).toMatch(/^Refusé : /);

    // 2. Admin d'un AUTRE projet : il voit le sien, pas celui-ci.
    const autreSlug = `e2e-mcp-${ts}`;
    const { projectId: autre } = await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug: autreSlug,
      name: `E2E MCP ${ts}`,
    });
    try {
      const adminAilleurs = `e2e-mcp-ailleurs-${ts}@repackit.test`;
      await admin.mutation(api.projects.e2eEnsureMemberUser, {
        secret: E2E_SECRET,
        email: adminAilleurs,
        projectId: autre,
        role: "admin",
      });
      const cleAilleurs = await clePour(adminAilleurs, "ailleurs");
      const projets = JSON.parse(sortie(await rpc(url, cleAilleurs, appel(3, "projets"))).text);
      expect(projets).toEqual([{ slug: autreSlug, nom: `E2E MCP ${ts}`, role: "admin" }]);
      const intrusion = sortie(await rpc(url, cleAilleurs, appel(4, "comptes", { projet: "e2e-test" })));
      expect(intrusion.isError).toBe(true);
      expect(intrusion.text).toMatch(/Projet inconnu ou inaccessible/);
      // Sans argument, son seul projet est pris par défaut.
      expect(JSON.parse(sortie(await rpc(url, cleAilleurs, appel(5, "comptes"))).text)).toMatchObject({
        projet: autreSlug,
        total: 0,
      });
    } finally {
      await admin.mutation(api.projects.e2eDeleteProject, { secret: E2E_SECRET, slug: autreSlug });
    }

    // 3. Une créatrice (rôle de portail seul) n'obtient pas de clé.
    const creatrice = `e2e-mcp-creatrice-${ts}@repackit.test`;
    await admin.mutation(api.projects.e2eEnsureMemberUser, {
      secret: E2E_SECRET,
      email: creatrice,
      projectId: e2eProjectId,
      role: "creator",
    });
    await expect(clePour(creatrice, "créatrice")).rejects.toThrow(/ERR_MCP_TOKEN_NOT_ALLOWED/);
  });
});
