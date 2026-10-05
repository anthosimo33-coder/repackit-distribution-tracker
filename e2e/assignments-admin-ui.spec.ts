import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * P7 — geste admin : mise en évidence des assignments en retard dans la table
 * /admin/.../assignments + filtre « en retard seulement ». L'assignation en
 * masse est posée côté serveur (le modal AssignFormatDialog, lancé depuis la
 * fiche format, a été retiré avec la page Formats).
 */
test.describe("Admin — assignation + table", () => {
  test("assignation crée N rows + l'en-retard ressort dans la table", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] AssignUI ${ts}`;
    const C = await createCreatorSession(convexUrl, {
      name: creatorName,
      email: `e2e-creator-asgui-${ts}@repackit.test`,
      password: "creator-asgui-12345",
    });
    const formatName = `[E2E_TEST] AssignUI Fmt ${ts}`;
    const fid = (await createFormatWithRate(admin, {
      name: formatName,
      type: "short",
      rateModel: { basePerPost: 30 },
    })) as Id<"formats">;

    // Compte TikTok DISPONIBLE (cible) + 1 assignment EN RETARD côté serveur.
    const tkHandle = `@e2easgui${ts}`;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: tkHandle,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: C.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts - 3 * 86_400_000,
    });

    // Assignation en masse (2 vidéos) posée côté serveur — équivalent du modal
    // AssignFormatDialog retiré avec la page Formats (api.assignments.assignFormat).
    // Total attendu pour ce format : 1 (retard) + 2 = 3.
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: C.creatorId,
      targets: [target],
      postsPerCreator: 2,
      dueDate: ts + 7 * 86_400_000,
    });

    // Serveur : 1 (retard) + 2 (modal) = 3 rows pour ce format. Même course de
    // propagation cross-client que pour la suppression → poll au lieu d'un
    // one-shot. Strict : un total ≠ 3 au-delà du timeout fait échouer le test.
    await expect
      .poll(
        async () =>
          (await admin.query(api.assignments.listAssignments, {})).filter(
            (a) => a.formatId === fid,
          ).length,
        { timeout: 10_000 },
      )
      .toBe(3);
    const list = await admin.query(api.assignments.listAssignments, {});

    // Table admin : 3 lignes pour ce format, dont une en retard.
    await page.goto(adminPath("/assignments"));
    // La vue par DÉFAUT est le calendrier → basculer en Liste pour la table.
    await page.getByRole("radio", { name: "Liste" }).click();
    const rowsForFormat = page.getByRole("row").filter({ hasText: formatName });
    await expect(rowsForFormat).toHaveCount(3, { timeout: 10_000 });
    await expect(page.getByText("(retard)").first()).toBeVisible();

    // « En retard seulement » → ne reste que la ligne en retard.
    await page
      .getByText("En retard seulement")
      .click();
    await expect(rowsForFormat).toHaveCount(1, { timeout: 8000 });

    // Cleanup (cleanupTestAssignments nettoie aussi, mais on évite l'accumulation).
    for (const a of list.filter((x) => x.formatId === fid)) {
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: process.env.E2E_SECRET ?? "",
        id: a._id,
        status: "todo",
      });
    }
  });

  test("supprimer un assignment depuis la table (confirmation → disparaît)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] DelUI ${ts}`;
    const C = await createCreatorSession(convexUrl, {
      name: creatorName,
      email: `e2e-creator-delui-${ts}@repackit.test`,
      password: "creator-delui-12345",
    });
    const formatName = `[E2E_TEST] DelUI Fmt ${ts}`;
    const fid = (await createFormatWithRate(admin, {
      name: formatName,
      type: "short",
      rateModel: { basePerPost: 30 },
    })) as Id<"formats">;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: `@e2edelui${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: C.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * 86_400_000,
    });

    await page.goto(adminPath("/assignments"));
    // La vue par DÉFAUT est le calendrier → basculer en Liste pour la table.
    await page.getByRole("radio", { name: "Liste" }).click();
    const row = page.getByRole("row").filter({ hasText: formatName });
    await expect(row).toHaveCount(1, { timeout: 10_000 });

    // Poubelle → AlertDialog de confirmation → Supprimer.
    await row.getByRole("button", { name: "Supprimer cet assignment" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/irréversible/i);
    await dialog.getByRole("button", { name: "Supprimer" }).click();

    // La ligne disparaît (réactivité Convex) ; le serveur confirme la suppression.
    await expect(row).toHaveCount(0, { timeout: 10_000 });
    // La propagation de la suppression vers la query re-fetchée (client admin
    // distinct de la page) peut avoir un micro-retard sous charge : on POLLE
    // jusqu'à ce que l'assignment ait disparu côté serveur, au lieu d'un check
    // one-shot qui flake. Reste STRICT : si l'assignment n'est réellement pas
    // supprimé, le poll renvoie true jusqu'au timeout et l'assertion échoue.
    await expect
      .poll(
        async () => {
          const list = await admin.query(api.assignments.listAssignments, {});
          return list.some((a) => a.formatId === fid);
        },
        { timeout: 10_000 },
      )
      .toBe(false);
  });

  /**
   * Une mission ABANDONNÉE se supprime comme les autres : l'abandon est borné
   * aux statuts pré-publication, rien n'y est rattaché. Le bouton restait grisé
   * avec un motif faux (« publié ou payé ») : le 04/10/2026, dix missions
   * remplacées ne pouvaient pas quitter la liste depuis l'écran.
   */
  test("supprimer une mission abandonnée (panneau + table → disparaît)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const C = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Sarah Da Costa ${ts}`,
      email: `e2e-creator-delabandon-${ts}@repackit.test`,
      password: "creator-delabandon-12345",
    });
    const formatName = `[E2E_TEST] DelAbandon Fmt ${ts}`;
    const fid = (await createFormatWithRate(admin, {
      name: formatName,
      type: "short",
      rateModel: { basePerPost: 30 },
    })) as Id<"formats">;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: `@sarah_olv8_${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: C.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * 86_400_000,
    });
    const [mission] = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.formatId === fid,
    );
    await admin.mutation(api.assignments.cancelAssignment, { id: mission._id });

    await page.goto(adminPath("/assignments"));
    await page.getByRole("radio", { name: "Liste" }).click();
    const row = page.getByRole("row").filter({ hasText: formatName });
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await expect(row).toContainText("Abandonné");

    // Panneau de détail : le bouton de suppression, pas le motif de blocage.
    await row.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Ouvrir le détail" }).click();
    const sheet = page.getByTestId("assignment-detail-sheet");
    await expect(sheet.getByTestId("assignment-detail-delete")).toBeVisible();
    await expect(sheet.getByTestId("assignment-detail-delete-blocked")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Table : poubelle → confirmation qui dit ce qui change → Supprimer.
    await row.getByRole("button", { name: "Supprimer cet assignment" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("disparaîtra de la liste et de l'historique");
    await dialog.getByRole("button", { name: "Supprimer" }).click();
    await expect(page.getByText("Mission abandonnée supprimée.")).toBeVisible();

    await expect(row).toHaveCount(0, { timeout: 10_000 });
    await expect
      .poll(
        async () => {
          const list = await admin.query(api.assignments.listAssignments, {});
          return list.some((a) => a.formatId === fid);
        },
        { timeout: 10_000 },
      )
      .toBe(false);
  });
  /**
   * Les lignes de la table sont MÉMOÏSÉES (le 05/10/2026 : ouvrir une modale
   * re-rendait les 787 lignes de Snytch et gelait l'écran ~500 ms). Le risque
   * d'une ligne mémoïsée est de rester FIGÉE : ce test vérifie qu'une ligne se
   * met à jour quand SA donnée change — par le geste de l'écran (vidéo modèle
   * ajoutée depuis la modale) comme par une écriture venue d'ailleurs
   * (consigne posée par un autre client, le connecteur par exemple).
   */
  test("une ligne de la table suit SA donnée (modale + écriture extérieure)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const C = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] RowMemo ${ts}`,
      email: `e2e-creator-rowmemo-${ts}@repackit.test`,
      password: "creator-rowmemo-12345",
    });
    const formatName = `[E2E_TEST] RowMemo Fmt ${ts}`;
    const fid = (await createFormatWithRate(admin, {
      name: formatName,
      type: "short",
      rateModel: { basePerPost: 30 },
    })) as Id<"formats">;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: `@e2erowmemo${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: C.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * 86_400_000,
    });
    const [mission] = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.formatId === fid,
    );

    await page.goto(adminPath("/assignments"));
    await page.getByRole("radio", { name: "Liste" }).click();
    const row = page.getByRole("row").filter({ hasText: formatName });
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    const models = row.getByRole("button", { name: "Gérer les vidéos modèles" });
    const overlay = row.getByRole("button", {
      name: "Texte à incruster en haut de la vidéo",
    });
    await expect(models).toHaveText("+");
    await expect(overlay).toHaveText("+");

    // 1) Le geste de l'écran : la modale s'ouvre sur CETTE ligne, l'ajout
    //    remonte dans le compteur de la ligne.
    await models.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(`[E2E_TEST] RowMemo ${ts}`);
    await dialog
      .getByLabel("URL de la vidéo modèle")
      .fill(`https://www.tiktok.com/@e2e/video/${ts}`);
    await dialog.getByRole("button", { name: "Ajouter la vidéo modèle" }).click();
    await expect(page.getByText("Vidéo modèle ajoutée.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(models).toHaveText("1");

    // 2) Une écriture venue d'AILLEURS : la liste revient en objets neufs, seule
    //    cette ligne a changé — elle doit le montrer sans rechargement.
    await admin.mutation(api.assignments.setAssignmentOverlayText, {
      id: mission._id,
      overlayText: "Lien en bio",
    });
    await expect(overlay).toHaveText("•", { timeout: 10_000 });
    await expect(overlay).toHaveAttribute("title", "Lien en bio");
    await expect(models).toHaveText("1");
  });
});
