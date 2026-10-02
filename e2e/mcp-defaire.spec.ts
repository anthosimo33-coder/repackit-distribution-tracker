import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Page } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso);

type Rpc = { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };

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
const jourDe = (ts: number | undefined) =>
  ts === undefined ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));

/** Une clé créée dans l'écran, avec les domaines demandés ouverts. */
async function cle(page: Page, nom: string, domaines: string[]) {
  await page.goto(adminPath("/comptes"));
  await page.getByRole("button", { name: "Connecter Claude" }).click();
  await page.getByLabel("Nom de la clé").fill(nom);
  await page.getByRole("button", { name: "Créer une clé" }).click();
  const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
  const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
  await page.getByRole("button", { name: "J’ai copié la clé" }).click();
  for (const d of domaines) {
    const nomInterrupteur = d === "compta" ? `Modifications de la Compta pour ${nom}` : `Modifications des ${d} pour ${nom}`;
    await page.getByRole("switch", { name: nomInterrupteur }).click();
    await expect(page.getByRole("switch", { name: nomInterrupteur })).toBeChecked();
  }
  const appel = async (projet: string, name: string, args: Record<string, unknown>) => {
    const r = await rpc(url, token, "tools/call", { name, arguments: { projet, ...args } });
    return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
  };
  /** Défait la modification la plus récente de cet outil (dont le résumé contient `morceau`). */
  const defaire = async (projet: string, outil: string, morceau = "") => {
    const liste = JSON.parse((await appel(projet, "modifications", { limite: 30 })).texte).modifications as {
      rang: number;
      outil: string;
      fait: string;
      etat: string;
    }[];
    const cible = liste.find((m) => m.outil === outil && m.fait.includes(morceau) && m.etat === "se défait");
    expect(cible, `aucune modification « ${outil} » défaisable contenant « ${morceau} »`).toBeDefined();
    return appel(projet, "defaire", { rang: cible!.rang, outil });
  };
  return { appel, defaire };
}

/**
 * DÉFAIRE — `modifications` numérote le journal, `defaire` restaure l'état
 * d'avant par le cœur de l'écran, SEULEMENT si la base montre encore ce que
 * Claude a écrit. Jamais d'écrasement silencieux ; un refus dit pourquoi.
 */
