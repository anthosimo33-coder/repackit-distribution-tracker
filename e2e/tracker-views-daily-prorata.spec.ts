import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

/** Instant UTC absolu : utcAt(2026, 8, 8, 8) = 8 août 2026 08:00 UTC. */
const utcAt = (y: number, m: number, d: number, h: number): number =>
  Date.UTC(y, m - 1, d, h, 0, 0);

/**
 * Série « Vues gagnées par jour » — preuve SERVEUR de la répartition au prorata.
 *
 * Ce que l'unitaire (lib/views-daily.test.ts) ne peut PAS prouver : que le
 * runtime Convex sait résoudre le fuseau Europe/Paris. Le découpage repose sur
 * `Intl.DateTimeFormat({ timeZone: "Europe/Paris" })` ; un runtime sans ICU
 * complet retomberait silencieusement sur UTC et servirait 1600/2400/800 au lieu
 * de 1400/2400/1000. Les valeurs attendues ci-dessous DISTINGUENT les deux
 * lectures — c'est tout l'intérêt de poser les relevés à 08:00 UTC, l'heure
 * réelle du cron (= 10:00 Paris l'été).
 *
 * Base e2e partagée et sérielle : on isole nos deux posts par leur `compte`
 * (filtre multi-select déjà servi par la query), jamais par un total absolu.
 */
test.describe("Vue tracker — vues gagnées par jour", () => {
  test("répartit un delta au prorata du temps couvert, en jours Europe/Paris", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    // Dates ABSOLUES et passées : la série attendue ne dépend pas du jour où la
    // suite tourne (et le fuseau d'été est celui du scénario).
    const datePubli = utcAt(2026, 8, 7, 12);

    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] Prorata vues ${ts}`,
    })) as Id<"icps">;

    async function makePublishedShort(
      suffix: string,
      compte: string,
    ): Promise<Id<"publications">> {
      const carouselId = await admin.query(
        api.publications.getNextCarouselId,
        {},
      );
      const { ids } = await admin.mutation(api.publications.createPublication, {
        carouselId,
        hookId: null,
        hookText: `[E2E] Prorata vues ${suffix} ${ts}`,
        mecanique: "Erreur",
        niveau: "Broad-A",
        mediaType: "short",
        script: "script e2e",
        angleTonal: "Psycho",
        langue: "FR",
        icpId,
        plateformes: ["TikTok"],
        compte,
        datePubli,
        notes: "[E2E_TEST] tracker-views-daily-prorata",
      });
      const pubId = ids[0] as Id<"publications">;
      await admin.mutation(api.publications.updateMetrics, {
        id: pubId,
        postUrl: `https://www.tiktok.com/@e2e/video/8${suffix}${ts}`,
      });
      return pubId;
    }

    async function snapshot(
      publicationId: Id<"publications">,
      capturedAt: number,
      vues: number,
    ): Promise<void> {
      const res = await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
        secret: E2E_SECRET,
        publicationId,
        vues,
        capturedAt,
        source: "tiktok",
      });
      // Le relevé DOIT être écrit : un "skipped" (capturedAt < datePubli) ferait
      // passer les assertions de série pour de mauvaises raisons.
      expect(res.action).toBe("inserted");
    }

    const compteTrou = `@e2e_prorata_trou_${ts}`;
    const compteQuotidien = `@e2e_prorata_quot_${ts}`;
    const pubTrou = await makePublishedShort("trou", compteTrou);
    const pubQuotidien = await makePublishedShort("quot", compteQuotidien);

    // Post A — sync MANQUÉE : 48 h entre deux relevés (08/08 → 10/08, 08:00 UTC).
    await snapshot(pubTrou, utcAt(2026, 8, 8, 8), 6200);
    await snapshot(pubTrou, utcAt(2026, 8, 10, 8), 11_000);

    // Post B — rythme NOMINAL : un relevé par jour (09/08 → 10/08 → 11/08).
    await snapshot(pubQuotidien, utcAt(2026, 8, 9, 8), 1000);
    await snapshot(pubQuotidien, utcAt(2026, 8, 10, 8), 1480);
    await snapshot(pubQuotidien, utcAt(2026, 8, 11, 8), 1720);

    // ── Le trou de 48 h se répartit sur les 3 jours PARIS qu'il couvre ───────
    // 08:00 UTC = 10:00 Paris → 14 h le 08, 24 h le 09, 10 h le 10.
    // En jours UTC (la lecture d'AVANT) ce serait 16 h / 24 h / 8 h.
    const serieTrou = await admin.query(api.trackerData.trackerViewsDaily, {
      comptes: [compteTrou],
    });
    expect(serieTrou).toEqual([
      { date: "2026-08-08", value: 1400, estimated: true },
      { date: "2026-08-09", value: 2400, estimated: true },
      { date: "2026-08-10", value: 1000, estimated: true },
    ]);

    // ── Rythme nominal : réparti aussi, mais JAMAIS marqué « estimé » ────────
    const serieQuotidienne = await admin.query(
      api.trackerData.trackerViewsDaily,
      { comptes: [compteQuotidien] },
    );
    expect(serieQuotidienne).toEqual([
      { date: "2026-08-09", value: 280, estimated: false }, // 480 × 14/24
      { date: "2026-08-10", value: 340, estimated: false }, // 480 × 10/24 + 240 × 14/24
      { date: "2026-08-11", value: 100, estimated: false }, // 240 × 10/24
    ]);

    // ── Les deux posts ensemble : le drapeau est levé dès qu'UNE part du jour
    //    vient d'un intervalle trop large ; le 11/08, servi par le seul post
    //    relevé quotidiennement, reste une mesure.
    const serieCumulee = await admin.query(api.trackerData.trackerViewsDaily, {
      comptes: [compteTrou, compteQuotidien],
    });
    expect(serieCumulee).toEqual([
      { date: "2026-08-08", value: 1400, estimated: true },
      { date: "2026-08-09", value: 2680, estimated: true },
      { date: "2026-08-10", value: 1340, estimated: true },
      { date: "2026-08-11", value: 100, estimated: false },
    ]);

    // Aucune vue perdue ni inventée par la répartition : 4800 + 480 + 240.
    const total = serieCumulee.reduce((sum, p) => sum + p.value, 0);
    expect(total).toBe(5520);
  });
});
