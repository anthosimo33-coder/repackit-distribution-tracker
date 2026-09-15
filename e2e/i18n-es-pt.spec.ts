import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { inviteEmailCopy } from "../convex/emailMessages";
import type { Browser } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * ESPAGNOL ET PORTUGAIS — de l'invitation à l'espace créatrice.
 *
 * Le parcours anglais est couvert par i18n-invitation-locale.spec.ts ; celui-ci
 * prouve que les deux langues AJOUTÉES ne retombent pas dans la branche d'une
 * autre. Chaque absence de français est appariée à une PRÉSENCE de la langue
 * attendue : un écran vide ou mort passerait sinon le test.
 *
 * Navigateur FRANÇAIS dans les deux cas : seule l'invitation peut basculer.
 */

async function joinAndLand(
  browser: Browser,
  token: string,
  creatorId: Id<"creators">,
  locale: "es" | "pt",
  labels: { password: RegExp; submit: RegExp; greeting: RegExp; home: string },
) {
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    locale: "fr-FR",
  });
  const page = await ctx.newPage();
  await page.goto(`/join/${token}`);

  // /join rend DÉJÀ dans la langue de l'invitation, et pose le cookie.
  await expect(page.getByRole("button", { name: labels.submit })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: /activer mon compte/i })).toHaveCount(0);
  await expect
    .poll(async () => (await ctx.cookies()).find((c) => c.name === "NEXT_LOCALE")?.value)
    .toBe(locale);

  await page.getByLabel(labels.password).fill(`${locale}-pass-12345`);
  await page.getByRole("button", { name: labels.submit }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });

  await expect
    .poll(
      async () =>
        await convex.mutation(api.creators.e2eGetCreatorLocaleState, {
          creatorId,
          secret: E2E_SECRET,
        }),
      { timeout: 20_000 },
    )
    .toEqual({ creatorLocale: locale, userLocale: locale });

  // L'espace : <html lang>, le titre d'accueil et la navigation dans la langue.
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.getByRole("heading", { name: labels.greeting })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("heading", { name: /Bonjour|Hi there|Hi / })).toHaveCount(0);
  await expect(page.getByRole("link", { name: labels.home }).first()).toBeAttached();

  return { ctx, page };
}

