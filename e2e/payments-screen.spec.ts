import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/**
 * ÉCRAN PAIEMENTS refondu — trois gênes nommées, trois réponses.
 *
 *  1. GROUPÉ PAR CRÉATRICE — un virement se fait à une personne : ses cycles
 *     ouverts, sa méthode et son total tiennent dans un bloc, et cocher le bloc
 *     coche ses cycles ;
 *  2. LES ZÉROS SONT REPLIÉS — une créatrice à 0 $ n'occupe plus une ligne
 *     pleine largeur, mais elle ne DISPARAÎT pas (contrôle d'absence adossé à la
 *     présence : elle réapparaît au clic) ;
 *  3. PAYÉS ET DÛS SÉPARÉS — payer déplace le cycle de « À payer » vers
 *     « Réglé », où vit l'annulation ; annuler le ramène.
 *
 * ⚠️ Base e2e partagée : tout est scopé à NOS deux créatrices (par testid), et
 * aucune assertion ne porte sur un total global.
 */
test.describe("Paiements — écran refondu", () => {
  test("bloc par créatrice, zéros repliés, dû ↔ réglé et annulation", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();

    // Deux créatrices : l'une doit de l'argent, l'autre est à 0,00 $ (format
    // sans fixe — c'est le cas réel des cycles qui polluaient la liste).
    const payee = await createCreatorSession(url, {
      name: `[E2E_TEST] Ecran Payee ${ts}`,
      email: `e2e-ecran-payee-${ts}@repackit.test`,
      password: "ecran-12345",
    });
    const zero = await createCreatorSession(url, {
      name: `[E2E_TEST] Ecran Zero ${ts}`,
      email: `e2e-ecran-zero-${ts}@repackit.test`,
      password: "ecran-12345",
    });

    async function publie(
      creator: Awaited<ReturnType<typeof createCreatorSession>>,
      montant: number,
      suffixe: string,
    ) {
      const formatId = await createFormatWithRate(admin, {
        name: `[E2E_TEST] FmtEcran ${suffixe} ${ts}`,
        type: "short",
        rateModel: { basePerPost: montant },
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: creator.creatorId,
        platform: "TikTok",
        handle: `@e2eecran${suffixe}${ts}`,
      });
      await admin.mutation(api.assignments.assignFormat, {
        formatId,
        creatorId: creator.creatorId,
        targets: [target],
        dueDate: ts + 7 * DAY,
        postsPerCreator: 1,
      });
      const a = (await admin.query(api.assignments.listAssignments, {})).find(
        (x) => x.creatorId === creator.creatorId,
      )!;
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: a._id,
        status: "to_publish",
      });
      await creator.client.mutation(api.assignments.confirmPublication, {
        projectId: creator.projectId,
        id: a._id,
        urls: [
          {
            platform: "TikTok",
            url: `https://www.tiktok.com/@e/video/ec${suffixe}${ts}`,
          },
        ],
      });
    }

    await publie(payee, 120, "p");
    await publie(zero, 0, "z");

    await page.goto(adminPath("/paiements"));
    const carteDue = page.getByTestId(`creator-card-${payee.creatorId}`);
    const carteZero = page.getByTestId(`creator-card-${zero.creatorId}`);

    // ── 1. UN BLOC PAR CRÉATRICE ────────────────────────────────────────────
    await expect(carteDue).toBeVisible({ timeout: 20_000 });
    await expect(carteDue).toContainText("Ecran Payee");
    await expect(carteDue).toContainText("120");

    // ── 2. LES ZÉROS SONT REPLIÉS ───────────────────────────────────────────
    // Absente de l'écran… mais nommée dans la ligne repliée : elle n'est pas
    // perdue, elle est rangée.
    await expect(carteZero).toHaveCount(0);
    const repli = page.getByTestId("zeros-fold");
    await expect(repli).toContainText("Ecran Zero");
    await repli.click();
    await expect(carteZero).toBeVisible();
    await repli.click();
    await expect(carteZero).toHaveCount(0);

    // ── 3. PAYER DÉPLACE LE CYCLE VERS « RÉGLÉ » ────────────────────────────
    const cycle = (await admin.query(api.payments.listPayments, {})).find(
      (p) => p.creatorId === payee.creatorId && p.cycleIndex === 0,
    )!;
    const reglé = page.getByRole("region", { name: "Cycles réglés" });
    // PRÉSENCE d'abord : la section n'existe pas tant que rien n'est réglé pour
    // personne, donc on ne peut pas se contenter de « pas encore dedans ».
    await expect(carteDue.getByTestId(`mark-paid-${cycle.key}`)).toBeVisible();
    await carteDue.getByTestId(`mark-paid-${cycle.key}`).click();

    await expect(carteDue).toHaveCount(0, { timeout: 15_000 });
    const ligneReglee = reglé
      .getByTestId(/^cycle-paid:/)
      .filter({ hasText: "Ecran Payee" });
    await expect(ligneReglee).toHaveCount(1);

    // Le cycle payé n'est PAS des deux côtés. On déplie d'abord les zéros :
    // sans ça, un cycle payé rangé chez les zéros (il ne doit plus rien) serait
    // invisible, et l'assertion passerait pour la mauvaise raison.
    const cyclePaye = (await admin.query(api.payments.listPayments, {})).find(
      (p) => p.creatorId === payee.creatorId && p.cycleIndex === 0,
    )!;
    await repli.click();
    await expect(page.getByTestId(`cycle-${cyclePaye.key}`)).toHaveCount(1);
    await repli.click();

    // ── ANNULATION — le cycle revient dans « À payer » ──────────────────────
    await ligneReglee.getByRole("button", { name: "Annuler" }).click();
    const modale = page.getByRole("dialog");
    await expect(modale).toContainText("e-mail de correction");
    await modale.getByRole("button", { name: "Annuler ce paiement" }).click();

    await expect(carteDue).toBeVisible({ timeout: 15_000 });
    await expect(carteDue).toContainText("120");
    // …et il a bien QUITTÉ « Réglé » : un cycle annulé n'est pas dans les deux.
    await expect(
      reglé.getByTestId(/^cycle-paid:/).filter({ hasText: "Ecran Payee" }),
    ).toHaveCount(0);
  });
});
