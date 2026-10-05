import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { ConvexHttpClient } from "convex/browser";
import type { Page } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

/** Une créatrice, un compte TikTok disponible. */
async function createatrice(ts: number, tag: string) {
  const c = await createCreatorSession(convexUrl!, {
    name: `[E2E_TEST] ${tag} ${ts}`,
    email: `e2e-${tag.toLowerCase()}-${ts}@repackit.test`,
    password: `${tag.toLowerCase()}-123456`,
  });
  const target = await availableTarget({ e2eClient: admin, creatorId: c.creatorId, platform: "TikTok", handle: `@${tag.toLowerCase()}${ts}` });
  return { ...c, target };
}

/** Une mission sur un format À SON NOM (une ligne reconnaissable dans la liste). */
async function mission(c: Awaited<ReturnType<typeof createatrice>>, formatName: string, dueInDays = 7) {
  const formatId = (await createFormatWithRate(admin, { name: formatName, type: "short", rateModel: { basePerPost: 20 } })) as Id<"formats">;
  await admin.mutation(api.assignments.assignFormat, {
    formatId,
    creatorId: c.creatorId,
    targets: [c.target],
    postsPerCreator: 1,
    dueDate: Date.now() + dueInDays * DAY,
  });
  return (await admin.query(api.assignments.listAssignments, {})).find((a) => a.formatId === formatId)!._id;
}

const ligneDe = async (id: Id<"assignments">) => (await admin.query(api.assignments.listAssignments, {})).find((a) => a._id === id);
const emailsAnnulation = (id: Id<"assignments">) => admin.mutation(api.assignments.e2eCancelEmailsFor, { secret: E2E_SECRET, id });

/** Upload réel d'un petit fichier « vidéo » par la créatrice, puis soumission. */
async function envoyerVideo(client: ConvexHttpClient, projectId: Id<"projects">, id: Id<"assignments">) {
  const uploadUrl = await client.mutation(api.storage.generateUploadUrl, {});
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "video/mp4" },
    body: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]),
  });
  if (!res.ok) throw new Error(`upload échoué (HTTP ${res.status})`);
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  await client.mutation(api.assignments.submitVideo, { projectId, id, storageId, mimeType: "video/mp4" });
  return storageId;
}

async function vueListe(page: Page) {
  await page.goto(adminPath("/assignments"));
  await page.getByRole("radio", { name: "Liste" }).click();
}

/**
 * ABANDONNER / RÉTABLIR, VIDÉOS SUPPRIMÉES — suite de l'incident Juliette
 * (05/10/2026) : l'équipe n'avait que la corbeille pour retirer une mission, et
 * aucun écran pour retrouver une vidéo supprimée.
 */
