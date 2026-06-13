import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import {
  createE2eClient,
  E2E_EMAIL,
  E2E_PASSWORD,
} from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * P6 — cycle de vie d'un exemple FICHIER : upload navigateur→storage (petit
 * mp4 de fixture, pas 300 Mo), résolution d'URL SERVEUR dans getFormat, puis
 * retrait de l'exemple → le blob est SUPPRIMÉ du storage (getPreviewUrl null).
 */
test.describe("Formats — exemple fichier (storage)", () => {
  test("upload → url résolue serveur → retrait supprime le blob", async () => {
    const ts = Date.now();

    // Client authentifié BRUT (pas d'injection projectId) pour generateUploadUrl
    // + getPreviewUrl (authedMutation/Query sans projectId).
    const raw = new ConvexHttpClient(convexUrl);
    const signin = await raw.action(api.auth.signIn, {
      provider: "password",
      params: { email: E2E_EMAIL, password: E2E_PASSWORD, flow: "signIn" },
    });
    const token = signin.tokens?.token;
    if (!token) throw new Error("signIn e2e sans token");
    raw.setAuth(token);

    const fid = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] File ${ts}`,
      type: "short",
    });

    // Upload d'un petit blob mp4.
    const uploadUrl = await raw.mutation(api.storage.generateUploadUrl, {});
    const bytes = new Uint8Array(2048).fill(7); // contenu factice ~2 Ko
    const resp = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "video/mp4" },
      body: bytes,
    });
    expect(resp.ok).toBe(true);
    const { storageId } = (await resp.json()) as { storageId: Id<"_storage"> };

    // Lie le fichier au format.
    await admin.mutation(api.formats.updateFormat, {
      id: fid,
      exampleVideos: [
        { kind: "file", storageId, title: "Clip de test", mimeType: "video/mp4" },
      ],
    });

    // getFormat résout l'URL SERVEUR + le blob existe.
    const f1 = await admin.query(api.formats.getFormat, { id: fid });
    expect(f1).not.toBeNull();
    const ex = f1!.exampleVideos[0];
    expect(ex.kind).toBe("file");
    if (ex.kind === "file") expect(ex.url).toBeTruthy();
    expect(await raw.query(api.storage.getPreviewUrl, { storageId })).toBeTruthy();

    // Retrait de l'exemple → blob supprimé du storage.
    await admin.mutation(api.formats.updateFormat, { id: fid, exampleVideos: [] });
    expect(await raw.query(api.storage.getPreviewUrl, { storageId })).toBeNull();

    // Cleanup.
    await admin.mutation(api.formats.deleteFormat, { id: fid });
  });
});
