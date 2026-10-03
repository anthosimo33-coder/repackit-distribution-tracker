import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { minuitParis } from "./helpers/paris-day";
import { endOfParisDay } from "../convex/missionOpsPlan";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Page } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

const jourParis = (n: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + n * DAY));
const jourDe = (ts: number | undefined) =>
  ts === undefined ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));
/** Ce que l'écran affiche (navigateur épinglé à Paris) — calculé ici sans dépendre du fuseau du runner. */
const dateEcran = (ts: number) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris" }).format(new Date(ts));
/** L'instant d'une échéance posée sur ce jour : 23:59:59 à Paris. */
const finDe = (jour: string) => {
  const t = endOfParisDay(jour);
  if (t === null) throw new Error(`jour invalide ${jour}`);
  return t;
};

type Rpc = { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };

async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}

/** Une clé MCP créée dans l'écran, domaine « missions » ouvert. */
async function cleMissions(page: Page, nom: string) {
  await page.goto(adminPath("/comptes"));
  await page.getByRole("button", { name: "Connecter Claude" }).click();
  await page.getByLabel("Nom de la clé").fill(nom);
  await page.getByRole("button", { name: "Créer une clé" }).click();
  const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
  const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
  await page.getByRole("button", { name: "J’ai copié la clé" }).click();
  const interrupteur = `Modifications des missions pour ${nom}`;
  await page.getByRole("switch", { name: interrupteur }).click();
  await expect(page.getByRole("switch", { name: interrupteur })).toBeChecked();
  const appel = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc(url, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
    return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
  };
  return { appel };
}

/** Créatrice, compte, campagne de trois briques, barème — le décor commun. */
async function decor(ts: number, prenom: string) {
  const nom = `${prenom} Da Costa ${ts}`;
  const c = await createCreatorSession(convexUrl!, {
    name: `[E2E_TEST] ${nom}`,
    email: `e2e-due-date-${prenom.toLowerCase()}-${ts}@repackit.test`,
    password: "due-date-123456",
  });
  const handle = `@${prenom.toLowerCase()}_olv${ts}`;
  const target = await availableTarget({ e2eClient: admin, creatorId: c.creatorId, platform: "TikTok", handle });
  const campagne = `Reaction + Demo LAB ${ts}`;
  const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${campagne}` })) as Id<"scriptCampaigns">;
  for (const [kind, label, content] of [
    ["hook", "LES 2000", `LES 2000 QUI SONT EN COUPLES SONT FOUTUES MDR !!!! ${ts}`],
    ["hook", "Attendez", `Attendez..quelqu’un peut m’expliquer ce que je viens de trouver ??!! ${ts}`],
    ["hook", "Je pensais", `Je pensais que j’étais parano… jusqu’à ce que je voie ça ${ts}`],
    ["flux", "FLOW 02 — « ELLE LE SUIT AUSSI »", "1) Commence directement sur le profil Instagram de @jeremieltvt."],
    ["cta", "personne", "personne m'avait dit qu'on pouvait voir ça sur insta #instagram #abonnements #pourlesfilles"],
  ] as const) {
    await admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
  }
  const bareme = `Créateur Francais 2 vidéos ${ts}`;
  const { pricingId } = await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] ${bareme}`, montantFixe: 600, nbVideosCible: 2, tauxCPM: 0 });
  const missions = async () => (await admin.query(api.assignments.listAssignments, {})).filter((a) => a.creatorId === c.creatorId);
  return { nom, c, handle, target, campagne, campaignId, bareme, pricingId, missions };
}

/**
 * ÉCHÉANCE DE PRODUCTION d'une mission existante. L'assignation pose une échéance
 * pour tout le lot ; on la cale ensuite mission par mission (le plus souvent sur
 * le jour de publication), sans annuler ni réassigner — donc sans email.
 */