test.describe("Abandonner une mission, et récupérer une vidéo supprimée", () => {
  test("abandon d'une mission avec vidéo : confirmation explicite, vidéo gardée, créatrice prévenue ; « Rétablir » remet le statut exact", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const c = await createatrice(ts, "Abandon");
    const fmtVideo = `[E2E_TEST] Abandon vidéo ${ts}`;
    const fmtAutre = `[E2E_TEST] Abandon autre ${ts}`;
    const m = await mission(c, fmtVideo);
    await mission(c, fmtAutre); // une mission vivante, que le filtre « Abandonné » doit cacher
    // Vidéo envoyée et validée : « à publier », avec son fichier (cas Juliette).
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, { secret: E2E_SECRET, id: m, status: "to_publish" });
    await admin.mutation(api.assignments.e2eSetSubmittedVideoStream, { secret: E2E_SECRET, id: m, uid: `uid-abandon-${ts}`, status: "ready" });

    // Le cœur refuse sans confirmation explicite — le bouton passe donc par elle.
    await expect(admin.mutation(api.assignments.cancelAssignment, { id: m })).rejects.toThrow(/ERR_ASSIGNMENT_HAS_VIDEO|Vidéo déjà envoyée/);
    expect((await ligneDe(m))!.status).toBe("to_publish");

    await vueListe(page);
    const row = page.getByRole("row").filter({ hasText: fmtVideo });
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await row.getByRole("button", { name: "Abandonner cette mission" }).click();
    const dialog = page.getByTestId("abandon-dialog");
    await expect(dialog.getByTestId("abandon-video-warning")).toContainText("Une vidéo a déjà été envoyée pour cette mission (statut : À publier). Elle est conservée");
    await expect(dialog.getByRole("checkbox", { name: /Prévenir la créatrice par email/ })).toBeChecked();
    await dialog.getByRole("button", { name: "Abandonner malgré la vidéo" }).click();
    await expect(dialog).toBeHidden();

    // Abandonnée, toujours dans la liste, vidéo intacte, email planifié.
    await expect(row).toContainText("Abandonné");
    const abandonnee = (await ligneDe(m))!;
    expect(abandonnee.status).toBe("cancelled");
    expect(abandonnee.submittedVideoStreamUid).toBe(`uid-abandon-${ts}`);
    expect(await emailsAnnulation(m)).toEqual([{ assignmentId: m, videoKept: true }]);

    // Filtrable : « Abandonné » ne montre qu'elle, pas la mission vivante.
    await page.getByRole("combobox", { name: "Filtrer par statut" }).click();
    await page.getByRole("option", { name: "Abandonné", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: fmtVideo })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: fmtAutre })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Filtrer par statut" }).click();
    await page.getByRole("option", { name: "Tous statuts" }).click();
    await expect(page.getByRole("row").filter({ hasText: fmtAutre })).toHaveCount(1);

    // « Rétablir » : le statut EXACT d'avant (« à publier »), pas « à faire ».
    await row.getByRole("button", { name: "Rétablir cette mission" }).click();
    await expect(page.getByText("Mission rétablie : statut « À publier ».")).toBeVisible();
    const retablie = (await ligneDe(m))!;
    expect(retablie.status).toBe("to_publish");
    expect(retablie.submittedVideoStreamUid).toBe(`uid-abandon-${ts}`);

    // La fiche garde la trace : qui, quand, depuis quel statut, prévenue ou non.
    await row.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Ouvrir le détail" }).click();
    const historique = page.getByTestId("assignment-status-history");
    await expect(historique.getByRole("listitem")).toHaveCount(2);
    await expect(historique.getByRole("listitem").nth(0)).toContainText("Abandonnée le");
    await expect(historique.getByRole("listitem").nth(0)).toContainText("(était : À publier) · créatrice prévenue par email");
    await expect(historique.getByRole("listitem").nth(1)).toContainText("Rétablie le");
    await expect(historique.getByRole("listitem").nth(1)).toContainText("(statut : À publier)");
    await expect(historique).not.toContainText("par quelqu'un");
  });

  test("sans vidéo : confirmation simple ; case décochée = aucun email, cochée = un email ; « Abandonner plutôt » depuis la suppression", async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const c = await createatrice(ts, "Simple");
    const fmt = `[E2E_TEST] Simple ${ts}`;
    const m = await mission(c, fmt);

    // La corbeille propose l'option sûre.
    await vueListe(page);
    const row = page.getByRole("row").filter({ hasText: fmt });
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await row.getByRole("button", { name: "Supprimer cet assignment" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Abandonner plutôt" }).click();

    // Pas de vidéo : pas d'avertissement, bouton simple. Case DÉCOCHÉE.
    const dialog = page.getByTestId("abandon-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("abandon-video-warning")).toHaveCount(0);
    const caseEmail = dialog.getByRole("checkbox", { name: /Prévenir la créatrice par email/ });
    await expect(caseEmail).toBeChecked();
    await caseEmail.click();
    await expect(caseEmail).not.toBeChecked();
    await dialog.getByRole("button", { name: "Abandonner", exact: true }).click();
    await expect(dialog).toBeHidden();

    // Abandonnée, PAS supprimée, et aucun email.
    await expect(row).toContainText("Abandonné");
    expect((await ligneDe(m))!.status).toBe("cancelled");
    expect(await emailsAnnulation(m)).toEqual([]);

    // Depuis la fiche : Rétablir (« à faire »), puis abandon case cochée → un email.
    await row.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Ouvrir le détail" }).click();
    const sheet = page.getByTestId("assignment-detail-sheet");
    await sheet.getByTestId("assignment-detail-restore").click();
    await expect.poll(async () => (await ligneDe(m))!.status).toBe("todo");
    await sheet.getByTestId("assignment-detail-abandon").click();
    await expect(dialog.getByRole("checkbox", { name: /Prévenir la créatrice par email/ })).toBeChecked();
    await dialog.getByRole("button", { name: "Abandonner", exact: true }).click();
    await expect.poll(async () => (await ligneDe(m))!.status).toBe("cancelled");
    expect(await emailsAnnulation(m)).toEqual([{ assignmentId: m, videoKept: false }]);
    await expect(sheet.getByTestId("assignment-status-history")).toContainText("créatrice non prévenue");
    await expect(sheet.getByTestId("assignment-status-history")).toContainText("créatrice prévenue par email");
  });

  test("« Rétablir » refuse quand la créatrice a repris le même script entre-temps", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const c = await createatrice(ts, "Combo");
    // UNE combinaison possible : 1 hook × 1 flux × 1 cta.
    const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] Combo ${ts}` })) as Id<"scriptCampaigns">;
    for (const kind of ["hook", "flux", "cta"] as const) {
      await admin.mutation(api.scripts.createBrick, { campaignId, kind, label: kind, content: `${kind} ${ts}` });
    }
    const { pricingId } = await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] Combo ${ts}`, montantFixe: 50, nbVideosCible: 5, tauxCPM: 1 });
    const assigner = async () => {
      await admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId: c.creatorId,
        targets: [c.target],
        videosPerCreator: 1,
        dueDate: Date.now() + 7 * DAY,
        pricingId,
      });
      return (await admin.query(api.assignments.listAssignments, {})).filter((a) => a.scriptCombo?.campaignId === campaignId);
    };
    const [premiere] = await assigner();
    await admin.mutation(api.assignments.cancelAssignment, { id: premiere._id });
    // L'abandon a libéré la combinaison : la nouvelle mission la reprend.
    const seconde = (await assigner()).find((a) => a._id !== premiere._id)!;
    expect(seconde.comboKey).toBe(premiere.comboKey);

    await expect(admin.mutation(api.assignments.restoreAssignment, { id: premiere._id })).rejects.toThrow(/ERR_ASSIGNMENT_RESTORE_COMBO_TAKEN/);
    expect((await ligneDe(premiere._id))!.status).toBe("cancelled");

    // L'autre abandonnée, plus rien ne bloque : retour au statut d'avant.
    await admin.mutation(api.assignments.cancelAssignment, { id: seconde._id });
    expect(await admin.mutation(api.assignments.restoreAssignment, { id: premiere._id })).toEqual({ ok: true, status: "todo", exact: true });
  });

  test("vidéos supprimées : la vidéo se télécharge et se rattache à une mission de la créatrice, qui passe en Validation ; jamais par-dessus une vidéo", async ({ page }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const c = await createatrice(ts, "Archive");
    const supprimee = await mission(c, `[E2E_TEST] Archive supprimée ${ts}`);
    const cible = await mission(c, `[E2E_TEST] Archive cible ${ts}`, 9);
    const envoyee = await mission(c, `[E2E_TEST] Archive envoyée ${ts}`, 8);
    const seconde = await mission(c, `[E2E_TEST] Archive seconde ${ts}`);
    const storageId = await envoyerVideo(c.client, c.projectId, supprimee);
    await envoyerVideo(c.client, c.projectId, envoyee);
    await envoyerVideo(c.client, c.projectId, seconde);

    // Supprimée : la vidéo part en archive, avec l'auteur de la suppression.
    await admin.mutation(api.assignments.deleteAssignment, { id: supprimee });
    const archive = (await admin.mutation(api.deletedVideos.e2eArchiveOf, { secret: E2E_SECRET, assignmentId: supprimee }))!;
    expect(archive.hasFile).toBe(true);
    expect(archive.deletedBy).not.toBeNull();

    // L'écran, par le menu Production.
    await page.goto(adminPath("/assignments"));
    await page.getByRole("link", { name: "Vidéos supprimées" }).click();
    await expect(page.getByRole("heading", { name: "Vidéos supprimées" })).toBeVisible();
    const carte = page.getByTestId(`deleted-video-${supprimee}`);
    await expect(carte).toContainText(`Archive ${ts}`);
    await expect(carte).toContainText(`archive${ts}`);
    await expect(carte).toContainText(`[E2E_TEST] Archive supprimée ${ts}`);
    await expect(carte.getByTestId("deleted-video-days-left")).toHaveText("Effacée définitivement dans 30 jours");
    await expect(carte.getByTestId("deleted-video-when")).toContainText("par ");
    await expect(carte.getByTestId("deleted-video-when")).not.toContainText("auteur non enregistré");
    await expect(carte.getByTestId("deleted-video-when")).toContainText("elle était « Vidéo en revue »");
    // Télécharger : le FICHIER d'origine stocké.
    const ligne = (await admin.query(api.deletedVideos.listDeletedVideos, {})).find((d) => d.assignmentId === supprimee)!;
    expect(ligne.url).toBeTruthy();
    await expect(carte.getByTestId("deleted-video-download")).toHaveAttribute("href", ligne.url!);

    // Le serveur refuse de rattacher par-dessus une vidéo envoyée.
    await expect(
      admin.mutation(api.deletedVideos.attachToMission, { id: ligne._id, assignmentId: envoyee }),
    ).rejects.toThrow(/ERR_DELETED_VIDEO_TARGET_HAS_VIDEO/);

    // Rattacher : seule la mission qui n'a rien envoyé est proposée.
    await carte.getByTestId("deleted-video-attach").click();
    const dialog = page.getByTestId("attach-dialog");
    await expect(dialog.getByRole("radio")).toHaveCount(1);
    await expect(dialog).toContainText(`[E2E_TEST] Archive cible ${ts}`);
    await expect(dialog).not.toContainText(`Archive envoyée ${ts}`);
    await dialog.getByRole("radio").check();
    await dialog.getByTestId("attach-confirm").click();
    await expect(dialog).toBeHidden();
    await expect(carte).toHaveCount(0);

    // La vidéo est sur la mission, « vidéo envoyée » : le circuit normal.
    const rattachee = (await ligneDe(cible))!;
    expect(rattachee.status).toBe("video_submitted");
    expect(rattachee.submittedVideoStorageId).toBe(storageId);
    // L'archive ne référence plus le fichier : la purge à 30 jours ne peut plus l'effacer.
    const apres = (await admin.mutation(api.deletedVideos.e2eArchiveOf, { secret: E2E_SECRET, assignmentId: supprimee }))!;
    expect(apres.hasFile).toBe(false);
    expect(apres.reattachedTo).toBe(cible);
    // Elle apparaît dans Validation.
    await page.goto(adminPath("/validation"));
    await expect(page.getByTestId(`submission-media-${cible}`)).toBeVisible({ timeout: 15_000 });

    // Une seconde vidéo supprimée, et plus AUCUNE mission libre : l'écran dit pourquoi.
    await admin.mutation(api.assignments.deleteAssignment, { id: seconde });
    await page.goto(adminPath("/videos-supprimees"));
    const carte2 = page.getByTestId(`deleted-video-${seconde}`);
    await carte2.getByTestId("deleted-video-attach").click();
    await expect(page.getByTestId("attach-impossible")).toContainText("Aucune mission de cette créatrice n'attend de vidéo : 2 ont déjà une vidéo envoyée");
    await expect(page.getByTestId("attach-confirm")).toBeDisabled();
    await page.keyboard.press("Escape");

    // Téléphone : rien ne déborde, les actions sont à portée.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(carte2.getByTestId("deleted-video-attach")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const bouton = (await carte2.getByTestId("deleted-video-attach").boundingBox())!;
    expect(bouton.x + bouton.width).toBeLessThanOrEqual(390);
    expect(bouton.height).toBeGreaterThanOrEqual(44);
  });
});
