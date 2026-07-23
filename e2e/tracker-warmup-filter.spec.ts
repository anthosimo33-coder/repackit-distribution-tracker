import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Filtre warmup de la Vue tracker — preuves SERVEUR sur listTrackerPosts, la
 * source unique des 4 KPI, du compteur de posts, de la liste et des charts.
 *
 * Le biais corrigé : les posts warmup sont hors paie et hors rentabilité, mais
 * étaient comptés dans les vues/likes/commentaires du tracker. Les assertions
 * portent donc sur l'APPARTENANCE de nos 2 posts (la base e2e est partagée et
 * sérielle : jamais d'assertion sur un compte absolu de lignes).
 */
test.describe("Vue tracker — filtre warmup", () => {
  test("exclut le warmup par défaut, le réintègre en « Tous », l'isole en « Warmup seulement »", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();

    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] Warmup filter ${ts}`,
    })) as Id<"icps">;

    async function makePublishedShort(
      suffix: string,
      vues: number,
    ): Promise<Id<"publications">> {
      const carouselId = await admin.query(
        api.publications.getNextCarouselId,
        {},
      );
      const { ids } = await admin.mutation(api.publications.createPublication, {
        carouselId,
        hookId: null,
        hookText: `[E2E] Warmup filter ${suffix} ${ts}`,
        mecanique: "Erreur",
        niveau: "Broad-A",
        mediaType: "short",
        script: "script e2e",
        angleTonal: "Psycho",
        langue: "FR",
        icpId,
        plateformes: ["TikTok"],
        compte: `@e2e_warmup_${suffix}`,
        datePubli: ts - 5 * DAY,
        notes: "[E2E_TEST] tracker-warmup-filter",
      });
      const pubId = ids[0] as Id<"publications">;
      await admin.mutation(api.publications.updateMetrics, {
        id: pubId,
        postUrl: `https://www.tiktok.com/@e2e/video/9${suffix}${ts}`,
      });
      // Vues réelles → vuesLatest alimenté (les KPI somment ce champ).
      await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId: pubId,
        vues,
        capturedAt: Math.floor(ts / DAY) * DAY + 12 * HOUR,
        source: "tiktok",
      });
      return pubId;
    }

    const paidId = await makePublishedShort("paid", 1000);
    const warmId = await makePublishedShort("warm", 500);

    // Marque UN seul post en warmup (le moteur de paie n'est pas touché).
    await admin.mutation(api.publications.setPublicationWarmup, {
      publicationId: warmId,
      isWarmup: true,
    });

    const idsOf = (rows: { _id: string }[]) => rows.map((r) => r._id);
    const sumVues = (rows: { _id: string; vues: number }[]) =>
      rows
        .filter((r) => r._id === paidId || r._id === warmId)
        .reduce((s, r) => s + r.vues, 0);

    // ── Défaut (aucun arg) = « Hors warmup » ────────────────────────────────
    const byDefault = await admin.query(api.trackerData.listTrackerPosts, {});
    expect(idsOf(byDefault)).toContain(paidId);
    expect(idsOf(byDefault)).not.toContain(warmId);
    // L'agrégat ne compte QUE le post monétisé : c'est tout l'objet du chantier.
    expect(sumVues(byDefault)).toBe(1000);

    // ── « Hors warmup » explicite = même résultat que le défaut ─────────────
    const excluded = await admin.query(api.trackerData.listTrackerPosts, {
      warmup: "exclude",
    });
    expect(idsOf(excluded)).toContain(paidId);
    expect(idsOf(excluded)).not.toContain(warmId);

    // ── « Tous » = warmup réintégré, agrégat gonflé ────────────────────────
    const all = await admin.query(api.trackerData.listTrackerPosts, {
      warmup: "all",
    });
    expect(idsOf(all)).toContain(paidId);
    expect(idsOf(all)).toContain(warmId);
    expect(sumVues(all)).toBe(1500);
    // La pastille warmup reste servie sur la ligne.
    expect(all.find((r) => r._id === warmId)?.isWarmup).toBe(true);
    expect(all.find((r) => r._id === paidId)?.isWarmup).toBe(false);

    // ── « Warmup seulement » = volume de chauffe isolé ─────────────────────
    const only = await admin.query(api.trackerData.listTrackerPosts, {
      warmup: "only",
    });
    expect(idsOf(only)).toContain(warmId);
    expect(idsOf(only)).not.toContain(paidId);
    expect(sumVues(only)).toBe(500);

    // ── La série temporelle (mode Charts) suit le MÊME filtre ──────────────
    // Même règle d'inclusion partagée (publishedAndMatches) → aucune divergence
    // possible entre les KPI/la liste et la courbe.
    const dailyExcluded = await admin.query(api.trackerData.trackerViewsDaily, {
      warmup: "exclude",
    });
    const dailyOnly = await admin.query(api.trackerData.trackerViewsDaily, {
      warmup: "only",
    });
    expect(Array.isArray(dailyExcluded)).toBe(true);
    expect(Array.isArray(dailyOnly)).toBe(true);
  });
});
