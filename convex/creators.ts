import {
  adminMutation,
  adminQuery,
  authedQuery,
  creatorMutation,
  creatorQuery,
  e2eMutation,
  publicQuery,
  requireProjectAdmin,
} from "./functions";
import { getProjectBySlug, REPACKIT_SLUG } from "./projects";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * P1 Créateurs — gestion des créateurs côté admin + onboarding par lien
 * d'invitation à token. Un créateur est externe (publie pour le projet) ; à NE
 * PAS confondre avec `personnes` (annuaire interne des gestionnaires).
 *
 * Couche d'accès :
 *   - listCreators / getCreator / inviteCreator / regenerateInvitation /
 *     updateCreator → adminQuery / adminMutation (admin du projet requis).
 *   - getInvitationPreview → publicQuery (pré-session : la page /join lit le
 *     token avant que le compte n'existe). NE LEAK PAS l'état d'un token.
 *   - getMyPortal → authedQuery (routage par rôle, cf /app et /).
 *   - L'acceptation effective de l'invitation (création du compte + membership
 *     creator + liaison + statut onboarding) se fait dans convex/auth.ts
 *     (createOrUpdateUser), atomique avec le signup.
 */

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 jours
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const CREATOR_STATUSES = v.union(
  v.literal("invited"),
  v.literal("onboarding"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("churned"),
);
const PAYMENT_METHODS = v.union(
  v.literal("sepa"),
  v.literal("paypal"),
  v.literal("usdt"),
  v.literal("autre"),
);

/** Invitation active (non utilisée, future) la plus récente d'un créateur. */
async function activeInvitation(
  ctx: QueryCtx,
  creatorId: Id<"creators">,
): Promise<Doc<"invitations"> | null> {
  const invs = await ctx.db
    .query("invitations")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect();
  const usable = invs
    .filter((i) => i.usedAt === undefined)
    .sort((a, b) => b.expiresAt - a.expiresAt);
  return usable[0] ?? null;
}

/** Tue tous les tokens d'un créateur (suppression → lookup futur = invalide). */
async function killInvitations(ctx: MutationCtx, creatorId: Id<"creators">) {
  const invs = await ctx.db
    .query("invitations")
    .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
    .collect();
  for (const i of invs) await ctx.db.delete(i._id);
}

// ─── Admin ─────────────────────────────────────────────────────────────────

/**
 * Liste des créateurs du projet (récent → ancien). Chaque ligne porte
 * l'invitation active (token + expiresAt) quand le créateur est encore
 * "invited" — pour reconstruire le lien /join et le bouton régénérer côté UI.
 */
export const listCreators = adminQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const rows = [];
    for (const c of creators) {
      let invitation: { token: string; expiresAt: number } | null = null;
      if (c.status === "invited") {
        const inv = await activeInvitation(ctx, c._id);
        if (inv) invitation = { token: inv.token, expiresAt: inv.expiresAt };
      }
      rows.push({ ...c, invitation });
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Fiche détaillée d'un créateur + son invitation active éventuelle. */
export const getCreator = adminQuery({
  args: { id: v.id("creators") },
  handler: async (ctx, { id }) => {
    const creator = await ctx.db.get(id);
    if (!creator || creator.projectId !== ctx.projectId) return null;
    const inv =
      creator.status === "invited" ? await activeInvitation(ctx, id) : null;
    return {
      ...creator,
      invitation: inv ? { token: inv.token, expiresAt: inv.expiresAt } : null,
    };
  },
});

/**
 * Invite un créateur : crée la fiche (status "invited") + l'invitation à token.
 * Retourne { creatorId, token } pour afficher le lien /join immédiatement.
 * Dedupe par email dans le projet.
 */
export const inviteCreator = adminMutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    const email = args.email.trim().toLowerCase();
    if (name.length === 0) {
      throw new ConvexError("Le nom du créateur est requis.");
    }
    if (!EMAIL_RE.test(email)) {
      throw new ConvexError("Email invalide.");
    }
    const existing = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    if (existing.some((c) => c.email.toLowerCase() === email)) {
      throw new ConvexError("Un créateur avec cet email existe déjà.");
    }
    const now = Date.now();
    const creatorId = await ctx.db.insert("creators", {
      projectId: ctx.projectId,
      name,
      email,
      phone: args.phone?.trim() || undefined,
      status: "invited",
      createdAt: now,
    });
    const token = crypto.randomUUID();
    await ctx.db.insert("invitations", {
      token,
      creatorId,
      projectId: ctx.projectId,
      email,
      expiresAt: now + INVITE_TTL_MS,
    });
    return { creatorId, token };
  },
});

