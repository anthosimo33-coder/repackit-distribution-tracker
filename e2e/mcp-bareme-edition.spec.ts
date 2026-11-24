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
 * OUTILS MCP `creer_bareme` et `modifier_bareme` — les termes d'un barème, par
 * Claude, sous l'interrupteur « Barèmes ».
 *
 * Ce que la spec tient :
 *  1. l'interrupteur ouvre les deux outils ; `simuler` n'écrit rien ;
 *  2. créer avec un minimum de vues par vidéo ; un nom déjà pris est refusé ;
 *  3. modifier UN terme laisse les autres en place — le piège : le cœur de
 *     l'écran efface seuil et minimum s'ils ne sont pas renvoyés ;
 *  4. `defaire` remet les termes d'avant, refuse si le barème a rebougé, et
 *     supprime un barème créé qui n'a servi à rien.
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

test.describe("MCP — creer_bareme / modifier_bareme", () => {
  test("simuler, créer avec un minimum, modifier un terme, défaire", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const slug = `e2e-mcp-bareme-${ts}`;
    const nom = `E2E MCP barème ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };
    const bareme = `Créateur Snytch 🇫🇷 - 240€/mois ${ts}`;
    const lire = async () =>
      (await admin.query(api.pricing.listPricings, { projectId, includeArchived: true })).find((p) => p._id === idCree) ??
      null;
    let idCree: string | null = null;

    try {
      await admin.mutation(api.projects.e2eSetProjectCurrency, {
        secret: E2E_SECRET,
        projectId,
        payCurrency: "eur",
        fxRateToRevenue: null,
      });
      const { appel, outils, ferme } = await cleBaremes(page, `E2E barème ${ts}`, slug);

      // ── 1. L'interrupteur ouvre les outils ───────────────────────────────────
      expect(ferme).not.toContain("creer_bareme");
      expect(ferme).not.toContain("modifier_bareme");
      expect(await outils()).toEqual(expect.arrayContaining(["creer_bareme", "modifier_bareme"]));

      const termes = { nom: bareme, fixe: 240, nb_videos: 30, cpm: 0, min_vues_par_video: 200 };
      const sim = await appel("creer_bareme", { ...termes, simuler: true });
      expect(sim.erreur, sim.texte).toBe(false);
      expect(JSON.parse(sim.texte).simulation.bareme.fixe).toBe("240 EUR pour 30 vidéos (8 EUR par vidéo)");
      expect(await admin.query(api.pricing.listPricings, { projectId })).toHaveLength(0);

      // ── 2. Créer ──────────────────────────────────────────────────────────────
      const cree = await appel("creer_bareme", termes);
      expect(cree.erreur, cree.texte).toBe(false);
      idCree = (await admin.query(api.pricing.listPricings, { projectId })).find((p) => p.name === bareme)!._id;
      expect(await lire()).toMatchObject({ montantFixe: 240, nbVideosCible: 30, tauxCPM: 0, minVuesParVideo: 200, currency: "eur" });

      const doublon = await appel("creer_bareme", { ...termes, nom: bareme.toUpperCase() });
      expect(doublon.erreur).toBe(true);
      expect(doublon.texte).toContain("Un barème s'appelle déjà");

      // La liste, sans barème désigné.
      const liste = JSON.parse((await appel("modifier_bareme", { simuler: true })).texte).simulation.baremes as {
        nom: string;
        minimumParVideo: string;
      }[];
      expect(liste).toContainEqual(
        expect.objectContaining({ nom: bareme, minimumParVideo: "une vidéo touche son fixe à partir de 200 vues" }),
      );

      // ── 3. Modifier UN terme : le minimum reste ───────────────────────────────
      const cpm = await appel("modifier_bareme", { bareme, cpm: 1.1 });
      expect(cpm.erreur, cpm.texte).toBe(false);
      expect(JSON.parse(cpm.texte).fait).toBe(`Barème « ${bareme} » modifié : CPM : 0 EUR → 1,1 EUR`);
      expect(await lire()).toMatchObject({ tauxCPM: 1.1, minVuesParVideo: 200, montantFixe: 240 });

      const retire = await appel("modifier_bareme", { bareme, min_vues_par_video: 0 });
      expect(retire.erreur, retire.texte).toBe(false);
      expect((await lire())!.minVuesParVideo).toBe(0);
      expect((await lire())!.tauxCPM).toBe(1.1);

      // ── 4. Défaire ────────────────────────────────────────────────────────────
      const journal = async () =>
        JSON.parse((await appel("modifications", { limite: 20 })).texte).modifications as {
          rang: number;
          outil: string;
          etat: string;
        }[];
      const derniere = (await journal()).find((m) => m.outil === "modifier_bareme")!;
      expect(derniere.etat).toBe("se défait");
      const defait = await appel("defaire", { rang: derniere.rang, outil: "modifier_bareme" });
      expect(defait.erreur, defait.texte).toBe(false);
      expect(await lire()).toMatchObject({ minVuesParVideo: 200, tauxCPM: 1.1 });

      // Le CPM rebouge à l'écran : défaire sa modification n'écrase rien.
      await admin.mutation(api.pricing.updatePricing, {
        projectId,
        id: idCree as Id<"pricings">,
        name: bareme,
        montantFixe: 240,
        nbVideosCible: 30,
        tauxCPM: 1.2,
        minVuesParVideo: 200,
      });
      const rangCpm = (await journal()).filter((m) => m.outil === "modifier_bareme")[1].rang;
      const perime = await appel("defaire", { rang: rangCpm, outil: "modifier_bareme" });
      expect(perime.erreur).toBe(true);
      expect(perime.texte).toContain("Ses termes ont changé depuis");
      expect((await lire())!.tauxCPM).toBe(1.2);

      // La création se défait si le barème est revenu à ses termes de départ et n'a servi à rien.
      await admin.mutation(api.pricing.updatePricing, {
        projectId,
        id: idCree as Id<"pricings">,
        name: bareme,
        montantFixe: 240,
        nbVideosCible: 30,
        tauxCPM: 0,
        minVuesParVideo: 200,
      });
      const rangCreation = (await journal()).find((m) => m.outil === "creer_bareme")!.rang;
      const supprime = await appel("defaire", { rang: rangCreation, outil: "creer_bareme" });
      expect(supprime.erreur, supprime.texte).toBe(false);
      expect(await lire()).toBeNull();
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nom });
    }
  });
});
