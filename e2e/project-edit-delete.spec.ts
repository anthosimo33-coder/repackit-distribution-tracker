import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/** PNG 1×1 — un vrai fichier image, pour que le serveur le reconnaisse comme tel. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Superadmin — modifier puis supprimer un projet depuis le switcher.
 *
 * Le projet est semé avec des données de plusieurs familles (créatrice +
 * invitation, compte, publication, logo téléversé) : la suppression doit les
 * emporter TOUTES, y compris par la purge en arrière-plan. `e2eRemainingProjectRows`
 * lit par les mêmes étapes que la purge.
 */
test.describe("Projets — modifier et supprimer (superadmin)", () => {
  test("nom, couleur et logo modifiés ; suppression confirmée par le nom, données purgées", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const slug = `e2e-edit-${ts}`;
    const nom = `E2E Edit ${ts}`;
    const nouveauNom = `E2E Renommé ${ts}`;
    // Projet semé par la mutation e2e (le client injecterait sinon un projectId
    // que `createProject` refuse). Le user e2e, superadmin, y a accès sans
    // membership.
    const { projectId } = (await convex.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug, name: nom },
    )) as { projectId: Id<"projects"> };

    try {
      // Des données de plusieurs familles dans le projet. La créatrice ACTIVE
      // son compte : la suppression du projet doit emporter sa connexion.
      const emailCreatrice = `e2e-edit-${ts}@repackit.test`;
      const mdpCreatrice = "Edit-creatrice-2026!";
      const { token } = await convex.mutation(api.creators.inviteCreator, {
        projectId,
        name: `[E2E_TEST] Edit Créatrice ${ts}`,
        email: emailCreatrice,
      });
      await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
        provider: "password",
        params: {
          email: emailCreatrice,
          password: mdpCreatrice,
          flow: "signUp",
          inviteToken: token,
        },
      });
      const connexionCreatrice = () =>
        new ConvexHttpClient(convexUrl!)
          .action(api.auth.signIn, {
            provider: "password",
            params: { email: emailCreatrice, password: mdpCreatrice, flow: "signIn" },
          })
          .then((r) => Boolean(r.tokens?.token))
          .catch(() => false);
      // PRÉSENCE : son mot de passe ouvre une session tant que le projet vit.
      expect(await connexionCreatrice()).toBe(true);
      await convex.mutation(api.comptes.createCompte, {
        projectId,
        handle: `@e2eedit${ts}`,
        plateforme: "TikTok",
        notes: "[E2E_TEST] edit-delete",
      });
      // Assez de lignes pour que la purge enchaîne plusieurs lots ET se
      // reprogramme (plafond de 400 écritures par exécution).
      await convex.mutation(api.projectLifecycle.e2eSeedPersonnes, {
        secret: E2E_SECRET,
        projectId,
        n: 450,
      });

      // ── Modifier ───────────────────────────────────────────────────────────
      await page.goto(`/admin/${slug}/dashboard`);
      await page.getByRole("button", { name: "Changer de projet" }).click();
      await page.getByRole("menuitem", { name: "Modifier ce projet" }).click();
      await expect(
        page.getByRole("heading", { name: "Modifier le projet" }),
      ).toBeVisible();
      // Le slug est montré, pas modifiable.
      await expect(page.getByText(`/admin/${slug}`, { exact: true })).toBeVisible();

      await page.getByLabel("Nom", { exact: true }).fill(nouveauNom);
      await page.getByLabel("Code de la couleur").fill("#7C3AED");
      await page.getByLabel("Choisir une image de logo").setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: PNG_1PX,
      });
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(
        page.getByRole("heading", { name: "Modifier le projet" }),
      ).toBeHidden();

      // Le switcher porte le nouveau nom ET le logo téléversé.
      const avatar = page
        .getByRole("button", { name: "Changer de projet" })
        .getByRole("img", { name: nouveauNom });
      await expect(avatar).toBeVisible();
      await expect(avatar).toHaveAttribute("src", /\/api\/storage\//);
      const etat = () =>
        convex.mutation(api.projectLifecycle.e2eProjectState, {
          secret: E2E_SECRET,
          slug,
        });
      expect(await etat()).toEqual({
        name: nouveauNom,
        accentColor: "#7c3aed",
        logoUrl: expect.stringMatching(/\/api\/storage\//),
        hasLogoBlob: true,
      });

      // Une couleur hors format est refusée par le SERVEUR aussi.
      await expect(
        convex.mutation(api.projectLifecycle.updateProject, {
          projectId,
          accentColor: "red;display:none",
        }),
      ).rejects.toThrow(/ERR_ACCENT_COLOR_INVALID/);

      // ── Supprimer ──────────────────────────────────────────────────────────
      // PRÉSENCE d'abord : le compteur de lignes restantes voit bien le semis,
      // sinon le « [] » attendu après la purge ne prouverait rien.
      const avant = await convex.mutation(
        api.projectLifecycle.e2eRemainingProjectRows,
        { secret: E2E_SECRET, projectId },
      );
      expect(avant).toEqual(
        expect.arrayContaining(["comptes", "creators", "personnes"]),
      );

      // Mauvaise confirmation : refusée côté serveur, projet intact.
      await expect(
        convex.mutation(api.projectLifecycle.deleteProject, {
          projectId,
          confirmation: nom, // l'ANCIEN nom
        }),
      ).rejects.toThrow(/ERR_PROJECT_DELETE_CONFIRMATION/);

      await page.getByRole("button", { name: "Changer de projet" }).click();
      await page.getByRole("menuitem", { name: "Modifier ce projet" }).click();
      await page.getByRole("button", { name: "Supprimer…" }).click();
      const impact = page.getByTestId("impact-suppression");
      await expect(impact).toContainText("1 créatrice(s)");
      await expect(impact).toContainText("1 compte(s)");

      const bouton = page.getByRole("button", { name: "Supprimer définitivement" });
      const champ = page.getByLabel(/Pour confirmer, tape le nom du projet/);
      await champ.fill(nouveauNom.toLowerCase());
      await expect(bouton).toBeDisabled();
      await champ.fill(nouveauNom);
      await expect(bouton).toBeEnabled();
      await bouton.click();

      // Renvoyé hors du projet supprimé, qui a disparu de la liste.
      await expect(page).not.toHaveURL(new RegExp(`/admin/${slug}`), {
        timeout: 10_000,
      });
      expect(await etat()).toBeNull();
      // Son compte de connexion est parti avec le projet : l'email est LIBRE,
      // une invitation ailleurs s'active (avant : « Account … already exists »).
      expect(await connexionCreatrice()).toBe(false);
      const { token: tokenAilleurs } = await convex.mutation(
        api.creators.inviteCreator,
        { name: `[E2E_TEST] Edit Créatrice ${ts}`, email: emailCreatrice },
      );
      const ailleurs = await new ConvexHttpClient(convexUrl!).action(
        api.auth.signIn,
        {
          provider: "password",
          params: {
            email: emailCreatrice,
            password: "Autre-projet-2026!",
            flow: "signUp",
            inviteToken: tokenAilleurs,
          },
        },
      );
      expect(ailleurs.tokens?.token).toBeTruthy();

      // La purge en arrière-plan vide toutes les tables du projet.
      await expect
        .poll(
          () =>
            convex.mutation(api.projectLifecycle.e2eRemainingProjectRows, {
              secret: E2E_SECRET,
              projectId,
            }),
          { timeout: 30_000 },
        )
        .toEqual([]);
    } finally {
      // Filet si le test a cassé avant la suppression.
      await convex.mutation(api.projects.e2eDeleteProject, {
        secret: E2E_SECRET,
        slug,
      });
    }
  });
});
