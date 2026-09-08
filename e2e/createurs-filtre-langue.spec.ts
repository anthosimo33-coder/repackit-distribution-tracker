import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);
const MARKER = "[E2E_TEST]";

/**
 * FILTRE PAR LANGUE de l'écran créateurs.
 *
 * Ce que ces tests protègent : que la langue AFFICHÉE et FILTRÉE soit celle
 * réellement servie au créateur, pas celle de sa fiche. Les deux divergent, et
 * dans les deux sens — c'est là que le filtre mentirait sans qu'on le voie.
 */
test.describe("Créateurs — filtre par langue", () => {
  test("la langue servie fait foi, dans les DEUX sens de divergence", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();

    // ── Divergence 1 : fiche MUETTE, compte anglophone ──────────────────────
    const e1 = `e2e-lang-a-${ts}@repackit.test`;
    const { token: t1, creatorId: c1 } = await convex.mutation(
      api.creators.inviteCreator,
      { name: `${MARKER} Fiche muette ${ts}`, email: e1 },
    );
    const cli1 = new ConvexHttpClient(convexUrl);
    const r1 = await cli1.action(api.auth.signIn, {
      provider: "password",
      params: { email: e1, password: "lang-a-12345", flow: "signUp", inviteToken: t1 },
    });
    cli1.setAuth(r1.tokens!.token);
    await cli1.mutation(api.i18n.setMyLocale, { locale: "en" });

    // ── Divergence 2 : fiche « en », compte repassé en FRANÇAIS ─────────────
    // Celle qui arrivera en vrai : invitée en anglais, elle bascule depuis son
    // profil. `setMyLocale` écrit « fr » EXPLICITEMENT sur users.locale.
    const e2 = `e2e-lang-b-${ts}@repackit.test`;
    const { token: t2, creatorId: c2 } = await convex.mutation(
      api.creators.inviteCreator,
      { name: `${MARKER} Bascule FR ${ts}`, email: e2, locale: "en" },
    );
    const cli2 = new ConvexHttpClient(convexUrl);
    const r2 = await cli2.action(api.auth.signIn, {
      provider: "password",
      params: { email: e2, password: "lang-b-12345", flow: "signUp", inviteToken: t2 },
    });
    cli2.setAuth(r2.tokens!.token);
    await cli2.mutation(api.i18n.setMyLocale, { locale: "fr" });

    // ── Témoin : invitée en anglais, jamais rien changé ─────────────────────
    const { creatorId: c3 } = await convex.mutation(api.creators.inviteCreator, {
      name: `${MARKER} Reste EN ${ts}`,
      email: `e2e-lang-c-${ts}@repackit.test`,
      locale: "en",
    });

    const rows = await convex.query(api.creators.listCreators, {});
    const langueDe = (id: string) =>
      rows.find((r) => String(r._id) === String(id))?.locale;
    const ficheDe = (id: string) =>
      rows.find((r) => String(r._id) === String(id))?.locale;

    // Le serveur sert une langue CONCRÈTE, jamais `undefined`.
    expect(langueDe(c1), "fiche muette + compte EN").toBe("en");
    expect(langueDe(c2), "fiche EN + compte repassé FR").toBe("fr");
    expect(langueDe(c3), "fiche EN, rien changé").toBe("en");
    expect(ficheDe(c1)).toBeDefined();

    // Aucune ligne ne sort sans langue — c'est ce qui permet au filtre de
    // comparer une valeur au lieu d'une absence.
    expect(rows.every((r) => r.locale === "fr" || r.locale === "en")).toBe(true);
  });

  test("UI — les deux axes se combinent et les compteurs sont CROISÉS", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const ts = Date.now();
    // 2 partenaires EN, 1 talent EN, 1 partenaire FR.
    for (const [n, kind, locale] of [
      ["P-EN-1", "partner", "en"],
      ["P-EN-2", "partner", "en"],
      ["T-EN-1", "talent", "en"],
      ["P-FR-1", "partner", undefined],
    ] as const) {
      await convex.mutation(api.creators.inviteCreator, {
        name: `${MARKER} ${n} ${ts}`,
        email: `e2e-mix-${n.toLowerCase()}-${ts}@repackit.test`,
        kind,
        ...(locale ? { locale } : {}),
      });
    }

    await page.goto(adminPath("/createurs"));

    // La colonne existe : sans elle on filtre à l'aveugle. Elle survit à la
    // refonte pour cette raison exacte — l'écran doit MONTRER ce qu'il filtre.
    await expect(page.getByRole("columnheader", { name: "Langue" })).toBeVisible({
      timeout: 15_000,
    });

    const lignesAvec = async (t: string) =>
      page.getByRole("row").filter({ hasText: t }).count();

    /**
     * Ouvre un menu de filtre et coche une option.
     *
     * Les options sont cherchées DANS le popover (`filtre-options`) : les
     * `<select>` natifs de la barre d'outils — « Grouper par », « Trier par » —
     * exposent eux aussi des `role="option"`, et un `getByRole("option")` non
     * scopé les ramasse.
     */
    const cocher = async (axe: string, option: RegExp) => {
      await page.getByTestId(`filtre-${axe}`).locator("button").click();
      await page
        .getByTestId("filtre-options")
        .getByRole("option", { name: option })
        .click();
      await page.keyboard.press("Escape");
    };

    // Axe langue seul : English montre les 3 anglophones.
    await cocher("langue", /^English/);
    expect(await lignesAvec(`P-EN-1 ${ts}`)).toBe(1);
    expect(await lignesAvec(`P-FR-1 ${ts}`)).toBe(0);

    // COMPTEURS CROISÉS, moitié 1 : AVANT de croiser, on note ce que le menu
    // Population annonce pour « Créateur partenaire » — la liste est déjà
    // réduite aux anglophones, donc il doit annoncer 2, pas 3.
    await page.getByTestId("filtre-population").locator("button").click();
    const optPartenaire = page
      .getByTestId("filtre-options")
      .getByRole("option", { name: /^Créateur partenaire/ });
    const annonce = Number(
      (await optPartenaire.textContent())?.match(/(\d+)\s*$/)?.[1],
    );

    // Les DEUX axes se combinent : Partenaire + English → les 2 partenaires EN,
    // pas le talent EN.
    await optPartenaire.click();
    expect(await lignesAvec(`P-EN-1 ${ts}`)).toBe(1);
    expect(await lignesAvec(`P-EN-2 ${ts}`)).toBe(1);
    expect(await lignesAvec(`T-EN-1 ${ts}`), "le talent EN sort").toBe(0);
    expect(await lignesAvec(`P-FR-1 ${ts}`), "le partenaire FR sort").toBe(0);

    // COMPTEURS CROISÉS, moitié 2 : ce que le compteur ANNONÇAIT est exactement
    // ce que le filtre a PRODUIT. Un compteur qui ment sur ce qu'il va donner
    // est pire que pas de compteur — c'est la règle que ce test tient.
    await page.keyboard.press("Escape");
    const visibles = await page
      .getByRole("row")
      .filter({ hasText: MARKER })
      .count();
    expect(annonce, "le compteur Population doit valoir ce qu'il produit").toBe(
      visibles,
    );
  });
});
