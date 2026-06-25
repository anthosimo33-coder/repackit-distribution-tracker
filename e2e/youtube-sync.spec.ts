import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
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
 * Tracking auto YouTube — vérifie la LOGIQUE déterministe sans dépendre de la
 * clé API (le relevé réel est testé par Serge avec la clé posée) :
 *  - idempotence de l'upsert (1 snapshot/pub/jour, MAJ le même jour, nouveau
 *    point le lendemain) via le helper e2e qui exerce le VRAI code path ;
 *  - intégration : vuesLatest + lastYouTubeSyncAt maintenus ;
 *  - isolation : le créateur ne peut PAS déclencher la sync ;
 *  - UI : le bouton « Synchroniser YouTube » est présent et déclenchable.
 */
test.describe("Tracking auto des vues YouTube", () => {
  test("idempotence du relevé, intégration latest, isolation, bouton manuel", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();

    // Un Short YouTube nécessite un ICP.
    const icpId = await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] YT ${ts}`,
    });
    const carouselId = await admin.query(api.publications.getNextCarouselId, {});
    const { ids } = await admin.mutation(api.publications.createPublication, {
      carouselId,
      hookId: null,
      hookText: `[E2E] YT sync ${ts}`,
      mecanique: "Erreur",
      niveau: "Broad-A",
      mediaType: "short",
      script: "script e2e",
      angleTonal: "Psycho",
      langue: "FR",
      icpId: icpId as Id<"icps">,
      plateformes: ["YouTube"],
      compte: "@e2e_yt",
      datePubli: ts - 5 * DAY, // actif (< 90 jours)
      notes: "[E2E_TEST] yt-sync",
    });
    const pubId = ids[0] as Id<"publications">;
    await admin.mutation(api.publications.updateMetrics, {
      id: pubId,
      postUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });

    // ── Idempotence — relevé du jour ─────────────────────────────────────────
    // ANCRÉ à MIDI UTC du jour courant : +HOUR reste le MÊME jour UTC (→ MAJ) et
    // +DAY tombe le lendemain (→ nouveau point), QUELLE QUE SOIT l'heure
    // d'exécution. Sans cet ancrage, un run dans la dernière heure UTC (ex. CI à
    // 23:40) ferait basculer ts+HOUR au jour suivant → faux "inserted" (flake de
    // bord de jour, indépendant du tracking lui-même).
    const capturedAt = Math.floor(ts / DAY) * DAY + 12 * HOUR;
    const r1 = await admin.mutation(api.youtubeSync.e2eRecordYouTubeSnapshot, {
      secret: E2E_SECRET,
      publicationId: pubId,
      vues: 1000,
      capturedAt,
    });
    expect(r1.action).toBe("inserted");

    // Re-run le MÊME jour (UTC) avec un relevé plus frais → MAJ, pas de doublon.
    const r2 = await admin.mutation(api.youtubeSync.e2eRecordYouTubeSnapshot, {
      secret: E2E_SECRET,
      publicationId: pubId,
      vues: 1500,
      capturedAt: capturedAt + HOUR,
    });
    expect(r2.action).toBe("updated");

    const after2 = await admin.query(
      api.metricSnapshots.listSnapshotsByPublication,
      { publicationId: pubId },
    );
    const yt2 = after2.filter((s) => s.source === "youtube");
    expect(yt2.length).toBe(1); // un SEUL snapshot YouTube ce jour-là
    expect(yt2[0].vues).toBe(1500); // valeur mise à jour

    // Le lendemain → NOUVEAU point (un snapshot par jour), AVEC titre (snippet.title).
    const r3 = await admin.mutation(api.youtubeSync.e2eRecordYouTubeSnapshot, {
      secret: E2E_SECRET,
      publicationId: pubId,
      vues: 2000,
      title: "Mon titre YouTube",
      capturedAt: capturedAt + DAY,
    });
    expect(r3.action).toBe("inserted");
    const after3 = await admin.query(
      api.metricSnapshots.listSnapshotsByPublication,
      { publicationId: pubId },
    );
    expect(after3.filter((s) => s.source === "youtube").length).toBe(2);

    // ── Intégration — vuesLatest suit le dernier relevé + indicateur posé ─────
    const pubs = await admin.query(api.publications.listPublications, {
      snapshotAge: "latest",
    });
    const pub = pubs.find((p) => p._id === pubId)!;
    expect(pub.vuesLatest).toBe(2000); // vues YouTube NON régressées
    expect(pub.postTitle).toBe("Mon titre YouTube"); // titre snippet capturé
    expect(pub.lastYouTubeSyncAt).toBeTruthy();

    // Le Tracker affiche le TITRE YouTube au lieu de « (sans titre) ».
    const trackerRows = await admin.query(api.trackerData.listTrackerPosts, {});
    const ytRow = trackerRows.find((r) => r._id === pubId)!;
    expect(ytRow.label).toBe("Mon titre YouTube");

    // ── Isolation — le créateur ne peut PAS déclencher la sync ───────────────
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] YTc ${ts}`,
      email: `e2e-creator-yt-${ts}@repackit.test`,
      password: "yt-sync-12345",
    });
    await expect(
      creator.client.mutation(api.youtubeSync.requestYouTubeSync, {
        projectId: creator.projectId,
      }),
    ).rejects.toThrow();

    // L'admin, lui, peut planifier le relevé (asynchrone).
    const scheduled = await admin.mutation(api.youtubeSync.requestYouTubeSync, {});
    expect(scheduled).toEqual({ scheduled: true });

    // ── UI — bouton « Synchroniser YouTube » sur la vue tracker ──────────────
    await page.goto(adminPath("/dashboard"));
    await page.getByRole("radio", { name: "Tracker" }).click();
    const syncBtn = page.getByRole("button", { name: /Synchroniser YouTube/i });
    await expect(syncBtn).toBeVisible();
    await syncBtn.click();
    await expect(
      page.getByRole("button", { name: /Sync lancée/i }),
    ).toBeVisible();

    // Nettoyage (les snapshots orphelins seront purgés par le global-setup).
    await admin.mutation(api.publications.deletePublication, { id: pubId });
  });
});
