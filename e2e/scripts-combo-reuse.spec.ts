import { test, expect } from "@playwright/test";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { minuitParisDecale } from "./helpers/paris-day";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;
type Platform = "TikTok" | "Instagram" | "YouTube";
type Target = { platform: Platform; accountId: Id<"comptes"> };
const TT: Platform[] = ["TikTok"];
const YT: Platform[] = ["YouTube"];

/**
 * SCRIPTS RÉUTILISABLES (11/11/2026, tous projets) — un script déjà fait par
 * une créatrice peut lui revenir. Ce qui remplace l'ancienne unicité à vie
 * (#59) est une PRÉFÉRENCE : d'abord les scripts qu'elle n'a jamais faits sur
 * la plateforme, puis celui qu'elle a fait il y a le plus longtemps — pas le
 * premier du catalogue. Campagne minimale : 2 hooks × 1 flux × 1 cta = 2
 * scripts. Prouvé SERVEUR, aperçu ET création.
 */
async function makeCampaign(ts: number) {
  const campaignId = await admin.mutation(api.scripts.createCampaign, {
    name: `[E2E_TEST] Il te garde au chaud ${ts}`,
  });
  const add = (kind: "hook" | "flux" | "cta", label: string, content: string) =>
    admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
  const h1 = await add("hook", "H1", `Il te garde au chaud pendant qu'il en voit une autre ${ts}`);
  const h2 = await add("hook", "H2", `Il répond à ses stories mais pas à tes messages ${ts}`);
  await add("flux", "F1", "Regarde ce que l'app m'a montré sur son compte…");
  await add("cta", "C1", "Le lien est dans ma bio 💗");
  const { pricingId } = await admin.mutation(api.pricing.createPricing, {
    name: `[E2E_TEST] PricingReuse ${ts}`,
    montantFixe: 100,
    nbVideosCible: 10,
    tauxCPM: 2,
  });
  return { campaignId, h1, h2, pricingId };
}

const rowsFor = (campaignId: string, creatorId: string) =>
  admin
    .query(api.assignments.listAssignments, {})
    .then((all) =>
      all.filter(
        (a) =>
          a.scriptCombo?.campaignId === campaignId && a.creatorId === creatorId,
      ),
    );

