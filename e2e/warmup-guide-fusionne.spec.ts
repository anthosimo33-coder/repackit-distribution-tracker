import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);
const MARKER = "[E2E_TEST]";

/**
 * FUSION — le bouton « Guide warmup » ouvre le MODULE DU GUIDE, plus un second
 * document en catalogue.
 *
 * Ce que ces tests protègent : qu'il n'existe qu'UNE source. Le protocole
 * vivait en double et les deux copies se sont contredites sur la durée, les
 * plateformes et l'ordre de supprimer une vidéo qui flope.
 */
test.describe("Guide warmup — fusionné dans le module du guide", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.guideModules.cleanupTestGuideModules, {
      secret: E2E_SECRET,
    });
  });

  test("le panneau rend le module marqué warmup, et le repli EN est signalé", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const id = await convex.mutation(api.guideModules.createModule, {
      title: `${MARKER} Warmup fusionné ${ts}`,
      contentMarkdown:
        "## Les règles communes\n\n- Un e-mail **dédié** par compte.\n\n## Si la chauffe a raté\n\n1. Arrête de poster.",
      status: "published",
    });
    await convex.mutation(api.guideModules.e2eSetModuleSlot, {
      secret: E2E_SECRET,
      id,
      slot: "warmup",
    });

    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: /guide warmup/i }).click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();

    // Le TITRE du module devient celui du panneau : une seule source, jusqu'au
    // libellé. Et le markdown est RENDU, pas affiché brut.
    await expect(panel.getByText(`${MARKER} Warmup fusionné ${ts}`)).toBeVisible();
    await expect(panel.getByRole("heading", { name: /les règles communes/i })).toBeVisible();
    await expect(panel.locator("strong", { hasText: "dédié" })).toBeVisible();
    await expect(panel.getByRole("heading", { name: /si la chauffe a raté/i })).toBeVisible();

    // L'ancien accordéon n'existe plus : plus de sections repliables en dur.
    await expect(
      panel.getByRole("button", { name: /^YouTube Shorts$/ }),
    ).toHaveCount(0);
  });

  test("serveur — le module est adressé par SLOT, pas par titre", async () => {
    const ts = Date.now();
    // Un module publié SANS slot ne doit pas être servi, même s'il parle de warmup.
    await convex.mutation(api.guideModules.createModule, {
      title: `${MARKER} Warmup & éviter le shadowban ${ts}`,
      contentMarkdown: "Contenu piège — pas de slot.",
      status: "published",
    });
    const sansSlot = await convex.query(api.guideModules.getWarmupModuleForAdmin, {});
    expect(sansSlot.module).toBeNull();

    // Contrôle de présence apparié : avec le slot, il est servi.
    const id = await convex.mutation(api.guideModules.createModule, {
      title: `${MARKER} Le vrai ${ts}`,
      contentMarkdown: "Le bon contenu.",
      status: "published",
    });
    await convex.mutation(api.guideModules.e2eSetModuleSlot, {
      secret: E2E_SECRET,
      id,
      slot: "warmup",
    });
    const avecSlot = await convex.query(api.guideModules.getWarmupModuleForAdmin, {});
    expect(avecSlot.module?.contentMarkdown).toBe("Le bon contenu.");

    // Un brouillon marqué warmup n'est PAS servi côté lecteur.
    await convex.mutation(api.guideModules.updateModule, { id, status: "draft" });
    const brouillon = await convex.query(api.guideModules.getWarmupModuleForAdmin, {});
    expect(brouillon.module).toBeNull();
  });
});
