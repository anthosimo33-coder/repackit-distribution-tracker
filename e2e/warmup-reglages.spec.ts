import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

/**
 * RÉGLAGE DES DURÉES DE WARMUP par l'admin.
 *
 * Le point du chantier : la durée est une règle PRODUIT, elle doit se changer
 * sans PR. Et un champ VIDE doit vouloir dire « ce projet n'utilise pas cette
 * plateforme », pas « zéro jour » — c'est la distinction que l'écran doit tenir.
 */
test.describe("Réglages — durée de warmup du projet", () => {
  test.afterEach(async () => {
    // Le projet e2e est PARTAGÉ : on le rend au barème par défaut, sinon les
    // specs de warmup qui suivent verraient une cible qu'elles n'attendent pas.
    const projectId = await convex.getProjectId();
    await convex.mutation(api.comptes.e2eSetProjectWarmupDays, {
      secret: E2E_SECRET,
      projectId,
      tiktok: 7,
      instagram: 14,
      youtube: 7,
    });
  });

  test("régler 3 jours, puis vider un champ = « non défini »", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: /durées de warmup/i }).click();

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(
      panel.getByText(/ne change que les chauffes à venir/i),
    ).toBeVisible();

    // Régler TikTok et Instagram à 3, laisser YouTube vide (hors périmètre).
    await panel.getByLabel("TikTok").fill("3");
    await panel.getByLabel("Instagram").fill("3");
    await panel.getByLabel("YouTube").fill("");
    await panel.getByRole("button", { name: /enregistrer/i }).click();
    await expect(page.getByText(/durées de warmup enregistrées/i)).toBeVisible({
      timeout: 10_000,
    });

    // Le serveur a bien retenu 3/3 ET l'absence de YouTube.
    const saved = await convex.query(api.projects.getWarmupSettings, {});
    expect(saved.defined.tiktok).toBe(3);
    expect(saved.defined.instagram).toBe(3);
    expect(saved.defined.youtube).toBeNull();
    // Un champ vide n'est PAS zéro : la plateforme prend le défaut.
    expect(saved.effective.youtube).toBe(7);

    // Un compte créé maintenant prend 3 — la règle vaut vraiment.
    const id = await convex.mutation(api.comptes.createCompte, {
      handle: `[E2E_TEST]_reglage_${Date.now()}`,
      plateforme: "TikTok",
      status: "warmup",
      warmupStartedAt: Date.now(),
      notes: "",
    });
    const rows = await convex.query(api.comptes.listComptes, {});
    expect(rows.find((r) => String(r._id) === String(id))?.targetDays).toBe(3);
  });

  test("une durée hors bornes est REFUSÉE côté serveur", async () => {
    // La garde n'est pas qu'un `min` d'input : l'écran n'est pas la barrière.
    await expect(
      convex.mutation(api.projects.setWarmupSettings, {
        tiktok: 0,
        instagram: null,
        youtube: null,
      }),
    ).rejects.toThrow(/invalide/i);
    await expect(
      convex.mutation(api.projects.setWarmupSettings, {
        tiktok: 999,
        instagram: null,
        youtube: null,
      }),
    ).rejects.toThrow(/invalide/i);
    // Contrôle de présence : une valeur licite passe.
    await expect(
      convex.mutation(api.projects.setWarmupSettings, {
        tiktok: 5,
        instagram: null,
        youtube: null,
      }),
    ).resolves.toEqual({ updated: true });
  });
});
