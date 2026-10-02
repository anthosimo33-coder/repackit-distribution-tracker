import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
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

type Rpc = { result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }; error?: { message: string } };

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

/**
 * PROPOSITIONS DE CLAUDE — une connexion en LECTURE SEULE propose ; l'équipe
 * applique ou écarte d'un clic sur l'accueil. Appliquer appelle l'outil
 * d'écriture lui-même (la mission est réellement créée, journalisée au nom de la
 * personne qui clique) ; écarter est respecté (pas de nouvelle proposition
 * identique) ; un refus à l'application laisse la proposition en attente, avec
 * le message.
 */
test.describe("MCP — propositions de Claude", () => {
  test("proposer en lecture seule, appliquer et écarter dans l'app", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const P = E2E_PROJECT_SLUG;
    const nom = `Clara Vidal ${ts}`;
    const clara = await createCreatorSession(convexUrl, { name: `[E2E_TEST] ${nom}`, email: `e2e-mcp-prop-${ts}@repackit.test`, password: "clara-12345" });
    await availableTarget({ e2eClient: admin, creatorId: clara.creatorId, platform: "TikTok", handle: `@claravidal${ts}` });
    const campagne = `Propositions ${ts}`;
    const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${campagne}` })) as Id<"scriptCampaigns">;
    for (const [kind, label] of [["hook", "Hook vitrine"], ["flux", "Flux scan"], ["cta", "CTA bio"]] as const) {
      await admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content: `${label} ${ts}` });
    }
    const bareme = `Barème propositions ${ts}`;
    await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] ${bareme}`, montantFixe: 60, nbVideosCible: 6, tauxCPM: 1.25 });
    const missions = async () => (await admin.query(api.assignments.listAssignments, {})).filter((a) => a.creatorId === clara.creatorId);

    // ── Une clé en LECTURE SEULE : elle propose, elle n'écrit pas ─────────────
    const nomCle = `E2E routine ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    const noms = ((await rpc(url, token, "tools/list")).result?.tools ?? []).map((t) => t.name);
    expect(noms).toEqual(expect.arrayContaining(["proposer", "propositions"]));
    expect(noms).not.toContain("assigner_scripts");
    const appel = async (name: string, args: Record<string, unknown>) => {
      const r = await rpc(url, token, "tools/call", { name, arguments: { projet: P, ...args } });
      return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
    };

    const J3 = jourParis(3);
    const assigner = { campagne, createatrices: [nom], jours: [J3], bareme };
    const resume = `Assigner 1 script « ${campagne} » à ${nom} pour le ${J3}`;
    const p1 = await appel("proposer", {
      outil: "assigner_scripts",
      arguments: assigner,
      resume,
      pourquoi: "Aucune mission dans les 7 prochains jours ; 100 % à l'heure sur 4 semaines.",
      lot: `Routine ${ts}`,
    });
    expect(p1.erreur, p1.texte).toBe(false);
    expect(await missions()).toHaveLength(0);
    // Mêmes arguments en attente : refusé. Arguments invalides, simulation : refusés.
    expect((await appel("proposer", { outil: "assigner_scripts", arguments: assigner, resume, pourquoi: "x" })).texte).toContain("attend déjà");
    expect((await appel("proposer", { outil: "assigner_scripts", arguments: { ...assigner, couleur: "rouge" }, resume, pourquoi: "x" })).texte).toContain(
      "Arguments de assigner_scripts",
    );
    expect((await appel("proposer", { outil: "assigner_scripts", arguments: { ...assigner, simuler: true }, resume, pourquoi: "x" })).texte).toContain(
      "ne se simule pas",
    );
    const lues = JSON.parse((await appel("propositions", {})).texte) as { enAttente: { resume: string; statut: string }[] };
    expect(lues.enAttente.filter((x) => x.resume === resume)).toEqual([expect.objectContaining({ statut: "en attente" })]);

    // ── Sur l'accueil : appliquer crée réellement la mission ──────────────────
    await page.goto(adminPath("/dashboard"));
    const carte = page.getByTestId("propositions-claude");
    const ligne = carte.getByTestId("proposition").filter({ hasText: resume });
    await expect(ligne).toBeVisible();
    await expect(ligne).toContainText("Assigner des scripts");
    await expect(ligne).toContainText(nomCle);
    await ligne.getByRole("button", { name: "Appliquer" }).click();
    await expect(page.getByText(/Appliquée :/)).toBeVisible();
    await expect(ligne).toHaveCount(0);
    expect(await missions()).toHaveLength(1);
    const appliquees = JSON.parse((await appel("propositions", {})).texte) as { decidees: { resume: string; statut: string; fait?: string }[] };
    expect(appliquees.decidees.find((x) => x.resume === resume)).toMatchObject({ statut: "appliquée" });

    // ── Écarter : respecté, la même proposition n'est pas reposée ─────────────
    const relance = { createatrice: nom, jour: J3 };
    const resumeRelance = `Relancer ${nom} sur sa mission du ${J3}`;
    expect((await appel("proposer", { outil: "relancer", arguments: relance, resume: resumeRelance, pourquoi: "Rien soumis à J-1." })).erreur).toBe(false);
    await page.reload();
    const ligneRelance = carte.getByTestId("proposition").filter({ hasText: resumeRelance });
    await ligneRelance.getByRole("button", { name: "Écarter" }).click();
    await expect(ligneRelance).toHaveCount(0);
    expect((await appel("proposer", { outil: "relancer", arguments: relance, resume: resumeRelance, pourquoi: "Rien soumis." })).texte).toContain(
      "écartée il y a moins de 14 jours",
    );

    // ── Un refus à l'application : la proposition reste en attente, avec le message
    const resumeFaux = `Replanifier la mission de ${nom} du ${jourParis(9)}`;
    expect(
      (await appel("proposer", {
        outil: "replanifier_mission",
        arguments: { createatrice: nom, jour: jourParis(9), nouveau_jour: jourParis(10) },
        resume: resumeFaux,
        pourquoi: "Test d'une désignation périmée.",
      })).erreur,
    ).toBe(false);
    await page.reload();
    const ligneFausse = carte.getByTestId("proposition").filter({ hasText: resumeFaux });
    await ligneFausse.getByRole("button", { name: "Appliquer" }).click();
    await expect(ligneFausse).toContainText("Dernière tentative refusée");
    await expect(ligneFausse).toContainText("Aucune mission de");
    expect((await missions()).map((m) => m.postDate)).toHaveLength(1);
    await ligneFausse.getByRole("button", { name: "Écarter" }).click();
    await expect(ligneFausse).toHaveCount(0);

    // ── Le journal dit qui a appliqué, et d'où ça vient ───────────────────────
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    const journal = page.getByTestId("mcp-journal");
    await expect(journal).toContainText(`Proposition de ${nomCle}`);
    await expect(journal).toContainText(`[E2E_TEST] ${nom} : 1 vidéo`);
  });
});
