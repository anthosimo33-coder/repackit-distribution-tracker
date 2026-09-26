import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { assembledScriptOf } from "./helpers/assignment-script";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { minuitParis } from "./helpers/paris-day";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * Brique NOTIF — activable par campagne, tirée HORS combo, une par vidéo.
 *
 * Ce que la spec tient, bout à bout (le module pur de rotation est couvert par
 * lib/script-notif.test.ts) :
 *  - allumée sans notif tirable → l'assignation est REFUSÉE (pas de vidéo
 *    sortie de la mesure en silence), puis ACCEPTÉE dès qu'il y en a ;
 *  - chaque vidéo porte une notif ACTIVE, différentes entre elles, texte figé ;
 *    le comboKey reste à 3 segments et le texte monté ne la contient pas ;
 *  - la créatrice reçoit le texte de la notif, jamais son id ;
 *  - corriger une AUTRE brique garde la notif ; corriger la notif ne touche ni
 *    au texte monté ni au comboKey ;
 *  - éteinte, les vidéos suivantes n'ont pas de notif ;
 *  - l'analytics range les vues PAR NOTIF (perfByBrick, drill-down, verdicts).
 */
test.describe("Brique notif", () => {
  test("refus sans notif, rotation, fiche créatrice, correction, analytics par notif", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Notif Léa Martin ${ts}`,
      email: `e2e-creator-notif-${ts}@repackit.test`,
      password: "notif-12345",
    });

    // 3 hooks × 1 flux × 1 description = 3 combos (textes de la forme prod).
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Notif ${ts}`,
    });
    const add = (
      kind: "hook" | "flux" | "cta" | "notif",
      label: string,
      content: string,
    ) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    await add("hook", "POV stalk", "POV : tu découvres qui regarde ton profil en cachette");
    await add("hook", "Ex", "Mon ex pensait que je ne verrais jamais ça…");
    await add("hook", "Capture", "Quand tu sais qui fait des captures de tes stories");
    await add("flux", "Démo appli", "Je te montre l'appli : tu tapes le pseudo, et là…");
    await add("cta", "Lien bio", "Lien en bio 🔗 #snytch #stalker #pov");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingNotif ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2enotif${ts}`,
    });
    const assign = (videosPerCreator: number) =>
      admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId: creator.creatorId,
        targets: [target],
        videosPerCreator,
        dueDate: ts + 7 * DAY,
        pricingId,
      });
    const rowsFor = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) =>
          a.scriptCombo?.campaignId === campaignId &&
          a.creatorId === creator.creatorId,
      );

    // ── Allumée SANS notif : refus, et rien n'est créé.
    await admin.mutation(api.scripts.updateCampaign, {
      id: campaignId,
      notifEnabled: true,
    });
    await expect(assign(1)).rejects.toThrow(/aucune notif active/i);
    expect(await rowsFor()).toHaveLength(0);

    // Deux notifs actives (bords blancs : le texte figé est rogné) + une coupée.
    const n1 = await add("notif", "Story ×3", "  Léa a regardé ta story 3 fois 👀 ");
    const n2 = await add("notif", "Capture", "Quelqu'un a fait une capture de ton profil");
    const off = await add("notif", "Coupée", "Notif désactivée");
    await admin.mutation(api.scripts.updateBrick, { id: off, active: false });

    // ── Présence : 2 vidéos, 2 notifs actives DIFFÉRENTES, texte figé rogné.
    expect((await assign(2)).created).toBe(2);
    const rows = await rowsFor();
    expect(rows).toHaveLength(2);
    const notifIds = rows.map((r) => r.scriptCombo!.notifBrickId);
    expect(new Set(notifIds)).toEqual(new Set([n1, n2]));
    const texts = new Map<string, string>([
      [n1, "Léa a regardé ta story 3 fois 👀"],
      [n2, "Quelqu'un a fait une capture de ton profil"],
    ]);
    for (const r of rows) {
      expect(r.scriptCombo!.notifText).toBe(texts.get(r.scriptCombo!.notifBrickId!));
      // Hors combo : clé à 3 segments, texte monté sans la notif.
      expect(r.comboKey!.split(":")).toHaveLength(3);
      const monte = await assembledScriptOf(admin, r._id);
      expect(monte).not.toContain(r.scriptCombo!.notifText!);
    }

    // ── Créatrice : le texte de SA notif, pas d'id ni de combo.
    const [a, b] = rows;
    const mine = await creator.client.query(api.assignments.getMyAssignment, {
      projectId: creator.projectId,
      id: a._id,
    });
    expect(mine!.scriptNotif).toEqual({
      text: a.scriptCombo!.notifText,
      instruction: null,
    });
    expect(JSON.stringify(mine)).not.toContain(a.scriptCombo!.notifBrickId!);

    // ── Corriger le HOOK de A garde sa notif (le combo est réécrit en entier).
    const campaign = await admin.query(api.scripts.getCampaign, { id: campaignId });
    const usedHooks = new Set(rows.map((r) => r.scriptCombo!.hookBrickId));
    const freeHook = campaign!.bricks.find(
      (x) => x.kind === "hook" && !usedHooks.has(x._id),
    )!;
    await admin.mutation(api.scripts.editScriptCombo, {
      id: a._id,
      slot: "hook",
      newBrickId: freeHook._id,
    });
    const aAfterHook = (await rowsFor()).find((r) => r._id === a._id)!;
    expect(aAfterHook.scriptCombo!.hookBrickId).toBe(freeHook._id);
    expect(aAfterHook.scriptCombo!.notifBrickId).toBe(a.scriptCombo!.notifBrickId);
    expect(aAfterHook.scriptCombo!.notifText).toBe(a.scriptCombo!.notifText);

    // ── Corriger le TEXTE de la notif de B : variante, texte monté et clé intacts.
    const monteB = await assembledScriptOf(admin, b._id);
    await admin.mutation(api.scripts.editScriptBrickText, {
      id: b._id,
      slot: "notif",
      newText: "Ton ex a regardé ta story 4 fois 👀",
    });
    const bAfter = (await rowsFor()).find((r) => r._id === b._id)!;
    expect(bAfter.scriptCombo!.notifText).toBe("Ton ex a regardé ta story 4 fois 👀");
    expect(bAfter.scriptCombo!.notifBrickId).not.toBe(b.scriptCombo!.notifBrickId);
    expect(bAfter.comboKey).toBe(b.comboKey);
    expect(await assembledScriptOf(admin, b._id)).toBe(monteB);

    // ── Éteinte : la vidéo suivante n'a pas de notif (et la fiche non plus).
    await admin.mutation(api.scripts.updateCampaign, {
      id: campaignId,
      notifEnabled: false,
    });
    expect((await assign(1)).created).toBe(1);
    const c = (await rowsFor()).find((r) => r._id !== a._id && r._id !== b._id)!;
    expect(c.scriptCombo!.notifBrickId).toBeUndefined();
    const mineC = await creator.client.query(api.assignments.getMyAssignment, {
      projectId: creator.projectId,
      id: c._id,
    });
    expect(mineC!.scriptNotif).toBeNull();

    // ── Analytics PAR NOTIF : on publie A et B, un relevé chacun.
    const views = new Map<Id<"assignments">, number>([
      [a._id, 12_480],
      [b._id, 3_917],
    ]);
    const pubOf = new Map<Id<"assignments">, Id<"publications">>();
    for (const [id, vues] of views) {
      const res = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id,
        urls: [
          {
            platform: "TikTok",
            url: `https://www.tiktok.com/@e2enotif${ts}/video/${ts}${vues}`,
          },
        ],
      });
      pubOf.set(id, res.publicationIds[0]);
      await admin.mutation(api.metricSnapshots.createSnapshot, {
        publicationId: res.publicationIds[0],
        capturedAt: Date.now() + 3 * DAY,
        vues,
        likes: 0,
      });
    }
    const aNotif = a.scriptCombo!.notifBrickId!;
    const bNotif = bAfter.scriptCombo!.notifBrickId!;
    const perf = await admin.query(api.scriptAnalytics.perfByBrick, {
      campaignId,
      window: "j3",
    });
    const notifRows = perf.filter((p) => p.kind === "notif");
    expect(notifRows.find((p) => p.brickId === aNotif)).toMatchObject({
      postCount: 1,
      viewsMedian: 12_480,
    });
    expect(notifRows.find((p) => p.brickId === bNotif)).toMatchObject({
      postCount: 1,
      viewsMedian: 3_917,
    });
    // La notif d'origine de B (remplacée avant publication) n'a AUCUN post.
    const bOrigin = notifRows.find((p) => p.brickId === b.scriptCombo!.notifBrickId);
    if (bOrigin && bOrigin.brickId !== aNotif) expect(bOrigin.postCount).toBe(0);

    const drill = await admin.query(api.scriptAnalytics.postsForBrick, {
      campaignId,
      brickId: aNotif,
      window: "j3",
    });
    expect(drill.map((d) => d._id)).toEqual([pubOf.get(a._id)]);

    const decisions = await admin.query(api.scriptDecision.campaignDecisions, {
      campaignId,
      window: "j3",
    });
    const notifDim = decisions.dimensions.find((d) => d.kind === "notif");
    expect(notifDim).toBeDefined();
    expect(notifDim!.decisions.map((d) => d.key)).toEqual(
      expect.arrayContaining([aNotif, bNotif]),
    );
  });

  /**
   * Les ÉCRANS : l'interrupteur fait apparaître l'onglet (absence adossée à une
   * présence), l'avertissement bloque l'assignation tant qu'aucune notif n'est
   * active, la notif se crée depuis le volet (relue en base), et la fiche de la
   * créatrice montre la carte 🔔 avec le texte exact.
   */
  test("interrupteur, onglet Notif, création depuis le volet, carte sur la fiche", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] NotifUI ${ts}`,
    });
    const add = (kind: "hook" | "flux" | "cta", label: string, content: string) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    await add("hook", "Stalk", `QUI REGARDE TON PROFIL EN CACHETTE ??? ${ts}`);
    await add("flux", "Démo", `Tu tapes son pseudo et l'appli te montre tout ${ts}`);
    await add("cta", "Bio", `Lien en bio 🔗 #snytch ${ts}`);

    await page.goto(adminPath(`/scripts/${campaignId}`));
    await expect(page.getByTestId("combo-count")).toContainText("1", {
      timeout: 15_000,
    });
    const notifTab = page.getByRole("tab", { name: /^Notif/ });
    const assignButton = page.getByRole("button", { name: "Assigner cette campagne" });

    // Éteinte : pas d'onglet Notif (l'onglet Hook, lui, est là), assignable.
    await expect(page.getByRole("tab", { name: /^Hook/ })).toBeVisible();
    await expect(notifTab).toHaveCount(0);
    await expect(assignButton).toBeEnabled();

    // Allumée sans notif : onglet présent, avertissement, assignation bloquée.
    await page.getByTestId("notif-toggle").click();
    await expect(notifTab).toBeVisible();
    await expect(page.getByTestId("notif-missing")).toBeVisible();
    await expect(assignButton).toBeDisabled();
    const campaignOn = await admin.query(api.scripts.getCampaign, { id: campaignId });
    expect(campaignOn!.notifEnabled).toBe(true);

    // Création depuis le volet : l'aperçu montre la carte telle que la verra la
    // créatrice, puis la brique est ÉCRITE en base.
    const notifText = `Léa a regardé ta story 3 fois 👀 ${ts}`;
    await notifTab.click();
    await page.getByRole("button", { name: "Ajouter" }).first().click();
    const volet = page.getByRole("region", { name: "Édition de la brique sélectionnée" });
    await volet.locator("#brick-content").fill(notifText);
    await volet.locator("#brick-label").fill(`Story ×3 ${ts}`);
    await expect(volet.getByTestId("script-notif-text")).toHaveText(notifText);
    await volet.getByRole("button", { name: "Ajouter" }).click();
    await expect
      .poll(async () =>
        (await admin.query(api.scripts.getCampaign, { id: campaignId }))!.bricks
          .filter((b) => b.kind === "notif")
          .map((b) => b.content),
      )
      .toEqual([notifText]);
    await expect(page.getByTestId("notif-missing")).toHaveCount(0);
    await expect(assignButton).toBeEnabled();

    // Fiche de la créatrice (vue observée) : la carte 🔔 porte le texte exact.
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] NotifUI Inès Garnier ${ts}`,
      email: `e2e-creator-notifui-${ts}@repackit.test`,
      password: "notifui-12345",
    });
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingNotifUI ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2enotifui${ts}`,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creator.creatorId,
      targets: [target],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a.scriptCombo?.campaignId === campaignId,
    )!;
    await page.goto(
      `/admin/voir/${E2E_PROJECT_SLUG}/${creator.creatorId}/assignments/${row._id}`,
    );
    const card = page.getByTestId("script-notif");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("script-notif-text")).toHaveText(notifText);
    await expect(card.getByRole("button", { name: "Copier la notif" })).toBeVisible();
  });

  /**
   * RATTRAPAGE — la campagne reçoit ses notifs APRÈS des assignations. Deux
   * gestes : le menu du panneau (une vidéo) et le bouton de la campagne (toutes
   * les autres). Une vidéo DÉJÀ PUBLIÉE ne reçoit rien : elle a été tournée
   * sans notif, lui en donner une fausserait l'analytics.
   */
  test("rattrapage : menu du panneau, bouton de campagne, publiée intacte", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] NotifRattrapage ${ts}`,
    });
    const add = (
      kind: "hook" | "flux" | "cta" | "notif",
      label: string,
      content: string,
    ) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    await add("hook", "Relation", `16 ans de relation et je découvre ÇA ??!! ${ts}`);
    await add("hook", "Ajouts", `Il a ajouté qui récemment ?? ${ts}`);
    await add("hook", "Stories", `Qui regarde mes stories en boucle ${ts}`);
    await add("flux", "Démo", "Va sur Snytch.co, recherche son @, montre son activité récente.");
    await add("cta", "Bio", "Lien en bio 🔗 #snytch");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingRattrapage ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });

    // Léa : 3 vidéos assignées SANS notif, dont une déjà publiée.
    const lea = await createCreatorSession(url, {
      name: `[E2E_TEST] Léa Moreau ${ts}`,
      email: `e2e-creator-notifbf-lea-${ts}@repackit.test`,
      password: "notifbf-lea-12345",
    });
    const tLea = await availableTarget({
      e2eClient: admin,
      creatorId: lea.creatorId,
      platform: "TikTok",
      handle: `@lea.moreau_${ts}`,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: lea.creatorId,
      targets: [tLea],
      videosPerCreator: 3,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    // Inès (nom unique → une seule pastille au calendrier) : 1 vidéo datée.
    const inesName = `[E2E_TEST] Inès Garnier ${ts}`;
    const ines = await createCreatorSession(url, {
      name: inesName,
      email: `e2e-creator-notifbf-ines-${ts}@repackit.test`,
      password: "notifbf-ines-12345",
    });
    const tInes = await availableTarget({
      e2eClient: admin,
      creatorId: ines.creatorId,
      platform: "TikTok",
      handle: `@ines.garnier${ts}`,
    });
    await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: ines.creatorId,
      targets: [tInes],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
      postDates: [minuitParis()],
    });
    const rows = async () =>
      (await admin.query(api.assignments.listAssignments, {})).filter(
        (a) => a.scriptCombo?.campaignId === campaignId,
      );
    const leaRows = (await rows()).filter((r) => r.creatorId === lea.creatorId);
    expect(leaRows).toHaveLength(3);
    const published = leaRows[0];
    await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
      id: published._id,
      urls: [
        { platform: "TikTok", url: `https://www.tiktok.com/@lea.moreau_${ts}/video/${ts}` },
      ],
    });
    expect((await rows()).every((r) => r.scriptCombo!.notifBrickId === undefined)).toBe(true);

    // La campagne reçoit ses notifs après coup.
    await admin.mutation(api.scripts.updateCampaign, { id: campaignId, notifEnabled: true });
    const n1 = await add("notif", "Ajouts", "  Il a suivi 12 nouveaux comptes cette semaine 👀 ");
    const n2 = await add("notif", "Story", "Quelqu'un a regardé ta story 3 fois");
    // 2 non publiées de Léa + celle d'Inès ; la publiée n'est PAS comptée.
    expect(await admin.query(api.scripts.notifBackfillCount, { campaignId })).toBe(3);

    // ── Geste 1 : le menu du panneau, sur la vidéo d'Inès.
    await page.goto(adminPath("/assignments"));
    await expect(page.getByText(/\d+ \/ \d+ livrable/)).toBeVisible();
    await page.locator("button").filter({ hasText: "Tous créateurs" }).click();
    await page.locator('[role="option"]').filter({ hasText: inesName }).click();
    await page.keyboard.press("Escape");
    await page
      .getByTitle(new RegExp(inesName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .click();
    const sheet = page.getByTestId("assignment-detail-sheet");
    const notifSelect = sheet.getByTestId("assignment-detail-notif-select");
    await expect(notifSelect).toContainText("Aucune notif — en choisir une");
    await notifSelect.click();
    await page.getByRole("option").filter({ hasText: "Quelqu'un a regardé ta story 3 fois" }).click();
    await expect(page.getByText("Notif ajoutée")).toBeVisible();
    await expect(notifSelect).toContainText("Quelqu'un a regardé ta story 3 fois");
    const inesRow = (await rows()).find((r) => r.creatorId === ines.creatorId)!;
    expect(inesRow.scriptCombo!.notifBrickId).toBe(n2);
    expect(inesRow.scriptCombo!.notifText).toBe("Quelqu'un a regardé ta story 3 fois");
    expect(await admin.query(api.scripts.notifBackfillCount, { campaignId })).toBe(2);

    // ── Geste 2 : le bouton de la campagne, pour les 2 restantes de Léa.
    await page.goto(adminPath(`/scripts/${campaignId}`));
    const bouton = page.getByTestId("notif-backfill");
    await expect(bouton).toContainText("aux 2 vidéos déjà assignées");
    await bouton.click();
    await page.getByTestId("notif-backfill-confirm").click();
    await expect(page.getByText("2 notifs ajoutées")).toBeVisible();
    await expect(bouton).toHaveCount(0);

    const after = (await rows()).filter((r) => r.creatorId === lea.creatorId);
    const unpublished = after.filter((r) => r._id !== published._id);
    // Rotation : les deux vidéos de Léa reçoivent les DEUX notifs, texte rogné.
    expect(new Set(unpublished.map((r) => r.scriptCombo!.notifBrickId))).toEqual(
      new Set([n1, n2]),
    );
    expect(
      unpublished.find((r) => r.scriptCombo!.notifBrickId === n1)!.scriptCombo!.notifText,
    ).toBe("Il a suivi 12 nouveaux comptes cette semaine 👀");
    // La publiée n'a rien reçu.
    expect(after.find((r) => r._id === published._id)!.scriptCombo!.notifBrickId).toBeUndefined();
    // Idempotent : plus rien à rattraper.
    expect(await admin.mutation(api.scripts.backfillNotifs, { campaignId })).toEqual({
      added: 0,
    });
  });
});
