import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

const E2E_MARKER = "[E2E_TEST]";

/**
 * Chantier vignettes — la récupération est PLANIFIÉE à la création
 * (scheduler.runAfter) et le résultat mis en CACHE sur la row. On exerce les
 * deux chemins déterministes (zéro réseau externe → pas de flake) :
 *   - YouTube : URL prévisible img.youtube.com/vi/<id>/hqdefault.jpg, status "ok".
 *   - Instagram : sans INSTAGRAM_OEMBED_TOKEN sur le deployment de test, oEmbed
 *     échoue PROPREMENT → status "failed", thumbnailUrl null (= fallback UI),
 *     création JAMAIS bloquée.
 * TikTok dépend d'un oEmbed réseau externe → non testé ici (flake CI) ;
 * couvert par les tests purs lib/thumbnail (parseOEmbedThumbnail).
 */

/** Poll getInspirationById jusqu'à ce que la vignette soit résolue (status posé). */
async function waitForResolved(
  id: Id<"inspirations">,
  timeoutMs = 15_000,
): Promise<NonNullable<Awaited<ReturnType<typeof getById>>>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await getById(id);
    if (row && row.thumbnailStatus !== undefined) return row;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Vignette non résolue dans ${timeoutMs}ms pour ${id}`);
}

function getById(id: Id<"inspirations">) {
  return admin.query(api.inspirations.getInspirationById, { id });
}

test.describe("Inspirations — vignettes auto (cache + fallback)", () => {
  test.beforeEach(async () => {
    await admin.mutation(api.inspirations.cleanupTestInspirations, {
      secret: E2E_SECRET,
    });
  });

  test("YouTube → vignette img.youtube en cache (status ok)", async () => {
    test.setTimeout(40_000);
    const id = (await admin.mutation(api.inspirations.createInspiration, {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      type: "video",
      plateforme: "YouTube",
      notes: `${E2E_MARKER} youtube thumb`,
    })) as Id<"inspirations">;

    const row = await waitForResolved(id);
    expect(row.thumbnailStatus).toBe("ok");
    expect(row.autoThumbnailUrl).toBe(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    // thumbnailUrl (résolu pour l'UI) reprend la vignette auto faute d'upload.
    expect(row.thumbnailUrl).toBe(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
  });

  test("Instagram sans token → fallback propre (status failed, pas de crash)", async () => {
    test.setTimeout(40_000);
    const id = (await admin.mutation(api.inspirations.createInspiration, {
      url: "https://www.instagram.com/reel/Cabc123def/",
      type: "video",
      plateforme: "Instagram",
      notes: `${E2E_MARKER} insta thumb`,
    })) as Id<"inspirations">;

    const row = await waitForResolved(id);
    expect(row.thumbnailStatus).toBe("failed");
    expect(row.autoThumbnailUrl).toBeUndefined();
    expect(row.thumbnailUrl).toBeNull();
  });
});
