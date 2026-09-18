import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { adminPath, createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
/** Le visiteur d'un lien public : AUCUNE session. */
const anonymous = new ConvexHttpClient(convexUrl);

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Partage public d'un dashboard — la preuve porte sur la RÉPONSE que reçoit un
 * visiteur sans compte, pas sur ce que la page choisit d'afficher.
 *
 * Données en forme de prod : noms complets, handles suffixés, URL TikTok qui
 * portent le @handle, vues non rondes.
 */
test.describe("Partage public du Tracker", () => {
  test("lien marque anonymisé, lien créatrice verrouillé, révocation", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const ts = Date.now();

    const fid = await createFormatWithRate(admin, {
      name: `[E2E_TEST] Share ${ts}`,
      type: "short",
      rateModel: { basePerPost: 50 },
    });

    async function publishedPostFor(
      name: string,
      slug: string,
      vues: number,
    ): Promise<{ creatorId: Id<"creators">; handle: string }> {
      const s = await createCreatorSession(convexUrl!, {
        name,
        email: `e2e-share-${slug}-${ts}@repackit.test`,
        password: `share-${slug}-12345`,
      });
      const handle = `${slug}.snytch_fr${ts}`;
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: s.creatorId,
        platform: "TikTok",
        handle: `@${handle}`,
      });
      await admin.mutation(api.assignments.assignFormat, {
        formatId: fid as Id<"formats">,
        creatorId: s.creatorId,
        targets: [target],
        postsPerCreator: 1,
        dueDate: ts + 7 * DAY,
      });
      const row = (await admin.query(api.assignments.listAssignments, {})).find(
        (a) => a.formatId === fid && a.creatorId === s.creatorId,
      )!;
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: row._id,
        status: "to_publish",
      });
      await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
        id: row._id,
        urls: [
          {
            platform: "TikTok",
            url: `https://www.tiktok.com/@${handle}/video/74${ts}`,
          },
        ],
      });
      const [post] = await admin.query(api.trackerData.listTrackerPosts, {
        creatorIds: [s.creatorId],
        warmup: "all",
      });
      expect(post, `post publié de ${name}`).toBeDefined();
      await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId: post._id,
        vues,
        likes: Math.round(vues * 0.071),
        comments: Math.round(vues * 0.0021),
        capturedAt: Date.now() + HOUR,
        source: "tiktok",
      });
      return { creatorId: s.creatorId, handle };
    }

    const kelly = await publishedPostFor(`[E2E_TEST] Kelly Martinez ${ts}`, "kelly", 41_237);
    const ines = await publishedPostFor(`[E2E_TEST] Inès Benali ${ts}`, "ines", 198_402);

    const perimeter = {
      period: { kind: "rolling" as const, days: 30 },
      creatorIds: [kelly.creatorId, ines.creatorId],
      warmup: "all" as const,
    };

    // ── Lien MARQUE, créatrices anonymisées, sans liens vers les posts ──────
    const brand = await admin.mutation(api.publicShares.createShare, {
      name: `[E2E_TEST] Rapport marque ${ts}`,
      audience: "brand",
      perimeter,
      blocks: ["kpi_views", "kpi_engagement", "by_creator", "posts", "quadrant"],
      showCreatorNames: false,
      postLinks: false,
      expiresInDays: 30,
    });
    expect(brand.token).toMatch(/^[0-9A-Za-z]{22}$/);

    const pub = await anonymous.query(api.publicShares.getPublicShare, {
      token: brand.token,
    });
    expect(pub.status).toBe("valid");
    if (pub.status !== "valid") return;
    // PRÉSENCE : les deux posts sont là, avec leurs vraies vues.
    expect(pub.view.postCount).toBe(2);
    expect(pub.view.kpi?.views).toBe(41_237 + 198_402);
    expect(pub.view.byCreator?.map((r) => r.creator)).toEqual([
      { kind: "anonymous", index: 0 },
      { kind: "anonymous", index: 1 },
    ]);
    // ABSENCE : ni nom, ni handle, ni URL, ni bloc décoché, ni quadrant.
    const raw = JSON.stringify(pub);
    for (const secret of ["Kelly", "Martinez", "Inès", "Benali", kelly.handle, ines.handle, "tiktok.com"]) {
      expect(raw, secret).not.toContain(secret);
    }
    expect(pub.blocks).not.toContain("quadrant");
    expect(pub.view.kpi).not.toHaveProperty("likes");
    expect(pub.view.byPlatform).toBeNull();

    // ── La page, ouverte SANS session ────────────────────────────────────
    // Session VIDE, explicitement : un contexte ouvert dans un test hérite des
    // options du projet — storageState compris. Sans cette ligne, le
    // « visiteur » est l'admin connecté, et le test passe même si la route
    // /s/ exige une session (vu à la contre-épreuve).
    const visitor = await browser.newContext({
      locale: "fr-FR",
      storageState: { cookies: [], origins: [] },
    });
    const vpage = await visitor.newPage();
    await vpage.goto(`/s/${brand.token}`);
    await expect(
      vpage.getByRole("heading", { name: `[E2E_TEST] Rapport marque ${ts}` }),
    ).toBeVisible();
    await expect(vpage.getByText("Créatrice A").first()).toBeVisible();
    await expect(vpage.getByText("Propulsé par Jarvia")).toBeVisible();
    await expect(vpage.getByText("Kelly")).toHaveCount(0);
    // L'aperçu de lien (WhatsApp, Slack) : balise posée ET image servie sans session.
    await expect(vpage.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      new RegExp(`/s/${brand.token}/opengraph-image`),
    );
    const og = await visitor.request.get(`/s/${brand.token}/opengraph-image`);
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toBe("image/png");

    // ── Lien CRÉATRICE : verrouillé sur elle, même avec un périmètre large ──
    const forKelly = await admin.mutation(api.publicShares.createShare, {
      name: `[E2E_TEST] Tes performances ${ts}`,
      audience: "creator",
      creatorId: kelly.creatorId,
      perimeter, // contient Inès : doit être ignoré
      blocks: ["kpi_views", "by_creator", "posts"],
      showCreatorNames: true,
      postLinks: true,
    });
    const mine = await anonymous.query(api.publicShares.getPublicShare, {
      token: forKelly.token,
    });
    expect(mine.status).toBe("valid");
    if (mine.status !== "valid") return;
    expect(mine.view.postCount).toBe(1);
    expect(mine.view.kpi?.views).toBe(41_237);
    expect(mine.view.byCreator).toBeNull();
    expect(mine.view.posts?.[0].url).toContain(kelly.handle);
    expect(JSON.stringify(mine)).not.toContain(ines.handle);

    // ── Révocation : même réponse qu'un lien qui n'a jamais existé ─────────
    const shares = await admin.query(api.publicShares.listShares, {});
    const brandRow = shares.find((s) => s.token === brand.token)!;
    expect(brandRow.active).toBe(true);
    await admin.mutation(api.publicShares.revokeShare, { shareId: brandRow._id });
    expect(
      await anonymous.query(api.publicShares.getPublicShare, { token: brand.token }),
    ).toEqual({ status: "invalid" });
    expect(
      await anonymous.query(api.publicShares.getPublicShare, {
        token: "AAAAAAAAAAAAAAAAAAAAAA",
      }),
    ).toEqual({ status: "invalid" });
    // La page ouverte passe d'elle-même sur l'écran « plus disponible ».
    await expect(vpage.getByText("Ce lien n'est plus disponible")).toBeVisible();
    await visitor.close();

    // ── Le mode partage, côté équipe ────────────────────────────────────
    await page.goto(adminPath("/dashboard"));
    await page.getByRole("radio", { name: "Tracker" }).click();
    await page.getByRole("button", { name: "Partager" }).click();
    await expect(page.getByTestId("share-mode")).toBeVisible();
    const postsBlock = page.locator('[data-share-block="posts"]');
    await expect(postsBlock).toHaveAttribute("data-share-on", "true");
    await postsBlock.getByRole("button", { name: /Cacher ce bloc/ }).click();
    await expect(postsBlock).toHaveAttribute("data-share-on", "false");
    await expect(page.getByTestId("share-recap")).toContainText("Aucun montant");
  });
});
