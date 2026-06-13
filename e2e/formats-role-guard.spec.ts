import { test, expect } from "@playwright/test";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * P6 — garde serveur : le rôle creator n'a accès à RIEN des formats admin
 * (adminQuery/adminMutation). Preuve via une session creator réelle.
 */
test.describe("Formats — garde rôle serveur", () => {
  test("un creator ne peut ni lister ni créer/modifier des formats", async () => {
    const ts = Date.now();
    const C = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] Fmt Guard ${ts}`,
      email: `e2e-creator-fmt-${ts}@repackit.test`,
      password: "creator-fmt-12345",
    });

    await expect(
      C.client.query(api.formats.listFormats, { projectId: C.projectId }),
    ).rejects.toThrow(/administrateur|refusé/i);

    await expect(
      C.client.mutation(api.formats.createFormat, {
        projectId: C.projectId,
        name: `[E2E_TEST] hack ${ts}`,
        type: "short",
      }),
    ).rejects.toThrow(/administrateur|refusé/i);

    // updateFormat sur un format RÉEL (créé par l'admin) → la validation d'args
    // passe, le rejet vient bien de la garde rôle, pas de l'arg.
    const fid = await admin.mutation(api.formats.createFormat, {
      name: `[E2E_TEST] Fmt Guard target ${ts}`,
      type: "short",
    });
    await expect(
      C.client.mutation(api.formats.updateFormat, {
        projectId: C.projectId,
        id: fid,
        name: "hack",
      }),
    ).rejects.toThrow(/administrateur|refusé/i);

    await admin.mutation(api.formats.deleteFormat, { id: fid });
  });
});