/**
 * Régénère le lien d'un créateur encore "invited" (lien expiré ou perdu) :
 * supprime les anciens tokens (l'ancien lien meurt) et en crée un neuf.
 */
export const regenerateInvitation = adminMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, { creatorId }) => {
    const creator = await ctx.db.get(creatorId);
    if (!creator || creator.projectId !== ctx.projectId) {
      throw new ConvexError("Créateur introuvable.");
    }
    if (creator.status !== "invited") {
      throw new ConvexError("Ce créateur a déjà accepté son invitation.");
    }
    await killInvitations(ctx, creatorId);
    const now = Date.now();
    const token = crypto.randomUUID();
    await ctx.db.insert("invitations", {
      token,
      creatorId,
      projectId: ctx.projectId,
      email: creator.email,
      expiresAt: now + INVITE_TTL_MS,
    });
    return { token };
  },
});

/** Patch partiel d'un créateur (statut, paiement, notes admin, contact). */
export const updateCreator = adminMutation({
  args: {
    id: v.id("creators"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    status: v.optional(CREATOR_STATUSES),
    paymentMethod: v.optional(PAYMENT_METHODS),
    paymentDetails: v.optional(v.string()),
    adminNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.id);
    if (!creator || creator.projectId !== ctx.projectId) {
      throw new ConvexError("Créateur introuvable.");
    }
    const patch: Partial<Doc<"creators">> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length === 0) throw new ConvexError("Le nom est requis.");
      patch.name = name;
    }
    if (args.phone !== undefined) patch.phone = args.phone.trim() || undefined;
    if (args.status !== undefined) patch.status = args.status;
    if (args.paymentMethod !== undefined) patch.paymentMethod = args.paymentMethod;
    if (args.paymentDetails !== undefined) {
      patch.paymentDetails = args.paymentDetails.trim() || undefined;
    }
    if (args.adminNotes !== undefined) {
      patch.adminNotes = args.adminNotes.trim() || undefined;
    }
    await ctx.db.patch(args.id, patch);
  },
});

// ─── Public (pré-session) ────────────────────────────────────────────────────

/**
 * Aperçu d'une invitation par token, pour la page /join. Retour discriminé
 * SANS LEAK : tout token absent / utilisé / expiré / créateur non-"invited"
 * renvoie le MÊME `{ status: "invalid" }` (on ne révèle jamais qu'un token a
 * existé). Cas valide : email pré-rempli + nom + projet pour un formulaire
 * accueillant.
 */
export const getInvitationPreview = publicQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const inv = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!inv || inv.usedAt !== undefined || inv.expiresAt < Date.now()) {
      return { status: "invalid" as const };
    }
    const creator = await ctx.db.get(inv.creatorId);
    if (!creator || creator.status !== "invited") {
      return { status: "invalid" as const };
    }
    const project = await ctx.db.get(inv.projectId);
    return {
      status: "valid" as const,
      email: inv.email,
      name: creator.name,
      projectName: project?.name ?? null,
    };
  },
});

// ─── Routage par rôle ────────────────────────────────────────────────────────

/**
 * Portail de l'utilisateur courant — base du routage par rôle :
 *   - superadmin OU au moins un membership "admin" → role "admin" + slug du
 *     projet par défaut (cible de redirection depuis / et /app).
 *   - sinon, au moins un membership "creator" → role "creator" + nom du
 *     créateur (pour l'accueil /app).
 *   - sinon → role "none".
 */
export const getMyPortal = authedQuery({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.db.get(ctx.userId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .collect();
    const isSuperadmin = user?.role === "superadmin";
    const hasAdmin = memberships.some((m) => m.role === "admin");
    const hasCreator = memberships.some((m) => m.role === "creator");

    if (isSuperadmin || hasAdmin) {
      let slug: string | null = null;
      if (memberships.length > 0) {
        const latest = memberships.reduce((a, b) =>
          b._creationTime > a._creationTime ? b : a,
        );
        const project = await ctx.db.get(latest.projectId);
        if (project) slug = project.slug;
      }
      if (slug === null) {
        const repackit = await getProjectBySlug(ctx, REPACKIT_SLUG);
        slug = repackit?.slug ?? null;
      }
      return { role: "admin" as const, slug, creatorName: null };
    }

    if (hasCreator) {
      const creator = await ctx.db
        .query("creators")
        .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
        .first();
      // P9 — payoutDay du projet : le portail créateur l'utilise pour afficher
      // la prochaine date de paie (nextPayoutDate, calculé client).
      let payoutDay: number | null = null;
      // P10 branding — accentColor du projet : le portail /app l'injecte dans
      // --primary pour que l'accent suive le projet du créateur (#FF5200 sinon).
      let accentColor: string | null = null;
      if (creator?.projectId) {
        const project = await ctx.db.get(creator.projectId);
        payoutDay = project?.payoutDay ?? null;
        accentColor = project?.accentColor ?? null;
      }
      return {
        role: "creator" as const,
        slug: null,
        creatorName: creator?.name ?? null,
        // P5 — projectId du créateur : le portail /app le passe aux
        // creatorQuery (qui exigent projectId, hors ProjectProvider).
        projectId: creator?.projectId ?? null,
        payoutDay,
        accentColor,
      };
    }

    return {
      role: "none" as const,
      slug: null,
      creatorName: null,
      projectId: null,
    };
  },
});

