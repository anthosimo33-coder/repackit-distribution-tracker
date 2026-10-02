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
 * CAMPAGNES, VEILLE, RELANCE, COMPTE CIBLE — les derniers gestes ouverts à
 * Claude. Une campagne créée par Claude naît DÉSACTIVÉE ; suivre un compte
 * passe par le cœur du bouton (relevé Apify annulé ici : pas de jeton en local) ;
 * chaque geste réversible se défait.
 */
test.describe("MCP — campagnes, veille, relance, compte cible", () => {
  test("créer une campagne désactivée, changer de compte, relancer, suivre, inspirer — et défaire", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const P = E2E_PROJECT_SLUG;
    const nom = `Maëlle Dupuis ${ts}`;
    const maelle = await createCreatorSession(convexUrl, { name: `[E2E_TEST] ${nom}`, email: `e2e-mcp-cv-${ts}@repackit.test`, password: "maelle-12345" });
    const h1 = `@maelledupuis${ts}`;
    const h2 = `@maelle.cartes${ts}`;
    const c1 = await availableTarget({ e2eClient: admin, creatorId: maelle.creatorId, platform: "TikTok", handle: h1 });
    const c2 = await availableTarget({ e2eClient: admin, creatorId: maelle.creatorId, platform: "TikTok", handle: h2 });

    // ── Une clé, trois domaines ───────────────────────────────────────────────
    const nomCle = `E2E campagnes ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    const noms = async () => ((await rpc(url, token, "tools/list")).result?.tools ?? []).map((t) => t.name);
    expect(await noms()).not.toContain("suivre_compte");
    for (const [label, outil] of [["la veille", "suivre_compte"], ["scripts", "creer_campagne"], ["missions", "relancer"]] as const) {
      const interrupteur = page.getByRole("switch", { name: `Modifications ${label === "la veille" ? "de la veille" : `des ${label}`} pour ${nomCle}` });
      await interrupteur.click();
      await expect(interrupteur).toBeChecked();
      expect(await noms()).toContain(outil);
    }
    const appel = async (name: string, args: Record<string, unknown>) => {
      const r = await rpc(url, token, "tools/call", { name, arguments: { projet: P, ...args } });
      return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
    };
    const defaire = async (outil: string) => {
      const liste = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as { rang: number; outil: string; etat: string }[];
      const cible = liste.find((m) => m.outil === outil && m.etat === "se défait");
      expect(cible, `rien à défaire pour ${outil}`).toBeDefined();
      return appel("defaire", { rang: cible!.rang, outil });
    };
    const campagnes = async () => (await admin.query(api.scripts.listCampaigns, {})).filter((c) => c.name === `Labo cartes ${ts}`);

    // ── creer_campagne : tout désactivé, nom unique, défaisable ───────────────
    const cc = await appel("creer_campagne", {
      nom: `Labo cartes ${ts}`,
      hooks: [`Personne ne regarde le coin de cette carte ${ts}`, `Elle dormait dans un classeur depuis 2004 ${ts}`],
      flux: ["Je la passe au scanner de l'appli."],
      ctas: ["Le lien est dans ma bio."],
    });
    expect(cc.erreur, cc.texte).toBe(false);
    const [campagne] = await campagnes();
    const briques = (await admin.query(api.scripts.getCampaign, { id: campagne._id }))!.bricks;
    expect(briques.map((b) => [b.kind, b.active])).toEqual([
      ["hook", false],
      ["hook", false],
      ["flux", false],
      ["cta", false],
    ]);
    const doublon = await appel("creer_campagne", { nom: `labo CARTES ${ts}` });
    expect(doublon.erreur).toBe(true);
    expect(doublon.texte).toContain("existe déjà");

    // ── ajouter_flux_cta : désactivés, sans doublon ───────────────────────────
    const fc = await appel("ajouter_flux_cta", {
      campagne: `Labo cartes ${ts}`,
      role: "cta",
      briques: [{ texte: "Télécharge l'appli, le lien est en bio." }, { texte: "le lien est dans ma bio." }],
    });
    expect(fc.erreur, fc.texte).toBe(false);
    expect(JSON.parse(fc.texte)).toMatchObject({ dejaPresents: ["le lien est dans ma bio."] });
    const ctas = (await admin.query(api.scripts.getCampaign, { id: campagne._id }))!.bricks.filter((b) => b.kind === "cta");
    expect(ctas.map((b) => [b.content, b.active])).toEqual([
      ["Le lien est dans ma bio.", false],
      ["Télécharge l'appli, le lien est en bio.", false],
    ]);
    // Défaire la campagne la retire avec ses briques (aucune mission ne l'utilise).
    expect((await defaire("creer_campagne")).erreur).toBe(false);
    expect(await campagnes()).toHaveLength(0);

    // ── changer_compte_cible, puis défaire ────────────────────────────────────
    const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] Compte cible ${ts}` })) as Id<"scriptCampaigns">;
    for (const [kind, label] of [["hook", "H"], ["flux", "F"], ["cta", "C"]] as const) {
      await admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content: `${label} ${ts}` });
    }
    const { pricingId } = await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] Barème cible ${ts}`, montantFixe: 70, nbVideosCible: 7, tauxCPM: 1.5 });
    const J3 = jourParis(3);
    const [y, m, d] = J3.split("-").map(Number);
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: maelle.creatorId,
      targets: [c1],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      postDates: [Date.UTC(y, m - 1, d, 12)],
    });
    const mission = async () => (await admin.query(api.assignments.listAssignments, {})).find((a) => a.creatorId === maelle.creatorId)!;
    expect((await mission()).targets[0].accountHandle).toBe(h1);
    const cc2 = await appel("changer_compte_cible", { createatrice: nom, jour: J3, nouveau_compte: h2 });
    expect(cc2.erreur, cc2.texte).toBe(false);
    expect((await mission()).targets[0].accountHandle).toBe(h2);
    expect((await defaire("changer_compte_cible")).erreur).toBe(false);
    expect((await mission()).targets[0].accountHandle).toBe(h1);
    expect(c2.accountId).toBeDefined();

    // ── relancer : une fois par 24 h, et ne se défait pas ─────────────────────
    const r1 = await appel("relancer", { createatrice: nom, jour: J3 });
    expect(r1.erreur, r1.texte).toBe(false);
    expect(JSON.parse(r1.texte).fait).toContain("relance envoyée");
    const r2 = await appel("relancer", { createatrice: nom, jour: J3 });
    expect(JSON.parse(r2.texte).fait).toContain("déjà relancée il y a moins de 24 h");
    const relances = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications.filter(
      (x: { outil: string; fait: string }) => x.outil === "relancer" && x.fait.includes(nom),
    );
    expect(relances).toHaveLength(1);
    expect((await appel("defaire", { rang: relances[0].rang, outil: "relancer" })).texte).toContain("ne se défait pas");

    // ── Veille : suivre, noter, ne plus suivre — chacun défait ────────────────
    const handle = `e2esuivi${ts}`;
    const suivis = async () => (await admin.query(api.radar.listRadarAccounts, {})).accounts.filter((a) => a.handle === handle);
    expect((await appel("suivre_compte", { compte: `https://www.tiktok.com/@${handle}`, note: "Format carton" })).erreur).toBe(false);
    expect(await suivis()).toHaveLength(1);
    expect((await appel("noter_compte_suivi", { compte: `@${handle}`, note: "Hooks en question" })).erreur).toBe(false);
    expect((await suivis())[0].note).toBe("Hooks en question");
    expect((await defaire("noter_compte_suivi")).erreur).toBe(false);
    expect((await suivis())[0].note).toBe("Format carton");
    expect((await appel("ne_plus_suivre", { compte: handle })).erreur).toBe(false);
    expect(await suivis()).toHaveLength(0);
    expect((await defaire("ne_plus_suivre")).erreur).toBe(false);
    expect((await suivis()).map((a) => a.note)).toEqual(["Format carton"]);
    expect((await defaire("suivre_compte")).erreur).toBe(false);
    expect(await suivis()).toHaveLength(0);

    // ── Inspiration : par son lien, sans doublon, défaite ─────────────────────
    const lien = `https://www.tiktok.com/@inspicartes/video/${(BigInt(Math.floor(Date.now() / 1000)) << BigInt(32)).toString()}`;
    const titre = `[E2E_TEST] Carton qui s'ouvre ${ts}`;
    const inspirations = async () => (await admin.query(api.inspirations.listInspirations, {})).filter((i) => i.titre === titre);
    const ai = await appel("ajouter_inspiration", { lien, titre, tags: ["unboxing"] });
    expect(ai.erreur, ai.texte).toBe(false);
    expect((await inspirations()).map((i) => [i.type, i.plateforme])).toEqual([["video", "TikTok"]]);
    const encore = await appel("ajouter_inspiration", { lien: `${lien}?is_from_webapp=1`, titre });
    expect(encore.texte).toContain("Déjà dans la bibliothèque");
    expect((await defaire("ajouter_inspiration")).erreur).toBe(false);
    expect(await inspirations()).toHaveLength(0);
  });
});
