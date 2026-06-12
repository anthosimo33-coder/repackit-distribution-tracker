import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Remédiation sécurité — wrappers de gating pour TOUTES les fonctions
 * publiques du repo.
 *
 * RÈGLE : aucun module ne doit définir de fonction publique via query /
 * mutation bruts de _generated/server. Toujours passer par :
 *   - authedQuery / authedMutation : identité requise (session Convex Auth).
 *     ctx est enrichi de `userId` (Id<"users"> de l'appelant).
 *   - superadminMutation : identité requise + role === "superadmin".
 *     Réservé aux opérations d'administration (P4 : invitations…).
 *   - e2eMutation : PAS d'identité, mais arg `secret` strictement égal à
 *     process.env.E2E_SECRET côté deployment. Si la variable n'est pas
 *     définie sur le deployment → rejet systématique (cas prod, où
 *     E2E_SECRET ne doit JAMAIS être défini). Sert aux mutations de seed /
 *     cleanup e2e qui doivent fonctionner AVANT toute session (global-setup
 *     Playwright, fenêtre bootstrap pas encore franchie).
 *
 * Les internalMutation (migrations one-shot) restent inchangées : non
 * exposées à l'API publique, appelables uniquement via `convex run`.
 */

async function requireUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Non authentifié.");
  }
  return userId;
}

export const authedQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    const userId = await requireUserId(ctx);
    return { userId };
  }),
);

export const authedMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    const userId = await requireUserId(ctx);
    return { userId };
  }),
);

export const superadminMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (user?.role !== "superadmin") {
      throw new ConvexError("Réservé aux superadmins.");
    }
    return { userId };
  }),
);

export const e2eMutation = customMutation(mutation, {
  args: { secret: v.string() },
  input: async (_ctx, { secret }) => {
    const expected = process.env.E2E_SECRET;
    if (expected === undefined || expected.length === 0) {
      throw new ConvexError(
        "Fonctions e2e désactivées sur ce deployment (E2E_SECRET non défini).",
      );
    }
    if (secret !== expected) {
      throw new ConvexError("Secret e2e invalide.");
    }
    // `secret` est consommé ici : il n'atteint jamais le handler.
    return { ctx: {}, args: {} };
  },
});
