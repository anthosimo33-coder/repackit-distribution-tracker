/**
 * CLÉS D'ACCÈS PERSONNELLES au serveur MCP (convex/mcpHttp.ts).
 *
 * Une clé agit au nom de la personne qui l'a créée, avec SES droits : chaque
 * outil repasse par `requirePermission`, projet par projet (cf
 * `mcpPermissionQuery`). La clé ne donne donc rien de plus que l'app — elle
 * évite seulement d'avoir un navigateur ouvert.
 *
 * Sécurité :
 *   - 32 octets aléatoires, tirés dans une ACTION (les mutations Convex ont un
 *     aléa rejouable, pas fait pour un secret) ;
 *   - seule l'EMPREINTE SHA-256 est stockée : la clé en clair n'est montrée
 *     qu'une fois, au moment où elle est créée ;
 *   - révoquer = supprimer la ligne, effet immédiat au prochain appel ;
 *   - une personne qui n'a qu'un rôle de PORTAIL (créatrice, talent, clippeur)
 *     n'en obtient pas : aucun outil ne lui servirait, et une clé qui ne sert à
 *     rien est une clé qui traîne.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  authedAction,
  authedMutation,
  authedQuery,
  e2eMutation,
} from "./functions";
import { ERR, err } from "./errorCodes";
import { teamRoleOf } from "./roles";

/** Préfixe des clés : les reconnaître d'un coup d'œil (et dans un scanner de secrets). */
export const MCP_TOKEN_PREFIX = "jv_";

/** Nombre de clés vivantes par personne — une par appareil suffit largement. */
const CLES_MAX = 20;

const NOM_MAX = 60;

/** Empreinte SHA-256 en hexadécimal — ce qui est stocké, et ce qu'on compare. */
export async function sha256Hex(texte: string): Promise<string> {
  const octets = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texte),
  );
  return [...new Uint8Array(octets)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64url(octets: Uint8Array): string {
  let bin = "";
  for (const b of octets) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * La personne peut-elle détenir une clé ? Superadmin, ou un rôle d'ÉQUIPE
 * (admin, manager) sur au moins un projet. Même règle pour la vraie création et
 * pour le chemin e2e.
 */
async function assertPeutDetenirUneCle(ctx: MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user) throw err(ERR.NOT_AUTHENTICATED, "Non authentifié.");
  if (user.role === "superadmin") return;
  const acces = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  if (!acces.some((m) => teamRoleOf(m) !== null)) {
    throw err(
      ERR.MCP_TOKEN_NOT_ALLOWED,
      "Les clés d'accès sont réservées à l'équipe (admin ou manager).",
    );
  }
}

function nomDeCle(brut: string): string {
  const nom = brut.trim().replace(/\s+/g, " ");
  if (nom === "") {
    throw err(ERR.MCP_TOKEN_NAME_REQUIRED, "Donne un nom à la clé (ex. « Claude sur mon Mac »).");
  }
  return nom.slice(0, NOM_MAX);
}

async function insererCle(
  ctx: MutationCtx,
  args: { userId: Id<"users">; name: string; tokenHash: string; prefix: string },
) {
  await assertPeutDetenirUneCle(ctx, args.userId);
  const existantes = await ctx.db
    .query("mcpTokens")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .collect();
  if (existantes.length >= CLES_MAX) {
    throw err(
      ERR.MCP_TOKEN_LIMIT,
      `Tu as déjà ${CLES_MAX} clés : révoque celles qui ne servent plus.`,
      { max: CLES_MAX },
    );
  }
  return await ctx.db.insert("mcpTokens", {
    userId: args.userId,
    name: nomDeCle(args.name),
    tokenHash: args.tokenHash,
    prefix: args.prefix,
    createdAt: Date.now(),
  });
}

export const insertToken = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    tokenHash: v.string(),
    prefix: v.string(),
  },
  handler: async (ctx, args) => insererCle(ctx, args),
});

/**
 * Crée une clé et la rend EN CLAIR — la seule fois où elle l'est. L'écran doit
 * la montrer tout de suite, avec la commande à coller.
 */
export const createMcpToken = authedAction({
  args: { name: v.string() },
  handler: async (ctx, { name }): Promise<{ token: string; prefix: string }> => {
    const token = MCP_TOKEN_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
    const prefix = token.slice(0, 10);
    await ctx.runMutation(internal.mcpTokens.insertToken, {
      userId: ctx.userId,
      name,
      tokenHash: await sha256Hex(token),
      prefix,
    });
    return { token, prefix };
  },
});

export const listMyMcpTokens = authedQuery({
  args: {},
  handler: async (ctx) => {
    const cles = await ctx.db
      .query("mcpTokens")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .collect();
    // Projection explicite : jamais l'empreinte, même hachée.
    return cles
      .map((c) => ({
        _id: c._id,
        name: c.name,
        prefix: c.prefix,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt ?? null,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const revokeMcpToken = authedMutation({
  args: { tokenId: v.id("mcpTokens") },
  handler: async (ctx, { tokenId }) => {
    const cle = await ctx.db.get(tokenId);
    // La clé d'un AUTRE est traitée comme inexistante : ne rien révéler.
    if (!cle || cle.userId !== ctx.userId) {
      throw err(ERR.MCP_TOKEN_NOT_FOUND, "Clé introuvable.");
    }
    await ctx.db.delete(tokenId);
  },
});

/** Adresse du serveur MCP de CE déploiement — l'écran la met dans la commande. */
export const getMcpEndpoint = authedQuery({
  args: {},
  handler: async () => `${process.env.CONVEX_SITE_URL ?? ""}/mcp`,
});

/**
 * Empreinte → personne. `null` si la clé est inconnue, révoquée, ou si son
 * propriétaire n'existe plus (compte supprimé depuis).
 */
export const resolveToken = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const cle = await ctx.db
      .query("mcpTokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!cle) return null;
    const user = await ctx.db.get(cle.userId);
    if (!user) return null;
    return {
      userId: cle.userId,
      tokenId: cle._id,
      lastUsedAt: cle.lastUsedAt ?? null,
    };
  },
});

export const touchToken = internalMutation({
  args: { tokenId: v.id("mcpTokens") },
  handler: async (ctx, { tokenId }) => {
    if (await ctx.db.get(tokenId)) {
      await ctx.db.patch(tokenId, { lastUsedAt: Date.now() });
    }
  },
});

/**
 * Test e2e — pose une clé pour un utilisateur désigné par e-mail (qui n'a pas
 * de session dans la spec). La spec fournit l'empreinte de SA clé ; la règle
 * d'éligibilité est la même que pour la vraie création.
 */
export const e2eInsertMcpToken = e2eMutation({
  args: {
    email: v.string(),
    name: v.string(),
    tokenHash: v.string(),
    prefix: v.string(),
  },
  handler: async (ctx, { email, ...rest }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (!user) throw new Error(`Utilisateur e2e introuvable : ${email}`);
    await insererCle(ctx, { userId: user._id, ...rest });
  },
});

/**
 * Nettoyage e2e — TOUTES les clés du déploiement de test. Chaque spec MCP en
 * crée une par l'écran ; sans ce ménage, une base locale réutilisée d'un run à
 * l'autre atteint la limite de 20 clés et les specs échouent pour une raison
 * qui n'a rien à voir avec elles. Gardé par E2E_SECRET, jamais défini en prod.
 */
export const cleanupTestMcpTokens = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const cles = await ctx.db.query("mcpTokens").collect();
    for (const c of cles) await ctx.db.delete(c._id);
    return { deleted: cles.length };
  },
});
