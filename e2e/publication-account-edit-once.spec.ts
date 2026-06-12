import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

async function ensureCompte(handle: string) {
  const comptes = await convex.query(api.comptes.listComptes, {});
  const existing = comptes.find(
    (c) => c.handle === handle && c.plateforme === "TikTok",
  );
  if (existing && !existing.actif) {
    await convex.mutation(api.comptes.updateCompte, {
      id: existing._id,
      actif: true,
    });
  }
  if (!existing) {
    await convex.mutation(api.comptes.createCompte, {
      handle,
      plateforme: "TikTok",
      notes: `${E2E_MARKER} acct edit`,
    });
  }
}

/**
 * Modification du compte d'une publication publiée — autorisée 1 seule fois.
 */
test.describe("Publication — modification compte (1 fois)", () => {
  test("publié → Modifier compte → Modifié (lecture seule ensuite)", async ({
    page,
  }) => {
    const ts = Date.now();
    const compte1 = "@e2e_acct1";
    const compte2 = "@e2e_acct2";
    await ensureCompte(compte1);
    await ensureCompte(compte2);

    const cid = await convex.query(api.publications.getNextPublicationId, {
      mediaType: "carousel",
    });
    const { ids } = await convex.mutation(
      api.publications.createPublication,
      {
        carouselId: cid,
        hookId: null,
        hookText: `${E2E_MARKER} acct ${ts}`,
        mecanique: "Erreur",
        niveau: "Broad-A",
        angleTonal: "Psycho",
        langue: "FR",
        mediaType: "carousel",
        format: "A",
        nbSlides: 5,
        slides: Array.from({ length: 5 }, (_, i) => ({
          position: i + 1,
          texte: "x",
        })),
        plateformes: ["TikTok"],
        compte: compte1,
        datePubli: ts,
        notes: `${E2E_MARKER} acct`,
      },
    );
    // Publier (postUrl) pour activer la modification de compte.
    await convex.mutation(api.publications.updateMetrics, {
      id: ids[0],
      postUrl: "https://www.tiktok.com/@x/video/1e2e",
    });

    async function openDetail() {
      await page.goto(`/carrousels?carouselId=${cid}`);
      const row = page.getByRole("row").filter({ hasText: cid });
      await expect(row).toBeVisible({ timeout: 5000 });
      await row.getByRole("button").last().click();
      await page.getByRole("menuitem", { name: /voir détail/i }).click();
      return page.getByRole("dialog", { name: new RegExp(cid) });
    }

    // 1er passage : compte1 + bouton Modifier.
    const dialog = await openDetail();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(compte1)).toBeVisible();
    await dialog.getByRole("button", { name: "Modifier", exact: true }).click();

    const sub = page.getByRole("dialog", { name: /modifier le compte/i });
    await expect(sub).toBeVisible();
    await sub.getByRole("combobox").click();
    await page.getByRole("option", { name: /e2e_acct2/i }).click();
    await sub.getByRole("button", { name: /^confirmer$/i }).click();
    await expect(sub).not.toBeVisible({ timeout: 5000 });

    // 2e passage (reload) : compte2 + badge Modifié + pas de bouton Modifier.
    const dialog2 = await openDetail();
    await expect(dialog2).toBeVisible();
    await expect(dialog2.getByText(compte2)).toBeVisible();
    await expect(dialog2.getByText(/^modifié$/i)).toBeVisible();
    await expect(
      dialog2.getByRole("button", { name: "Modifier", exact: true }),
    ).toHaveCount(0);

    // Cleanup
    await convex.mutation(api.publications.deletePublication, { id: ids[0] });
  });
});
