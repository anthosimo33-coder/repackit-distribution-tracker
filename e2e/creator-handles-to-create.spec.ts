import { test, expect } from "@playwright/test";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

/**
 * @ à créer par réseau (creators.handlesToCreate) — défini par l'admin, par
 * créateur, par réseau (saisie libre). Vu par le créateur (getMyProfile) ET en
 * view-as (getProfileAsAdmin). Normalisé (trim, réseau vide → absent, tout vide
 * → null). Un créateur ne peut pas l'éditer (adminMutation).
 */
test.describe("@ à créer par réseau", () => {
  test("admin pose / partiel / efface ; créateur + view-as ; auth", async () => {
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Handles ${ts}`,
      email: `e2e-handles-${ts}@repackit.test`,
      password: "handles-12345",
    });

    // Initial : aucun @.
    const p0 = await creator.client.query(api.creators.getMyProfile, {
      projectId: creator.projectId,
    });
    expect(p0!.handlesToCreate).toBeNull();

    // Admin pose 2 réseaux (trim appliqué) ; Instagram vide → absent.
    await admin.mutation(api.creators.updateCreator, {
      id: creator.creatorId,
      handlesToCreate: {
        tiktok: "  @repackit_tk  ",
        youtube: "@repackit_yt",
        instagram: "   ",
      },
    });

    // CRÉATEUR : voit TikTok + YouTube, pas Instagram.
    const p1 = await creator.client.query(api.creators.getMyProfile, {
      projectId: creator.projectId,
    });
    expect(p1!.handlesToCreate?.tiktok).toBe("@repackit_tk"); // trimmé
    expect(p1!.handlesToCreate?.youtube).toBe("@repackit_yt");
    expect(p1!.handlesToCreate?.instagram).toBeUndefined();

    // VIEW-AS admin : même donnée.
    const pa = await admin.query(api.creators.getProfileAsAdmin, {
      creatorId: creator.creatorId,
    });
    expect(pa!.handlesToCreate?.tiktok).toBe("@repackit_tk");
    expect(pa!.handlesToCreate?.youtube).toBe("@repackit_yt");

    // Effacement : tous les réseaux vides → null (aucune consigne).
    await admin.mutation(api.creators.updateCreator, {
      id: creator.creatorId,
      handlesToCreate: { tiktok: "", youtube: "", instagram: "" },
    });
    const p2 = await creator.client.query(api.creators.getMyProfile, {
      projectId: creator.projectId,
    });
    expect(p2!.handlesToCreate).toBeNull();

    // AUTORISATION : un créateur ne peut PAS éditer (adminMutation).
    await expect(
      creator.client.mutation(api.creators.updateCreator, {
        projectId: creator.projectId,
        id: creator.creatorId,
        handlesToCreate: { tiktok: "@hack" },
      }),
    ).rejects.toThrow();
  });
});
