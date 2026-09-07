import { test, expect } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { minuitParisDecale } from "./helpers/paris-day";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * LE JOUR PRÉVU EST UNE ÉTIQUETTE — vue depuis un navigateur À L'OUEST DE PARIS.
 *
 * Ce fichier tourne DEUX FOIS (projets `chromium-newyork` et
 * `chromium-losangeles`), et c'est tout l'intérêt : `postDate` est stocké à
 * minuit PARIS, donc lu avec l'horloge du navigateur il tombe la VEILLE au soir
 * — 18 h à New York, 15 h à Los Angeles. L'écran d'une créatrice américaine
 * annonçait « le 4 » pour un plan « le 5 » ; elle publiait le 4, et se
 * retrouvait hors date. Un correctif juste à New York peut être faux à Los
 * Angeles : les deux projets existent pour ça.
 *
 * L'assertion ne compare à aucune date en dur : elle recalcule l'étiquette au
 * moment du run, et vérifie EN PLUS que l'écran ne montre pas le jour de la
 * veille — celui que rendait l'ancienne lecture locale.
 */
const JOURS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];

/** Jour, mois et quantième de l'ÉTIQUETTE (lue à Paris) d'un `postDate`. */
function etiquetteParis(ms: number): { jour: string; mois: string; num: string } {
  const f = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      ...opts,
    }).format(new Date(ms));
  return {
    jour: f({ weekday: "long" }),
    mois: f({ month: "long" }),
    num: f({ day: "numeric" }),
  };
}

test.describe("Jour prévu — l'étiquette ne bouge pas avec le fuseau du lecteur", () => {
  test("son écran annonce le jour PLANIFIÉ, pas la veille", async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const zone = testInfo.project.name.slice(-2);
    const email = `e2e-jourprevu-${ts}-${zone}@repackit.test`;
    const password = `jourprevu-${ts}`;

    // Onboardée par l'API (invite + signUp) : une fiche non onboardée n'est pas
    // assignable, et le sujet du test n'est pas le formulaire d'activation.
    const creatrice = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] JourPrevu ${zone} ${ts}`,
      email,
      password,
    });

    // Mission planifiée dans TROIS jours : un jour à venir, donc rendu dans un
    // groupe DATÉ (ni « aujourd'hui » ni « demain », qui masqueraient la date).
    const prevu = minuitParisDecale(3);
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] FmtJourPrevu ${zone} ${ts}`,
      type: "short",
      rateModel: { basePerPost: 0 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creatrice.creatorId,
      platform: "TikTok",
      handle: `@e2ejp${zone}${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creatrice.creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 10 * 86_400_000,
    });
    const mine = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.creatorId === creatrice.creatorId,
    );
    expect(mine).toHaveLength(1);
    await admin.mutation(api.assignments.setAssignmentPostDate, {
      id: mine[0]._id,
      postDate: prevu,
    });

    // Elle se connecte DANS SON NAVIGATEUR — celui que le projet Playwright
    // épingle sur New York ou Los Angeles.
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await page.waitForURL("**/app", { timeout: 20_000 });
    await page.goto("/app/missions");

    const attendu = etiquetteParis(prevu);
    const veille = etiquetteParis(prevu - 86_400_000);
    // `\d+$` : sans l'ancre, le testid du COMPTEUR (« …-count ») matche aussi.
    const groupe = page.getByTestId(/^missions-group-day-\d+$/);
    await expect(groupe).toHaveCount(1, { timeout: 20_000 });

    // L'écran annonce le jour PLANIFIÉ…
    await expect(groupe).toContainText(
      new RegExp(`${attendu.jour}\\s+${attendu.num}\\s+${attendu.mois}`, "i"),
    );
    // …et surtout PAS celui de la veille, qui est ce que rendait la lecture en
    // heure locale (minuit Paris = 18 h la veille à New York, 15 h à Los
    // Angeles). Les deux jours sont adjacents : l'assertion est scopée au
    // groupe, elle tombe si le libellé recule d'un jour.
    await expect(groupe).not.toContainText(
      new RegExp(`${veille.jour}\\s+${veille.num}\\s+${veille.mois}`, "i"),
    );
    // Contrôle de forme : le libellé attendu est bien un jour de semaine, pas
    // une chaîne vide qui rendrait les deux assertions vraies pour rien.
    expect(JOURS).toContain(attendu.jour);
  });
});
