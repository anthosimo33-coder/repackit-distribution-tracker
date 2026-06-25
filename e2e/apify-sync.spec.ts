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
 * Tracking auto TikTok/Instagram (Apify) — vérifie la LOGIQUE déterministe SANS
 * appel Apify réel (le relevé réel est testé avec le token posé). Apify est
 * "mocké" par construction : e2eRecordApifySnapshot exerce le VRAI code path
 * d'upsert (recompute + paliers + indicateur) en injectant directement les vues,
 * sans réseau. On couvre :
 *  - idempotence par jour, par source (1 snapshot/pub/jour/source, MAJ le même
 *    jour, nouveau point le lendemain) — même robustesse de bord de jour qu'YT ;
 *  - les DEUX sources (tiktok, instagram) ;
 *  - intégration : vuesLatest + lastApifySyncAt maintenus ;
 *  - isolation : le créateur ne peut PAS déclencher la sync ;
 *  - UI : le bouton « Synchroniser TikTok/Insta » est présent et déclenchable.
 */
test.describe("Tracking auto des vues TikTok/Instagram (Apify)", () => {
  test("idempotence par source, intégration latest, isolation, bouton manuel", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();

    // Un Short nécessite un ICP.
    const icpId = (await admin.mutation(api.icps.createIcp, {
      nom: `[E2E_TEST] Apify ${ts}`,
    })) as Id<"icps">;

    async function makeShort(plateforme: "TikTok" | "Instagram", postUrl: string) {
      const carouselId = await admin.query(
        api.publications.getNextCarouselId,
        {},
      );
      const { ids } = await admin.mutation(api.publications.createPublication, {
        carouselId,
        hookId: null,
        hookText: `[E2E] Apify ${plateforme} ${ts}`,
        mecanique: "Erreur",
        niveau: "Broad-A",
        mediaType: "short",
        script: "script e2e",
        angleTonal: "Psycho",
        langue: "FR",
        icpId,
        plateformes: [plateforme],
        compte: `@e2e_${plateforme.toLowerCase()}`,
        datePubli: ts - 5 * DAY, // actif (< 90 jours)
        notes: "[E2E_TEST] apify-sync",
      });
      const pubId = ids[0] as Id<"publications">;
      await admin.mutation(api.publications.updateMetrics, { id: pubId, postUrl });
      return pubId;
    }

    const tkId = await makeShort(
      "TikTok",
      "https://www.tiktok.com/@e2e/video/7234567890123456789",
    );
    const igId = await makeShort(
      "Instagram",
      "https://www.instagram.com/reel/Ce2eReel01/",
    );

    // ── Idempotence TikTok — ANCRÉ à MIDI UTC (cf youtube-sync : évite le flake
    //    de bord de jour si le run tombe dans la dernière heure UTC). ─────────
    const capturedAt = Math.floor(ts / DAY) * DAY + 12 * HOUR;
    const r1 = await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
      secret: E2E_SECRET,
      publicationId: tkId,
      vues: 1000,
      capturedAt,
      source: "tiktok",
    });
    expect(r1.action).toBe("inserted");

    // Re-run le MÊME jour (UTC) avec un relevé plus frais → MAJ, pas de doublon.
    const r2 = await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
      secret: E2E_SECRET,
      publicationId: tkId,
      vues: 1500,
      capturedAt: capturedAt + HOUR,
      source: "tiktok",
    });
    expect(r2.action).toBe("updated");

    const afterTk = await admin.query(
      api.metricSnapshots.listSnapshotsByPublication,
      { publicationId: tkId },
    );
    const tkSnaps = afterTk.filter((s) => s.source === "tiktok");
    expect(tkSnaps.length).toBe(1); // un SEUL snapshot tiktok ce jour-là
    expect(tkSnaps[0].vues).toBe(1500); // valeur mise à jour

    // Le lendemain → NOUVEAU point, AVEC likes (diggCount) + titre (légende).
    const r3 = await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
      secret: E2E_SECRET,
      publicationId: tkId,
      vues: 2000,
      likes: 42,
      title: "Ma légende TikTok",
      capturedAt: capturedAt + DAY,
      source: "tiktok",
    });
    expect(r3.action).toBe("inserted");
    const afterTk2 = await admin.query(
      api.metricSnapshots.listSnapshotsByPublication,
      { publicationId: tkId },
    );
    expect(afterTk2.filter((s) => s.source === "tiktok").length).toBe(2);

    // ── Source instagram — chemin distinct, même upsert ──────────────────────
    const rIg = await admin.mutation(api.apifySync.e2eRecordApifySnapshot, {
      secret: E2E_SECRET,
      publicationId: igId,
      vues: 777,
      capturedAt,
      source: "instagram",
    });
    expect(rIg.action).toBe("inserted");
    const afterIg = await admin.query(
      api.metricSnapshots.listSnapshotsByPublication,
      { publicationId: igId },
    );
    const igSnaps = afterIg.filter((s) => s.source === "instagram");
    expect(igSnaps.length).toBe(1);
    expect(igSnaps[0].vues).toBe(777);

    // ── Intégration — vuesLatest suit le dernier relevé + indicateur posé ─────
    const pubs = await admin.query(api.publications.listPublications, {
      snapshotAge: "latest",
    });
    const tkPub = pubs.find((p) => p._id === tkId)!;
    expect(tkPub.vuesLatest).toBe(2000);
    // Likes Apify (diggCount) écrits → likesLatest ; titre (légende) → postTitle.
    expect(tkPub.likesLatest).toBe(42);
    expect(tkPub.postTitle).toBe("Ma légende TikTok");
    expect(tkPub.lastApifySyncAt).toBeTruthy();
    const igPub = pubs.find((p) => p._id === igId)!;
    expect(igPub.vuesLatest).toBe(777);
    expect(igPub.lastApifySyncAt).toBeTruthy();

    // Le Tracker affiche le TITRE (postTitle) au lieu de « (sans titre) ».
    const trackerRows = await admin.query(api.trackerData.listTrackerPosts, {});
    const tkRow = trackerRows.find((r) => r._id === tkId)!;
    expect(tkRow.label).toBe("Ma légende TikTok");

    // ── Isolation — le créateur ne peut PAS déclencher la sync ───────────────
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Apifyc ${ts}`,
      email: `e2e-creator-apify-${ts}@repackit.test`,
      password: "apify-sync-12345",
    });
    await expect(
      creator.client.mutation(api.apifySync.requestApifySync, {
        projectId: creator.projectId,
      }),
    ).rejects.toThrow();

    // L'admin, lui, peut planifier le relevé (asynchrone).
    const scheduled = await admin.mutation(api.apifySync.requestApifySync, {});
    expect(scheduled).toEqual({ scheduled: true });

    // ── UI — bouton « Synchroniser TikTok/Insta » sur la vue tracker ─────────
    await page.goto(adminPath("/dashboard"));
    await page.getByRole("radio", { name: "Tracker" }).click();
    const syncBtn = page.getByRole("button", {
      name: /Synchroniser TikTok\/Insta/i,
    });
    await expect(syncBtn).toBeVisible();
    await syncBtn.click();
    await expect(
      page.getByRole("button", { name: /Sync lancée/i }),
    ).toBeVisible();

    // Nettoyage (les snapshots orphelins seront purgés par le global-setup).
    await admin.mutation(api.publications.deletePublication, { id: tkId });
    await admin.mutation(api.publications.deletePublication, { id: igId });
  });
});
