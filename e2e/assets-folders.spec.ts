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
// PNG 1×1 valide (transparent).
const PNG_1x1_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Client authentifié BRUT (pas d'injection projectId) pour generateUploadUrl
 *  (authedMutation à args vides — l'injection projectId la ferait rejeter). */
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

/** Upload un blob image via le flow Convex (generateUploadUrl → POST). */
async function uploadImageBlob(
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

test.describe("Assets — dossiers d'images liés aux assignments", () => {
  test("upload image OK, non-image/trop gros rejetés, lien + visibilité + isolation créateur", async () => {
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

    // ── Dossier + upload image (réel blob) ───────────────────────────────────
    const folderId = await admin.mutation(api.assets.createAssetFolder, {
      name: `[E2E_TEST] Assets ${ts}`,
    });
    const okBlob = await uploadImageBlob(raw, "image/png");
    await admin.mutation(api.assets.createAsset, {
      folderId,
      storageId: okBlob.storageId,
      fileName: "logo.png",
      contentType: "image/png",
      size: okBlob.size,
    });

    // Liste (scopée projet) : dossier + 1 image avec URL signée.
    const folders = await admin.query(api.assets.listAssetFolders, {});
    const folder = folders.find((f) => f._id === folderId)!;
    expect(folder.assetCount).toBe(1);
    const assets = await admin.query(api.assets.listAssets, { folderId });
    expect(assets.length).toBe(1);
    expect(assets[0].url).toBeTruthy();
    expect(assets[0].fileName).toBe("logo.png");

    // ── Rejets serveur : non-image + trop gros ───────────────────────────────
    const badType = await uploadImageBlob(raw, "image/png");
    await expect(
      admin.mutation(api.assets.createAsset, {
        folderId,
        storageId: badType.storageId,
        fileName: "clip.mp4",
        contentType: "video/mp4", // pas une image → refus
        size: badType.size,
      }),
    ).rejects.toThrow(/images|refus/i);

    const tooBig = await uploadImageBlob(raw, "image/png");
    await expect(
      admin.mutation(api.assets.createAsset, {
        folderId,
        storageId: tooBig.storageId,
        fileName: "huge.png",
        contentType: "image/png",
        size: 11 * 1024 * 1024, // > 10 Mo → refus
      }),
    ).rejects.toThrow(/images|refus|Mo/i);

    // Toujours 1 seule image (les rejets n'ont rien enregistré).
    expect((await admin.query(api.assets.listAssets, { folderId })).length).toBe(
      1,
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
    // Badge admin : dossier lié + compteur.
    const aLinked = (
      await admin.query(api.assignments.listAssignments, {})
    ).find((x) => x._id === aRow._id)!;
    expect(aLinked.assetFolderName).toBe(`[E2E_TEST] Assets ${ts}`);
    expect(aLinked.assetFolderCount).toBe(1);

    // ── Créateur A voit les assets (téléchargeables) ─────────────────────────
    const mineA = await creatorA.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: aRow._id,
    });
    expect(mineA!.assets).not.toBeNull();
    expect(mineA!.assets!.items.length).toBe(1);
    expect(mineA!.assets!.items[0].url).toBeTruthy();

    // ── ISOLATION : B a son propre assignment SANS dossier → assets null ;
    //    B ne peut pas lire l'assignment de A. ─────────────────────────────────
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
    expect(mineB!.assets).toBeNull(); // B n'a aucun dossier lié
    // B ne voit pas l'assignment (ni les assets) de A.
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
