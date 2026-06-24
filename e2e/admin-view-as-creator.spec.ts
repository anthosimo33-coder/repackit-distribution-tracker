import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import {
  createE2eClient,
  E2E_SECRET,
  E2E_EMAIL,
} from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * Admin « voir l'espace d'un créateur » (LECTURE SEULE, scopé projet) — preuve
 * SERVEUR du contrôle d'accès des queries view-as (adminViewAsQuery) :
 *   - un admin lit les écrans du créateur de SON projet (données servies) ;
 *   - un créateur d'un AUTRE projet est REFUSÉ (admin non-membre du projet B) ;
 *   - un creatorId hors projet (passé avec un autre projectId) ne renvoie RIEN
 *     (« introuvable dans ce projet » — pas de fuite cross-projet) ;
 *   - le superadmin voit partout ;
 *   - une session CRÉATEUR est rejetée du chemin admin view-as (requireProjectAdmin).
 * Le mode est en lecture seule par construction : il n'existe AUCUNE mutation
 * view-as (aucune n'est testée car aucune n'est exposée).
 */
test.describe("Admin — voir l'espace d'un créateur (lecture seule, scopé projet)", () => {
  test("admin lit son créateur ; cross-projet et hors-projet refusés ; superadmin partout", async () => {
    const ts = Date.now();
    const projectA = await convex.getProjectId();

    // Créateur du projet A (e2e).
    const nameA = `[E2E_TEST] ViewAs A ${ts}`;
    const { creatorId: creatorA } = await convex.mutation(
      api.creators.inviteCreator,
      { name: nameA, email: `e2e-viewas-a-${ts}@repackit.test` },
    );

    // 2e projet + créateur du projet B (le user e2e est superadmin → crée partout).
    const slugB = `e2e-viewas-${ts}`;
    const { projectId: projectB } = await convex.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug: slugB, name: `ViewAs B ${ts}` },
    );
    const { creatorId: creatorB } = await convex.mutation(
      api.creators.inviteCreator,
      {
        projectId: projectB,
        name: `[E2E_TEST] ViewAs B ${ts}`,
        email: `e2e-viewas-b-${ts}@repackit.test`,
      },
    );

    // --- Queries view-as RÉELLES (session superadmin e2e), projectId injecté = A ---
    // Profil du créateur ciblé de A → données servies.
    const profileA = await convex.query(api.creators.getProfileAsAdmin, {
      creatorId: creatorA,
    });
    expect(profileA?.name).toBe(nameA);
    // Les autres écrans répondent sans erreur (créateur neuf → vides).
    expect(
      await convex.query(api.comptes.listComptesAsAdmin, { creatorId: creatorA }),
    ).toEqual([]);
    expect(
      await convex.query(api.payments.getPaymentsAsAdmin, {
        creatorId: creatorA,
      }),
    ).toEqual([]);
    expect(
      await convex.query(api.assignments.listAssignmentsAsAdmin, {
        creatorId: creatorA,
      }),
    ).toEqual([]);

    // creatorId du projet B passé avec le projet A (injection) → REFUSÉ serveur,
    // même pour le superadmin : le créateur n'appartient pas à CE projet.
    await expect(
      convex.query(api.creators.getProfileAsAdmin, { creatorId: creatorB }),
    ).rejects.toThrow(/introuvable dans ce projet/i);

    // --- Scoping par RÔLE (admin NON-superadmin de A) via assertion serveur ---
    const adminAEmail = `e2e-viewas-admin-a-${ts}@repackit.test`;
    await convex.mutation(api.projects.e2eEnsureMemberUser, {
      secret: E2E_SECRET,
      email: adminAEmail,
      projectId: projectA,
      role: "admin",
    });

    // admin de A → voit le créateur de A.
    const ownProject = await convex.mutation(
      api.creators.e2eAssertViewAsAccess,
      {
        secret: E2E_SECRET,
        email: adminAEmail,
        projectId: projectA,
        creatorId: creatorA,
      },
    );
    expect(ownProject.allowed).toBe(true);

    // admin de A → NE voit PAS le créateur du projet B (pas admin de B).
    const crossProject = await convex.mutation(
      api.creators.e2eAssertViewAsAccess,
      {
        secret: E2E_SECRET,
        email: adminAEmail,
        projectId: projectB,
        creatorId: creatorB,
      },
    );
    expect(crossProject.allowed).toBe(false);
    expect(crossProject.error).toMatch(/administrateur|refusé/i);

    // admin de A → creatorId de B passé avec le projet A → introuvable (no leak).
    const foreignCreator = await convex.mutation(
      api.creators.e2eAssertViewAsAccess,
      {
        secret: E2E_SECRET,
        email: adminAEmail,
        projectId: projectA,
        creatorId: creatorB,
      },
    );
    expect(foreignCreator.allowed).toBe(false);
    expect(foreignCreator.error).toMatch(/introuvable/i);

    // superadmin (user e2e) → voit partout (créateur du projet B).
    const superViewB = await convex.mutation(
      api.creators.e2eAssertViewAsAccess,
      {
        secret: E2E_SECRET,
        email: E2E_EMAIL,
        projectId: projectB,
        creatorId: creatorB,
      },
    );
    expect(superViewB.allowed).toBe(true);

    await convex.mutation(api.projects.e2eDeleteProject, {
      secret: E2E_SECRET,
      slug: slugB,
    });
  });

  test("une session créateur est refusée des queries view-as", async () => {
    const ts = Date.now();
    const projectA = await convex.getProjectId();
    const email = `e2e-viewas-creator-${ts}@repackit.test`;
    const password = "viewas-creator-12345";
    const { creatorId, token } = await convex.mutation(
      api.creators.inviteCreator,
      { name: `[E2E_TEST] ViewAs Creator ${ts}`, email },
    );

    // signUp via le token → session creator réelle.
    const creatorClient = new ConvexHttpClient(convexUrl);
    const res = await creatorClient.action(api.auth.signIn, {
      provider: "password",
      params: { email, password, flow: "signUp", inviteToken: token },
    });
    const sessionToken = res.tokens?.token;
    expect(sessionToken).toBeTruthy();
    creatorClient.setAuth(sessionToken!);

    // Même un créateur de CE projet ne peut pas emprunter le chemin admin view-as
    // (requireProjectAdmin rejette le rôle creator).
    await expect(
      creatorClient.query(api.creators.getProfileAsAdmin, {
        projectId: projectA,
        creatorId,
      }),
    ).rejects.toThrow(/administrateur|refusé/i);
    await expect(
      creatorClient.query(api.comptes.listComptesAsAdmin, {
        projectId: projectA,
        creatorId,
      }),
    ).rejects.toThrow(/administrateur|refusé/i);
  });
});