test.describe("i18n — espagnol et portugais, de l'invitation à l'espace", () => {
  test("l'admin invite en espagnol depuis le dialogue : fiche, /join et espace en espagnol", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const name = `[E2E_TEST] Lucía Fernández ${ts}`;
    const email = `e2e-locale-es-${ts}@repackit.test`;

    await page.goto(adminPath("/createurs"));
    await page.getByRole("button", { name: /inviter un créateur/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nom *", { exact: true }).fill(name);
    await dialog.getByLabel("Email *", { exact: true }).fill(email);

    // Les quatre langues sont proposées, sous leur endonyme.
    await dialog.getByRole("combobox", { name: "Langue" }).click();
    const options = page.getByRole("option");
    await expect(options).toHaveText(["Français", "English", "Español", "Português"]);
    await page.getByRole("option", { name: "Español" }).click();
    await expect(dialog.getByRole("combobox", { name: "Langue" })).toHaveText(/Español/);

    await dialog.getByRole("button", { name: "Inviter", exact: true }).click();
    const linkInput = dialog.getByLabel("Lien d'invitation");
    await expect(linkInput).toBeVisible({ timeout: 10_000 });
    const token = (await linkInput.inputValue()).split("/join/")[1];
    expect(token.length).toBeGreaterThan(0);

    const creators = await convex.query(api.creators.listCreators, {});
    const created = creators.find((c) => c.email === email);
    expect(created).toBeDefined();

    const { ctx } = await joinAndLand(browser, token, created!._id, "es", {
      password: /contraseña/i,
      submit: /activar mi cuenta/i,
      greeting: /Hola/,
      home: "Misiones",
    });
    await ctx.close();
  });

  test("invitation en portugais : e-mail, /join et espace en portugais", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { token, creatorId } = await convex.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] João Pereira ${ts}`,
      email: `e2e-locale-pt-${ts}@repackit.test`,
      locale: "pt",
    });

    // L'e-mail qui part : portugais, et plus un mot de français ni d'anglais.
    const copy = inviteEmailCopy("pt");
    expect(copy.ctaLabel).toBe("Ativar meu acesso");
    expect(
      [copy.subject, copy.greeting("João"), copy.intro, copy.linkHint, copy.footerNote].join(" "),
    ).not.toMatch(/Bienvenue|Salut|Welcome|Hi João|Activer|Activate/);

    const { ctx } = await joinAndLand(browser, token, creatorId, "pt", {
      password: /senha/i,
      submit: /ativar minha conta/i,
      greeting: /Oi/,
      home: "Missões",
    });
    await ctx.close();
  });
});

/**
 * CHANGER LA LANGUE D'UNE CRÉATRICE DÉJÀ INSCRITE — cas réel du 2026-09-15 :
 * fiche passée de « en » à « pt », espace resté en anglais. À l'activation, la
 * langue est recopiée sur le compte (`users.locale`), qui prime ensuite ; seule
 * la fiche changeait.
 *
 * Le contre-test compte autant : « Enregistrer » renvoie la langue à chaque fois.
 * Corriger une note ne doit pas écraser la langue que la créatrice s'est
 * choisie elle-même.
 */
test.describe("i18n — la langue changée par l'admin s'applique à l'espace", () => {
  test("anglais → portugais après inscription, puis sa propre préférence n'est pas écrasée", async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const { token, creatorId } = await convex.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Cíntia Fantato ${ts}`,
      email: `e2e-locale-switch-${ts}@repackit.test`,
      locale: "en",
    });
    const state = () =>
      convex.mutation(api.creators.e2eGetCreatorLocaleState, {
        creatorId,
        secret: E2E_SECRET,
      });

    // (1) Elle s'inscrit en anglais : le compte porte « en ».
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      locale: "fr-FR",
    });
    const creator = await ctx.newPage();
    await creator.goto(`/join/${token}`);
    await creator.getByLabel(/password/i).fill("switch-pass-12345");
    await creator.getByRole("button", { name: /activate my account/i }).click();
    await creator.waitForURL(/\/app/, { timeout: 30_000 });
    await expect.poll(state, { timeout: 20_000 }).toEqual({ creatorLocale: "en", userLocale: "en" });
    await expect(creator.locator("html")).toHaveAttribute("lang", "en");

    // (2) L'admin la passe en portugais depuis sa fiche.
    await page.goto(adminPath(`/createurs/${creatorId}`));
    const langue = page.getByRole("combobox", { name: "Langue" });
    await expect(langue).toHaveText(/English/, { timeout: 20_000 });
    await langue.click();
    await page.getByRole("option", { name: "Português" }).click();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect.poll(state, { timeout: 20_000 }).toEqual({ creatorLocale: "pt", userLocale: "pt" });

    // (3) Son espace, rechargé, est en portugais — sans qu'elle ait rien fait.
    await creator.reload();
    await expect(creator.locator("html")).toHaveAttribute("lang", "pt");
    await expect(creator.getByRole("heading", { name: /Oi/ })).toBeVisible({ timeout: 20_000 });
    await expect(creator.getByRole("heading", { name: /Hi there|Hi / })).toHaveCount(0);

    // (4) CONTRE-TEST — elle repasse elle-même en anglais depuis son profil…
    await creator.goto("/app/profil");
    await creator.getByRole("button", { name: "en", exact: true }).click();
    await expect.poll(state, { timeout: 20_000 }).toEqual({ creatorLocale: "pt", userLocale: "en" });

    // …puis l'admin corrige seulement une note : la langue qu'elle a choisie tient.
    await page.reload();
    await expect(langue).toHaveText(/English/, { timeout: 20_000 });
    await page.getByPlaceholder(/Notes internes/).fill(`note ${ts}`);
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect
      .poll(async () => (await convex.query(api.creators.getCreator, { id: creatorId }))?.adminNotes)
      .toBe(`note ${ts}`);
    expect((await state()).userLocale).toBe("en");

    await ctx.close();
  });
});
