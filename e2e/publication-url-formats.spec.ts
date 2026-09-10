import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const RATE = {
  basePerPost: 50,
  viewBonusPer1k: 2,
  bounties: [{ thresholdViews: 100_000, amount: 100 }],
};

/**
 * FORMES D'URL ACCEPTÉES / REFUSÉES À LA CONFIRMATION DE PUBLICATION.
 *
 * Le 2026-09-03, des créatrices ne pouvaient plus déclarer leur publication :
 * « Copier le lien » de l'app TikTok iOS rend `tiktok.com/t/<code>`, refusé par
 * une garde CLIENT plus stricte que le serveur. Ce fichier verrouille les deux
 * bords de la règle arbitrée (cf convex/postUrlShape.ts) :
 *   - un format d'URL de post PASSE, même court, même inhabituel ;
 *   - un lien de PROFIL et un hôte qui IMITE le domaine sont REFUSÉS.
 *
 * Les deux refus sont appariés à une PRÉSENCE (la publication qui, elle, part) :
 * une assertion d'absence seule ne prouve pas que le chemin nominal fonctionne.
 */
test.describe("Publication — formes d'URL", () => {
  test("lien court TikTok accepté, lien de profil et hôte imité refusés", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const fid = await createFormatWithRate(admin, {
      name: `[E2E_TEST] UrlForms ${ts}`,
      type: "short",
      rateModel: RATE,
    });
    const C = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] UrlForms ${ts}`,
      email: `e2e-creator-urlforms-${ts}@repackit.test`,
      password: "creator-urlforms-12345",
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: C.creatorId,
      platform: "TikTok",
      handle: `@e2eurlforms${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid as Id<"formats">,
      creatorId: C.creatorId,
      targets: [target],
      postsPerCreator: 2,
      dueDate: ts + 7 * 86_400_000,
    });
    const mine = await C.client.query(api.assignments.listMyAssignments, {
      projectId: C.projectId,
    });
    expect(mine.length).toBe(2);
    const [refus, nominal] = mine;

    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: refus._id,
      status: "to_publish",
    });

    // REFUS 1 — lien de PROFIL. La plateforme est bonne, donc rien ne
    // l'arrêtait : la publication était créée sans vidéo derrière, donc sans
    // aucune vue à relever, jamais.
    await expect(
      C.client.mutation(api.assignments.confirmPublication, {
        projectId: C.projectId,
        id: refus._id,
        urls: [{ platform: "TikTok", url: `https://www.tiktok.com/@e2eurlforms${ts}` }],
      }),
    ).rejects.toThrow(/profil/i);

    // REFUS 2 — hôte qui CONTIENT le domaine sans en être. L'ancienne détection
    // par sous-chaîne l'acceptait ; les vues restaient introuvables à jamais.
    await expect(
      C.client.mutation(api.assignments.confirmPublication, {
        projectId: C.projectId,
        id: refus._id,
        urls: [
          {
            platform: "TikTok",
            url: "https://tiktok.com.evil.example/@x/video/7123456789012345678",
          },
        ],
      }),
    ).rejects.toThrow(/plateforme/i);

    // L'assignation n'a PAS bougé : un refus ne publie rien à moitié.
    const apresRefus = await C.client.query(api.assignments.getMyAssignment, {
      projectId: C.projectId,
      id: refus._id,
    });
    expect(apresRefus?.assignment.status).toBe("to_publish");
    expect(apresRefus?.targets[0]?.publishedUrl).toBeFalsy();

    // PRÉSENCE — le lien court de l'app iOS passe, et il passe JUSQU'AU BOUT.
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: nominal._id,
      status: "to_publish",
    });
    const published = await C.client.mutation(api.assignments.confirmPublication, {
      projectId: C.projectId,
      id: nominal._id,
      urls: [{ platform: "TikTok", url: "https://www.tiktok.com/t/ZP8cDXdtT/" }],
    });
    expect(published.alreadyPublished).toBe(false);
    const apres = await C.client.query(api.assignments.getMyAssignment, {
      projectId: C.projectId,
      id: nominal._id,
    });
    expect(apres?.assignment.status).toBe("published");
    expect(apres?.targets[0]?.publishedUrl).toContain("tiktok.com");

    // Cleanup — les deux assignations repassent en todo.
    for (const a of [refus, nominal]) {
      await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
        secret: E2E_SECRET,
        id: a._id,
        status: "todo",
      });
    }
  });
  /**
   * LE SYMPTÔME EXACT SIGNALÉ, À L'ÉCRAN. La créatrice colle le lien rendu par
   * « Copier le lien » de l'app TikTok iOS et voit « L'URL pour TikTok ne
   * correspond pas à cette plateforme » — sur un lien TikTok. La garde client
   * ne bloque plus que ce qu'elle prouve faux, et le dit à la saisie au lieu de
   * l'annoncer au clic.
   */
  test("portail : le lien court passe, le lien de profil est nommé à la saisie", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const password = "creator-urlui-12345";
    const fid = await createFormatWithRate(admin, {
      name: `[E2E_TEST] UrlUI ${ts}`,
      type: "short",
      rateModel: RATE,
    });
    const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] UrlUI ${ts}`,
      email: `e2e-creator-urlui-${ts}@repackit.test`,
    });
    // ORDRE IMPOSÉ : une créatrice n'est assignable qu'une fois ONBOARDÉE —
    // on ouvre donc sa session (le join) avant de poser la mission.
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await ctx.newPage();
    await page.goto(`/join/${token}`);
    await page.getByLabel("Mot de passe").fill(password);
    await page.getByRole("button", { name: /activer mon compte/i }).click();
    await page.waitForURL("**/app", { timeout: 20_000 });

    const target = await availableTarget({
      e2eClient: admin,
      creatorId,
      platform: "TikTok",
      handle: `@e2eurlui${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId: fid as Id<"formats">,
      creatorId,
      targets: [target],
      postsPerCreator: 1,
      dueDate: ts + 7 * 86_400_000,
    });
    const all = await admin.query(api.assignments.listAssignments, {});
    const mine = all.filter((a) => a.formatId === fid);
    expect(mine.length).toBe(1);
    const aid = mine[0]._id;
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: aid,
      status: "to_publish",
    });

    await page.goto(`/app/assignments/${aid}`);

    const champ = page.getByLabel(/Publie sur TikTok/);
    await expect(champ).toBeVisible({ timeout: 15_000 });
    const confirmer = page.getByRole("button", { name: /confirmer la publication/i });

    // PROUVÉ FAUX — un lien de profil est nommé DÈS LA SAISIE, et le clic ne
    // publie pas. C'est le seul refus que la garde client s'autorise encore.
    const inline = page.getByTestId("url-issue-TikTok");
    await champ.fill(`https://www.tiktok.com/@e2eurlui${ts}`);
    await expect(inline).toBeVisible();
    await confirmer.click();
    await expect(champ).toBeVisible();

    // NON PROUVÉ FAUX — le lien court de l'app iOS. Aucun avertissement, et la
    // publication part : c'est exactement ce qui était refusé jusqu'ici.
    await champ.fill("https://www.tiktok.com/t/ZP8cDXdtT/");
    await expect(inline).toBeHidden();
    await expect(page.getByTestId("url-unknown-TikTok")).toBeHidden();
    await confirmer.click();
    await expect(page.getByText(/Publié/)).toBeVisible({ timeout: 15_000 });

    // Le serveur a bien enregistré la publication, pas seulement l'écran.
    const apres = await admin.query(api.assignments.listAssignments, {});
    expect(apres.find((a) => a._id === aid)?.status).toBe("published");

    await ctx.close();
    await admin.mutation(api.assignments.e2eSetAssignmentStatus, {
      secret: E2E_SECRET,
      id: aid,
      status: "todo",
    });
  });
});
