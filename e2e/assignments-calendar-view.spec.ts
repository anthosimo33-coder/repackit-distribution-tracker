import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { minuitParis } from "./helpers/paris-day";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const DAY = 86_400_000;
/** Minuit PARIS d'aujourd'hui — cf e2e/helpers/paris-day (le calendrier
 *  découpe ses journées à Paris, pas dans le fuseau du runner). */
const todayMidnight = () => minuitParis();

/**
 * Brique C — la page Assignments bascule Liste/Calendrier, avec des filtres
 * PARTAGÉS (dont le filtre créateur MULTI). Filtrer sur une créatrice restreint
 * la liste ET le calendrier. Le calendrier affiche le post planifié (statut). On
 * filtre sur la créatrice de test pour être robuste à la base e2e partagée.
 * Le CALENDRIER est désormais la vue par DÉFAUT ; le dernier choix est mémorisé.
 */
test.describe("Admin — vue calendrier de publication", () => {
  test("calendrier par défaut + bascule Liste + filtre partagé + persistance", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] CalView ${ts}`;
    const C = await createCreatorSession(convexUrl, {
      name: creatorName,
      email: `e2e-creator-calview-${ts}@repackit.test`,
      password: "creator-calview-12345",
    });
    const fid = (await createFormatWithRate(admin, {
      name: `[E2E_TEST] CalView Fmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 30 },
    })) as Id<"formats">;
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: `@e2ecalview${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: C.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    // Date de post = aujourd'hui (dans le mois courant du calendrier).
    const row = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a.formatId === fid && a.creatorId === C.creatorId,
    )!;
    await admin.mutation(api.assignments.setAssignmentPostDate, {
      id: row._id,
      postDate: todayMidnight(),
    });

    await page.goto(adminPath("/assignments"));

    // Attendre le chargement des assignments — signal INDÉPENDANT de la vue
    // (compteur d'en-tête « N / M livrables », qui remplace « Chargement… »).
    await expect(page.getByText(/\d+ \/ \d+ livrable/)).toBeVisible();

    // Filtre créateur MULTI (partagé) → ne garder que la créatrice de test.
    // Trigger ciblé par le TAG button + libellé (role varie selon base-ui).
    await page.locator("button").filter({ hasText: "Tous créateurs" }).click();
    await page.locator('[role="option"]').filter({ hasText: creatorName }).click();
    await page.keyboard.press("Escape");

    // Le CALENDRIER est la vue par DÉFAUT (aucun choix mémorisé) : radio coché,
    // stats + navigation mensuelle rendues, chip du post filtré trouvable.
    await expect(page.getByRole("radio", { name: "Calendrier" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      page.getByRole("button", { name: "Mois suivant" }),
    ).toBeVisible();
    await expect(
      page.getByText("Taux à l'heure", { exact: true }),
    ).toBeVisible();
    const chipTitle = new RegExp(
      creatorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    await expect(page.getByTitle(chipTitle)).toBeVisible();

    // Bascule LISTE : la colonne « Post » + la ligne de la créatrice apparaissent.
    await page.getByRole("radio", { name: "Liste" }).click();
    await expect(
      page.getByRole("columnheader", { name: "Post" }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell").filter({ hasText: creatorName }),
    ).toBeVisible();

    // Persistance : le dernier choix (Liste) survit au rechargement (localStorage).
    await page.reload();
    await expect(page.getByRole("radio", { name: "Liste" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      page.getByRole("columnheader", { name: "Post" }),
    ).toBeVisible();

    // ── Lien profond ?createur= — la cible des notifications de retard ───────
    // Les messages promettent « un lien vers ses assignations filtrées ». Sans
    // ce paramètre, le lien tombe sur la liste complète du projet.
    //
    // PRÉSENCE d'abord : sans le paramètre, le filtre est vide (« Tous
    // créateurs ») — sinon l'assertion suivante pourrait passer pour une raison
    // sans rapport avec le lien.
    await page.goto(adminPath("/assignments"));
    await expect(page.getByText(/\d+ \/ \d+ livrable/)).toBeVisible();
    await expect(
      page.locator("button").filter({ hasText: "Tous créateurs" }),
    ).toBeVisible();

    await page.goto(adminPath(`/assignments?createur=${C.creatorId}`));
    await expect(page.getByText(/\d+ \/ \d+ livrable/)).toBeVisible();
    // Le filtre est PRÉ-RENSEIGNÉ : son libellé porte le nom de la créatrice,
    // et « Tous créateurs » a disparu.
    await expect(
      page.locator("button").filter({ hasText: creatorName }),
    ).toBeVisible();
    await expect(
      page.locator("button").filter({ hasText: "Tous créateurs" }),
    ).toHaveCount(0);
  });

  /**
   * Une mission ABANDONNÉE garde son jour prévu (l'abandon ne touche que le
   * statut), mais elle ne sortira jamais. Le calendrier la dessinait comme un
   * post « prévu » et la comptait dans le rappel du jour : 03/10/2026, dix
   * missions de Sarah Da Costa remplacées par dix autres → quatre posts par
   * jour à l'écran au lieu de deux.
   */
  test("une mission abandonnée sort du calendrier et du rappel du jour", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const creatorName = `[E2E_TEST] Sarah Da Costa ${ts}`;
    const C = await createCreatorSession(convexUrl, {
      name: creatorName,
      email: `e2e-creator-calcancel-${ts}@repackit.test`,
      password: "creator-calcancel-12345",
    });
    const fid = (await createFormatWithRate(admin, {
      name: `[E2E_TEST] CalCancel Fmt ${ts}`,
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
      postsPerCreator: 2,
      dueDate: ts + 7 * DAY,
    });
    const [garde, abandonnee] = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.formatId === fid && a.creatorId === C.creatorId,
    );
    for (const { _id } of [garde, abandonnee]) {
      await admin.mutation(api.assignments.setAssignmentPostDate, {
        id: _id,
        postDate: todayMidnight(),
      });
    }

    await page.goto(adminPath(`/assignments?createur=${C.creatorId}`));
    await expect(page.getByText(/\d+ \/ \d+ livrable/)).toBeVisible();
    await expect(page.getByRole("radio", { name: "Calendrier" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const chips = page.getByTitle(
      new RegExp(creatorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    // PRÉSENCE d'abord : les deux missions du jour sont dessinées et comptées.
    await expect(chips).toHaveCount(2);
    await expect(page.getByText("posts à publier")).toBeVisible();
    await expect(page.getByText("posts à publier").locator("..")).toContainText("2");
    const note = page.getByText("Statuts calculés en heure de Paris.", { exact: false });
    await expect(note).toBeVisible();
    await expect(note).not.toContainText("plus au calendrier");

    await admin.mutation(api.assignments.cancelAssignment, { id: abandonnee._id });

    // L'abandonnée sort ; la mission gardée reste (la lecture est réactive).
    await expect(chips).toHaveCount(1);
    await expect(page.getByText("post à publier", { exact: false })).toBeVisible();
    await expect(page.getByText("post à publier", { exact: false }).locator("..")).toContainText("1");
    // L'en-tête « N / M livrables » la compte toujours (il sert aussi la liste) :
    // la note dit où elle est passée, pour que les totaux se recoupent.
    await expect(note).toContainText("1 mission abandonnée n'est plus au calendrier.");

    // La liste, elle, la garde — avec son badge : l'historique n'est pas perdu.
    await page.getByRole("radio", { name: "Liste" }).click();
    await expect(page.getByText("Abandonné", { exact: true })).toHaveCount(1);

    // Panneau de détail : la mission gardée a son statut calendrier…
    const sheet = page.getByTestId("assignment-detail-sheet");
    const ouvrir = async (ligne: ReturnType<typeof page.getByRole>) => {
      // Le menu précédent doit avoir fini de se fermer : sinon deux « Ouvrir le
      // détail » coexistent le temps de l'animation.
      await expect(page.getByRole("menuitem")).toHaveCount(0);
      await ligne.getByRole("button", { name: "Actions" }).click();
      await page.getByRole("menuitem", { name: "Ouvrir le détail" }).click();
      await expect(sheet).toBeVisible();
    };
    const lignes = page.getByRole("row").filter({ hasText: creatorName });
    await ouvrir(lignes.filter({ hasNotText: "Abandonné" }));
    await expect(sheet).toContainText("Prévu");
    await expect(sheet.getByTestId("detail-calendar-abandoned")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    // …l'abandonnée n'est ni « prévue » ni « manquée ».
    await ouvrir(lignes.filter({ hasText: "Abandonné" }));
    await expect(sheet.getByTestId("detail-calendar-abandoned")).toHaveText("Abandonnée — hors calendrier");
    await expect(sheet).not.toContainText("Prévu");
  });
});
