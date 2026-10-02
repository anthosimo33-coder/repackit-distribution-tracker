/**
 * POINT D'ENTRÉE HTTP du serveur MCP : `<CONVEX_SITE_URL>/mcp`.
 *
 * Hébergé par Convex et non par Next : les outils lisent la base par des queries
 * internes, sans aller-retour réseau, et sans rien coûter au quota CPU de Vercel
 * (déjà surveillé, cf scripts/check-link-prefetch.mjs).
 *
 * Toute la logique d'échange (méthodes, authentification, JSON-RPC) est dans
 * `mcpProtocol.handleMcpHttp`, pure et testée ; ce fichier ne fait que brancher
 * la requête réelle, le jeton et les outils.
 *
 * Deux sortes de jeton, une seule empreinte : la clé personnelle (Claude Code,
 * scripts — convex/mcpTokens.ts) et le jeton d'accès OAuth (connecteur claude.ai
 * — convex/mcpOAuth.ts). Le 401 pointe les métadonnées OAuth : c'est ce qui
 * permet à Claude de lancer la connexion tout seul.
 */

import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { handleMcpHttp } from "./mcpProtocol";
import { jarviaServer } from "./mcpTools";
import { sha256Hex } from "./mcpTokens";
import { urlsDuDeploiement } from "./mcpOAuth";
import { wwwAuthenticate } from "./mcpOAuthCore";

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
      const tokenHash = await sha256Hex(token);
      const aToucher = (lastUsedAt: number | null) =>
        lastUsedAt === null || Date.now() - lastUsedAt > RAFRAICHIR_USAGE_MS;
      const cle = await ctx.runQuery(internal.mcpTokens.resolveToken, { tokenHash });
      if (cle) {
        if (aToucher(cle.lastUsedAt)) {
          await ctx.runMutation(internal.mcpTokens.touchToken, { tokenId: cle.tokenId });
        }
        return jarviaServer(ctx, cle.userId, {
          kind: "token",
          id: cle.tokenId,
          name: cle.name,
          writeScopes: cle.writeScopes,
        });
      }
      const acces = await ctx.runQuery(internal.mcpOAuth.resoudreJetonAcces, { tokenHash });
      if (!acces) return null;
      if (aToucher(acces.lastUsedAt)) {
        await ctx.runMutation(internal.mcpOAuth.toucherAcces, { grantId: acces.grantId });
      }
      return jarviaServer(ctx, acces.userId, {
        kind: "oauth",
        id: acces.grantId,
        name: acces.name || "Claude",
        writeScopes: acces.writeScopes,
      });
    },
    (jetonPresente) => wwwAuthenticate(urlsDuDeploiement(), jetonPresente),
  );
  return new Response(rep.body, { status: rep.status, headers: rep.headers });
});
