import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Page } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;
const jourParis = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));

/**
 * CHANGER LE BARÈME DE VIDÉOS DÉJÀ ATTRIBUÉES — le cas Juliette (08/10/2026) :
 * nouveau contrat à partir d'un jour, ancien barème figé sur ses vidéos, dont
 * certaines publiées, et un cycle déjà payé derrière.
 *
 * Ce que la spec tient, sur de l'ARGENT :
 *   1. la vidéo d'un cycle PAYÉ n'est jamais touchée — listée, laissée ;
 *   2. les autres, publiées comprises, passent sur le nouveau barème, et le dû
 *      du cycle en cours bouge du fixe du nouveau barème (700 / 60) ;
 *   3. une liste qui a bougé depuis l'aperçu refuse l'écriture, sans rien écrire ;
 *   4. `defaire` remet chaque vidéo sur son snapshot d'avant, à l'identique.
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

/** Une clé créée dans l'écran, interrupteur « Barèmes » ouvert. */
async function cleBaremes(page: Page, nom: string) {
  await page.goto(adminPath("/comptes"));
  await page.getByRole("button", { name: "Connecter Claude" }).click();
  await page.getByLabel("Nom de la clé").fill(nom);
  await page.getByRole("button", { name: "Créer une clé" }).click();
  const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
  const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
  await page.getByRole("button", { name: "J’ai copié la clé" }).click();
  const interrupteur = page.getByRole("switch", { name: `Modifications des barèmes pour ${nom}` });
  await interrupteur.click();
  await expect(interrupteur).toBeChecked();
  const appel = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc(url, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
    return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
  };
  const outils = async () =>
    ((await rpc(url, token, "tools/list")).result as unknown as { tools: { name: string }[] }).tools.map((t) => t.name);
  return { appel, outils };
}

