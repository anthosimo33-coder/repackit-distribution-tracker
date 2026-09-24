/**
 * POINT D'ENTRÉE HTTP du serveur MCP : `<CONVEX_SITE_URL>/mcp`.
 *
 * Hébergé par Convex et non par Next : les outils lisent la base par des queries
 * internes, sans aller-retour réseau, et sans rien coûter au quota CPU de Vercel
 * (déjà surveillé, cf scripts/check-link-prefetch.mjs).
 *
 * Toute la logique d'échange (méthodes, authentification, JSON-RPC) est dans
 * `mcpProtocol.handleMcpHttp`, pure et testée ; ce fichier ne fait que brancher
 * la requête réelle, la clé et les outils.
 */

import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { handleMcpHttp } from "./mcpProtocol";
import { jarviaServer } from "./mcpTools";
import { sha256Hex } from "./mcpTokens";

/** « Dernière utilisation » : une écriture toutes les 5 min au plus, pas une par appel. */
const RAFRAICHIR_USAGE_MS = 5 * 60 * 1000;

export const mcpEndpoint = httpAction(async (ctx, request) => {
  const rep = await handleMcpHttp(
    {
      method: request.method,
      authorization: request.headers.get("authorization"),
      body: request.method === "POST" ? await request.text() : "",
    },
    async (token) => {
      const cle = await ctx.runQuery(internal.mcpTokens.resolveToken, {
        tokenHash: await sha256Hex(token),
      });
      if (!cle) return null;
      if (
        cle.lastUsedAt === null ||
        Date.now() - cle.lastUsedAt > RAFRAICHIR_USAGE_MS
      ) {
        await ctx.runMutation(internal.mcpTokens.touchToken, {
          tokenId: cle.tokenId,
        });
      }
      return jarviaServer(ctx, cle.userId);
    },
  );
  return new Response(rep.body, { status: rep.status, headers: rep.headers });
});
