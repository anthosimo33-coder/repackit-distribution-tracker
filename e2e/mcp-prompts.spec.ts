import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { config } from "dotenv";

config({ path: ".env.local" });

type Rpc = { result?: Record<string, unknown>; error?: { code: number; message: string } };

async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}

/**
 * PROMPTS MCP — servis par le vrai serveur, et ADAPTÉS aux domaines que la
 * connexion peut modifier : allumer « Missions » dans l'écran change ce que
 * `planifier_semaine` demande à Claude.
 */
test.describe("MCP — prompts tout prêts", () => {
  test("annoncés, listés, et adaptés à l'interrupteur Missions", async ({ page }) => {
    const nomCle = `E2E prompts ${Date.now()}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();

    const init = await rpc(url, token, "initialize", { protocolVersion: "2025-06-18" });
    expect(init.result?.capabilities).toMatchObject({ prompts: { listChanged: false } });
    const liste = (await rpc(url, token, "prompts/list")).result!.prompts as { name: string }[];
    expect(liste.map((p) => p.name)).toEqual(["point_du_jour", "planifier_semaine", "bilan_du_mois", "labo_hooks", "rejouer_gagnants"]);

    const planifier = async () => {
      const r = await rpc(url, token, "prompts/get", { name: "planifier_semaine", arguments: { projet: E2E_PROJECT_SLUG } });
      return (r.result!.messages as { content: { text: string } }[])[0].content.text;
    };
    // Lecture seule : le plan, pas d'assignation.
    const lecture = await planifier();
    expect(lecture).toContain(`« ${E2E_PROJECT_SLUG} »`);
    expect(lecture).toContain("ne peut pas assigner");
    expect(lecture).not.toContain("assigner_scripts");

    // Missions allumé dans l'écran : simuler, puis assigner après accord.
    const interrupteur = page.getByRole("switch", { name: `Modifications des missions pour ${nomCle}` });
    await interrupteur.click();
    await expect(interrupteur).toBeChecked();
    const ecriture = await planifier();
    expect(ecriture).toContain("`assigner_scripts` avec `simuler: true`");
    expect(ecriture).not.toContain("ne peut pas assigner");

    const refus = await rpc(url, token, "prompts/get", { name: "labo_hooks", arguments: {} });
    expect(refus.error).toMatchObject({ message: "Argument requis manquant : « campagne »." });
  });
});
