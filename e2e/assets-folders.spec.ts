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

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

const DAY = 86_400_000;
// PNG 1×1 valide (transparent) — sert de blob léger ; le contentType de l'arg
// createAsset (pas les octets) pilote la validation type/taille côté serveur.
const PNG_1x1_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Client authentifié BRUT (pas d'injection projectId) pour generateUploadUrl. */
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

/** Upload un blob léger via Convex storage (header content-type paramétrable). */
async function uploadBlob(
  raw: ConvexHttpClient,
  contentTypeHeader = "image/png",
): Promise<{ storageId: Id<"_storage">; size: number }> {
  const uploadUrl = await raw.mutation(api.storage.generateUploadUrl, {});
  const bytes = Buffer.from(PNG_1x1_B64, "base64");
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentTypeHeader },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload HTTP ${res.status}`);
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  return { storageId, size: bytes.length };
}

test.describe("Assets — images ET vidéos en dossiers liés aux assignments", () => {
  test("upload image+vidéo OK, vidéo trop grosse / type non supporté rejetés, visibilité + isolation créateur", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creatorA = await createCreatorSession(url, {
      name: `[E2E_TEST] AssetsA ${ts}`,
      email: `e2e-creator-assetsa-${ts}@repackit.test`,
      password: "assetsa-12345",
    });
    const creatorB = await createCreatorSession(url, {
      name: `[E2E_TEST] AssetsB ${ts}`,
      email: `e2e-creator-assetsb-${ts}@repackit.test`,
      password: "assetsb-12345",
    });
    const projectId = creatorA.projectId;
    const raw = await rawAuthedClient();

    // ── Dossier + image (≤ 10 Mo) + vidéo (≤ 100 Mo) ─────────────────────────
    const folderId = await admin.mutation(api.assets.createAssetFolder, {
      name: `[E2E_TEST] Assets ${ts}`,
    });
    const img = await uploadBlob(raw, "image/png");
    await admin.mutation(api.assets.createAsset, {
      folderId,
      storageId: img.storageId,
      fileName: "logo.png",
      contentType: "image/png",
      size: img.size,
    });
    const vid = await uploadBlob(raw, "video/mp4");
    await admin.mutation(api.assets.createAsset, {
      folderId,
      storageId: vid.storageId,
      fileName: "clip.mp4",
      contentType: "video/mp4",
      size: 50 * 1024 * 1024, // 50 Mo : OK pour une vidéo
    });

    const assets = await admin.query(api.assets.listAssets, { folderId });
    expect(assets.length).toBe(2);
    const imageItem = assets.find((a) => a.contentType === "image/png")!;
    const videoItem = assets.find((a) => a.contentType === "video/mp4")!;
    expect(imageItem.url).toBeTruthy();
    expect(videoItem.url).toBeTruthy();
    expect(videoItem.fileName).toBe("clip.mp4");
    const folder = (await admin.query(api.assets.listAssetFolders, {})).find(
      (f) => f._id === folderId,
    )!;
    expect(folder.assetCount).toBe(2);

    // ── Rejets serveur : type non supporté / vidéo trop grosse / image trop
    //    grosse (limite PAR type). Blob réel à chaque fois (purgé sur rejet). ──
    const bad1 = await uploadBlob(raw, "image/png");
    await expect(
      admin.mutation(api.assets.createAsset, {
        folderId,
        storageId: bad1.storageId,
        fileName: "doc.pdf",
        contentType: "application/pdf", // ni image ni vidéo → refus
        size: 1024,
      }),
    ).rejects.toThrow(/refus/i);

    const bad2 = await uploadBlob(raw, "video/mp4");
    await expect(
      admin.mutation(api.assets.createAsset, {
        folderId,
        storageId: bad2.storageId,
        fileName: "huge.mp4",
        contentType: "video/mp4",
        size: 101 * 1024 * 1024, // > 100 Mo → refus
      }),
    ).rejects.toThrow(/refus/i);

    const bad3 = await uploadBlob(raw, "image/png");
    await expect(
      admin.mutation(api.assets.createAsset, {
        folderId,
        storageId: bad3.storageId,
        fileName: "huge.png",
        contentType: "image/png",
        size: 11 * 1024 * 1024, // > 10 Mo (limite image) → refus
      }),
    ).rejects.toThrow(/refus/i);

    // Toujours 2 fichiers (les rejets n'ont rien enregistré).
    expect((await admin.query(api.assets.listAssets, { folderId })).length).toBe(
      2,
    );

    // ── Assignment (format) pour A + lien du dossier ─────────────────────────
    const formatId = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] AssetsFmt ${ts}`,
      type: "short",
    });
    const tA = await availableTarget({
      e2eClient: admin,
      creatorId: creatorA.creatorId,
      platform: "TikTok",
      handle: `@e2eassetsa${ts}`,
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
    await admin.mutation(api.assignments.linkAssetFolder, {
      id: aRow._id,
      folderId,
    });
    const aLinked = (
      await admin.query(api.assignments.listAssignments, {})
    ).find((x) => x._id === aRow._id)!;
    expect(aLinked.assetFolderCount).toBe(2);

    // ── Créateur A voit image + vidéo (lecture/téléchargement) ───────────────
    const mineA = await creatorA.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: aRow._id,
    });
    expect(mineA!.assets).not.toBeNull();
    expect(mineA!.assets!.items.length).toBe(2);
    const creatorVideo = mineA!.assets!.items.find(
      (i) => i.contentType === "video/mp4",
    )!;
    expect(creatorVideo.url).toBeTruthy(); // téléchargeable
    expect(
      mineA!.assets!.items.some((i) => i.contentType === "image/png"),
    ).toBe(true);

    // ── ISOLATION (inchangée) : B sans dossier → null ; B ne lit pas A. ───────
    const tB = await availableTarget({
      e2eClient: admin,
      creatorId: creatorB.creatorId,
      platform: "TikTok",
      handle: `@e2eassetsb${ts}`,
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

    // ── Délier : A ne voit plus d'assets ─────────────────────────────────────
    await admin.mutation(api.assignments.linkAssetFolder, {
      id: aRow._id,
      folderId: null,
    });
    const mineAUnlinked = await creatorA.client.query(
      api.assignments.getMyAssignment,
      { projectId, id: aRow._id },
    );
    expect(mineAUnlinked!.assets).toBeNull();
  });
});
