import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { inviteEmailCopy } from "../convex/emailMessages";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);
// Client BRUT pour les queries publiques : createE2eClient injecte `projectId`
// dans les args (il est scopé projet), or getInvitationPreview est une
// publicQuery qui n'en prend pas — l'injection la ferait échouer.
const publicClient = new ConvexHttpClient(convexUrl);

/**
 * PLOMBERIE LOCALE — la chaîne complète invitation → /join → signup → espace.
 *
 * Deux scénarios, et le SECOND est celui qui compte : une invitation sans langue
 * doit laisser TOUT en français, sans poser le moindre cookie. Une régression
 * qui francise l'anglais se voit ; une régression qui anglicise le français
 * passerait inaperçue jusqu'à ce qu'une créatrice s'en plaigne.
 *
 * L'e-mail n'est pas ENVOYÉ ici (pas de clé Resend en e2e, `emailConfig()` rend
 * un no-op) : on vérifie le CONTENU RENDU par le catalogue, qui est exactement ce
 * que `sendCreatorInvite` passe à `renderEmail`.
 */
test.describe("i18n — langue portée de l'invitation jusqu'à l'espace", () => {
  test("créateur invité en 'en' : fiche, e-mail, cookie, compte, espace", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const name = `[E2E_TEST] Locale EN ${ts}`;
    const email = `e2e-locale-en-${ts}@repackit.test`;
    const password = "locale-en-12345";

    // (a) creators.locale vaut 'en' après inviteCreator
    const { token, creatorId } = await convex.mutation(
      api.creators.inviteCreator,
      { name, email, locale: "en" },
    );
    const preview = await publicClient.query(api.creators.getInvitationPreview, {
      token,
    });
    expect(preview.status).toBe("valid");
    expect(preview.status === "valid" && preview.locale).toBe("en");

    // (b) l'e-mail rendu est en ANGLAIS — le contenu, pas seulement la locale
    const copy = inviteEmailCopy("en");
    expect(copy.subject).toBe("Welcome to Jarvia 👋");
    expect(copy.greeting("Sam")).toBe("Hi Sam,");
    expect(copy.ctaLabel).toBe("Activate my access");
    // …et surtout : plus une trace de français dans ce qui part.
    const rendered = [
      copy.subject,
      copy.greeting(name),
      copy.intro,
      copy.linkHint,
      copy.ctaLabel,
      copy.footerNote,
    ].join(" ");
    expect(rendered).not.toMatch(/Bienvenue|Salut|Ton espace|Activer|à usage unique/);

    // (c) /join pose le cookie NEXT_LOCALE=en
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      locale: "fr-FR", // navigateur FRANÇAIS : seule l'invitation peut basculer
    });
    const creator = await ctx.newPage();
    await creator.goto(`/join/${token}`);
    await creator.getByLabel(/mot de passe|password/i).waitFor();
    await expect
      .poll(async () =>
        (await ctx.cookies()).find((c) => c.name === "NEXT_LOCALE")?.value,
      )
      .toBe("en");

    // (d) users.locale vaut 'en' après signup
    await creator.getByLabel(/mot de passe|password/i).fill(password);
    await creator
      .getByRole("button", { name: /activer mon compte|activate/i })
      .click();
    await creator.waitForURL(/\/app/, { timeout: 30_000 });
    await expect
      .poll(
        async () =>
          await convex.mutation(api.creators.e2eGetCreatorLocaleState, {
            creatorId,
            secret: E2E_SECRET,
          }),
        { timeout: 20_000 },
      )
      .toEqual({ creatorLocale: "en", userLocale: "en" });

    // (e) l'espace rend en anglais — <html lang> est piloté par la locale résolue
    await expect
      .poll(async () => creator.locator("html").getAttribute("lang"))
      .toBe("en");

    await ctx.close();
  });

  test("CONTRE-TEST — invitation SANS langue, navigateur fr : tout reste français", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const name = `[E2E_TEST] Locale FR ${ts}`;
    const email = `e2e-locale-fr-${ts}@repackit.test`;
    const password = "locale-fr-12345";

    const { token, creatorId } = await convex.mutation(
      api.creators.inviteCreator,
      { name, email },
    );
    const preview = await publicClient.query(api.creators.getInvitationPreview, {
      token,
    });
    // Rien n'est stocké : on n'enregistre que la DIVERGENCE.
    expect(preview.status === "valid" && preview.locale).toBeNull();

    // L'e-mail part en français.
    expect(inviteEmailCopy(null).subject).toBe("Bienvenue chez Jarvia 👋");

    // Et « fr » EXPLICITE ne stocke rien non plus — l'invariant « on n'écrit que
    // la divergence ». Sans cette assertion, une fiche sur deux porterait « fr »
    // et on ne saurait plus qui a réellement été invité en anglais.
    const explicite = await convex.mutation(api.creators.inviteCreator, {
      name: `${name} bis`,
      email: `e2e-locale-frx-${ts}@repackit.test`,
      locale: "fr",
    });
    await expect
      .poll(async () =>
        convex.mutation(api.creators.e2eGetCreatorLocaleState, {
          creatorId: explicite.creatorId,
          secret: E2E_SECRET,
        }),
      )
      .toEqual({ creatorLocale: null, userLocale: null });

    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      locale: "fr-FR",
    });
    const creator = await ctx.newPage();
    await creator.goto(`/join/${token}`);
    await creator.getByLabel("Mot de passe").waitFor();

    // AUCUN cookie posé : la page n'a rien à dire sur la langue.
    expect(
      (await ctx.cookies()).find((c) => c.name === "NEXT_LOCALE"),
    ).toBeUndefined();
    await expect(creator.locator("html")).toHaveAttribute("lang", "fr");

    await creator.getByLabel("Mot de passe").fill(password);
    await creator
      .getByRole("button", { name: /activer mon compte/i })
      .click();
    await creator.waitForURL(/\/app/, { timeout: 30_000 });

    // Le compte non plus ne porte rien, et l'espace reste français.
    await expect
      .poll(
        async () =>
          await convex.mutation(api.creators.e2eGetCreatorLocaleState, {
            creatorId,
            secret: E2E_SECRET,
          }),
        { timeout: 20_000 },
      )
      .toEqual({ creatorLocale: null, userLocale: null });
    await expect(creator.locator("html")).toHaveAttribute("lang", "fr");
    expect(
      (await ctx.cookies()).find((c) => c.name === "NEXT_LOCALE"),
    ).toBeUndefined();

    await ctx.close();
  });
});
