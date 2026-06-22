import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { ConvexHttpClient } from "convex/browser";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;

/** Upload d'un blob vidéo minimal sous le contentType demandé (on teste le
 *  câblage storage + le bouton de download, pas la lecture). */
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

/**
 * Contournement HEVC : sur une vidéo .mov DÉJÀ soumise (que le navigateur ne
 * sait pas afficher), l'écran Validation expose un bouton « Télécharger la
 * vidéo » qui pointe sur le FICHIER ORIGINAL stocké (URL signée Convex du
 * storageId). Valider/Refuser restent accessibles.
 */
test.describe("Validation — bouton télécharger la vidéo soumise", () => {
  test("bouton présent + href = URL du fichier stocké (.mov HEVC)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] DLBtn ${ts}`,
      email: `e2e-creator-dlbtn-${ts}@repackit.test`,
      password: "creator-dlbtn-12345",
    });
    const projectId = creator.projectId;

    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Format DL ${ts}`,
      type: "short",
      rateModel: { basePerPost: 5 },
    });
    const target = await availableTarget({
      e2eClient: admin,
      creatorId: creator.creatorId,
      platform: "TikTok",
      handle: `@e2edl${ts}`,
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

    // Le créateur soumet un .mov (video/quicktime) : le navigateur ne le lira
    // pas, mais le fichier ORIGINAL est bien stocké et téléchargeable.
    const storageId = await uploadFakeVideo(creator.client, "video/quicktime");
    await creator.client.mutation(api.assignments.submitVideo, {
      projectId,
      id: a._id,
      storageId,
      mimeType: "video/quicktime",
    });

    // URL attendue = celle résolue serveur depuis le storageId (getUrl).
    const row = (
      await admin.query(api.assignments.listVideoSubmitted, {})
    ).find((r) => r._id === a._id)!;
    expect(row.videoUrl).toBeTruthy();

    await page.goto(adminPath("/validation"));

    const downloadBtn = page.getByTestId(`download-${a._id}`);
    await expect(downloadBtn).toBeVisible({ timeout: 15_000 });
    // Pointe sur le fichier original stocké (le storageId de la soumission).
    await expect(downloadBtn).toHaveAttribute("href", row.videoUrl!);
    // Nom de fichier lisible, extension .mov (HEVC iPhone).
    const dl = await downloadBtn.getAttribute("download");
    expect(dl).toMatch(/\.mov$/);

    // Valider/Refuser restent accessibles (rien cassé).
    await expect(page.getByTestId(`approve-${a._id}`)).toBeVisible();
  });
});
