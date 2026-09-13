import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createFormatWithRate } from "./helpers/formats";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const RATE = { basePerPost: 50, viewBonusPer1k: 2, bounties: [] };

/**
 * FAIRE RESSENTIR CHAQUE RÉUSSITE — ce qu'on peut prouver dans un navigateur.
 *
 *  - Au retour sur la mission, le lien de la vidéo trouvé dans le presse-papiers
 *    est PROPOSÉ (« C'est ce lien ? »), et jamais un lien d'une autre plateforme.
 *  - « Coller » remplit le champ en un geste.
 *  - Publier déclenche la célébration, SANS masquer la confirmation : ce n'est
 *    pas une modale.
 *  - Le manifeste de l'app installable est servi sans session.
 *
 * Les vues d'hier et la série reposent sur des relevés et des dates réelles :
 * leur calcul est couvert en vitest (lib/views-pulse, lib/on-time-streak).
 */
test.describe("Espace créatrice — réussites", () => {
  test("le lien du presse-papiers est proposé, collé, et la publication se célèbre", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const handle = `@e2ereussite${ts}`;
    const fid = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Réussite ${ts}`,
      type: "short",
      rateModel: RATE,
    });
    const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Camille Roux-Diallo ${ts}`,
      email: `e2e-creator-reussite-${ts}@repackit.test`,
    });
    // Presse-papiers autorisé pour l'origine : c'est l'état d'une créatrice qui
    // a déjà touché « Coller » une fois.
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill("creator-reussite-12345");
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/app", { timeout: 20_000 });

    const target = await availableTarget({
      e2eClient: admin,
      creatorId,
      platform: "TikTok",
      handle,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid as Id<"formats">,
      creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 5 * 86_400_000,
    });
    const aid = (await admin.query(api.assignments.listAssignments, {})).find(
      (a) => a.formatId === fid,
    )!._id;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: aid,
      status: "to_publish",
    });

    await page.goto(`/app/assignments/${aid}`);
    const champ = page.getByLabel(/Publie sur TikTok/);
    await expect(champ).toBeVisible({ timeout: 15_000 });
    const suggestion = page.getByTestId("clip-suggest-TikTok");
    const retour = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));

    // ── Un lien INSTAGRAM dans le presse-papiers : rien n'est proposé.
    await page.evaluate(
      (u) => navigator.clipboard.writeText(u),
      "Regarde ! https://www.instagram.com/reel/C9xYz12AbCd/?igsh=MWx0c2l",
    );
    await retour();
    await page.waitForTimeout(800);
    await expect(suggestion).toHaveCount(0);

    // ── Le lien TIKTOK de sa vidéo, noyé dans un texte de partage : proposé, propre.
    const lien = `https://www.tiktok.com/${handle}/video/7412345678901234567`;
    await page.evaluate(
      (u) => navigator.clipboard.writeText(u),
      `Ma nouvelle vidéo ${lien}?is_from_webapp=1. #snytch`,
    );
    await retour();
    await expect(suggestion).toBeVisible({ timeout: 10_000 });
    await expect(suggestion).toContainText(lien);
    await suggestion.click();
    await expect(champ).toHaveValue(`${lien}?is_from_webapp=1`);
    // Champ rempli : la suggestion s'efface.
    await expect(suggestion).toHaveCount(0);

    // ── « Coller » remplit aussi le champ, en un geste.
    await champ.fill("");
    await page.getByTestId("paste-url-TikTok").click();
    await expect(champ).toHaveValue(`${lien}?is_from_webapp=1`);

    // ── Publier : la célébration arrive, et la confirmation reste lisible.
    await page.getByRole("button", { name: /confirmer la publication/i }).click();
    const fete = page.getByTestId("celebration");
    await expect(fete).toBeVisible({ timeout: 15_000 });
    await expect(fete).toHaveAttribute("data-kind", "published");
    await expect(fete).toContainText(`[E2E_TEST] Réussite ${ts}`);
    await expect(page.getByText("Publié ✓", { exact: true })).toBeVisible();

    const apres = await admin.query(api.assignments.listAssignments, {});
    expect(apres.find((a) => a._id === aid)?.status).toBe("published");

    await ctx.close();
  });

  test("le manifeste de l'app installable est servi sans session", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const res = await ctx.request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest.start_url).toBe("/app");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(["192x192", "512x512"]);
    for (const i of manifest.icons as { src: string }[]) {
      const icon = await ctx.request.get(i.src);
      expect(icon.status()).toBe(200);
      expect(icon.headers()["content-type"]).toContain("image/png");
    }
    await ctx.close();
  });
});