test.describe("Échéance de production — modifiable après l'assignation", () => {
  test("écran : caler l'échéance sur le jour de publication ; refus serveur ; verrou après publication", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const d = await decor(ts, "Sarah");
    const aujourdhui = jourParis(0);
    // L'échéance d'origine : dans 12 jours (la forme de l'assignation : fin de journée).
    const origine = finDe(jourParis(12));
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId: d.campaignId,
      creatorId: d.c.creatorId,
      targets: [d.target],
      videosPerCreator: 1,
      dueDate: origine,
      pricingId: d.pricingId,
      postDates: [minuitParis()],
    });
    const mission = async () => (await d.missions())[0];
    const id = (await mission())._id as Id<"assignments">;
    expect((await mission()).dueDate).toBe(origine);

    await page.goto(adminPath("/assignments"));
    await expect(page.getByText(/\d+ \/ \d+ livrable/)).toBeVisible();
    await page.locator("button").filter({ hasText: "Tous créateurs" }).click();
    await page.locator('[role="option"]').filter({ hasText: d.nom }).click();
    await page.keyboard.press("Escape");
    await page.getByTitle(new RegExp(d.nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).click();
    const sheet = page.getByTestId("assignment-detail-sheet");
    await expect(sheet).toBeVisible();

    const bouton = sheet.getByTestId("assignment-detail-due-date");
    await expect(bouton).toHaveText(dateEcran(origine));
    await bouton.click();
    await page.getByRole("button", { name: "Caler sur le jour de publication" }).click();
    await expect(page.getByText("Échéance mise à jour.")).toBeVisible();

    // Serveur : fin du jour de publication à Paris — pas minuit, pas l'heure du clic.
    expect((await mission()).dueDate).toBe(finDe(aujourdhui));
    await expect(bouton).toHaveText(dateEcran(finDe(aujourdhui)));

    // ── Refus serveur — la règle ne dépend pas de l'écran ───────────────────
    const poser = (dueDay: string) => admin.mutation(api.assignments.setAssignmentDueDate, { id, dueDay });
    await expect(poser("08/10/2026")).rejects.toThrow(/ERR_DUE_DATE_INVALID/);
    await expect(poser("2026-02-30")).rejects.toThrow(/ERR_DUE_DATE_INVALID/);
    expect((await mission()).dueDate).toBe(finDe(aujourdhui));
    await expect(poser(jourParis(5))).resolves.toEqual({ ok: true, dueDate: finDe(jourParis(5)) });

    // ── Publiée → échéance figée, et l'écran repasse en lecture seule ───────
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id,
      urls: [{ platform: "TikTok", url: `https://www.tiktok.com/${d.handle}/video/${ts}` }],
    });
    await expect(poser(jourParis(6))).rejects.toThrow(/ERR_DUE_DATE_LOCKED/);
    expect((await mission()).dueDate).toBe(finDe(jourParis(5)));
    await expect(sheet.getByTestId("detail-publication-published")).toBeVisible();
    await expect(bouton).toHaveCount(0);
    await expect(sheet).toContainText(dateEcran(finDe(jourParis(5))));
  });

  test("connecteur : replanifier_mission « echeance » (jour, publication, avec nouveau jour) et défaire", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const d = await decor(ts, "Thania");
    const [J3, J4, J5, J6, J9] = [3, 4, 5, 6, 9].map(jourParis);
    const { appel } = await cleMissions(page, `E2E échéance ${ts}`);

    // Une seule assignation, échéance commune J9 — la situation de départ.
    const a = await appel("assigner_scripts", { campagne: d.campagne, createatrices: [d.nom], jours: [J3, J4], bareme: d.bareme, echeance: J9 });
    expect(a.erreur, a.texte).toBe(false);
    const du = async (jour: string) => (await d.missions()).find((m) => jourDe(m.postDate) === jour)!;
    expect((await du(J3)).dueDate).toBe(finDe(J9));
    expect((await du(J4)).dueDate).toBe(finDe(J9));

    // « publication » : la fin du jour de publication prévu.
    const r1 = await appel("replanifier_mission", { createatrice: d.nom, jour: J3, echeance: "publication" });
    expect(r1.erreur, r1.texte).toBe(false);
    expect(r1.texte).toContain("échéance");
    expect((await du(J3)).dueDate).toBe(finDe(J3));
    // L'autre mission n'a pas bougé.
    expect((await du(J4)).dueDate).toBe(finDe(J9));

    // Avec un nouveau jour dans le même appel : c'est le NOUVEAU jour qui compte.
    const r2 = await appel("replanifier_mission", { createatrice: d.nom, jour: J4, nouveau_jour: J5, echeance: "publication" });
    expect(r2.erreur, r2.texte).toBe(false);
    expect((await du(J5)).dueDate).toBe(finDe(J5));

    // Défaire : jour ET échéance d'origine, à l'instant près.
    const liste = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as {
      rang: number;
      outil: string;
      etat: string;
    }[];
    const derniere = liste.find((m) => m.outil === "replanifier_mission" && m.etat === "se défait")!;
    const d1 = await appel("defaire", { rang: derniere.rang, outil: "replanifier_mission" });
    expect(d1.erreur, d1.texte).toBe(false);
    expect((await du(J4)).dueDate).toBe(finDe(J9));

    // Un jour donné explicitement, puis changé à l'écran : défaire n'écrase rien.
    expect((await appel("replanifier_mission", { createatrice: d.nom, jour: J4, echeance: J6 })).erreur).toBe(false);
    const m4 = await du(J4);
    expect(m4.dueDate).toBe(finDe(J6));
    await admin.mutation(api.assignments.setAssignmentDueDate, { id: m4._id, dueDay: J5 });
    const liste2 = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as {
      rang: number;
      outil: string;
      etat: string;
    }[];
    const r3 = liste2.find((m) => m.outil === "replanifier_mission" && m.etat === "se défait")!;
    const ecrase = await appel("defaire", { rang: r3.rang, outil: "replanifier_mission" });
    expect(ecrase.erreur).toBe(true);
    expect(ecrase.texte).toContain("a changé depuis");
    expect((await du(J4)).dueDate).toBe(finDe(J5));

    // Un jour passé est refusé avant toute écriture.
    const passe = await appel("replanifier_mission", { createatrice: d.nom, jour: J4, echeance: jourParis(-2) });
    expect(passe.erreur).toBe(true);
    expect((await du(J4)).dueDate).toBe(finDe(J5));
  });
});
