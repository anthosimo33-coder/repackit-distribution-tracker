import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { E2E_SECRET, type E2eClient } from "./authed-client";

type Platform = "TikTok" | "Instagram" | "YouTube";

/**
 * Chantier C — crée un compte ACTIF (donc DISPONIBLE) lié au créateur et
 * retourne la CIBLE { platform, accountId } à passer à assignFormat /
 * assignScriptCampaign. S'appuie sur la mutation e2e-gated e2eSeedAvailableCompte
 * (pas besoin d'un client créateur ni de compléter un warmup).
 */
export async function availableTarget(opts: {
  e2eClient: E2eClient;
  creatorId: Id<"creators">;
  platform: Platform;
  handle: string;
}): Promise<{ platform: Platform; accountId: Id<"comptes"> }> {
  const accountId = await opts.e2eClient.mutation(
    api.comptes.e2eSeedAvailableCompte,
    {
      secret: E2E_SECRET,
      creatorId: opts.creatorId,
      plateforme: opts.platform,
      handle: opts.handle,
    },
  );
  return { platform: opts.platform, accountId };
}
