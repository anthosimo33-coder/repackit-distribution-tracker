import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
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
 * « MES MISSIONS » — l'écran qui rend joignable ce que le cap de 5 masquait.
 *
 * LE DÉFAUT QU'IL CORRIGE, relevé en PROD le 28/08/2026 : une créatrice portait
 * 16 missions actionnables (7 à produire, 9 à publier) et le dashboard n'en
 * montrait que 5 par bloc, derrière un « +N de plus… » qui n'était PAS un lien.
 * Le jeu de données ci-dessous reprend cette forme — 7 à produire, plus que le
 * cap, pas 2 ou 3 — parce qu'un cas à 6 passerait le test sans jamais reproduire
 * ce qu'on répare.
 *
 * Les dates sont ÉCHELONNÉES : c'est ce qui distingue un vrai regroupement par
 * jour d'une simple liste à plat, et le groupe « à rattraper » d'un tri par
 * échéance.
 *
 * ⚠️ SIX missions tombent le MÊME jour passé, et ce n'est pas décoratif. Une
 * première version étalait les 7 missions sur 7 familles distinctes : aucun
 * groupe ne dépassait 2, si bien que replafonner l'écran à 5 laissait le test
 * VERT. L'assertion ne prouvait donc pas l'absence de plafond, elle constatait
 * qu'il n'y avait rien à plafonner. Le groupe de 6 est ce qui la rend capable
 * d'échouer.
 */
test.describe("Créateur — écran « Mes missions »", () => {
  test("liste tout, groupe par jour, et le « +N de plus » y mène", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    const name = `[E2E_TEST] Missions ${ts}`;
    const email = `e2e-creator-missions-${ts}@repackit.test`;
    const password = "creator-missions-12345";

    const { creatorId, token } = await admin.mutation(
      api.creators.inviteCreator,
      { name, email },
    );
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const cpage = await ctx.newPage();
    await cpage.goto(`/join/${token}`);
    await cpage.getByLabel("Mot de passe").fill(password);
    await cpage.getByRole("button", { name: /activer mon compte/i }).click();
    await cpage.waitForURL("**/app", { timeout: 20_000 });

    // ── Seed : 11 missions à produire → 6 de plus que le cap du dashboard. ──
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Format Missions ${ts}`,
      type: "short",
      rateModel: { basePerPost: 10 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId,
      platform: "TikTok",
      handle: `@e2emissions${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId,
      targets: [target],
      postsPerCreator: 11,
      dueDate: ts + 10 * DAY,
    });
    const mine = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) => a.formatId === formatId && a.creatorId === creatorId,
    );
    expect(mine.length).toBe(11);

    // Dates de PUBLICATION échelonnées. Minuit LOCAL, comme la modale d'assignation
    // (postDate = minuit du jour choisi) — un timestamp « maintenant − 2 jours »
    // tomberait au milieu d'une journée et ne testerait pas le même découpage.
    const minuit = (decalageJours: number) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + decalageJours);
      return d.getTime();
    };
    // Six le MÊME jour passé (le groupe qui doit dépasser tout plafond), puis
    // aujourd'hui, demain, J+3, et J+9 (hors horizon d'une semaine).
    const decalages = [-2, -2, -2, -2, -2, -2, 0, 1, 3, 9];
    for (let i = 0; i < decalages.length; i++) {
      await admin.mutation(api.assignments.setAssignmentPostDate, {
        id: mine[i]._id,
        postDate: minuit(decalages[i]),
      });
    }
    // La 11ᵉ reste SANS date de publication : elle n'apparaît ni au calendrier ni
    // dans les bandeaux, et c'est le cas que rien d'autre ne rattrapait.

    // ── Le dashboard plafonne ET propose le lien. ──
    await cpage.goto("/app");
    await expect(cpage.getByTestId("produce-count")).toHaveText("11", {
      timeout: 20_000,
    });
    const lien = cpage.getByTestId("see-all-missions");
    await expect(lien).toBeVisible();
    await expect(lien).toHaveText(/\+6 de plus/);
    await lien.click();
    await cpage.waitForURL("**/app/missions", { timeout: 20_000 });

    // ── L'écran : les 7, groupées. ──
    await expect(
      cpage.getByRole("heading", { level: 1, name: "Mes missions" }),
    ).toBeVisible({ timeout: 20_000 });
    // AUCUN plafond : les 11 liens de mission sont là, contre 5 sur le dashboard.
    const lignes = cpage
      .getByTestId("missions-list")
      .locator('a[href*="/app/assignments/"]');
    await expect(lignes).toHaveCount(11);

    // Les deux jours passés sont regroupés sous « À rattraper », pas dispersés
    // dans les jours à venir.
    await expect(cpage.getByTestId("missions-group-catchup-count")).toHaveText(
      "6",
    );
    // …et les SIX sont réellement rendues, pas seulement comptées : c'est
    // l'assertion qui tombe si un plafond revient par la bande.
    await expect(
      cpage.getByTestId("missions-group-catchup").locator("li"),
    ).toHaveCount(6);
    // La mission sans date de publication a son propre groupe — c'est elle qui
    // n'était joignable par aucun chemin.
    await expect(cpage.getByTestId("missions-group-undated-count")).toHaveText(
      "1",
    );
    // Aujourd'hui / demain sont NOMMÉS, pas datés : c'est ce qui rend la semaine
    // lisible d'un coup d'œil.
    await expect(
      cpage.getByRole("heading", { level: 2, name: "Aujourd'hui" }),
    ).toBeVisible();
    await expect(
      cpage.getByRole("heading", { level: 2, name: "Demain" }),
    ).toBeVisible();
    // Au-delà de l'horizon d'une semaine → « Plus tard » (J+9), jamais un
    // vingtième groupe-jour.
    await expect(cpage.getByTestId("missions-group-later-count")).toHaveText("1");

    // ── L'onglet de nav mène ici (l'ask : « accessible depuis la nav »). ──
    await cpage.goto("/app");
    await cpage.getByRole("link", { name: "Mes missions" }).first().click();
    await cpage.waitForURL("**/app/missions", { timeout: 20_000 });

    // ── Une mission mène à son brief. ──
    await lignes.first().click();
    await cpage.waitForURL("**/app/assignments/**", { timeout: 20_000 });
    await expect(
      cpage.getByRole("button", { name: /je commence/i }),
    ).toBeVisible({ timeout: 20_000 });

    // ── ISOLATION : une AUTRE créatrice ne voit rien de tout ça. ──
    const autre = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Missions autre ${ts}`,
      email: `e2e-creator-missions-autre-${ts}@repackit.test`,
    });
    const ctx2 = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page2 = await ctx2.newPage();
    await page2.goto(`/join/${autre.token}`);
    await page2.getByLabel("Mot de passe").fill(password);
    await page2.getByRole("button", { name: /activer mon compte/i }).click();
    await page2.waitForURL("**/app", { timeout: 20_000 });
    await page2.goto("/app/missions");
    // Assertion de PRÉSENCE appariée à l'absence : l'écran MONTE (état vide),
    // il n'est pas simplement blanc — sinon « 0 mission » ne prouverait rien.
    await expect(
      page2.getByRole("heading", { level: 1, name: "Mes missions" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page2.getByTestId("missions-empty")).toBeVisible();
    await expect(page2.getByTestId("missions-list")).toHaveCount(0);

    await admin.mutation(api.assignments.cleanupTestAssignments, {
      secret: E2E_SECRET,
    });
    await ctx.close();
    await ctx2.close();
  });
});
