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

/**
 * Attachement de pièces jointes DÈS l'assignation d'un script (dossiers d'assets
 * + vidéos modèles), via la mutation UNITAIRE `assignScriptCampaign` — la MÊME que
 * la boucle client rappelle par créateur en mode « Plusieurs créateurs ». Vérifie :
 * fan-out (chaque vidéo créée porte les pièces jointes), dédoublonnage d'URL,
 * rejet atomique d'une URL invalide (rien créé), visibilité côté créateur au MÊME
 * endroit que l'attachement manuel, et non-régression (sans pièces jointes = rows
 * strictement inchangées).
 */
test.describe("Scripts — pièces jointes attachées dès l'assignation", () => {
  test("dossiers + vidéos modèles à la création : fan-out, dédup, isolation, créateur", async () => {
    test.setTimeout(150_000);
    const ts = Date.now();
    const creatorA = await createCreatorSession(url, {
      name: `[E2E_TEST] AttachA ${ts}`,
      email: `e2e-creator-attacha-${ts}@repackit.test`,
      password: "attacha-12345",
    });
    const creatorB = await createCreatorSession(url, {
      name: `[E2E_TEST] AttachB ${ts}`,
      email: `e2e-creator-attachb-${ts}@repackit.test`,
      password: "attachb-12345",
    });
    const projectId = creatorA.projectId;
    const raw = await rawAuthedClient();

    // ── Campagne (3 combos : 3 hooks × 1 flux × 1 cta) + pricing obligatoire ──
    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Attach ${ts}`,
    });
    const addBrick = (kind: "hook" | "flux" | "cta", label: string) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} contenu`,
      });
    await addBrick("hook", "H1");
    await addBrick("hook", "H2");
    await addBrick("hook", "H3");
    await addBrick("flux", "F");
    await addBrick("cta", "C");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingAttach ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });

    // ── 2 dossiers d'assets : folder1 (image + vidéo = 2), folder2 (1 image) ──
    const folder1 = await admin.mutation(api.assets.createAssetFolder, {
      name: `[E2E_TEST] AttachF1 ${ts}`,
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
      name: `[E2E_TEST] AttachF2 ${ts}`,
    });
    await admin.mutation(api.assets.createAsset, {
      folderId: folder2,
      storageId: await uploadBlob(raw, "image/png"),
      fileName: "overlay.png",
      contentType: "image/png",
      size: 2048,
    });

    const targetA = await availableTarget({
      e2eClient: admin,
      creatorId: creatorA.creatorId,
      platform: "TikTok",
      handle: `@e2eattacha${ts}`,
    });

    // ── REJET ATOMIQUE : URL de vidéo modèle invalide → rien n'est créé ───────
    await expect(
      admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId: creatorA.creatorId,
        targets: [targetA],
        videosPerCreator: 1,
        dueDate: ts + 7 * DAY,
        pricingId,
        modelVideos: [{ url: "tiktok.com/@x/video/1" }],
      }),
    ).rejects.toThrow(/invalide/i);
    const afterInvalid = (
      await admin.query(api.assignments.listAssignments, {})
    ).filter(
      (a) =>
        a.scriptCombo?.campaignId === campaignId &&
        a.creatorId === creatorA.creatorId,
    );
    expect(afterInvalid).toHaveLength(0); // aucun combo consommé, rien inséré

    // ── ATTACHEMENT à la création : 2 vidéos × (2 dossiers + 2 vidéos modèles) ─
    // 3 URLs en entrée dont 1 doublon → 2 vidéos modèles dédoublonnées.
    const u1 = "https://www.tiktok.com/@x/video/123";
    const u2 = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const res = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creatorA.creatorId,
      targets: [targetA],
      videosPerCreator: 2,
      dueDate: ts + 7 * DAY,
      pricingId,
      assetFolderIds: [folder1, folder2],
      modelVideos: [
        { url: u1, title: "Ref TikTok", note: "Reproduis le hook" },
        { url: u1 }, // doublon d'URL → ignoré
        { url: u2 },
      ],
    });
    expect(res.created).toBe(2);

    // Chaque assignment créé (une par vidéo) porte les MÊMES pièces jointes.
    const rowsA = (await admin.query(api.assignments.listAssignments, {})).filter(
      (a) =>
        a.scriptCombo?.campaignId === campaignId &&
        a.creatorId === creatorA.creatorId,
    );
    expect(rowsA).toHaveLength(2);
    for (const row of rowsA) {
      expect(row.linkedFolderIds.length).toBe(2);
      expect(row.assetFolderCount).toBe(3); // 2 (folder1) + 1 (folder2)
      expect(row.modelVideos ?? []).toHaveLength(2);
      const urls = (row.modelVideos ?? []).map((m) => m.url);
      expect(urls).toContain(u1);
      expect(urls).toContain(u2);
      const tiktok = (row.modelVideos ?? []).find((m) => m.url === u1)!;
      expect(tiktok.title).toBe("Ref TikTok");
      expect(tiktok.note).toBe("Reproduis le hook");
    }

    // ── CRÉATEUR : voit assets + vidéos modèles au MÊME endroit qu'un
    //    attachement manuel (getMyAssignment → assets.folders / modelVideos). ──
    for (const row of rowsA) {
      const mine = await creatorA.client.query(
        api.assignments.getMyAssignment,
        { projectId, id: row._id },
      );
      expect(mine).toBeTruthy();
      expect(mine!.assets).not.toBeNull();
      expect(mine!.assets!.folders.length).toBe(2);
      const totalItems = mine!.assets!.folders.reduce(
        (n, f) => n + f.items.length,
        0,
      );
      expect(totalItems).toBe(3);
      expect(mine!.assignment.modelVideos ?? []).toHaveLength(2);
    }

    // ── NON-RÉGRESSION : sans pièces jointes, la row est inchangée ────────────
    const targetB = await availableTarget({
      e2eClient: admin,
      creatorId: creatorB.creatorId,
      platform: "TikTok",
      handle: `@e2eattachb${ts}`,
    });
    const resB = await admin.mutation(api.scripts.assignScriptCampaign, {
      campaignId,
      creatorId: creatorB.creatorId,
      targets: [targetB],
      videosPerCreator: 1,
      dueDate: ts + 7 * DAY,
      pricingId,
    });
    expect(resB.created).toBe(1);
    const rowB = (
      await admin.query(api.assignments.listAssignments, {})
    ).find(
      (a) =>
        a.scriptCombo?.campaignId === campaignId &&
        a.creatorId === creatorB.creatorId,
    )!;
    expect(rowB.linkedFolderIds.length).toBe(0);
    expect(rowB.modelVideos ?? []).toHaveLength(0);
    const mineB = await creatorB.client.query(api.assignments.getMyAssignment, {
      projectId,
      id: rowB._id,
    });
    expect(mineB!.assets).toBeNull();
    expect(mineB!.assignment.modelVideos ?? []).toHaveLength(0);
  });
});
