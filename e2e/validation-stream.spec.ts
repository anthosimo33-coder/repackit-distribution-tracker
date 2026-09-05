import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { ConvexHttpClient } from "convex/browser";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const envUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!envUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const url: string = envUrl;
const admin = createE2eClient(url);

const DAY = 86_400_000;

/** Blob vidéo minimal (on teste le rendu du player/fallback, pas la lecture). */
async function uploadFakeVideo(
  client: ConvexHttpClient,
  contentType: string,
): Promise<Id<"_storage">> {
  const uploadUrl = await client.mutation(api.storage.generateUploadUrl, {});
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]),
  });
  if (!res.ok) throw new Error(`upload échoué (HTTP ${res.status})`);
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  return storageId;
}

/** Crée une soumission .mov (HEVC) prête à valider, renvoie son assignment id. */
async function makeSubmission(tag: string): Promise<Id<"assignments">> {
  const ts = Date.now();
  const creator = await createCreatorSession(url, {
    name: `[E2E_TEST] Stream ${tag} ${ts}`,
    email: `e2e-creator-stream-${tag}-${ts}@repackit.test`,
    password: "creator-stream-12345",
  });
  const formatId = await createFormatWithRate(admin, {
    name: `[E2E_TEST] Format Stream ${tag} ${ts}`,
    type: "short",
    rateModel: { basePerPost: 5 },
  });
  const target = await availableTarget({
    e2eClient: admin,
    creatorId: creator.creatorId,
    platform: "TikTok",
    handle: `@e2estream${tag}${ts}`,
  });
  await admin.mutation(api.assignments.assignFormat, {
    formatId,
    creatorId: creator.creatorId,
    targets: [target],
    postsPerCreator: 1,
    dueDate: ts + 7 * DAY,
  });
  const a = (await admin.query(api.assignments.listAssignments, {})).find(
    (x) => x.formatId === formatId && x.creatorId === creator.creatorId,
  )!;
  // .mov HEVC : illisible dans le navigateur, mais le blob Convex existe (source
  // + bouton télécharger). Le scheduler startStreamCopy no-op en CI (env absent).
  const storageId = await uploadFakeVideo(creator.client, "video/quicktime");
  await creator.client.mutation(api.assignments.submitVideo, {
    projectId: creator.projectId,
    id: a._id,
    storageId,
    mimeType: "video/quicktime",
  });
  return a._id;
}

/**
 * Vidéos de validation via Cloudflare Stream. CLOUDFLARE EST MOCKÉ : on injecte
 * l'UID + l'état Stream directement (e2eSetSubmittedVideoStream), SANS appel
 * réseau réel — exactement comme apify-sync mocke Apify. On couvre les 3 rendus :
 *  - "ready"      → player Stream inline (iframe) ;
 *  - "processing" → message « transcoding en cours » ;
 *  - pas d'UID    → fallback <video> Convex + bouton télécharger (#56).
 * Le bouton télécharger reste présent dans tous les cas exploitables.
 */
test.describe("Validation — vidéos via Cloudflare Stream", () => {
  test("UID ready → player Stream inline + bouton télécharger conservé", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const id = await makeSubmission("ready");
    await admin.mutation(api.assignments.e2eSetSubmittedVideoStream, {
      secret: E2E_SECRET,
      id,
      uid: "e2eready123",
      status: "ready",
    });

    await page.goto(adminPath("/validation"));

    // Scopé à LA carte de cet assignment (la file en contient d'autres).
    const media = page.getByTestId(`submission-media-${id}`);
    const player = media.getByTestId("stream-player");
    await expect(player).toBeVisible({ timeout: 15_000 });
    await expect(player).toHaveAttribute(
      "src",
      "https://iframe.videodelivery.net/e2eready123",
    );
    // Le <video> Convex de fallback N'est PAS rendu quand le player Stream l'est.
    await expect(media.locator("video")).toHaveCount(0);
    // Bouton télécharger toujours là (complément utile).
    await expect(page.getByTestId(`download-${id}`)).toBeVisible();
  });

  test("UID processing → message de transcoding (pas encore de player)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const id = await makeSubmission("proc");
    await admin.mutation(api.assignments.e2eSetSubmittedVideoStream, {
      secret: E2E_SECRET,
      id,
      uid: "e2eproc456",
      status: "processing",
    });

    await page.goto(adminPath("/validation"));

    const media = page.getByTestId(`submission-media-${id}`);
    await expect(media.getByTestId("stream-processing")).toBeVisible({
      timeout: 15_000,
    });
    await expect(media.getByTestId("stream-player")).toHaveCount(0);
    await expect(page.getByTestId(`approve-${id}`)).toBeVisible();
  });

  test("sans UID Stream → fallback <video> Convex + télécharger", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const id = await makeSubmission("fallback");
    // Pas d'injection Stream : la soumission reste sur le blob Convex.

    await page.goto(adminPath("/validation"));

    // Sans UID Stream → chemin Convex : le bouton télécharger (#56) est là et
    // AUCUN élément Stream n'est rendu sur cette carte. (On n'assert pas la
    // balise <video> : le faux blob .mov échoue à décoder → message HEVC, pas
    // de <video> — exactement le contournement download que ce fallback vise.)
    await expect(page.getByTestId(`download-${id}`)).toBeVisible({
      timeout: 15_000,
    });
    const media = page.getByTestId(`submission-media-${id}`);
    await expect(media.getByTestId("stream-player")).toHaveCount(0);
    await expect(media.getByTestId("stream-processing")).toHaveCount(0);
  });
});
