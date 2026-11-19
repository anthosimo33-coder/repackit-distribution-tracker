import { ConvexHttpClient } from "convex/browser";
import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { createFormatWithRate } from "./helpers/formats";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { parisDayKey, parisMidnightUtc } from "../convex/viewsDaily";
import { shiftDay } from "../convex/analyticsDates";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

/**
 * Paiements → Rentabilité → « Par jour » : les nouvelles ventes de chaque jour,
 * et les posts qui faisaient les vues ce jour-là.
 *
 * Projet DÉDIÉ pour des montants exacts (la base e2e partagée porte les
 * paiements d'autres specs). Le scénario reprend la forme de la prod Snytch du
 * 9 au 11/11/2026 : un post qui explose, et les ventes qui montent le même jour.
 * Il tient les pièges qui donneraient un pic FAUX ET CRÉDIBLE : un
 * renouvellement compté comme nouvelle vente, un échec compté comme une vente,
 * et un post qui ne serait pas le bon en tête du jour.
 */
test.describe("Rentabilité — ventes et posts par jour", () => {
  test("le jour du pic, les nouvelles ventes et le post qui faisait les vues", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const slug = `e2e-ventes-jour-${ts}`;
    const nom = `E2E Ventes par jour ${ts}`;
    const { projectId } = (await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
      secret: E2E_SECRET,
      slug,
      name: nom,
    })) as { projectId: Id<"projects"> };

    // Jours de Paris, relatifs à aujourd'hui : J(-1) = hier.
    const J = (n: number) => shiftDay(parisDayKey(ts), n);
    const aParis = (jour: string, h: number, min: number) => {
      const [y, m, d] = jour.split("-").map(Number);
      return parisMidnightUtc(y, m, d) + (h * 60 + min) * 60_000;
    };
    /** Le relevé de 23 h 30 Paris, DST comprise (minuit du lendemain − 30 min). */
    const releveDu = (jour: string) => {
      const [y, m, d] = jour.split("-").map(Number);
      return parisMidnightUtc(y, m, d + 1) - 30 * 60_000;
    };

    try {
      await admin.mutation(api.whopSync.e2eSetProjectWhop, {
        secret: E2E_SECRET,
        projectId,
        whop: { companyId: `biz_e2e_ventes_jour_${ts}`, apiKeyEnvVar: "WHOP_API_KEY_E2E_ABSENTE" },
      });

      // ── Paiements ─────────────────────────────────────────────────────────
      const paiement = (
        id: string,
        o: { membershipId: string; jour: string; h: number; min: number; net: number; status?: "paid" | "failed"; billingReason: string },
      ) =>
        admin.mutation(api.whopSync.e2eSeedWhopPayment, {
          secret: E2E_SECRET,
          projectId,
          whopId: `pay_e2e_vj_${id}_${ts}`,
          status: o.status ?? "paid",
          grossAmount: 9.99,
          netAmount: o.net,
          paidAt: aParis(o.jour, o.h, o.min),
          currency: "eur",
          membershipId: `mem_e2e_vj_${o.membershipId}_${ts}`,
          billingReason: o.billingReason,
        });
      // Un abonnement ouvert il y a 40 jours, qui se renouvelle le jour du pic :
      // PAS une nouvelle vente.
      await paiement("ancien1", { membershipId: "ancien", jour: J(-40), h: 21, min: 4, net: 9.13, billingReason: "subscription_create" });
      await paiement("ancien2", { membershipId: "ancien", jour: J(-3), h: 21, min: 4, net: 4.19, billingReason: "subscription_cycle" });
      // Deux nouvelles ventes le jour du pic, dont un achat unique.
      await paiement("a", { membershipId: "a", jour: J(-3), h: 19, min: 12, net: 9.13, billingReason: "subscription_create" });
      await paiement("c", { membershipId: "c", jour: J(-3), h: 22, min: 51, net: 11.37, billingReason: "one_time" });
      // Un échec le jour du pic, encaissé le lendemain : la vente est le lendemain.
      await paiement("b1", { membershipId: "b", jour: J(-3), h: 9, min: 30, net: 9.13, status: "failed", billingReason: "subscription_create" });
      await paiement("b2", { membershipId: "b", jour: J(-2), h: 9, min: 31, net: 6.73, billingReason: "subscription_create" });

      // ── Deux vidéos, relevées chaque soir ─────────────────────────────────
      const { pricingId } = await admin.mutation(api.pricing.createPricing, {
        projectId,
        name: `[E2E_TEST] Ventes par jour ${ts}`,
        montantFixe: 0,
        nbVideosCible: 1,
        tauxCPM: 2,
      });
      const formatId = await createFormatWithRate(admin, {
        projectId,
        name: `[E2E_TEST] Pas plus amoureux ${ts}`,
        type: "short",
        rateModel: { basePerPost: 0 },
      });
      const email = `e2e-ventes-jour-${ts}@repackit.test`;
      const creatrice = `[E2E_TEST] Élisa Marchand ${ts}`;
      const { creatorId, token: invite } = await admin.mutation(api.creators.inviteCreator, {
        projectId,
        name: creatrice,
        email,
      });
      await new ConvexHttpClient(convexUrl!).action(api.auth.signIn, {
        provider: "password",
        params: { email, password: `ventes-jour-${ts}-12345`, flow: "signUp", inviteToken: invite },
      });

      async function video(handle: string, publishedAt: number, releves: [string, number][]) {
        const target = await availableTarget({ e2eClient: admin, creatorId, platform: "TikTok", handle });
        await admin.mutation(api.assignments.assignFormat, {
          projectId,
          formatId,
          creatorId,
          targets: [target],
          postsPerCreator: 1,
          dueDate: ts + 7 * DAY,
          pricingId,
        });
        const row = (await admin.query(api.assignments.listAssignments, { projectId })).find(
          (a) => a.creatorId === creatorId && a.status !== "published" && a.status !== "paid",
        )!;
        const pub = await admin.mutation(api.assignments.confirmPublicationAsAdmin, {
          projectId,
          id: row._id,
          urls: [{ platform: "TikTok", url: `https://www.tiktok.com/${handle}/video/74${ts % 1_000_000}${releves.length}` }],
          publishedAt,
          allowBackdate: true,
        });
        const publicationId = (pub.publicationIds ?? [])[0] as Id<"publications">;
        for (const [jour, vues] of releves) {
          await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
            secret: E2E_SECRET,
            publicationId,
            vues,
            capturedAt: releveDu(jour),
            source: "tiktok",
          });
        }
      }
      const hit = `@elisa.vj_${ts}`;
      const petit = `@elisa.vj_petit_${ts}`;
      // Le post qui explose : publié la veille du pic au soir.
      await video(hit, aParis(J(-4), 18, 47), [
        [J(-4), 2_113],
        [J(-3), 41_907],
        [J(-2), 45_011],
      ]);
      // Un petit post publié le même jour, le matin.
      await video(petit, aParis(J(-4), 10, 2), [
        [J(-4), 517],
        [J(-3), 1_733],
      ]);

      // ── L'action, telle que l'écran l'appelle ─────────────────────────────
      const r = await admin.action(api.ventesParJour.getVentesEtPostsParJour, { projectId, jours: 7 });
      if (!r.configured) throw new Error("projet non configuré");
      expect(r.au).toBe(J(-1));
      expect(r.jours.map((j) => j.jour)).toEqual([J(-7), J(-6), J(-5), J(-4), J(-3), J(-2), J(-1)]);
      const pic = r.jours.find((j) => j.jour === J(-3))!;
      // a + c ; ni le renouvellement de l'ancien abonnement, ni l'échec de b.
      expect(pic.nouvelles).toBe(2);
      expect(pic.netNouvelles).toBe(20.5);
      expect(pic.netAutres).toBe(4.19);
      const lendemain = r.jours.find((j) => j.jour === J(-2))!;
      expect(lendemain.nouvelles).toBe(1);
      expect(lendemain.netNouvelles).toBe(6.73);

      // Vues du pic, au prorata des heures de Paris (comme la courbe du Tracker) :
      // 23 h 30 de l'écart J-4 → J-3, plus la demi-heure prise sur J-3 → J-2.
      // Chaque post est arrondi pour que leur somme tombe PILE sur le total du
      // jour (plus fort reste) : un post peut s'écarter d'une vue de son exact.
      const exactHit = ((41_907 - 2_113) * 23.5) / 24 + ((45_011 - 41_907) * 0.5) / 24;
      const exactPetit = ((1_733 - 517) * 23.5) / 24;
      expect(pic.vues).toBe(Math.round(exactHit + exactPetit));
      expect(Math.abs(pic.posts[0].vues - exactHit)).toBeLessThan(1);
      expect(Math.abs(pic.posts[1].vues - exactPetit)).toBeLessThan(1);
      expect(pic.posts[0].vues + pic.posts[1].vues).toBe(pic.vues);
      const vuesHit = pic.posts[0].vues;
      const fiche = r.posts.find((p) => p.publicationId === pic.posts[0].publicationId)!;
      expect(fiche.compte).toBe(hit);
      expect(fiche.createatrice).toBe(creatrice);
      expect(fiche.format).toBe(`[E2E_TEST] Pas plus amoureux ${ts}`);

      // ── L'écran ───────────────────────────────────────────────────────────
      await page.goto(`/admin/${slug}/paiements`);
      await page.getByRole("button", { name: "Par jour" }).click();
      const detail = page.getByTestId("ventes-jour-detail");
      // 30 jours par défaut ; le jour ouvert d'abord est celui du pic de ventes.
      await expect(detail).toContainText("2 nouvelles ventes", { timeout: 60_000 });
      await expect(detail).toContainText("20,50");
      const lignes = detail.locator("tbody tr");
      await expect(lignes).toHaveCount(2);
      await expect(lignes.first()).toContainText(hit);
      await expect(lignes.first()).toContainText(creatrice);
      await expect(lignes.first()).toContainText(vuesHit.toLocaleString("fr-FR"));
      await expect(lignes.nth(1)).toContainText(petit);
    } finally {
      await admin.mutation(api.projectLifecycle.deleteProject, {
        projectId,
        confirmation: nom,
      });
    }
  });
});