test.describe("MCP — défaire une modification", () => {
  test("missions, scripts, publications : restauré, refusé si changé depuis, non défaisable dit", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const nom = `Nora Lefebvre ${ts}`;
    const nora = await createCreatorSession(convexUrl, { name: `[E2E_TEST] ${nom}`, email: `e2e-mcp-defaire-${ts}@repackit.test`, password: "nora-123456" });
    const handle = `@noralefebvre${ts}`;
    await availableTarget({ e2eClient: admin, creatorId: nora.creatorId, platform: "TikTok", handle });
    const campagne = `Défaire ${ts}`;
    const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${campagne}` })) as Id<"scriptCampaigns">;
    for (const [kind, label, content] of [
      ["hook", "Hook prix", `Cette carte valait 2 € en 2019 ${ts}`],
      ["hook", "Hook grenier", `Le carton du grenier de ma tante ${ts}`],
      ["hook", "Hook bourse", `Je l'ai trouvée à une bourse d'échange ${ts}`],
      ["hook", "Hook vide-grenier", `Trouvée dans un bac à 1 € ${ts}`],
      ["hook", "Hook héritage", `Le classeur de mon grand-père ${ts}`],
      ["flux", "Flux scan", "Je la scanne avec l'appli."],
      ["cta", "CTA bio", "Le lien est dans ma bio."],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    }
    const bareme = `Barème défaire ${ts}`;
    await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] ${bareme}`, montantFixe: 90, nbVideosCible: 9, tauxCPM: 2.25 });
    const missions = async () => (await admin.query(api.assignments.listAssignments, {})).filter((a) => a.creatorId === nora.creatorId);
    const missionDu = async (jour: string) => (await missions()).find((a) => jourDe(a.postDate) === jour)!;
    const bricks = async () => (await admin.query(api.scripts.getCampaign, { id: campaignId }))!.bricks;
    const P = E2E_PROJECT_SLUG;
    const [J3, J4, J5, J6, J7, J8] = [3, 4, 5, 6, 7, 8].map(jourParis);

    const { appel, defaire } = await cle(page, `E2E défaire ${ts}`, ["missions", "scripts", "publications"]);

    // ── Replanifier puis défaire : jour ET plage d'origine ────────────────────
    expect((await appel(P, "assigner_scripts", { campagne, createatrices: [nom], jours: [J3, J4], bareme })).erreur).toBe(false);
    expect((await appel(P, "replanifier_mission", { createatrice: nom, jour: J3, nouveau_jour: J5, plage: "soir" })).erreur).toBe(false);
    expect((await missionDu(J5)).postWindow).toEqual({ startMin: 21 * 60, endMin: 23 * 60 });
    const d1 = await defaire(P, "replanifier_mission");
    expect(d1.erreur, d1.texte).toBe(false);
    const remise = await missionDu(J3);
    expect(remise).toBeDefined();
    expect(remise.postWindow).toBeUndefined();
    // Déjà défaite : refusé.
    const liste = JSON.parse((await appel(P, "modifications", {})).texte).modifications as { rang: number; outil: string; etat: string }[];
    const deja = liste.find((m) => m.outil === "replanifier_mission")!;
    expect(deja.etat).toContain("défaite le");
    expect((await appel(P, "defaire", { rang: deja.rang, outil: "replanifier_mission" })).texte).toContain("Déjà défaite");
    // Mauvais outil pour ce rang : le journal a bougé.
    const faux = await appel(P, "defaire", { rang: 1, outil: "ajouter_hooks" });
    expect(faux.erreur).toBe(true);
    expect(faux.texte).toContain("le journal a bougé");

    // ── Changé depuis à l'écran : rien n'est écrasé ───────────────────────────
    expect((await appel(P, "replanifier_mission", { createatrice: nom, jour: J4, nouveau_jour: J6 })).erreur).toBe(false);
    const m6 = await missionDu(J6);
    const [y, m, d] = J7.split("-").map(Number);
    await admin.mutation(api.assignments.setAssignmentPostDate, { id: m6._id, postDate: Date.UTC(y, m - 1, d, 12) });
    const ecrase = await defaire(P, "replanifier_mission");
    expect(ecrase.erreur).toBe(true);
    expect(ecrase.texte).toContain("a changé depuis");
    expect(jourDe((await missions()).find((a) => a._id === m6._id)!.postDate)).toBe(J7);

    // ── Consigne : remise à l'absence ─────────────────────────────────────────
    expect((await appel(P, "consigne_mission", { createatrice: nom, jour: J3, consigne: "Filme près d'une fenêtre." })).erreur).toBe(false);
    expect((await missionDu(J3)).instructions).toBe("Filme près d'une fenêtre.");
    expect((await defaire(P, "consigne_mission")).erreur).toBe(false);
    expect((await missionDu(J3)).instructions).toBeUndefined();

    // ── Hooks ajoutés puis retirés ; briques rallumées ────────────────────────
    expect((await appel(P, "ajouter_hooks", { campagne, hooks: [{ texte: `Personne ne regarde ce détail ${ts}` }] })).erreur).toBe(false);
    expect((await bricks()).filter((b) => b.kind === "hook")).toHaveLength(6);
    expect((await defaire(P, "ajouter_hooks")).erreur).toBe(false);
    expect((await bricks()).filter((b) => b.kind === "hook")).toHaveLength(5);
    expect((await appel(P, "activer_briques", { campagne, briques: ["Hook bourse"], actif: false })).erreur).toBe(false);
    expect((await bricks()).find((b) => b.label === "Hook bourse")!.active).toBe(false);
    expect((await defaire(P, "activer_briques")).erreur).toBe(false);
    expect((await bricks()).find((b) => b.label === "Hook bourse")!.active).toBe(true);

    // ── Chauffe sur un post NON QUALIFIÉ : défaire rend l'absence, pas « promo »
    expect((await appel(P, "assigner_scripts", { campagne, createatrices: [nom], jours: [J8], bareme })).erreur).toBe(false);
    const videoId = ((BigInt(Math.floor(Date.now() / 1000)) << BigInt(32)) + BigInt(777)).toString();
    const lien = `https://www.tiktok.com/${handle}/video/${videoId}`;
    expect((await appel(P, "confirmer_publication", { createatrice: nom, jour: J8, liens: [lien] })).erreur).toBe(false);
    const post = async () => (await admin.query(api.publications.listPublications, {})).find((p) => p.postUrl === lien)!;
    expect((await post()).isWarmup).toBeUndefined();
    expect((await appel(P, "marquer_warmup", { lien, warmup: true })).erreur).toBe(false);
    expect((await post()).isWarmup).toBe(true);
    expect((await defaire(P, "marquer_warmup")).erreur).toBe(false);
    expect((await post()).isWarmup).toBeUndefined();
    // Une publication confirmée ne se dé-publie pas : le refus le dit.
    const nonDefaisable = JSON.parse((await appel(P, "modifications", {})).texte).modifications.find(
      (x: { outil: string }) => x.outil === "confirmer_publication",
    );
    expect(nonDefaisable.etat).toContain("ne se dé-publie pas");
    expect((await appel(P, "defaire", { rang: nonDefaisable.rang, outil: "confirmer_publication" })).texte).toContain("ne se défait pas");

    // ── Missions créées : supprimées tant que pas commencées ──────────────────
    const avant = (await missions()).length;
    expect((await appel(P, "assigner_scripts", { campagne, createatrices: [nom], jours: [jourParis(10), jourParis(11)], bareme })).erreur).toBe(false);
    expect((await missions()).length).toBe(avant + 2);
    const dm = await defaire(P, "assigner_scripts", "2 vidéos");
    expect(dm.erreur, dm.texte).toBe(false);
    expect(JSON.parse(dm.texte).fait).toContain("2 mission(s) supprimée(s)");
    expect((await missions()).length).toBe(avant);

    // ── Le journal, dans l'écran ──────────────────────────────────────────────
    const journal = page.getByTestId("mcp-journal");
    await expect(journal).toContainText("Défaire une modification");
    await expect(journal).toContainText("Défaite le");
  });

  test("Compta : charge, règle, ventilation, relevé, mis de côté — chacun remis comme avant", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const slug = `e2e-mcp-defaire-${ts}`;
    const nomProjet = `E2E MCP Défaire ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, { secret: E2E_SECRET, slug, name: nomProjet })) as {
      projectId: Id<"projects">;
    };
    try {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });
      await admin.mutation(api.compta.e2eSetProjectFx, { secret: E2E_SECRET, projectId, payCurrency: "usd", fxRateToRevenue: 0.86 });
      await admin.mutation(api.compta.e2eSetComptaState, { secret: E2E_SECRET, projectId, referenceCurrency: "eur", lastSyncAt: Date.now() - 60_000 });
      const id = (s: string) => `line_def_${ts}_${s}`;
      await admin.mutation(api.compta.e2eSeedLedgerLines, {
        secret: E2E_SECRET,
        projectId,
        lines: [
          { whopId: id("g"), lineType: "payment_gross", amount: 4210.35, currency: "eur", postedAt: at("2025-09-05T10:00:00Z"), paymentId: `pay_${ts}` },
          { whopId: id("w"), lineType: "withdrawal", amount: -1250.5, currency: "eur", postedAt: at("2025-09-12T08:15:00Z"), sourceId: `wdrl_${ts}`, destination: "Banque Pro", sourceStatus: "completed" },
          { whopId: id("x"), lineType: "referral_bonus", amount: 12.4, currency: "eur", postedAt: at("2025-09-20T09:00:00Z") },
        ],
      });
      const { appel, defaire } = await cle(page, `E2E défaire compta ${ts}`, ["compta"]);
      const charges = async () => (await admin.query(api.compta.listComptaCharges, { projectId, month: "2025-09" })).charges.map((c) => c.label);
      const treso = () => admin.query(api.compta.getComptaTreasury, { projectId });

      // Charge ajoutée → défaite ; charge supprimée → recréée.
      expect((await appel(slug, "ajouter_charge", { jour: "2025-09-08", libelle: "Notion Plus", categorie: "outils", montant: "9,60" })).erreur).toBe(false);
      expect(await charges()).toContain("Notion Plus");
      expect((await defaire(slug, "ajouter_charge")).erreur).toBe(false);
      expect(await charges()).not.toContain("Notion Plus");
      expect((await appel(slug, "ajouter_charge", { jour: "2025-09-09", libelle: "Figma", categorie: "abonnements", montant: 15 })).erreur).toBe(false);
      expect((await appel(slug, "supprimer_charge", { jour: "2025-09-09", libelle: "figma" })).erreur).toBe(false);
      expect(await charges()).not.toContain("Figma");
      expect((await defaire(slug, "supprimer_charge")).erreur).toBe(false);
      expect(await charges()).toContain("Figma");

      // Règle → le type redevient « non classé ».
      expect((await appel(slug, "classer_type_whop", { type: "referral_bonus", colonne: "CA brut" })).erreur).toBe(false);
      expect((await admin.query(api.compta.getComptaOverview, { projectId, year: 2025 })).unclassified).toEqual([]);
      expect((await defaire(slug, "classer_type_whop")).erreur).toBe(false);
      expect((await admin.query(api.compta.getComptaOverview, { projectId, year: 2025 })).unclassified.map((u) => u.lineType)).toEqual(["referral_bonus"]);

      // Ventilation → effacée comme avant.
      const parts = async () =>
        (await admin.query(api.compta.listComptaTransfers, { projectId, month: "2025-09" })).transfers.find((t) => t.destination === "Banque Pro")!.parts;
      expect((await appel(slug, "ventiler_virement", { jour: "2025-09-12", montant: 1250.5, parts: [{ montant: 1250.5, usage: "rémunération" }] })).erreur).toBe(false);
      expect(await parts()).toHaveLength(1);
      expect((await defaire(slug, "ventiler_virement")).erreur).toBe(false);
      expect(await parts()).toHaveLength(0);

      // Relevé : compte né du relevé → retiré ; second relevé du jour → l'ancien montant revient.
      expect((await appel(slug, "relever_solde", { compte: "Banque Pro", solde: "2 480,15", jour: "2025-09-30" })).erreur).toBe(false);
      expect((await treso()).accounts).toHaveLength(1);
      expect((await defaire(slug, "relever_solde")).erreur).toBe(false);
      expect((await treso()).accounts).toEqual([]);
      expect((await appel(slug, "relever_solde", { compte: "Banque Pro", solde: 2480.15, jour: "2025-09-30" })).erreur).toBe(false);
      expect((await appel(slug, "relever_solde", { compte: "Banque Pro", solde: 2500, jour: "2025-09-30" })).erreur).toBe(false);
      expect((await treso()).accounts[0].reading).toMatchObject({ day: "2025-09-30", amount: 2500 });
      expect((await defaire(slug, "relever_solde", "2500,00")).erreur).toBe(false);
      expect((await treso()).accounts[0].reading).toMatchObject({ day: "2025-09-30", amount: 2480.15 });

      // Mis de côté payé → annulé.
      expect((await appel(slug, "marquer_mis_de_cote_paye", { montant: 320, jour: "2025-10-15", motif: "TVA T3" })).erreur).toBe(false);
      expect((await treso()).setAside.used).toBe(320);
      expect((await defaire(slug, "marquer_mis_de_cote_paye")).erreur).toBe(false);
      expect((await treso()).setAside.used).toBe(0);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, { projectId, confirmation: nomProjet });
    }
  });
});
