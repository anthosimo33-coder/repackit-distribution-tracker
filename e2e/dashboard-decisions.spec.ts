import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const HOUR = 3_600_000;

/**
 * Query d'assemblage du dashboard décisionnel — preuves SERVEUR de ce que
 * l'unitaire ne couvre pas : la fenêtre glissante de 48 h sur de vraies rows,
 * le delta 24 h calculé depuis les snapshots réels, et la DORMANCE des portes
 * ouvertes tant que saves/abonnés ne sont pas collectés.
 *
 * Base partagée : assertions sur NOS comptes uniquement, jamais un décompte
 * absolu du projet.
 */
test.describe("Dashboard décisionnel — assemblage", () => {
  test("fenêtre 48 h, delta 24 h, et portes dormantes sans collecte", async () => {
    test.setTimeout(120_000);
    const now = Date.now();
    const ts = now;

    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] Dashboard décisions ${ts}`,
    })) as Id<"icps">;

    async function poste(
      compte: string,
      hoursAgo: number,
      suffix: string,
    ): Promise<Id<"publications">> {
      const carouselId = await admin.query(
        api.publications.getNextCarouselId,
        {},
      );
      const { ids } = await admin.mutation(api.publications.createPublication, {
        carouselId,
        hookId: null,
        hookText: `[E2E] Décision ${suffix} ${ts}`,
        mecanique: "Erreur",
        niveau: "Broad-A",
        mediaType: "short",
        script: "script",
        angleTonal: "Psycho",
        langue: "FR",
        icpId,
        plateformes: ["TikTok"],
        compte,
        datePubli: now - hoursAgo * HOUR,
        notes: "[E2E_TEST] dashboard-decisions",
      });
      const pubId = ids[0] as Id<"publications">;
      await admin.mutation(api.publications.updateMetrics, {
        id: pubId,
        postUrl: `https://www.tiktok.com/@e2e/video/6${suffix}${ts}`,
      });
      return pubId;
    }
    const snap = (
      publicationId: Id<"publications">,
      hoursAgo: number,
      vues: number,
      likes: number,
    ) =>
      admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId,
        vues,
        likes,
        capturedAt: now - hoursAgo * HOUR,
        source: "tiktok",
      });

    const compteIn = `@e2e_dd_in_${ts}`;
    const compteOut = `@e2e_dd_out_${ts}`;

    // Post DANS la fenêtre (40 h), avec deux relevés espacés → delta calculable.
    // Vues et engagement au-dessus des seuils de porte — elle ne doit POURTANT
    // pas s'ouvrir : ni saves ni abonnés collectés.
    const dans = await poste(compteIn, 40, "in");
    await snap(dans, 25, 12_400, 1_240);
    await snap(dans, 1, 18_432, 1_732);

    // Post HORS fenêtre (60 h) sur un autre compte.
    const hors = await poste(compteOut, 60, "out");
    await snap(hors, 1, 9_000, 800);

    const d = await admin.query(api.dashboardDecisions.decisionDashboard, {});

    // ── Fenêtre glissante : 40 h dedans, 60 h dehors ─────────────────────────
    const ids48 = d.posts48h.map((p) => p.publicationId);
    expect(ids48).toContain(dans);
    expect(ids48).not.toContain(hors);

    // ── Delta 24 h depuis les VRAIS snapshots : 18 432 − 12 400 ──────────────
    const signal = d.posts48h.find((p) => p.publicationId === dans)!;
    expect(signal.vues).toBe(18_432);
    expect(signal.delta24h).toBe(6_032);
    // Saves jamais collectées sur ce post → null, PAS zéro.
    expect(signal.saves).toBeNull();
    // Aucun relevé de profil → delta d'abonnés inconnu.
    expect(signal.followersDelta).toBeNull();

    // ── DORMANCE : malgré 18 432 vues à 9,4 % de likes, pas de porte ─────────
    const portes = d.openDoors.filter((o) => o.post.compte === compteIn);
    expect(portes).toEqual([]);
  });
});
