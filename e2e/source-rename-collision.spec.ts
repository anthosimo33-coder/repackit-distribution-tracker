import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

/** Texte d'erreur d'un rejet ConvexError (data string OU message). */
function errText(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { data?: unknown; message?: unknown };
    const data = typeof o.data === "string" ? o.data : "";
    const msg = typeof o.message === "string" ? o.message : "";
    return `${data} ${msg}`;
  }
  return String(e);
}

/**
 * Collision au rename : renommer A vers un nom B déjà posté sur la MÊME
 * plateforme est bloqué — côté UI (preview rouge + bouton désactivé) ET côté
 * serveur (ConvexError, aucun override possible). A reste inchangé en DB.
 */
test.describe("Source rename — collision bloquante", () => {
  test.beforeEach(async () => {
    await convex.mutation(api.icps.cleanupTestIcps, { secret: E2E_SECRET });
  });

  test("rename vers un nom déjà utilisé sur la même plateforme → bloqué", async ({
    page,
  }) => {
    const ts = Date.now();
    const srcA = `collision_a_${ts}`;
    const srcB = `collision_b_${ts}`;
    const icpId = await convex.mutation(api.icps.createIcp, {
      nom: `${E2E_MARKER} coll ${ts}`,
    });
    const base = {
      hookId: null,
      hookText: `${E2E_MARKER} hook ${ts}`,
      mecanique: "Erreur" as const,
      niveau: "Broad-A" as const,
      angleTonal: "Psycho" as const,
      langue: "FR" as const,
      mediaType: "short" as const,
      icpId,
      datePubli: ts,
      notes: `${E2E_MARKER} collision`,
    };
    // A et B sur TikTok (comptes différents), sourceId distincts → OK au create.
    await convex.mutation(api.publications.createPublication, {
      ...base,
      carouselId: `E2ECOLA${ts}`,
      plateformes: ["TikTok"],
      compte: "@e2e_coll_a",
      sourceId: srcA,
    });
    await convex.mutation(api.publications.createPublication, {
      ...base,
      carouselId: `E2ECOLB${ts}`,
      plateformes: ["TikTok"],
      compte: "@e2e_coll_b",
      sourceId: srcB,
    });

    await page.goto("/shorts/sources");
    await page
      .getByRole("button", { name: `Renommer la source ${srcA}` })
      .click();

    const dialog = page.getByRole("dialog", { name: /renommer la source/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nouveau nom").fill(srcB);

    // Garde-fou UI : preview rouge + bouton désactivé (pas d'override possible).
    await expect(dialog.getByText(/conflit potentiel/i)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /confirmer le renommage/i }),
    ).toBeDisabled();

    // Garde-fou serveur : la mutation rejette explicitement (backstop).
    let err: unknown = null;
    try {
      await convex.mutation(api.publications.renameSourceId, {
        oldSourceId: srcA,
        newSourceId: srcB,
      });
    } catch (e) {
      err = e;
    }
    expect(err).not.toBeNull();
    expect(errText(err)).toMatch(/Renommage impossible/i);

    // A inchangé en DB (toujours présent sur TikTok sous son nom d'origine).
    const sources = await convex.query(api.publications.listSources, {});
    const entryA = sources.find((s) => s.sourceId === srcA);
    expect(entryA).toBeTruthy();
    expect(entryA?.coverage.tiktok).toBe(true);
  });
});
