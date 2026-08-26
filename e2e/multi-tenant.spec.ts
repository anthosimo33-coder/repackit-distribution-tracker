import { test, expect } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

const SLIDES = [
  { position: 1, texte: "[E2E_TEST] slide 1" },
  { position: 2, texte: "[E2E_TEST] slide 2" },
];

/**
 * P2 Multi-tenant — preuves des invariants A2 (compteur d'IDs par projet) et
 * de l'isolation inter-projets (membership requis). N'utilise PAS l'UI :
 * exerce directement la couche Convex via le client e2e authentifié (le user
 * e2e est superadmin → il peut viser plusieurs projets explicitement).
 */
test.describe("Multi-tenant — isolation projet", () => {
  test("compteur d'IDs par projet : un 2e projet repart à C001", async () => {
    const convex = createE2eClient(convexUrl);

    // Deux projets isolés A et B.
    const { projectId: projA } = await convex.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug: "e2e-idcounter-a", name: "ID Counter A" },
    );
    const { projectId: projB } = await convex.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug: "e2e-idcounter-b", name: "ID Counter B" },
    );

    // On crée une publication dans A (→ C001 dans A).
    const nextA = await convex.query(api.publications.getNextPublicationId, {
      projectId: projA,
      mediaType: "carousel",
    });
    const created = await convex.mutation(
      api.publications.createPublication,
      {
        projectId: projA,
        carouselId: nextA,
        hookId: null,
        hookText: "[E2E_TEST] idcounter A",
        mecanique: "Erreur",
        niveau: "Broad-A",
        format: "A",
        nbSlides: 2,
        slides: SLIDES,
        angleTonal: "Psycho",
        langue: "FR",
        plateformes: ["TikTok"],
        compte: "@e2e_idcounter",
        datePubli: Date.now(),
        notes: "[E2E_TEST] idcounter A",
      },
    );

    // A a maintenant C001. Le compteur de B est INDÉPENDANT → toujours C001
    // (un compteur global donnerait C002).
    const nextB = await convex.query(api.publications.getNextPublicationId, {
      projectId: projB,
      mediaType: "carousel",
    });
    expect(nextA).toBe("C001");
    expect(nextB).toBe("C001");

    // Cleanup de la pub créée.
    await convex.mutation(api.publications.deletePublication, {
      projectId: projA,
      id: created.ids[0],
    });
  });

  test("un membre du projet A est REFUSÉ sur le projet B", async () => {
    const convex = createE2eClient(convexUrl);

    const { projectId: projA } = await convex.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug: "e2e-iso-a", name: "Iso A" },
    );
    const { projectId: projB } = await convex.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug: "e2e-iso-b", name: "Iso B" },
    );

    // User NON-superadmin (role member) membre de A uniquement.
    const memberEmail = "e2e-member-iso@repackit.test";
    await convex.mutation(api.projects.e2eEnsureMemberUser, {
      secret: E2E_SECRET,
      email: memberEmail,
      projectId: projA,
      role: "creator",
    });

    // Accès à A : autorisé (membership). Accès à B : refusé (pas membre, pas
    // superadmin) — c'est la garde requireProjectAccess.
    const onA = await convex.mutation(api.projects.e2eAssertAccess, {
      secret: E2E_SECRET,
      email: memberEmail,
      projectId: projA,
    });
    const onB = await convex.mutation(api.projects.e2eAssertAccess, {
      secret: E2E_SECRET,
      email: memberEmail,
      projectId: projB,
    });

    expect(onA.allowed).toBe(true);
    expect(onB.allowed).toBe(false);
    expect(onB.error).toMatch(/ERR_PROJECT_ACCESS_DENIED/);
  });
});
