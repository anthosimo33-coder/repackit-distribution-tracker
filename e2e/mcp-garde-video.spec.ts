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

/** Une clé « Missions » créée dans l'écran, et de quoi appeler ses outils. */
async function cleMissions(page: Page, nom: string) {
  await page.goto(adminPath("/comptes"));
  await page.getByRole("button", { name: "Connecter Claude" }).click();
  await page.getByLabel("Nom de la clé").fill(nom);
  await page.getByRole("button", { name: "Créer une clé" }).click();
  const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
  const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
  await page.getByRole("button", { name: "J’ai copié la clé" }).click();
  const interrupteur = page.getByRole("switch", { name: `Modifications des missions pour ${nom}` });
  await interrupteur.click();
  await expect(interrupteur).toBeChecked();
  const appel = async (name: string, args: Record<string, unknown>) => {
    const r = await rpc(url, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
    return { erreur: r.error !== undefined || r.result?.isError === true, texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "" };
  };
  /** La ligne de journal la plus récente de cet outil, et son détail avant/après. */
  const journal = async (outil: string) => {
    const liste = JSON.parse((await appel("modifications", { limite: 30 })).texte).modifications as { rang: number; outil: string; etat: string }[];
    const l = liste.find((m) => m.outil === outil)!;
    expect(l, `aucune ligne « ${outil} » au journal`).toBeDefined();
    // `rang` en TEXTE, comme l'enverrait un connecteur au schéma périmé.
    const d = await appel("modifications", { rang: String(l.rang) });
    expect(d.erreur, d.texte).toBe(false);
    return { ...l, detail: JSON.parse(d.texte) as { documents: { table: string; id: string; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null }[] } };
  };
  return { appel, journal };
}

/**
 * GARDE-FOUS VIDÉO ET JOURNAL — incident du 05/10/2026 : une mission « à
 * publier » (vidéo envoyée) abandonnée par l'outil, puis supprimée à l'écran,
 * a perdu sa vidéo ; sa combinaison n'était plus nulle part. Trois règles :
 * l'abandon d'une mission avec vidéo exige « forcer » et garde la vidéo ; la
 * suppression met la vidéo en archive 30 jours ; chaque écriture garde au
 * journal la mission avant/après, et `defaire` remet l'état exact.
 */
test.describe("Garde-fous vidéo et journal", () => {
  test("abandon d'une mission avec vidéo : refusé, puis forcé (vidéo gardée), défait à l'identique", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const nom = `Lina Garde ${ts}`;
    const c = await createCreatorSession(convexUrl, { name: `[E2E_TEST] ${nom}`, email: `e2e-garde-${ts}@repackit.test`, password: "garde-123456" });
    await availableTarget({ e2eClient: admin, creatorId: c.creatorId, platform: "TikTok", handle: `@lina${ts}` });
    const campagne = `Garde ${ts}`;
    const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${campagne}` })) as Id<"scriptCampaigns">;
    for (const [kind, label, content] of [
      ["hook", "Hook A", `Hook A ${ts}`],
      ["hook", "Hook B", `Hook B ${ts}`],
      ["flux", "Flux", "Je montre l'appli."],
      ["cta", "CTA", "Le lien est dans ma bio."],
    ] as const) {
      await admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    }
    const bareme = `Barème garde ${ts}`;
    await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] ${bareme}`, montantFixe: 50, nbVideosCible: 5, tauxCPM: 1.1 });
    const { appel, journal } = await cleMissions(page, `E2E garde ${ts}`);
    const J3 = jourParis(3);
    expect((await appel("assigner_scripts", { campagne, createatrices: [nom], jours: [J3], bareme })).erreur).toBe(false);
    const mission = async () => (await admin.query(api.assignments.listAssignments, {})).find((a) => a.creatorId === c.creatorId && jourDe(a.postDate) === J3)!;

    // La création est au journal : la mission APRÈS, rien avant.
    const creation = await journal("assigner_scripts");
    expect(creation.detail.documents).toHaveLength(1);
    expect(creation.detail.documents[0]).toMatchObject({ table: "assignments", avant: null });
    expect(creation.detail.documents[0].apres).toMatchObject({ status: "todo" });

    // La créatrice a envoyé sa vidéo, validée : « à publier », avec son fichier.
    const m0 = await mission();
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, { secret: E2E_SECRET, id: m0._id, status: "to_publish" });
    await admin.mutation(api.assignments.e2eSetSubmittedVideoStream, { secret: E2E_SECRET, id: m0._id, uid: `uid-garde-${ts}`, status: "ready" });
    const avantAbandon = await mission();

    // Refusé par défaut, avec le statut et la façon de confirmer.
    const refus = await appel("annuler_mission", { createatrice: nom, jour: J3 });
    expect(refus.erreur).toBe(true);
    expect(refus.texte).toContain("vidéo déjà envoyée (statut à publier), annulation refusée ; passe forcer: true pour confirmer");
    expect((await mission()).status).toBe("to_publish");
    // Le bouton de l'écran tient la même règle.
    await expect(admin.mutation(api.assignments.cancelAssignment, { id: m0._id })).rejects.toThrow(/ERR_ASSIGNMENT_HAS_VIDEO|Vidéo déjà envoyée/);

    // Forcé (« true » en TEXTE : schéma périmé côté connecteur) : abandonnée, vidéo gardée.
    const force = await appel("annuler_mission", { createatrice: nom, jour: J3, forcer: "true" });
    expect(force.erreur, force.texte).toBe(false);
    const abandonnee = await mission();
    expect(abandonnee.status).toBe("cancelled");
    expect(abandonnee.submittedVideoStreamUid).toBe(`uid-garde-${ts}`);

    // Le journal a la mission entière avant/après — et l'abandon se DÉFAIT.
    const j = await journal("annuler_mission");
    expect(j.etat).toBe("se défait");
    expect(j.detail.documents[0].avant).toMatchObject({ status: "to_publish", submittedVideoStreamUid: `uid-garde-${ts}` });
    expect(j.detail.documents[0].apres).toMatchObject({ status: "cancelled", submittedVideoStreamUid: `uid-garde-${ts}` });
    const d = await appel("defaire", { rang: j.rang, outil: "annuler_mission" });
    expect(d.erreur, d.texte).toBe(false);
    expect(await mission()).toEqual(avantAbandon);
  });

  test("reecrire_mission : hook, notif et consigne réécrits sans email ; défait à l'identique ; refusé si vidéo envoyée", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const nom = `Maé Script ${ts}`;
    const c = await createCreatorSession(convexUrl, { name: `[E2E_TEST] ${nom}`, email: `e2e-reecrire-${ts}@repackit.test`, password: "reecrire-12345" });
    await availableTarget({ e2eClient: admin, creatorId: c.creatorId, platform: "TikTok", handle: `@mae${ts}` });
    const campagne = `Réécrire ${ts}`;
    const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${campagne}` })) as Id<"scriptCampaigns">;
    await admin.mutation(api.scripts.updateCampaign, { id: campaignId, notifEnabled: true });
    const brique = (kind: "hook" | "flux" | "cta" | "notif", label: string, content: string) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content }) as Promise<Id<"scriptBricks">>;
    await brique("hook", "Hook actif", `Hook actif ${ts}`);
    const hookEteint = await brique("hook", "Hook éteint", `Mon mec m’a envoyé ça hier soir ${ts}`);
    await admin.mutation(api.scripts.updateBrick, { id: hookEteint, active: false });
    await brique("flux", "Flux", "Je montre l'appli.");
    await brique("cta", "CTA", "Tous les memes finalement");
    await brique("notif", "Notif 1", `Je te quitte ${ts}`);
    const notif2 = await brique("notif", "Notif 2", `Ma copine est pas là ce soir 😏 ${ts}`);
    const bareme = `Barème réécrire ${ts}`;
    await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] ${bareme}`, montantFixe: 50, nbVideosCible: 5, tauxCPM: 1.1 });
    const { appel, journal } = await cleMissions(page, `E2E réécrire ${ts}`);
    const J3 = jourParis(3);
    expect((await appel("assigner_scripts", { campagne, createatrices: [nom], jours: [J3], bareme })).erreur).toBe(false);
    const missionDu = async (jour: string) =>
      (await admin.query(api.assignments.listAssignments, {})).find((a) => a.creatorId === c.creatorId && jourDe(a.postDate) === jour)!;
    const avant = await missionDu(J3);

    // Hook DÉSACTIVÉ (hors tirage) + autre notif + consigne : écrits sur place.
    const r = await appel("reecrire_mission", {
      createatrice: nom,
      jour: J3,
      hook: "Hook éteint",
      notif: "Notif 2",
      consigne: "Fais arriver la notification pendant la démo.",
    });
    expect(r.erreur, r.texte).toBe(false);
    const apres = await missionDu(J3);
    expect(apres.scriptCombo?.hookBrickId).toBe(hookEteint);
    expect(apres.scriptCombo?.notifBrickId).toBe(notif2);
    expect(apres.instructions).toBe("Fais arriver la notification pendant la démo.");
    expect(apres.comboImposed).toBe(true);
    expect(apres.status).toBe(avant.status);
    expect(apres.dueDate).toBe(avant.dueDate);

    // Journal : la mission entière avant/après ; défaire remet l'état EXACT.
    const j = await journal("reecrire_mission");
    expect(j.etat).toBe("se défait");
    expect((j.detail.documents[0].avant as { scriptCombo: { hookBrickId: string } }).scriptCombo.hookBrickId).toBe(avant.scriptCombo?.hookBrickId);
    const scriptApres = (j.detail.documents[0].apres as { scriptCombo: { hookBrickId: string; assembledScript: string; notifText: string } }).scriptCombo;
    expect(scriptApres.hookBrickId).toBe(hookEteint);
    // Le texte monté depuis les briques, comme à l'assignation ; la notif figée.
    expect(scriptApres.assembledScript).toBe(`Mon mec m’a envoyé ça hier soir ${ts}\n\nJe montre l'appli.\n\nTous les memes finalement`);
    expect(scriptApres.notifText).toBe(`Ma copine est pas là ce soir 😏 ${ts}`);
    const d = await appel("defaire", { rang: j.rang, outil: "reecrire_mission" });
    expect(d.erreur, d.texte).toBe(false);
    expect(await missionDu(J3)).toEqual(avant);

    // Une fois la vidéo envoyée, la mission est tournée : elle ne se réécrit plus.
    await admin.mutation(api.assignments.e2eSetSubmittedVideoStream, { secret: E2E_SECRET, id: avant._id, uid: `uid-reecrire-${ts}`, status: "ready" });
    const tournee = await appel("reecrire_mission", { createatrice: nom, jour: J3, hook: "Hook éteint" });
    expect(tournee.erreur).toBe(true);
    expect(tournee.texte).toContain("vidéo déjà envoyée");
    expect((await missionDu(J3)).scriptCombo?.hookBrickId).toBe(avant.scriptCombo?.hookBrickId);
  });

  test("supprimer une mission qui a une vidéo : l'écran prévient, la vidéo reste 30 jours en archive", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const C = await createCreatorSession(convexUrl, { name: `[E2E_TEST] Archive ${ts}`, email: `e2e-archive-${ts}@repackit.test`, password: "archive-12345" });
    const formatName = `[E2E_TEST] Archive Fmt ${ts}`;
    const fid = (await createFormatWithRate(admin, { name: formatName, type: "short", rateModel: { basePerPost: 30 } })) as Id<"formats">;
    const target = await availableTarget({ e2eClient: admin, creatorId: C.creatorId, platform: "TikTok", handle: `@archive${ts}` });
    await admin.mutation(api.assignments.assignFormat, { formatId: fid, creatorId: C.creatorId, targets: [target], postsPerCreator: 1, dueDate: ts + 7 * DAY });
    const m = (await admin.query(api.assignments.listAssignments, {})).find((a) => a.creatorId === C.creatorId)!;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, { secret: E2E_SECRET, id: m._id, status: "to_publish" });
    await admin.mutation(api.assignments.e2eSetSubmittedVideoStream, { secret: E2E_SECRET, id: m._id, uid: `uid-archive-${ts}`, status: "ready" });

    await page.goto(adminPath("/assignments"));
    await page.getByRole("radio", { name: "Liste" }).click();
    const row = page.getByRole("row").filter({ hasText: formatName });
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await row.getByRole("button", { name: "Supprimer cet assignment" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByTestId("delete-video-warning")).toContainText("conservée 30 jours après la suppression");
    await dialog.getByRole("button", { name: "Supprimer" }).click();
    // La fenêtre fermée = la suppression est enregistrée. Tant qu'elle est
    // ouverte, la page dessous est masquée : « 0 ligne » serait vrai trop tôt.
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(row).toHaveCount(0, { timeout: 10_000 });

    // Partie la mission, PAS la vidéo : archivée avec la mission entière, 30 jours.
    const archive = await admin.mutation(api.deletedVideos.e2eArchiveOf, { secret: E2E_SECRET, assignmentId: m._id });
    expect(archive).not.toBeNull();
    expect(archive!.streamUid).toBe(`uid-archive-${ts}`);
    expect(archive!.purgeAfter - archive!.deletedAt).toBe(30 * DAY);
    expect(JSON.parse(archive!.mission)).toMatchObject({ _id: m._id, status: "to_publish", submittedVideoStreamUid: `uid-archive-${ts}` });
  });
});
