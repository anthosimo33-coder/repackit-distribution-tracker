import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * FILE DE VALIDATION — classée par date de PUBLICATION, pas par date de création.
 *
 * LE DÉFAUT QU'ELLE CORRIGE. La file triait sur `createdAt`. Or une assignation
 * de LOT insère ses N lignes dans la MÊME transaction : elles portent le même
 * `createdAt` à la milliseconde près, et le tri ne départageait rien. L'écran
 * n'affichait par ailleurs que `dueDate` — l'échéance de PRODUCTION, elle aussi
 * commune à tout le lot. Résultat : cinq vidéos soumises ensemble, cinq fois la
 * même date, et aucun moyen de savoir laquelle devait sortir le lendemain.
 *
 * D'où la forme du jeu de test : les quatre soumissions viennent d'UN SEUL lot
 * (donc `createdAt` et `dueDate` identiques). Si le tri retombait sur l'un ou
 * l'autre, l'ordre serait arbitraire et cette spec le verrait.
 */
test.describe("Admin — file de validation triée par date de sortie", () => {
  test("ordre par postDate, sans-date en dernier, « demain » repérable", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const suffix = `${ts}`.slice(-6);
    const creatorName = `[E2E_TEST] File ${suffix}`;

    // Créateur ONBOARDÉ (userId posé), sinon `assignFormat` refuse
    // (ERR_CREATOR_NOT_ASSIGNABLE) et la file se remplirait de lignes d'un run
    // précédent sans que rien ne le dise — c'est ce qui a rendu vert un premier
    // jet de cette spec, sur une base locale polluée.
    const { creatorId } = await createCreatorSession(url, {
      name: creatorName,
      email: `e2e-file-validation-${ts}@repackit.test`,
      password: "creator-file-12345",
    });
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Format File ${suffix}`,
      type: "short",
      rateModel: { basePerPost: 10 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId,
      platform: "TikTok",
      handle: `@e2efile${suffix}`,
    });
    // UN SEUL lot → même createdAt, même dueDate pour les quatre.
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId,
      targets: [target],
      postsPerCreator: 4,
      dueDate: ts + 5 * DAY,
    });
    const mine = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.formatId === formatId && a.creatorId === creatorId,
    );
    expect(mine.length).toBe(4);

    const minuit = (n: number) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + n);
      return d.getTime();
    };
    // Volontairement posées dans le DÉSORDRE de la liste : si le tri ne faisait
    // rien, l'ordre rendu serait celui-ci.
    const plan: { idx: number; jours: number | null; slot: string }[] = [
      { idx: 0, jours: 3, slot: "upcoming" },
      { idx: 1, jours: -1, slot: "overdue" },
      { idx: 2, jours: null, slot: "undated" },
      { idx: 3, jours: 1, slot: "tomorrow" },
    ];
    for (const { idx, jours } of plan) {
      if (jours === null) continue; // celle-ci reste SANS date de publication
      await admin.mutation(api.assignments.setAssignmentPostDate, {
        id: mine[idx]._id,
        postDate: minuit(jours),
      });
    }
    for (const a of mine) {
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: a._id,
        status: "video_submitted",
      });
    }

    await page.goto("/admin/e2e-test/validation");
    // La file est GLOBALE au projet : on borne aux cartes de CE créateur, sinon
    // une soumission résiduelle d'un autre test ferait passer ou échouer la spec
    // pour une raison étrangère à ce qu'elle mesure.
    const mesCartes = page
      .locator("div", { has: page.getByText(creatorName, { exact: true }) })
      .filter({ has: page.locator('[data-testid="publication-slot"]') });
    const pastilles = mesCartes.locator('[data-testid="publication-slot"]');
    await expect(pastilles).toHaveCount(4, { timeout: 20_000 });

    // ── L'ORDRE : en retard → demain → dans 3 jours → sans date. ──
    // C'est l'assertion centrale : elle tombe si le tri retombe sur createdAt
    // (les quatre sont identiques) ou si les sans-date remontent en tête.
    const ordre = await pastilles.evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-slot")),
    );
    expect(ordre).toEqual(["overdue", "tomorrow", "upcoming", "undated"]);

    // ── Les libellés NOMMENT le jour proche au lieu de le dater. ──
    await expect(pastilles.nth(1)).toHaveText(/Sort demain/);
    await expect(pastilles.nth(0)).toHaveText(/Devait sortir le/);
    await expect(pastilles.nth(3)).toHaveText(/Pas de date de publication/);

    // ── L'en-tête annonce ce qui sort demain. ──
    await expect(page.getByTestId("review-tomorrow-count")).toHaveText(
      "1 à sortir demain",
    );

    // ── L'échéance de PRODUCTION reste lisible (elle n'est pas supprimée,
    //    seulement reléguée) — assertion de PRÉSENCE appariée aux précédentes.
    await expect(page.getByText(/Échéance /).first()).toBeVisible();

    await admin.mutation(api.assignments.cleanupTestAssignments, {
      secret: E2E_SECRET,
    });
    await admin.mutation(api.creators.cleanupTestCreators, {
      secret: E2E_SECRET,
    });
  });
});
