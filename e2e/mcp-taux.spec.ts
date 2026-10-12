import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Page } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * OUTIL MCP `regler_taux` — les taux de change du projet, par Claude, sous
 * l'interrupteur « Barèmes ».
 *
 * Ce que la spec tient :
 *  1. l'interrupteur « Barèmes » ouvre l'outil ; `simuler` montre la cible et
 *     le verdict sans rien écrire ;
 *  2. il écrit par le geste de l'écran, donc sous sa règle : un taux sur la
 *     devise du revenu, ou le retrait du taux de paie quand le revenu est
 *     ailleurs, est refusé sans rien écrire ;
 *  3. `defaire` remet le taux d'avant ; il refuse si le taux a rebougé depuis,
 *     et il refuse un retour en arrière que la règle interdit (le taux de paie
 *     ne se retire pas) — rien n'est écrasé.
 */

type Rpc = { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };

async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}

/** Une clé créée dans l'écran, interrupteur « Barèmes » ouvert, qui vise `projet`. */
async function cleBaremes(page: Page, nom: string, projet: string) {
  await page.goto(adminPath("/comptes"));
  await page.getByRole("button", { name: "Connecter Claude" }).click();
  await page.getByLabel("Nom de la clé").fill(nom);
  await page.getByRole("button", { name: "Créer une clé" }).click();
  const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
  const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
  await page.getByRole("button", { name: "J’ai copié la clé" }).click();
  const outils = async () =>
    ((await rpc(url, token, "tools/list")).result as unknown as { tools: { name: string }[] }).tools.map((t) => t.name);
  const ferme = await outils();
  const interrupteur = page.getByRole("switch", { name: `Modifications des barèmes pour ${nom}` });
  await interrupteur.click();
  await expect(interrupteur).toBeChecked();
  const appel = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc(url, token, "tools/call", { name, arguments: { projet, ...args } });
    return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
  };
  return { appel, outils, ferme };
}

test.describe("MCP — regler_taux", () => {
  test("simuler, écrire, refus de la règle, défaire (et ses refus)", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const slug = `e2e-mcp-taux-${ts}`;
    const nom = `E2E MCP taux ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };
    const tauxUsd = async () =>
      (await admin.query(api.fxRates.getFxRates, { projectId }))!.rows.find((r) => r.currency === "usd")?.rate ?? null;

    try {
      // Le cas de Snytch : paie en dollars, revenu en euros, un barème en dollars.
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "usd",
        fxRateToRevenue: null,
      });
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_mcp_taux_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.whopSync.e2eSeedWhopPayment, {
        secret: E2E_SECRET,
        projectId,
        whopId: `pay_e2e_mcp_taux_${ts}`,
        status: "paid",
        grossAmount: 1999,
        netAmount: 1873.42,
        paidAt: Date.now(),
        currency: "eur",
      });
      await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] US CPM ${ts}`,
        currency: "usd",
        montantFixe: 0,
        nbVideosCible: 30,
        tauxCPM: 1,
      });

      const { appel, outils, ferme } = await cleBaremes(page, `E2E taux ${ts}`, slug);
      // ── 1. L'interrupteur ouvre l'outil ───────────────────────────────────────
      expect(ferme).not.toContain("regler_taux");
      expect(await outils()).toContain("regler_taux");

      const etat = await appel("regler_taux", { simuler: true });
      expect(etat.erreur, etat.texte).toBe(false);
      const sim = JSON.parse(etat.texte).simulation as {
        etat: { deviseCible: string; devises: { devise: string; taux: number | null; role: string[] }[] };
      };
      expect(sim.etat.deviseCible).toBe("EUR");
      expect(sim.etat.devises).toContainEqual(
        expect.objectContaining({ devise: "USD", taux: null, role: ["devise de paie", "1 barème(s)"] }),
      );

      const verdict = await appel("regler_taux", { devise: "usd", taux: 0.86, simuler: true });
      expect(JSON.parse(verdict.texte).simulation.verdict).toBe("accepté : 1 USD = 0,86 EUR");
      // Simuler n'écrit rien.
      expect(await tauxUsd()).toBeNull();

      // ── 2. Écrire, sous la règle de l'écran ───────────────────────────────────
      const pose = await appel("regler_taux", { devise: "USD", taux: 0.86 });
      expect(pose.erreur, pose.texte).toBe(false);
      expect(JSON.parse(pose.texte).fait).toBe("Taux USD : 1 USD = 0,86 EUR (avant : aucun taux)");
      expect(await tauxUsd()).toBe(0.86);

      const surCible = await appel("regler_taux", { devise: "eur", taux: 1 });
      expect(surCible.erreur).toBe(true);
      expect(surCible.texte).toContain("EUR est la devise du revenu");
      const retrait = await appel("regler_taux", { devise: "usd", retirer: true });
      expect(retrait.erreur).toBe(true);
      expect(retrait.texte).toContain("la marge ne se calculerait plus");
      expect(await tauxUsd()).toBe(0.86);

      const corrige = await appel("regler_taux", { devise: "usd", taux: 0.9 });
      expect(JSON.parse(corrige.texte).fait).toBe("Taux USD : 1 USD = 0,9 EUR (avant : 0,86 EUR)");

      // ── 3. Défaire ────────────────────────────────────────────────────────────
      const journal = async () =>
        JSON.parse((await appel("modifications", { limite: 10 })).texte).modifications as {
          rang: number;
          outil: string;
          etat: string;
        }[];
      const [derniere] = (await journal()).filter((m) => m.outil === "regler_taux");
      expect(derniere.etat).toBe("se défait");
      const defait = await appel("defaire", { rang: derniere.rang, outil: "regler_taux" });
      expect(defait.erreur, defait.texte).toBe(false);
      expect(await tauxUsd()).toBe(0.86);

      // La première pose (aucun taux → 0,86) : la défaire RETIRERAIT le taux de
      // paie, ce que la règle refuse. Rien n'est écrit.
      // Le journal a bougé (le défaire s'y inscrit) : relire les rangs.
      const rangPremiere = (await journal()).filter((m) => m.outil === "regler_taux")[1].rang;
      const refuse = await appel("defaire", { rang: rangPremiere, outil: "regler_taux" });
      expect(refuse.erreur).toBe(true);
      expect(refuse.texte).toContain("Rien n'a été remis");
      expect(refuse.texte).toContain("la marge ne se calculerait plus");
      expect(await tauxUsd()).toBe(0.86);

      // Un taux qui a rebougé depuis (à l'écran) n'est jamais écrasé.
      const repose = await appel("regler_taux", { devise: "usd", taux: 0.88 });
      expect(repose.erreur, repose.texte).toBe(false);
      await admin.mutation(api.fxRates.setFxRate, { projectId, currency: "usd", rate: 0.87 });
      const rangRepose = (await journal()).find((m) => m.outil === "regler_taux")!.rang;
      const perime = await appel("defaire", { rang: rangRepose, outil: "regler_taux" });
      expect(perime.erreur).toBe(true);
      expect(perime.texte).toContain("Le taux USD a changé depuis");
      expect(await tauxUsd()).toBe(0.87);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});
