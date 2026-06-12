import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * P1 Créateurs — preuve SERVEUR (pas seulement UI) que le rôle creator n'a
 * accès à RIEN de l'app interne : un creator connecté (session réelle obtenue
 * via le signUp du flow d'invitation) est rejeté de tout adminQuery /
 * adminMutation par la garde requireProjectAdmin.
 */
test.describe("Créateurs — garde rôle serveur", () => {
  test("un creator connecté est rejeté des adminQuery/adminMutation", async () => {
    const ts = Date.now();
    const name = `[E2E_TEST] Guard ${ts}`;
    const email = `e2e-creator-guard-${ts}@repackit.test`;
    const password = "creator-guard-12345";

    const projectId = await convex.getProjectId();
    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name,
      email,
    });

    // signUp via le token → session creator réelle.
    const creatorClient = new ConvexHttpClient(convexUrl);
    const res = await creatorClient.action(api.auth.signIn, {
      provider: "password",
      params: { email, password, flow: "signUp", inviteToken: token },
    });
    const sessionToken = res.tokens?.token;
    expect(sessionToken).toBeTruthy();
    creatorClient.setAuth(sessionToken!);

    // adminQuery (lecture) d'un module métier → rejeté.
    await expect(
      creatorClient.query(api.comptes.listComptes, { projectId }),
    ).rejects.toThrow(/administrateur|refusé/i);

    // adminQuery du module créateurs lui-même → rejeté.
    await expect(
      creatorClient.query(api.creators.listCreators, { projectId }),
    ).rejects.toThrow(/administrateur|refusé/i);

    // adminMutation (écriture) → rejeté.
    await expect(
      creatorClient.mutation(api.creators.inviteCreator, {
        projectId,
        name: `[E2E_TEST] intrus ${ts}`,
        email: `e2e-creator-intrus-${ts}@repackit.test`,
      }),
    ).rejects.toThrow(/administrateur|refusé/i);
  });

  // Garde directe (sans session), miroir du test d'isolation : un membership
  // "creator" est refusé par requireProjectAdmin alors qu'un "admin" passe.
  test("requireProjectAdmin : creator refusé, admin autorisé", async () => {
    const ts = Date.now();
    const { projectId } = await convex.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug: `e2e-role-${ts}`, name: `Role ${ts}` },
    );
    const creatorEmail = `e2e-creator-role-${ts}@repackit.test`;
    const adminEmail = `e2e-admin-role-${ts}@repackit.test`;
    await convex.mutation(api.projects.e2eEnsureMemberUser, {
      secret: E2E_SECRET,
      email: creatorEmail,
      projectId,
      role: "creator",
    });
    await convex.mutation(api.projects.e2eEnsureMemberUser, {
      secret: E2E_SECRET,
      email: adminEmail,
      projectId,
      role: "admin",
    });

    const asCreator = await convex.mutation(api.creators.e2eAssertAdminAccess, {
      secret: E2E_SECRET,
      email: creatorEmail,
      projectId,
    });
    const asAdmin = await convex.mutation(api.creators.e2eAssertAdminAccess, {
      secret: E2E_SECRET,
      email: adminEmail,
      projectId,
    });

    expect(asCreator.allowed).toBe(false);
    expect(asCreator.error).toMatch(/administrateur/i);
    expect(asAdmin.allowed).toBe(true);

    await convex.mutation(api.projects.e2eDeleteProject, {
      secret: E2E_SECRET,
      slug: `e2e-role-${ts}`,
    });
  });
});
