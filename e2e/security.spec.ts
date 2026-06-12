import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient, adminPath } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

// P2 — un vrai projectId est requis pour que la validation d'args Convex passe
// (elle PRÉCÈDE le check d'auth). On le résout une fois ; l'appel anonyme est
// ensuite rejeté sur l'AUTH, pas sur la validation. Renseigné en beforeAll.
let projectId: Id<"projects">;
test.beforeAll(async () => {
  projectId = await createE2eClient(convexUrl).getProjectId();
});

/**
 * Remédiation sécurité — preuve du gating des fonctions Convex. Ces tests
 * utilisent volontairement un ConvexHttpClient ANONYME (pas createE2eClient)
 * pour simuler un attaquant qui n'a que NEXT_PUBLIC_CONVEX_URL (publique
 * dans le bundle JS). Avant cette remédiation, chacun de ces appels passait.
 */
test.describe("Gating Convex — client anonyme rejeté", () => {
  test("listPublications (lecture) → rejeté", async () => {
    const anon = new ConvexHttpClient(convexUrl);
    await expect(
      anon.query(api.publications.listPublications, { projectId }),
    ).rejects.toThrow(/Non authentifié/);
  });

  test("deletePublication (écriture destructive) → rejeté", async () => {
    // Un draft réel est créé avec le client AUTHENTIFIÉ pour passer la
    // validation d'args (v.id), puis la suppression est tentée en anonyme.
    const authed = createE2eClient(convexUrl);
    const carouselId = await authed.query(
      api.publications.getNextPublicationId,
      { mediaType: "carousel" },
    );
    const { ids } = await authed.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText: "Hook spec sécurité",
      mecanique: "Erreur",
      niveau: "Broad-A",
      format: "A",
      nbSlides: 2,
      slides: [
        { position: 1, texte: "slide 1" },
        { position: 2, texte: "slide 2" },
      ],
      angleTonal: "Psycho",
      langue: "FR",
      plateformes: ["TikTok"],
      compte: "compte_spec_securite",
      datePubli: Date.now(),
      notes: "[E2E_TEST] security spec",
    });

    const anon = new ConvexHttpClient(convexUrl);
    await expect(
      anon.mutation(api.publications.deletePublication, {
        id: ids[0],
        projectId,
      }),
    ).rejects.toThrow(/Non authentifié/);

    // La même suppression passe en authentifié (et nettoie le draft).
    await authed.mutation(api.publications.deletePublication, { id: ids[0] });
  });

  test("createCompte (écriture) → rejeté", async () => {
    const anon = new ConvexHttpClient(convexUrl);
    await expect(
      anon.mutation(api.comptes.createCompte, {
        projectId,
        handle: "intrus_anonyme",
        plateforme: "TikTok",
        notes: "[E2E_TEST] tentative anonyme",
      }),
    ).rejects.toThrow(/Non authentifié/);
  });

  test("generateUploadUrl (storage) → rejeté", async () => {
    const anon = new ConvexHttpClient(convexUrl);
    await expect(
      anon.mutation(api.storage.generateUploadUrl, {}),
    ).rejects.toThrow(/Non authentifié/);
  });

  test("clearHooks avec un secret invalide → rejeté (même authentifié)", async () => {
    const anon = new ConvexHttpClient(convexUrl);
    await expect(
      anon.mutation(api.hooks.clearHooks, {
        secret: "mauvais-secret",
        projectId,
      }),
    ).rejects.toThrow(/invalide|désactivées/);

    // Le secret est vérifié indépendamment de l'identité : un user connecté
    // avec un mauvais secret est rejeté pareil.
    const authed = createE2eClient(convexUrl);
    await expect(
      authed.mutation(api.hooks.clearHooks, {
        secret: "mauvais-secret",
        projectId,
      }),
    ).rejects.toThrow(/invalide|désactivées/);
  });
});

test.describe("Gating pages — proxy Next", () => {
  test("une page protégée sans session redirige vers /login", async ({
    browser,
  }) => {
    // Contexte SANS le storageState e2e → simule un visiteur anonyme.
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await page.goto(adminPath("/dashboard"));
    await page.waitForURL("**/login");
    await expect(
      page.getByRole("button", { name: "Se connecter" }),
    ).toBeVisible();
    await context.close();
  });
});
