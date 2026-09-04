import {
  test,
  expect,
  adminPath,
  E2E_PROJECT_SLUG,
} from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { viewAsBase } from "../lib/view-as";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);
const DAY = 86_400_000;

/**
 * Admin « voir l'espace d'un créateur » — LA PREVIEW REND DANS LA LANGUE DE LA
 * PERSONNE OBSERVÉE, pas dans celle de l'admin.
 *
 * Le défaut corrigé : le provider next-intl racine monte les messages de
 * l'APPELANT. En observation, l'appelant est l'admin — la preview d'un espace
 * anglophone s'affichait donc en français, avec ses dates et ses montants au
 * format français. Une preview qui existe pour montrer ce que la personne voit
 * ne montrait plus rien.
 *
 * La session admin de ces tests est en FRANÇAIS (défaut du produit) : c'est
 * précisément ce qui rend l'assertion probante. Si la preview rendait avec la
 * locale de l'appelant, tout ce qui suit serait français.
 */
test.describe("View-as — la preview parle la langue de la personne observée", () => {
  test("créateur EN, admin FR : contenu et formats en anglais, bandeau en français", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const name = `[E2E_TEST] ViewAsLoc ${ts}`;
    const email = `e2e-viewas-loc-${ts}@repackit.test`;
    const password = "viewas-loc-12345";

    // Fiche invitée EN ANGLAIS — c'est la fiche qui porte la langue avant que
    // le compte existe, et `auth.ts` la recopie sur `users.locale` au signup.
    const { token } = await admin.mutation(api.creators.inviteCreator, {
      name,
      email,
      locale: "en",
    });

    // Onboarding navigateur → le compte existe, `users.locale` vaut "en".
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const cpage = await ctx.newPage();
    await cpage.goto(`/join/${token}`);
    // La page /join est DÉJÀ en anglais (la langue vient de l'invitation).
    await cpage.getByLabel("Password").fill(password);
    await cpage.getByRole("button", { name: /activate my account/i }).click();
    await cpage.waitForURL("**/app", { timeout: 20_000 });
    await ctx.close();

    const creatorClient = createE2eClient(url, { email, password });
    const creatorId = (await admin.query(api.creators.listCreators, {})).find(
      (c) => c.email === email,
    )!._id;

    // Un paiement de 15 : sans devise de projet, `formatMoney` rend un NOMBRE NU.
    // Le séparateur décimal devient donc le témoin du format — « 15,00 » en
    // français, « 15.00 » en anglais. C'est l'assertion de format la plus nette
    // qu'on puisse écrire ici, et elle ne dépend d'aucune configuration.
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] ViewAsLocFmt ${ts}`,
      type: "short",
      rateModel: { basePerPost: 15 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId,
      platform: "TikTok",
      handle: `@e2eviewasloc${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    const assignment = (
      await admin.query(api.assignments.listAssignments, {})
    ).find((x) => x.formatId === formatId && x.creatorId === creatorId)!;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: assignment._id,
      status: "to_publish",
    });
    await creatorClient.mutation(api.assignments.confirmPublication, {
      id: assignment._id,
      urls: [
        {
          platform: "TikTok",
          url: `https://www.tiktok.com/@viewasloc/video/${ts}`,
        },
      ],
    });

    // ── L'ADMIN (session FR) ouvre la preview ────────────────────────────────
    const base = viewAsBase(E2E_PROJECT_SLUG, creatorId);
    await page.goto(`${base}/paiements`);

    // Le BANDEAU reste en français : il s'adresse à l'admin, pas à l'observée.
    await expect(page.getByTestId("view-as-banner")).toContainText(
      "Tu regardes l'espace de",
      { timeout: 20_000 },
    );

    // Le CONTENU est en anglais — titre d'écran et nav.
    await expect(
      page.getByRole("heading", { name: "My payments" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("link", { name: "My accounts", exact: true }).first(),
    ).toBeVisible();
    // Et le libellé français de la même nav n'est nulle part.
    await expect(page.getByText("Mes comptes", { exact: true })).toHaveCount(0);

    // Le FORMAT suit aussi : séparateur décimal anglais, jamais la virgule.
    const due = page.getByTestId("due-now");
    await expect(due).toContainText("15.00", { timeout: 20_000 });
    await expect(due).not.toContainText("15,00");

    // ── Le sélecteur de langue de l'ADMIN n'est PAS rendu en observation ─────
    // Il vit dans `Sidebar`, montée par `SidebarLayout`, lui-même monté par le
    // SEUL layout `/admin/[projectSlug]`. La route view-as est sa SŒUR et ne
    // l'hérite pas — il n'y a donc rien à désactiver.
    //
    // L'assertion garde ce fait plutôt que la lecture qui l'a établi : le jour
    // où quelqu'un monterait la sidebar admin dans l'arbre view-as, l'admin
    // pourrait rebasculer la preview dans SA langue d'un clic, et le défaut
    // qu'on vient de corriger reviendrait par la porte de service.
    const langSelector = page.getByRole("group", {
      name: /changer la langue|change the interface language/i,
    });
    await expect(langSelector).toHaveCount(0);

    // CONTRÔLE POSITIF, obligatoire : sans lui, l'assertion d'absence ci-dessus
    // passerait aussi si le sélecteur n'était trouvable NULLE PART — un test vert
    // qui ne prouve rien. On vérifie donc que le MÊME locator le trouve sur une
    // page admin normale.
    await page.goto(adminPath("/dashboard"));
    await expect(langSelector.first()).toBeVisible({ timeout: 20_000 });
  });

  test("fiche invitée NON activée : la preview suit la langue de la FICHE", async ({
    page,
  }) => {
    const ts = Date.now();
    // Aucun compte derrière : `users.locale` n'existe pas, `creators.locale` est
    // le seul porteur. C'est le cas nominal juste après l'invitation, et celui
    // où l'admin a le plus besoin de voir ce que la personne recevra.
    const { creatorId } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] ViewAsLocInv ${ts}`,
      email: `e2e-viewas-loc-inv-${ts}@repackit.test`,
      locale: "en",
    });

    await page.goto(viewAsBase(E2E_PROJECT_SLUG, creatorId));
    await expect(page.getByTestId("view-as-banner")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole("link", { name: "My accounts", exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Mes comptes", { exact: true })).toHaveCount(0);
  });
});
