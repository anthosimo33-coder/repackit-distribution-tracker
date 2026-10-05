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
 * Vue Liste des missions PAGINÉE par 100 (le 05/10/2026 : 787 lignes d'un bloc
 * sur Snytch, ~70 000 nœuds, ~0,9 s pour afficher la liste). Trois règles :
 * le découpage porte sur les lignes FILTRÉES, changer la recherche revient à la
 * page 1, et une écriture venue d'ailleurs NE renvoie PAS en page 1 — on reste
 * sur la page où l'on travaille.
 */
test("la liste se pagine par 100 ; la recherche revient en page 1, une écriture non", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ts = Date.now();
  const C = await createCreatorSession(convexUrl, {
    name: `[E2E_TEST] Pager ${ts}`,
    email: `e2e-creator-pager-${ts}@repackit.test`,
    password: "creator-pager-12345",
  });
  const fid = (await createFormatWithRate(admin, {
    name: `[E2E_TEST] Pager Fmt ${ts}`,
    type: "short",
    rateModel: { basePerPost: 30 },
  })) as Id<"formats">;
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: C.creatorId,
    platform: "TikTok",
    handle: `@e2epager${ts}`,
  });
  // 120 missions (l'assignation plafonne à 50 par appel).
  for (let i = 0; i < 3; i++) {
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid,
      creatorId: C.creatorId,
      targets: [target],
      postsPerCreator: 40,
      dueDate: ts + 7 * 86_400_000,
    });
  }
  const mine = (await admin.query(api.assignments.listAssignments, {})).filter(
    (a) => a.formatId === fid,
  );
  expect(mine).toHaveLength(120);

  await page.goto(adminPath("/assignments"));
  await page.getByRole("radio", { name: "Liste" }).click();
  const search = page.getByRole("searchbox", { name: "Rechercher une assignation" });
  const bodyRows = page.locator("tbody tr");
  const range = page.getByTestId("list-pager-range");
  const pageLabel = page.getByTestId("list-pager-page");
  const next = page.getByRole("button", { name: "Suivante" });
  const prev = page.getByRole("button", { name: "Précédente" });

  // Page 1 : 100 lignes sur les 120 retenues par la recherche.
  await search.fill(`Pager ${ts}`);
  await expect(range).toHaveText("1–100 sur 120", { timeout: 15_000 });
  await expect(pageLabel).toHaveText("Page 1 sur 2");
  await expect(bodyRows).toHaveCount(100);
  await expect(prev).toBeDisabled();

  // Page 2 : les 20 restantes.
  await next.click();
  await expect(range).toHaveText("101–120 sur 120");
  await expect(pageLabel).toHaveText("Page 2 sur 2");
  await expect(bodyRows).toHaveCount(20);
  await expect(next).toBeDisabled();
  await expect(prev).toBeEnabled();

  // Une écriture venue d'ailleurs (le connecteur, un autre onglet) renvoie la
  // query entière. Une mission de plus pour la même créatrice : le total passe
  // à 121, ce qui prouve que la nouvelle version est arrivée — et on RESTE en
  // page 2.
  await admin.mutation(api.assignments.assignFormat, {
    formatId: fid,
    creatorId: C.creatorId,
    targets: [target],
    postsPerCreator: 1,
    dueDate: ts + 7 * 86_400_000,
  });
  await expect(range).toHaveText("101–121 sur 121", { timeout: 10_000 });
  await expect(pageLabel).toHaveText("Page 2 sur 2");
  await expect(bodyRows).toHaveCount(21);

  // Changer la recherche (mêmes 120 lignes, autre sélection) : retour page 1.
  await search.fill(`${ts}`);
  await expect(range).toHaveText("1–100 sur 121", { timeout: 15_000 });
  await expect(pageLabel).toHaveText("Page 1 sur 2");
  await expect(bodyRows).toHaveCount(100);

  // Une recherche qui tient sur une page : plus de pager du tout.
  await search.fill(`Pager ${ts} zzz-aucune`);
  await expect(range).toHaveCount(0, { timeout: 15_000 });
});