// ─── Portail créateur — profil (P9, isolé par ctx.creatorId) ─────────────────

/** Profil de paiement du créateur courant (SES données uniquement). */
export const getMyProfile = creatorQuery({
  args: {},
  handler: async (ctx) => {
    const c = await ctx.db.get(ctx.creatorId);
    if (!c) return null;
    return {
      name: c.name,
      email: c.email,
      phone: c.phone ?? null,
      paymentMethod: c.paymentMethod ?? null,
      paymentDetails: c.paymentDetails ?? null,
    };
  },
});

/**
 * Le créateur édite SON profil de paiement (téléphone + méthode + coordonnées).
 * Filtré serveur : patch sur ctx.creatorId (résolu par requireCreator) → un
 * créateur ne peut écrire que sa propre fiche. name/email restent gérés admin
 * (identité). Ces champs sont les MÊMES colonnes que la fiche admin (P4) →
 * visibles côté admin sans duplication.
 */
export const updateMyProfile = creatorMutation({
  args: {
    phone: v.optional(v.string()),
    paymentMethod: v.optional(PAYMENT_METHODS),
    paymentDetails: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Partial<Doc<"creators">> = {};
    if (args.phone !== undefined) {
      patch.phone = args.phone.trim() || undefined;
    }
    if (args.paymentMethod !== undefined) {
      patch.paymentMethod = args.paymentMethod;
    }
    if (args.paymentDetails !== undefined) {
      patch.paymentDetails = args.paymentDetails.trim() || undefined;
    }
    await ctx.db.patch(ctx.creatorId, patch);
    return { ok: true };
  },
});

// ─── Helpers e2e (gated E2E_SECRET) ──────────────────────────────────────────

/**
 * Exécute requireProjectAdmin pour le user (par email) sur projectId et
 * retourne { allowed, error? }. Preuve serveur que la garde des wrappers
 * adminQuery/adminMutation rejette un creator (sans avoir à ouvrir une session
 * pour un user de test dépourvu de mot de passe). Cf e2eAssertAccess.
 */
export const e2eAssertAdminAccess = e2eMutation({
  args: { email: v.string(), projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (user === null) return { allowed: false, error: "user introuvable" };
    try {
      await requireProjectAdmin(ctx, user._id, args.projectId);
      return { allowed: true };
    } catch (e) {
      return {
        allowed: false,
        error: e instanceof ConvexError ? String(e.data) : "error",
      };
    }
  },
});

/** Force l'expiration d'une invitation par token (spec « token expiré »). */
export const e2eExpireInvitation = e2eMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const inv = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!inv) return { expired: false };
    await ctx.db.patch(inv._id, { expiresAt: Date.now() - 1000 });
    return { expired: true };
  },
});

/**
 * Cleanup test-only : supprime les créateurs marqués (nom [E2E_TEST] ou email
 * e2e-creator) + leurs invitations, memberships et user de connexion. Les
 * authAccounts orphelins ne gênent pas (emails de test uniques par run).
 */
export const cleanupTestCreators = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("creators").collect();
    let deleted = 0;
    for (const c of all) {
      const isTest =
        c.name.startsWith("[E2E_TEST]") || c.email.includes("e2e-creator");
      if (!isTest) continue;
      const invs = await ctx.db
        .query("invitations")
        .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
        .collect();
      for (const i of invs) await ctx.db.delete(i._id);
      if (c.userId) {
        const userId = c.userId;
        const ms = await ctx.db
          .query("memberships")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
        for (const m of ms) await ctx.db.delete(m._id);
        const u = await ctx.db.get(userId);
        if (u) await ctx.db.delete(u._id);
      }
      await ctx.db.delete(c._id);
      deleted++;
    }
    return { deleted };
  },
});
