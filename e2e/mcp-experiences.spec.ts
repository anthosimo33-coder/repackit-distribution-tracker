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

/**
 * TEST A/B DE HOOKS — de bout en bout : 2 hooks × 6 créatrices en carré latin
 * (chaque jour voit les deux hooks, chaque créatrice tourne les deux), les 12
 * vidéos publiées et mesurées à J+7, puis le verdict. Le hook A fait plus de vues
 * chez TOUTES les créatrices : p exact = 2/64 → gagnant. Avant les mesures :
 * « trop tôt ». Une seconde expérience se défait (missions supprimées, annulée).
 */
test.describe("MCP — tests A/B de hooks", () => {
  test("lancer en carré latin, trop tôt, mesurer à J+7, verdict ; défaire une expérience", async ({ page }) => {
    test.setTimeout(300_000);
    const ts = Date.now();
    const P = E2E_PROJECT_SLUG;
    const prenoms = ["Kelly Martin", "Léa Fontaine", "Inès Garnier", "Nora Lefebvre", "Clara Vidal", "Maëlle Dupuis"];
    const creatrices: { nom: string; creatorId: Id<"creators">; handle: string; cible: { platform: "TikTok"; accountId: Id<"comptes"> } }[] = [];
    for (const [i, prenom] of prenoms.entries()) {
      const nom = `${prenom} ${ts}`;
      const s = await createCreatorSession(convexUrl, { name: `[E2E_TEST] ${nom}`, email: `e2e-mcp-ab-${i}-${ts}@repackit.test`, password: `ab-${i}-12345` });
      const handle = `@ab${i}${ts}`;
      const cible = await availableTarget({ e2eClient: admin, creatorId: s.creatorId, platform: "TikTok", handle });
      creatrices.push({ nom, creatorId: s.creatorId, handle, cible });
    }
    const campagne = `Labo AB ${ts}`;
    const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${campagne}` })) as Id<"scriptCampaigns">;
    const brique = (kind: "hook" | "flux" | "cta", label: string, content: string) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content }) as Promise<Id<"scriptBricks">>;
    const hookA = await brique("hook", "Hook prix", `Cette carte valait 3 € il y a un an ${ts}`);
    const hookB = await brique("hook", "Hook grenier", `Le classeur du grenier de mon frère ${ts}`);
    await brique("flux", "Flux scan", "Je la scanne avec l'appli.");
    await brique("cta", "CTA bio", "Le lien est dans ma bio.");
    const bareme = `Barème AB ${ts}`;
    await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] ${bareme}`, montantFixe: 50, nbVideosCible: 5, tauxCPM: 1.1 });

    // ── Une clé, Missions allumé ──────────────────────────────────────────────
    const nomCle = `E2E AB ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    const interrupteur = page.getByRole("switch", { name: `Modifications des missions pour ${nomCle}` });
    await interrupteur.click();
    await expect(interrupteur).toBeChecked();
    const appel = async (name: string, args: Record<string, unknown>) => {
      const r = await rpc(url, token, "tools/call", { name, arguments: { projet: P, ...args } });
      return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
    };
    const J3 = jourParis(3);
    const J4 = jourParis(4);
    const nomXp = `Prix contre grenier ${ts}`;
    const lancement = { nom: nomXp, campagne, hooks: ["Hook prix", "Hook grenier"], createatrices: creatrices.map((c) => c.nom), jours: [J3, J4], bareme };

    // ── Simuler : le plan en carré latin, rien d'écrit ────────────────────────
    const sim = await appel("lancer_experience", { ...lancement, simuler: true });
    expect(sim.erreur, sim.texte).toBe(false);
    const plan = JSON.parse(sim.texte).plan as { createatrice: string; jours: { jour: string; hook: string }[] }[];
    expect(plan.map((p) => p.jours.map((j) => j.hook))).toEqual([0, 1, 2, 3, 4, 5].map((i) => (i % 2 === 0 ? ["Hook prix", "Hook grenier"] : ["Hook grenier", "Hook prix"])));
    const missions = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter((a) => creatrices.some((c) => c.creatorId === a.creatorId));
    expect(await missions()).toHaveLength(0);

    // ── Tout ou rien : une créatrice inconnue, et rien n'est créé pour les autres
    const rate = await appel("lancer_experience", { ...lancement, createatrices: [...lancement.createatrices, `Inconnue ${ts}`] });
    expect(rate.erreur).toBe(true);
    expect(rate.texte).toContain(`Inconnue ${ts}`);
    expect(await missions()).toHaveLength(0);

    // ── Lancer : 12 missions, combos imposés, chaque jour voit les deux hooks ─
    const go = await appel("lancer_experience", lancement);
    expect(go.erreur, go.texte).toBe(false);
    const toutes = await missions();
    expect(toutes).toHaveLength(12);
    for (const jour of [J3, J4]) {
      const duJour = toutes.filter((m) => jourDe(m.postDate) === jour);
      expect(duJour).toHaveLength(6);
      expect(duJour.filter((m) => m.scriptCombo?.hookBrickId === hookA)).toHaveLength(3);
      expect(duJour.every((m) => m.comboImposed === true)).toBe(true);
    }
    for (const c of creatrices) {
      expect(new Set(toutes.filter((m) => m.creatorId === c.creatorId).map((m) => m.scriptCombo?.hookBrickId))).toEqual(new Set([hookA, hookB]));
    }
    expect((await appel("lancer_experience", lancement)).texte).toContain("existe déjà");

    // ── Avant les mesures : trop tôt ──────────────────────────────────────────
    const liste = JSON.parse((await appel("experiences", {})).texte).experiences as { nom: string; missions: number; publiees: number }[];
    expect(liste.find((x) => x.nom === nomXp)).toMatchObject({ missions: 12, publiees: 0 });
    expect(JSON.parse((await appel("experiences", { experience: nomXp })).texte).verdict).toContain("Trop tôt");

    // ── Publier les 12 vidéos il y a 10 jours, relevé à J+7 ───────────────────
    const publieeLe = Date.now() - 10 * DAY;
    for (const [i, c] of creatrices.entries()) {
      for (const m of toutes.filter((x) => x.creatorId === c.creatorId)) {
        const lien = `https://www.tiktok.com/${c.handle}/video/${((BigInt(Math.floor(publieeLe / 1000)) << BigInt(32)) + BigInt(i * 10 + (m.scriptCombo?.hookBrickId === hookA ? 1 : 2))).toString()}`;
        await admin.mutation(api.assignments.confirmPublicationAsAdmin, { id: m._id, urls: [{ platform: "TikTok", url: lien }], publishedAt: publieeLe, allowBackdate: true });
        const pub = (await admin.query(api.publications.listPublications, {})).find((p) => p.postUrl === lien)!;
        const vues = m.scriptCombo?.hookBrickId === hookA ? 4000 + i * 137 : 2600 + i * 91;
        await admin.mutation(api.metricSnapshots.createSnapshot, { publicationId: pub._id, capturedAt: pub.datePubli + 7 * DAY + 3_600_000, vues, likes: Math.round(vues / 20) });
      }
    }
    const lu = JSON.parse((await appel("experiences", { experience: nomXp })).texte);
    expect(lu.verdict).toContain("« Hook prix » gagne");
    expect(lu.verdict).toContain("p = 0,0313 sur 6 créatrices complètes");
    expect(lu.variantes).toEqual([
      { hook: "Hook prix", mesurees: 6, medianeVuesJ7: 4000 + 2.5 * 137 },
      { hook: "Hook grenier", mesurees: 6, medianeVuesJ7: 2600 + 2.5 * 91 },
    ]);

    // ── Une seconde expérience, défaite : missions supprimées, annulée ────────
    const nomXp2 = `À annuler ${ts}`;
    expect((await appel("lancer_experience", { ...lancement, nom: nomXp2, createatrices: creatrices.slice(0, 2).map((c) => c.nom), jours: [jourParis(8), jourParis(9)] })).erreur).toBe(false);
    expect(await missions()).toHaveLength(16);
    const modifs = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as { rang: number; outil: string; fait: string }[];
    const cible = modifs.find((x) => x.outil === "lancer_experience" && x.fait.includes(nomXp2))!;
    const d = await appel("defaire", { rang: cible.rang, outil: "lancer_experience" });
    expect(d.erreur, d.texte).toBe(false);
    expect(await missions()).toHaveLength(12);
    const apres = JSON.parse((await appel("experiences", {})).texte).experiences as { nom: string; statut: string }[];
    expect(apres.find((x) => x.nom === nomXp2)?.statut).toBe("annulee");
  });

  /**
   * TOUT LE RESTE IDENTIQUE : sans « notif », une campagne à notif en tire une
   * en rotation par mission — la variante n'est plus la seule différence. Avec
   * « notif », la même sur chaque mission (deux notifs actives : la rotation en
   * aurait posé deux) ; « type » et « remuneree » qualifient les missions ;
   * « echeance: publication » cale chaque échéance sur SON jour de publication.
   */
  test("notif commune, type, rémunération et échéance au jour de publication", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const P = E2E_PROJECT_SLUG;
    const creatrices: { nom: string; creatorId: Id<"creators"> }[] = [];
    for (const [i, prenom] of ["Jade Morel", "Lou Bernard"].entries()) {
      const nom = `${prenom} ${ts}`;
      const s = await createCreatorSession(convexUrl, { name: `[E2E_TEST] ${nom}`, email: `e2e-mcp-abn-${i}-${ts}@repackit.test`, password: `abn-${i}-12345` });
      await availableTarget({ e2eClient: admin, creatorId: s.creatorId, platform: "TikTok", handle: `@abn${i}${ts}` });
      creatrices.push({ nom, creatorId: s.creatorId });
    }
    const campagne = `Labo notif ${ts}`;
    const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${campagne}` })) as Id<"scriptCampaigns">;
    await admin.mutation(api.scripts.updateCampaign, { id: campaignId, notifEnabled: true });
    const brique = (kind: "hook" | "flux" | "cta" | "notif", label: string, content: string) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content }) as Promise<Id<"scriptBricks">>;
    await brique("hook", "Hook un", `Premier hook ${ts}`);
    await brique("hook", "Hook deux", `Second hook ${ts}`);
    await brique("flux", "Flux", "Je montre l'appli.");
    await brique("cta", "CTA", "Le lien est dans ma bio.");
    const quitte = await brique("notif", "Je te quitte", `Je te quitte ${ts}`);
    await brique("notif", "Autre notif", `Une autre notif ${ts}`);
    const bareme = `Barème ABN ${ts}`;
    await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] ${bareme}`, montantFixe: 50, nbVideosCible: 5, tauxCPM: 1.1 });

    const nomCle = `E2E ABN ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();
    const interrupteur = page.getByRole("switch", { name: `Modifications des missions pour ${nomCle}` });
    await interrupteur.click();
    await expect(interrupteur).toBeChecked();
    const appel = async (name: string, args: Record<string, unknown>) => {
      const r = await rpc(url, token, "tools/call", { name, arguments: { projet: P, ...args } });
      return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
    };
    const [J3, J5] = [jourParis(3), jourParis(5)];
    const lancement = {
      nom: `Notif commune ${ts}`,
      campagne,
      hooks: ["Hook un", "Hook deux"],
      createatrices: creatrices.map((c) => c.nom),
      jours: [J3, J5],
      bareme,
      notif: "Je te quitte",
      type: "promo",
      remuneree: true,
      echeance: "publication",
    };

    // ── Une notif qui n'existe pas : refus, et la campagne est citée ─────────
    const inconnue = await appel("lancer_experience", { ...lancement, notif: `Absente ${ts}`, simuler: true });
    expect(inconnue.erreur).toBe(true);
    expect(inconnue.texte).toContain(`Absente ${ts}`);

    // ── Simuler : la notif et les scripts montés se lisent AVANT de lancer ───
    const sim = JSON.parse((await appel("lancer_experience", { ...lancement, simuler: true })).texte);
    expect(sim.communs).toMatchObject({ notif: `Je te quitte ${ts}`, type: "promo", remuneree: true, echeance: "le jour de publication de chaque mission" });
    expect(sim.scripts).toEqual([
      { hook: "Hook un", script: `Premier hook ${ts}\n\nJe montre l'appli.\n\nLe lien est dans ma bio.`, notif: `Je te quitte ${ts}` },
      { hook: "Hook deux", script: `Second hook ${ts}\n\nJe montre l'appli.\n\nLe lien est dans ma bio.`, notif: `Je te quitte ${ts}` },
    ]);

    // ── Lancer : la MÊME notif partout, missions qualifiées, échéance du jour ─
    const go = await appel("lancer_experience", lancement);
    expect(go.erreur, go.texte).toBe(false);
    const toutes = (await admin.query(api.assignments.listAssignments, {})).filter((a) => creatrices.some((c) => c.creatorId === a.creatorId));
    expect(toutes).toHaveLength(4);
    for (const m of toutes) {
      expect(m.scriptCombo?.notifBrickId).toBe(quitte);
      expect(m.scriptCombo?.notifText).toBe(`Je te quitte ${ts}`);
      expect(m.contentType).toBe("promo");
      expect(m.remunerated).toBe(true);
      expect(jourDe(m.dueDate)).toBe(jourDe(m.postDate));
      expect(jourDe(m.dueDate + 1000)).not.toBe(jourDe(m.postDate));
    }
    expect(new Set(toutes.map((m) => jourDe(m.dueDate)))).toEqual(new Set([J3, J5]));
  });
});
