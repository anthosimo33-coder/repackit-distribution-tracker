import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const convex = createE2eClient(convexUrl);
// getInvitationPreview est PUBLIC (pré-session) → client anonyme, sans
// injection de projectId (la query n'en prend pas).
const anon = new ConvexHttpClient(convexUrl);

test.describe("Créateurs — cycle de vie des tokens d'invitation", () => {
  test("régénérer invalide l'ancien token et en émet un neuf", async () => {
    const ts = Date.now();
    const { creatorId, token: oldToken } = await convex.mutation(
      api.creators.inviteCreator,
      {
        name: `[E2E_TEST] Regen ${ts}`,
        email: `e2e-creator-regen-${ts}@repackit.test`,
      },
    );

    const before = await anon.query(api.creators.getInvitationPreview, {
      token: oldToken,
    });
    expect(before.status).toBe("valid");

    const { token: newToken } = await convex.mutation(
      api.creators.regenerateInvitation,
      { creatorId },
    );
    expect(newToken).not.toBe(oldToken);

    // L'ancien token meurt ; le nouveau est valide.
    const oldAfter = await anon.query(api.creators.getInvitationPreview, {
      token: oldToken,
    });
    const newAfter = await anon.query(api.creators.getInvitationPreview, {
      token: newToken,
    });
    expect(oldAfter.status).toBe("invalid");
    expect(newAfter.status).toBe("valid");
  });

  test("un token expiré est rejeté (preview + signUp)", async () => {
    const ts = Date.now();
    const email = `e2e-creator-exp-${ts}@repackit.test`;
    const { token } = await convex.mutation(api.creators.inviteCreator, {
      name: `[E2E_TEST] Exp ${ts}`,
      email,
    });

    await convex.mutation(api.creators.e2eExpireInvitation, {
      secret: E2E_SECRET,
      token,
    });

    const preview = await anon.query(api.creators.getInvitationPreview, {
      token,
    });
    expect(preview.status).toBe("invalid");

    // Le signUp avec un token expiré est rejeté serveur (no-leak générique).
    const client = new ConvexHttpClient(convexUrl);
    await expect(
      client.action(api.auth.signIn, {
        provider: "password",
        params: { email, password: "expired-pass-123", flow: "signUp", inviteToken: token },
      }),
    ).rejects.toThrow(/invalide|expirée/i);
  });
});
