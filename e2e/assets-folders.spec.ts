import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import {
  createE2eClient,
  E2E_EMAIL,
  E2E_PASSWORD,
} from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";
import { createFormatWithRate } from "./helpers/formats";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;
const PNG_1x1_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function rawAuthedClient(): Promise<ConvexHttpClient> {
  const raw = new ConvexHttpClient(url!);
  const signin = await raw.action(api.auth.signIn, {
    provider: "password",
    params: { email: E2E_EMAIL, password: E2E_PASSWORD, flow: "signIn" },
  });
  const token = signin.tokens?.token;
  if (!token) throw new Error("signIn e2e sans token");
  raw.setAuth(token);
  return raw;
}

async function uploadBlob(
  raw: ConvexHttpClient,
  contentTypeHeader = "image/png",
): Promise<Id<"_storage">> {
  const uploadUrl = await raw.mutation(api.storage.generateUploadUrl, {});
  const bytes = Buffer.from(PNG_1x1_B64, "base64");
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentTypeHeader },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload HTTP ${res.status}`);
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  return storageId;
}

test.describe("Assets — PLUSIEURS dossiers liés à un assignment", () => {
  test("lier 2 dossiers, retrait à l'unité, créateur voit tout, isolation", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creatorA = await createCreatorSession(url, {
      name: `[E2E_TEST] MultiA ${ts}`,
      email: `e2e-creator-multia-${ts}@repackit.test`,
      password: "multia-12345",
    });
    const creatorB = await createCreatorSession(url, {
      name: `[E2E_TEST] MultiB ${ts}`,
      email: `e2e-creator-multib-${ts}@repackit.test`,
      password: "multib-12345",
    });
    const projectId = creatorA.projectId;
    const raw = await rawAuthedClient();

    // ── 2 dossiers : folder1 (image + vidéo = 2), folder2 (1 image) ──────────
    const folder1 = await admin.mutation(api.assets.createAssetFolder, {
      name: `[E2E_TEST] Multi1 ${ts}`,
    });
    await admin.mutation(api.assets.createAsset, {
      folderId: folder1,
      storageId: await uploadBlob(raw, "image/png"),
      fileName: "logo.png",
      contentType: "image/png",
      size: 1024,
    });
    await admin.mutation(api.assets.createAsset, {
      folderId: folder1,
      storageId: await uploadBlob(raw, "video/mp4"),
      fileName: "clip.mp4",
      contentType: "video/mp4",
      size: 50 * 1024 * 1024,
    });
    const folder2 = await admin.mutation(api.assets.createAssetFolder, {
      name: `[E2E_TEST] Multi2 ${ts}`,
    });
    await admin.mutation(api.assets.createAsset, {
      folderId: folder2,
      storageId: await uploadBlob(raw, "image/png"),
      fileName: "overlay.png",
      contentType: "image/png",
      size: 2048,
    });

    // ── Validation toujours active : type non supporté rejeté + purge blob ───
    await expect(
      admin.mutation(api.assets.createAsset, {
        folderId: folder1,
        storageId: await uploadBlob(raw, "image/png"),
        fileName: "doc.pdf",
        contentType: "application/pdf",
        size: 1024,
      }),
    ).rejects.toThrow(/refus/i);

    // ── Assignment (format) pour A + LIER LES 2 DOSSIERS ─────────────────────
    const formatId = await createFormatWithRate(admin, {
      name: `[E2E_TEST] MultiFmt ${ts}`,
      type: "short",
      // Format volontairement GRATUIT : zéro EXPLICITE, pas une grille absente —
    // sans quoi la garde de paie refuse l'assignation (et elle a raison).
    rateModel: { basePerPost: 0 },
  });
    const tA = await availableTarget({
      e2eClient: admin,
      creatorId: creatorA.creatorId,
      platform: "TikTok",
      handle: `@e2emultia${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creatorA.creatorId,
      targets: [tA],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    const aRow = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.formatId === formatId && x.creatorId === creatorA.creatorId,
    )!;
    await admin.mutation(api.assignments.setAssetFolders, {
      id: aRow._id,
      folderIds: [folder1, folder2],
    });

    // Badge admin : 2 dossiers liés, total 3 fichiers (2 + 1).
    const aLinked = (
      await admin.query(api.assignments.listAssignments, {})
    ).find((x) => x._id === aRow._id)!;
    expect(aLinked.linkedFolderIds.length).toBe(2);
    expect(aLinked.assetFolderCount).toBe(3);

    // ── Créateur A voit les DEUX dossiers (groupés), vidéo incluse ───────────
    const mineA = await creatorA.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: aRow._id,
    });
    expect(mineA!.assets).not.toBeNull();
    expect(mineA!.assets!.folders.length).toBe(2);
    const totalItems = mineA!.assets!.folders.reduce(
      (n, f) => n + f.items.length,
      0,
    );
    expect(totalItems).toBe(3);
    const hasVideo = mineA!.assets!.folders.some((f) =>
      f.items.some((i) => i.contentType === "video/mp4" && i.url),
    );
    expect(hasVideo).toBe(true);

    // ── Retrait d'un dossier (setAssetFolders → [folder1]) ───────────────────
    await admin.mutation(api.assignments.setAssetFolders, {
      id: aRow._id,
      folderIds: [folder1],
    });
    const aOne = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x._id === aRow._id,
    )!;
    expect(aOne.linkedFolderIds.length).toBe(1);
    expect(aOne.assetFolderCount).toBe(2);
    const mineAOne = await creatorA.client.query(
      api.assignments.getMyAssignment,
      { projectId, id: aRow._id },
    );
    expect(mineAOne!.assets!.folders.length).toBe(1);

    // ── ISOLATION : B sans dossier → null ; B ne lit pas A ───────────────────
    const tB = await availableTarget({
      e2eClient: admin,
      creatorId: creatorB.creatorId,
      platform: "TikTok",
      handle: `@e2emultib${ts}`,
    });
    await admin.mutation(api.assignments.assignFormat, {
      formatId,
      creatorId: creatorB.creatorId,
      targets: [tB],
      postsPerCreator: 1,
      dueDate: ts + 7 * DAY,
    });
    const bRow = (await admin.query(api.assignments.listAssignments, {})).find(
      (x) => x.formatId === formatId && x.creatorId === creatorB.creatorId,
    )!;
    const mineB = await creatorB.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: bRow._id,
    });
    expect(mineB!.assets).toBeNull();
    const bSeesA = await creatorB.client.query(
      api.assignments.getMyAssignment,
      { projectId, id: aRow._id },
    );
    expect(bSeesA).toBeNull();

    // ── Tout délier → A ne voit plus d'assets ────────────────────────────────
    await admin.mutation(api.assignments.setAssetFolders, {
      id: aRow._id,
      folderIds: [],
    });
    const mineAEmpty = await creatorA.client.query(
      api.assignments.getMyAssignment,
      { projectId, id: aRow._id },
    );
    expect(mineAEmpty!.assets).toBeNull();
  });
});