test.describe("Scripts réutilisables — jamais faits d'abord, puis le moins récent", () => {
  test("catalogue épuisé : un script déjà fait lui revient, le moins récent et pas le premier", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const a = await createCreatorSession(url, {
      name: `[E2E_TEST] Kelly Chapters ${ts}`,
      email: `e2e-reuse-a-${ts}@repackit.test`,
      password: "reuse-a-12345",
    });
    const b = await createCreatorSession(url, {
      name: `[E2E_TEST] Juliette Moreau ${ts}`,
      email: `e2e-reuse-b-${ts}@repackit.test`,
      password: "reuse-b-12345",
    });
    const { campaignId, h1, h2, pricingId } = await makeCampaign(ts);

    const aTikTok = await availableTarget({
      e2eClient: admin,
      creatorId: a.creatorId,
      platform: "TikTok",
      handle: `@thekellychapters_${ts}`,
    });
    const aYouTube = await availableTarget({
      e2eClient: admin,
      creatorId: a.creatorId,
      platform: "YouTube",
      handle: `@kelly.chapters.yt${ts}`,
    });
    const bTikTok = await availableTarget({
      e2eClient: admin,
      creatorId: b.creatorId,
      platform: "TikTok",
      handle: `@juliette.mrx_${ts}`,
    });

    const assign = (
      creatorId: Id<"creators">,
      targets: Target[],
      videos: number,
      postDates?: number[],
    ) =>
      admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId,
        targets,
        videosPerCreator: videos,
        dueDate: ts + 14 * DAY,
        pricingId,
        ...(postDates ? { postDates } : {}),
      });
    const avail = (creatorId: Id<"creators">, platforms: Platform[]) =>
      admin.query(api.scripts.availableCombosForAssignment, {
        campaignId,
        creatorId,
        platforms,
      });
    const hookOfDay = async (day: number) =>
      (await rowsFor(campaignId, a.creatorId)).find((r) => r.postDate === day)
        ?.scriptCombo?.hookBrickId;

    // Jours de publication réels (minuit Paris), espacés d'au moins le délai
    // du projet (1 jour par défaut) : seul l'ordre de préférence joue.
    const J3 = minuitParisDecale(3);
    const J4 = minuitParisDecale(4);
    const J6 = minuitParisDecale(6);
    const J8 = minuitParisDecale(8);

    // Elle fait tout le catalogue sur TikTok. H1 (le premier créé) est tiré
    // d'abord mais publié le PLUS TARD : c'est H2 le moins récent.
    expect((await assign(a.creatorId, [aTikTok], 1, [J4])).created).toBe(1);
    expect((await assign(a.creatorId, [aTikTok], 1, [J3])).created).toBe(1);
    expect(await hookOfDay(J4)).toBe(h1);
    expect(await hookOfDay(J3)).toBe(h2);
    expect(await avail(a.creatorId, TT)).toEqual({ total: 2, available: 0 });

    // L'APERÇU annonce ce que la création fera : H2, sans pénurie.
    const apercu = await admin.query(api.scripts.previewCombosForAssignment, {
      campaignId,
      creatorId: a.creatorId,
      targets: [aTikTok],
      videosPerCreator: 1,
      postDates: [J6],
    });
    expect(apercu.shortage).toBe(false);
    expect(apercu.combos.map((c) => c.hookBrickId)).toEqual([h2]);

    // Catalogue épuisé : la vidéo est CRÉÉE (avant le 11/11 : 0 créée +
    // pénurie), avec le script le moins récemment fait — pas le premier.
    const again = await assign(a.creatorId, [aTikTok], 1, [J6]);
    expect(again.created).toBe(1);
    expect(again.shortages).toEqual([]);
    expect(await hookOfDay(J6)).toBe(h2);

    // La suivante revient sur H1 (fait le J4, désormais le moins récent) : le
    // tirage tourne, il ne retombe pas toujours sur le même.
    expect((await assign(a.creatorId, [aTikTok], 1, [J8])).created).toBe(1);
    expect(await hookOfDay(J8)).toBe(h1);

    // Cross-plateforme : tout reste neuf sur son YouTube.
    expect(await avail(a.creatorId, YT)).toEqual({ total: 2, available: 2 });
    expect((await assign(a.creatorId, [aYouTube], 2)).created).toBe(2);
    expect((await avail(a.creatorId, YT)).available).toBe(0);

    // Autre créatrice : rien ne se partage, tout est neuf pour elle.
    expect(await avail(b.creatorId, TT)).toEqual({ total: 2, available: 2 });
    expect((await assign(b.creatorId, [bTikTok], 2)).created).toBe(2);
  });

  test("le délai du projet reste un interdit, aussi entre ses propres vidéos", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const c = await createCreatorSession(url, {
      name: `[E2E_TEST] Lorena Diaz ${ts}`,
      email: `e2e-reuse-delai-${ts}@repackit.test`,
      password: "reuse-delai-123",
    });
    const { campaignId, pricingId } = await makeCampaign(ts);
    const t = await availableTarget({
      e2eClient: admin,
      creatorId: c.creatorId,
      platform: "TikTok",
      handle: `@lorena.dz_${ts}`,
    });
    const J5 = minuitParisDecale(5);
    // Trois vidéos le MÊME jour sur un catalogue de deux : la troisième
    // reprendrait un script du jour même → refusée par le délai (1 jour).
    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: c.creatorId,
      targets: [t],
      videosPerCreator: 3,
      dueDate: ts + 14 * DAY,
      pricingId,
      postDates: [J5, J5, J5],
    });
    expect(r.created).toBe(2);
    expect(r.shortages).toEqual([
      expect.objectContaining({ requested: 3, assigned: 2 }),
    ]);
    const keys = (await rowsFor(campaignId, c.creatorId)).map((x) => x.comboKey);
    expect(new Set(keys).size).toBe(2);
  });

  test("editScriptCombo accepte un script qu'elle a déjà sur la plateforme", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const c = await createCreatorSession(url, {
      name: `[E2E_TEST] Sarah Benali ${ts}`,
      email: `e2e-reuse-edit-${ts}@repackit.test`,
      password: "reuse-edit-123",
    });
    const { campaignId, h1, h2, pricingId } = await makeCampaign(ts);
    const tTikTok = await availableTarget({
      e2eClient: admin,
      creatorId: c.creatorId,
      platform: "TikTok",
      handle: `@sarah.bnl_${ts}`,
    });
    const r = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: c.creatorId,
      targets: [tTikTok],
      videosPerCreator: 2,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(r.created).toBe(2); // H1 et H2 sur TikTok, sans date

    // Passer la mission H1 sur H2 : son comboKey devient celui de l'autre
    // mission (même créatrice, même plateforme). Avant le 11/11 : refus
    // « déjà utilisé ». Désormais accepté (aucune date : pas de délai en jeu).
    const rows = await rowsFor(campaignId, c.creatorId);
    const onH1 = rows.find((x) => x.scriptCombo?.hookBrickId === h1)!;
    const onH2 = rows.find((x) => x.scriptCombo?.hookBrickId === h2)!;
    await admin.mutation(api.scripts.editScriptCombo, {
      id: onH1._id,
      slot: "hook",
      newBrickId: h2,
    });
    const after = (await rowsFor(campaignId, c.creatorId)).find(
      (x) => x._id === onH1._id,
    )!;
    expect(after.scriptCombo?.hookBrickId).toBe(h2);
    expect(after.comboKey).toBe(onH2.comboKey);
  });
});