/** Une créatrice, son ancien et son nouveau contrat, et un format pour l'assigner. */
async function decor(ts: number, suffixe: string) {
  const nom = `Reassign ${suffixe} ${ts}`;
  const creatrice = await createCreatorSession(convexUrl!, {
    name: `[E2E_TEST] ${nom}`,
    email: `e2e-reassign-${suffixe}-${ts}@repackit.test`,
    password: "creator-reassign-12345",
  });
  const ancienNom = `Ancien contrat ${suffixe} ${ts}`;
  const nouveauNom = `Nouveau contrat ${suffixe} ${ts}`;
  // La forme de la prod : 400 / 30 conditionné à 100 000 vues → 700 / 60 sans
  // condition, avec un bonus par vidéo.
  const { pricingId: ancien } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] ${ancienNom}`,
    montantFixe: 400,
    nbVideosCible: 30,
    tauxCPM: 0,
    seuilVuesFixe: 100_000,
  });
  const { pricingId: nouveau } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] ${nouveauNom}`,
    montantFixe: 700,
    nbVideosCible: 60,
    tauxCPM: 0,
    videoBonus: { tiers: [{ seuilVues: 10_000, montant: 10 }], cumulative: false },
  });
  const formatId = await createFormatWithRate(admin, {
    name: `[E2E_TEST] Format reassign ${suffixe} ${ts}`,
    type: "short",
    rateModel: { basePerPost: 0 },
  });
  let n = 0;
  /** Une mission sur l'ANCIEN barème ; publiée par l'admin si `publieeLe` est donné. */
  async function mission(publieeLe?: number): Promise<Id<"assignments">> {
    n += 1;
    const handle = `@e2ereassign${suffixe}${n}${ts}`;
    const target = await availableTarget({ e2eClient: admin, creatorId: creatrice.creatorId, platform: "TikTok", handle });
    const avant = new Set((await admin.query(api.assignments.listAssignments, {})).map((a) => a._id));
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creatrice.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 5 * DAY,
      pricingId: ancien,
    });
    const id = (await admin.query(api.assignments.listAssignments, {})).find((a) => !avant.has(a._id) && a.formatId === formatId)!._id;
    if (publieeLe !== undefined) {
      await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id,
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/${handle}/video/73100000${n}${ts % 100000}` }],
        publishedAt: publieeLe,
        allowBackdate: true,
      });
    }
    return id;
  }
  const snapshotDe = async (id: Id<"assignments">) =>
    (await admin.query(api.assignments.listAssignments, {})).find((a) => a._id === id)!.pricingSnapshot;
  return { nom, creatrice, ancien, nouveau, ancienNom, nouveauNom, mission, snapshotDe };
}

test.describe("Barèmes — changer le barème de vidéos déjà attribuées", () => {
  test("MCP : simuler, écrire (cycle payé laissé), refus si la liste a bougé, défaire", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const d = await decor(ts, "mcp");
    const il35j = Date.now() - 35 * DAY;
    // v1 : 1er cycle (ancre = sa publication), qui sera PAYÉ. v2 : publiée
    // maintenant, 2e cycle. v3 : pas encore publiée.
    const v1 = await d.mission(il35j);
    const v2 = await d.mission(Date.now() - 60_000);
    const v3 = await d.mission();
    await admin.mutation(api.payments.markCyclePaid, { creatorId: d.creatrice.creatorId, cycleIndex: 0 });
    const ancienSnapshot = await d.snapshotDe(v2);
    expect(ancienSnapshot?.pricingId).toBe(d.ancien);

    const cycle1 = async () =>
      (await d.creatrice.client.query(api.payments.getMyPayments, { projectId: d.creatrice.projectId })).find((p) => p.cycleIndex === 1)!;
    const dueAvant = (await cycle1()).totalDue;

    const { appel, outils } = await cleBaremes(page, `E2E barèmes ${ts}`);
    // L'interrupteur « Barèmes » ouvre l'outil ; il n'ouvre pas les missions.
    const liste = await outils();
    expect(liste).toContain("changer_bareme");
    expect(liste).not.toContain("assigner_scripts");

    const demande = { createatrice: d.nom, bareme: d.nouveauNom, a_partir_du: jourParis(il35j) };

    // ── Simuler : les trois vidéos, la payée laissée ─────────────────────────
    const sim = await appel("changer_bareme", { ...demande, simuler: true });
    expect(sim.erreur, sim.texte).toBe(false);
    const s = JSON.parse(sim.texte).simulation as { aChanger: number; laissees: number; videos: { statut: string; suite: string }[] };
    expect(s.aChanger).toBe(2);
    expect(s.laissees).toBe(1);
    expect(s.videos.map((x) => x.suite)).toEqual([
      "laissée : son cycle de paie est payé (montant gelé)",
      `passe sur « [E2E_TEST] ${d.nouveauNom} »`,
      `passe sur « [E2E_TEST] ${d.nouveauNom} »`,
    ]);
    // Simuler n'écrit rien.
    expect((await d.snapshotDe(v2))?.pricingId).toBe(d.ancien);

    // ── La liste a « bougé » : refus, rien d'écrit ───────────────────────────
    const perime = await appel("changer_bareme", { ...demande, attendu: 5 });
    expect(perime.erreur).toBe(true);
    expect(perime.texte).toContain("La liste a changé depuis l'aperçu");
    expect((await d.snapshotDe(v2))?.pricingId).toBe(d.ancien);
    expect((await d.snapshotDe(v3))?.pricingId).toBe(d.ancien);

    // ── Écrire ───────────────────────────────────────────────────────────────
    const ecrit = await appel("changer_bareme", { ...demande, attendu: 2 });
    expect(ecrit.erreur, ecrit.texte).toBe(false);
    expect(JSON.parse(ecrit.texte).fait).toContain("2 vidéo(s) passée(s)");
    // Présence : publiée ET pas publiée passent, aux termes du nouveau barème.
    for (const id of [v2, v3]) {
      expect(await d.snapshotDe(id)).toMatchObject({ pricingId: d.nouveau, montantFixe: 700, nbVideosCible: 60, tauxCPM: 0 });
      expect((await d.snapshotDe(id))?.seuilVuesFixe).toBeUndefined();
    }
    // Absence appariée : la vidéo du cycle payé n'a pas bougé.
    expect(await d.snapshotDe(v1)).toEqual(ancienSnapshot);
    // L'argent : le fixe de l'ancien barème était bloqué (0 vue < 100 000) ; le
    // nouveau paie 700 / 60 la vidéo publiée du cycle (la pas-publiée attend).
    await expect.poll(async () => (await cycle1()).totalDue).toBeCloseTo(dueAvant + 700 / 60, 2);

    // Relancer ne fait rien : déjà sur ce barème.
    const resim = JSON.parse((await appel("changer_bareme", { ...demande, simuler: true })).texte).simulation as { aChanger: number };
    expect(resim.aChanger).toBe(0);

    // Le journal garde chaque vidéo, avant et après.
    const journal = JSON.parse((await appel("modifications", { limite: 5 })).texte).modifications as { rang: number; outil: string; etat: string }[];
    const ligne = journal.find((m) => m.outil === "changer_bareme")!;
    expect(ligne.etat).toBe("se défait");
    const detail = JSON.parse((await appel("modifications", { rang: ligne.rang })).texte) as { documents: { id: string }[] };
    expect(detail.documents.map((x) => x.id).sort()).toEqual([v2, v3].sort());

    // ── Défaire : chaque vidéo sur son snapshot d'avant, à l'identique ───────
    const defait = await appel("defaire", { rang: ligne.rang, outil: "changer_bareme" });
    expect(defait.erreur, defait.texte).toBe(false);
    expect(await d.snapshotDe(v2)).toEqual(ancienSnapshot);
    expect(await d.snapshotDe(v3)).toEqual(ancienSnapshot);
    await expect.poll(async () => (await cycle1()).totalDue).toBeCloseTo(dueAvant, 2);
    // Défaire s'inscrit au journal : relire le rang avant de redemander.
    const apres = JSON.parse((await appel("modifications", { limite: 5 })).texte).modifications as { rang: number; outil: string; etat: string }[];
    const defaite = apres.find((m) => m.outil === "changer_bareme")!;
    expect(defaite.etat).toContain("défaite le");
    expect((await appel("defaire", { rang: defaite.rang, outil: "changer_bareme" })).texte).toContain("Déjà défaite");

    await admin.mutation(api.pricing.cleanupTestPricings, { secret: E2E_SECRET });
  });

  test("écran Barèmes : aperçu, puis « Appliquer » ; un aperçu périmé est refusé", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const d = await decor(ts, "ecran");
    const v = await d.mission();

    // Le serveur refuse un nombre qui n'est pas celui de l'aperçu.
    await expect(
      admin.mutation(api.pricingReassign.reassignPricing, {
        creatorId: d.creatrice.creatorId,
        pricingId: d.nouveau,
        du: jourParis(Date.now()),
        expected: 3,
      }),
    ).rejects.toThrow(/ERR_PRICING_REASSIGN_STALE/);
    expect((await d.snapshotDe(v))?.pricingId).toBe(d.ancien);

    await page.goto(adminPath("/pricings"));
    await page.getByRole("button", { name: `Actions du barème [E2E_TEST] ${d.nouveauNom}` }).click();
    await page.getByRole("menuitem", { name: "Appliquer à des vidéos déjà attribuées…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(`Appliquer « [E2E_TEST] ${d.nouveauNom} » à des vidéos déjà attribuées`)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Appliquer", exact: true })).toBeDisabled();

    await dialog.getByLabel("Créatrice").click();
    await page.getByRole("option", { name: `[E2E_TEST] ${d.nom}` }).click();
    // « À partir du » vaut aujourd'hui : la mission sans date y tombe.
    const lignes = dialog.getByTestId("apply-pricing-videos").getByRole("listitem");
    await expect(lignes).toHaveCount(1);
    await expect(lignes.first()).toContainText("Passe sur ce barème");
    await expect(lignes.first()).toContainText(`[E2E_TEST] ${d.ancienNom}`);
    await expect(dialog.getByText("1 vidéo passera sur")).toBeVisible();

    await dialog.getByRole("button", { name: "Appliquer à 1 vidéo" }).click();
    await expect(page.getByText(`1 vidéo passée sur « [E2E_TEST] ${d.nouveauNom} ».`)).toBeVisible();
    expect(await d.snapshotDe(v)).toMatchObject({ pricingId: d.nouveau, montantFixe: 700, nbVideosCible: 60 });

    await admin.mutation(api.pricing.cleanupTestPricings, { secret: E2E_SECRET });
  });
});
