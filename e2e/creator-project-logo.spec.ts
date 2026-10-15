import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { viewAsBase } from "../lib/view-as";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * LOGO DU PROJET À CÔTÉ DE SON NOM — portail créatrice ET sa réplique en
 * observation (« Tu regardes l'espace de … »).
 *
 * Le portail réel affichait déjà le logo (CreatorProjectSwitcher) ; la coque
 * d'observation, elle, ne rendait que le nom. L'admin qui ouvrait l'espace d'une
 * créatrice BLUSH voyait « BLUSH » nu et concluait que la créatrice ne voyait
 * pas le logo. Les deux en-têtes rendent maintenant le même ProjectAvatar : la
 * spec les vérifie côte à côte, sur le même projet, la même personne.
 */
test.describe("Logo du projet dans l'espace créatrice", () => {
  test("le logo est à côté du nom, chez elle comme en observation", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const slug = `e2e-logo-${ts}`;
    const projectName = `E2E Logo Projet ${ts}`;
    const logoUrl = "/brand/snytch-logo.jpeg";
    const email = `e2e-creator-logo-${ts}@repackit.test`;
    const password = `creator-logo-${ts}`;

    const { projectId } = await admin.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug, name: projectName },
    );
    await admin.mutation(api.projects.e2eSetProjectBranding, {
      secret: E2E_SECRET,
      slug,
      logoUrl,
    });

    try {
      const { creatorId, token } = await admin.mutation(
        api.creators.inviteCreator,
        { projectId, name: `[E2E_TEST] Juliette Logo-Chetrit ${ts}`, email },
      );
      const signup = new ConvexHttpClient(convexUrl!);
      await signup.action(api.auth.signIn, {
        provider: "password",
        params: { email, password, flow: "signUp", inviteToken: token },
      });

      // 1. CHEZ ELLE — connectée par /login, comme en vrai.
      const ctx = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      try {
        const sienne = await ctx.newPage();
        await sienne.goto("/login");
        await sienne.getByLabel("Email").fill(email);
        await sienne.getByLabel("Mot de passe").fill(password);
        await sienne.getByRole("button", { name: /se connecter/i }).click();
        await sienne.waitForURL("**/app", { timeout: 20_000 });

        const enTete = sienne.locator("aside").filter({ hasText: projectName });
        await expect(enTete).toBeVisible({ timeout: 10_000 });
        await expect(enTete.locator(`img[src="${logoUrl}"]`)).toBeVisible();
      } finally {
        await ctx.close();
      }

      // 2. EN OBSERVATION — la même sidebar, le même logo.
      await page.goto(viewAsBase(slug, creatorId));
      await expect(page.getByTestId("view-as-banner")).toBeVisible({
        timeout: 15_000,
      });
      const observee = page.locator("aside").filter({ hasText: projectName });
      await expect(observee).toBeVisible({ timeout: 10_000 });
      await expect(observee.locator(`img[src="${logoUrl}"]`)).toBeVisible();
    } finally {
      await admin.mutation(api.projects.e2eDeleteProject, {
        secret: E2E_SECRET,
        slug,
      });
    }
  });
});
