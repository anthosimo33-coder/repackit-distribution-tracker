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
    const { daily: serieTrou } = await admin.query(api.trackerData.trackerViewsDaily, {
      comptes: [compteTrou],
    });
    expect(serieTrou).toEqual([
      { date: "2026-08-08", value: 1400, estimated: true },
      { date: "2026-08-09", value: 2400, estimated: true },
      { date: "2026-08-10", value: 1000, estimated: true },
    ]);

    // ── Rythme nominal : réparti aussi, mais JAMAIS marqué « estimé » ────────
    const { daily: serieQuotidienne } = await admin.query(
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
    const { daily: serieCumulee } = await admin.query(api.trackerData.trackerViewsDaily, {
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

  /**
   * VENTILATION PAR MARCHÉ et DÉTAIL D'UN JOUR.
   *
   * Ce que l'unitaire ne peut pas prouver : que la jointure publication → compte
   * → marché visé tient sur de vraies lignes, et que les deux lectures sortent
   * bien de la MÊME répartition que la courbe. Un total de détail qui
   * divergerait du point cliqué serait le pire défaut possible ici — on ne
   * saurait pas lequel des deux croire.
   */
  test("ventile par marché et détaille un jour, sans jamais s'écarter du total", async () => {
    test.setTimeout(180_000);
    const ts = Date.now() + 1;
    const datePubli = utcAt(2026, 8, 7, 12);

    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] Marché vues ${ts}`,
    })) as Id<"icps">;

    /** Un compte RÉEL, avec son marché visé — c'est lui qui porte le pays. */
    async function compteAvecMarche(
      suffix: string,
      pays: "FR" | "RS",
    ): Promise<string> {
      const handle = `@e2e_marche_${suffix}_${ts}`;
      await admin.mutation(api.comptes.createCompte, {
        handle,
        plateforme: "TikTok",
        notes: "[E2E_TEST] tracker-vues-marche",
        targetCountry: pays,
      });
      return handle;
    }

    async function postSur(compte: string, suffix: string): Promise<Id<"publications">> {
      const carouselId = await admin.query(api.publications.getNextCarouselId, {});
      const { ids } = await admin.mutation(api.publications.createPublication, {
        carouselId,
        hookId: null,
        hookText: `[E2E] Marché vues ${suffix} ${ts}`,
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
        notes: "[E2E_TEST] tracker-vues-marche",
      });
      const pubId = ids[0] as Id<"publications">;
      await admin.mutation(api.publications.updateMetrics, {
        id: pubId,
        postUrl: `https://www.tiktok.com/@e2e/video/9${suffix}${ts}`,
      });
      return pubId;
    }

    async function snap(
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
      expect(res.action).toBe("inserted");
    }

    const compteFr = await compteAvecMarche("fr", "FR");
    const compteRs = await compteAvecMarche("rs", "RS");
    // Un post sur un compte qui n'existe PAS dans la table : son marché est
    // inconnu, et il ne doit pas être versé dans un marché réel.
    const compteOrphelin = `@e2e_marche_orphelin_${ts}`;

    const pubFr = await postSur(compteFr, "fr");
    const pubRs = await postSur(compteRs, "rs");
    const pubOrphelin = await postSur(compteOrphelin, "orph");

    // Même fenêtre pour les trois : 08:00 UTC → 08:00 UTC, donc 14 h du jour
    // Paris et 10 h du suivant.
    for (const [pub, gain] of [
      [pubFr, 2400],
      [pubRs, 1200],
      [pubOrphelin, 600],
    ] as const) {
      await snap(pub, utcAt(2026, 8, 9, 8), 1000);
      await snap(pub, utcAt(2026, 8, 10, 8), 1000 + gain);
    }

    const filtres = { comptes: [compteFr, compteRs, compteOrphelin] };
    const { daily, byMarket, marketLabels } = await admin.query(
      api.trackerData.trackerViewsDaily,
      filtres,
    );

    // ── Les trois marchés sont là, et l'orphelin à part ────────────────────
    const cles = new Set(byMarket.flatMap((j) => j.parts.map((p) => p.group)));
    expect(cles).toEqual(new Set(["FR", "RS", ""]));
    // Les libellés couvrent les marchés nommés ; le groupe vide n'en a pas.
    expect(new Set(marketLabels.map((l) => l.key))).toEqual(new Set(["FR", "RS"]));

    // ── Chaque jour : la somme des tranches EST le total du jour ───────────
    for (const jour of byMarket) {
      expect(jour.parts.reduce((s, p) => s + p.value, 0)).toBe(jour.value);
    }
    // …et la série ventilée porte les mêmes totaux que la série simple.
    expect(byMarket.map((j) => [j.date, j.value])).toEqual(
      daily.map((j) => [j.date, j.value]),
    );

    // ── Les proportions suivent bien les comptes ──────────────────────────
    // Sur le premier jour : 2400/1200/600 × 14/24 = 1400 / 700 / 350.
    const premier = byMarket[0];
    const parGroupe = new Map(premier.parts.map((p) => [p.group, p.value]));
    expect(parGroupe.get("FR")).toBe(1400);
    expect(parGroupe.get("RS")).toBe(700);
    expect(parGroupe.get("")).toBe(350);

    // ── Le détail d'un jour somme EXACTEMENT au point de la courbe ─────────
    for (const point of daily) {
      const detail = await admin.query(api.trackerData.trackerViewsDayDetail, {
        filters: filtres,
        day: point.date,
      });
      expect(detail.total).toBe(point.value);
      expect(detail.rows.reduce((s, r) => s + r.value, 0)).toBe(point.value);
    }

    // ── Et il nomme le marché de chaque ligne ─────────────────────────────
    const detail = await admin.query(api.trackerData.trackerViewsDayDetail, {
      filters: filtres,
      day: premier.date,
    });
    const parCompte = new Map(detail.rows.map((r) => [r.compte, r]));
    expect(parCompte.get(compteFr)?.market).toBe("FR");
    expect(parCompte.get(compteRs)?.market).toBe("RS");
    // Un compte inconnu de la table n'a pas de marché — et ce n'est pas « FR ».
    expect(parCompte.get(compteOrphelin)?.market).toBeNull();
    // Les lignes sont classées de la plus forte à la plus faible.
    expect(detail.rows[0].compte).toBe(compteFr);

    // ── LE MÊME PSEUDO SUR DEUX PLATEFORMES, DEUX MARCHÉS ─────────────────
    // L'unicité d'un compte porte sur (handle, plateforme) : un même pseudo
    // peut donc viser la France sur TikTok et la Serbie sur Instagram. Joindre
    // sur le seul handle rattacherait les deux posts au même marché.
    const pseudo = `@e2e_marche_deux_${ts}`;
    await admin.mutation(api.comptes.createCompte, {
      handle: pseudo,
      plateforme: "TikTok",
      notes: "[E2E_TEST] tracker-vues-marche",
      targetCountry: "FR",
    });
    await admin.mutation(api.comptes.createCompte, {
      handle: pseudo,
      plateforme: "Instagram",
      notes: "[E2E_TEST] tracker-vues-marche",
      targetCountry: "RS",
    });

    const carouselId = await admin.query(api.publications.getNextCarouselId, {});
    const { ids } = await admin.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText: `[E2E] Marché deux plateformes ${ts}`,
      mecanique: "Erreur",
      niveau: "Broad-A",
      mediaType: "short",
      script: "script e2e",
      angleTonal: "Psycho",
      langue: "FR",
      icpId,
      // Le MÊME pseudo, les DEUX plateformes : deux publications d'un coup.
      plateformes: ["TikTok", "Instagram"],
      compte: pseudo,
      datePubli,
      notes: "[E2E_TEST] tracker-vues-marche",
    });
    expect(ids).toHaveLength(2);
    for (const [i, id] of ids.entries()) {
      await admin.mutation(api.publications.updateMetrics, {
        id: id as Id<"publications">,
        postUrl: `https://www.tiktok.com/@e2e/video/7${i}${ts}`,
      });
      await snap(id as Id<"publications">, utcAt(2026, 8, 9, 8), 1000);
      await snap(id as Id<"publications">, utcAt(2026, 8, 10, 8), 1000 + 2400);
    }

    const deux = await admin.query(api.trackerData.trackerViewsDaily, {
      comptes: [pseudo],
    });
    const groupesDuPseudo = new Set(
      deux.byMarket.flatMap((j) => j.parts.map((p) => p.group)),
    );
    // DEUX marchés, pas un : la plateforme fait partie de la clé de jointure.
    expect(groupesDuPseudo).toEqual(new Set(["FR", "RS"]));
  });
});