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
import { syncBonusUnlocks } from "./pricing";
import { DELETABLE_STATUSES, purgeAndDeleteAssignment } from "./assignments";
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
    // Grille de paliers de bonus du créateur (cumul). null = détacher.
    bonusPricingId: v.optional(v.union(v.id("pricings"), v.null())),
  },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.id);
    if (!creator || creator.projectId !== ctx.projectId) {
      throw new ConvexError("Créateur introuvable.");
    }
    const patch: Partial<Doc<"creators">> = {};
    if (args.bonusPricingId !== undefined) {
      if (args.bonusPricingId === null) {
        patch.bonusPricingId = undefined;
      } else {
        const pricing = await ctx.db.get(args.bonusPricingId);
        if (!pricing || pricing.projectId !== ctx.projectId) {
          throw new ConvexError("Pricing de bonus introuvable dans le projet.");
        }
        patch.bonusPricingId = args.bonusPricingId;
      }
    }
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
    // Changer la grille de bonus → matérialise immédiatement les paliers déjà
    // atteints par le cumul (idempotent).
    if (args.bonusPricingId !== undefined) {
      await syncBonusUnlocks(ctx, ctx.projectId, args.id);
    }
  },
});

// ─── Suppression d'un créateur (hard-delete + cascade, historique conservé) ──

/**
 * Compteurs de ce que deleteCreator SUPPRIMERA vs CONSERVERA. Lecture seule,
 * partagé par la query de prévisualisation (UI de confirmation) et la mutation
 * (résumé de succès). `publications` = posts sur les handles de compte du
 * créateur (publications n'ont pas de creatorId direct ; le handle est le seul
 * lien — scan projet, action admin ponctuelle, hors chemin chaud).
 */
async function creatorDeletionImpact(
  ctx: QueryCtx,
  creator: Doc<"creators">,
): Promise<{
  comptes: number;
  deletableAssignments: number;
  keptAssignments: number;
  payments: number;
  publications: number;
}> {
  const projectId = creator.projectId;
  const comptes = await ctx.db
    .query("comptes")
    .withIndex("by_project_creator", (q) =>
      q.eq("projectId", projectId).eq("creatorId", creator._id),
    )
    .collect();
  const handles = new Set(comptes.map((c) => c.handle));
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
    .collect();
  let deletableAssignments = 0;
  for (const a of assignments) {
    if (DELETABLE_STATUSES.has(a.status)) deletableAssignments++;
  }
  const payments = await ctx.db
    .query("payments")
    .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
    .collect();
  let publications = 0;
  if (handles.size > 0) {
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    publications = pubs.filter((p) => handles.has(p.compte)).length;
  }
  return {
    comptes: comptes.length,
    deletableAssignments,
    keptAssignments: assignments.length - deletableAssignments,
    payments: payments.length,
    publications,
  };
}

/**
 * Prévisualisation pour la confirmation de suppression : nom exact (saisie de
 * confirmation) + compteurs supprimé/conservé. null si introuvable / hors projet.
 */
export const getCreatorDeletionImpact = adminQuery({
  args: { id: v.id("creators") },
  handler: async (ctx, { id }) => {
    const creator = await ctx.db.get(id);
    if (!creator || creator.projectId !== ctx.projectId) return null;
    const impact = await creatorDeletionImpact(ctx, creator);
    return { name: creator.name, ...impact };
  },
});

/**
 * HARD-DELETE d'un créateur (Approche C) — opération la plus destructrice de
 * l'app. Scopé projet, admin only, idempotent (déjà supprimé / hors projet →
 * `alreadyGone`).
 *
 * SUPPRIMÉ (opérationnel, sans valeur historique) :
 *   - comptes du créateur (bio + warmup embarqués dans la row) ;
 *   - assignments NON publiés/payés (DELETABLE_STATUSES) → purge vidéo orpheline
 *     (Convex + Stream, best-effort) + suppression de la row, ce qui LIBÈRE le
 *     comboKey (réassignable) ;
 *   - invitations (tokens one-shot) ;
 *   - membership creator du projet (révoque l'accès portail) ;
 *   - le compte user partagé + ses reset tokens UNIQUEMENT s'il devient orphelin
 *     (aucun autre membership ni fiche) → ne casse pas un créateur multi-projets
 *     ni un admin.
 *
 * CONSERVÉ (historique), avec le nom FIGÉ en dénormalisation (creatorNameSnapshot,
 * le creatorId reste comme référence morte mais utile au regroupement) :
 *   - publications (liées par handle de compte, conservent leur handle string) ;
 *   - paiements / line items (le breakdown live des paiements non soldés reste
 *     correct : il recompute depuis les assignments published/paid + bonusUnlocks
 *     CONSERVÉS, jamais depuis la fiche créateur) ;
 *   - assignments published/paid/validated + bonusUnlocks (financier).
 *
 * Les effets externes (storage.delete, Cloudflare) sont best-effort/post-commit
 * via purgeAndDeleteAssignment (idiome deleteAssignment) — un échec externe ne
 * casse pas la suppression DB (transactionnelle).
 */
export const deleteCreator = adminMutation({
  args: { id: v.id("creators") },
  handler: async (ctx, { id }) => {
    const creator = await ctx.db.get(id);
    if (!creator || creator.projectId !== ctx.projectId) {
      return { ok: true as const, alreadyGone: true as const };
    }
    const name = creator.name;
    const projectId = creator.projectId;

    // Handles de compte AVANT suppression → compte les publications conservées.
    const comptes = await ctx.db
      .query("comptes")
      .withIndex("by_project_creator", (q) =>
        q.eq("projectId", projectId).eq("creatorId", id),
      )
      .collect();
    const handles = new Set(comptes.map((c) => c.handle));
    let keptPublications = 0;
    if (handles.size > 0) {
      const pubs = await ctx.db
        .query("publications")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect();
      keptPublications = pubs.filter((p) => handles.has(p.compte)).length;
    }

    // 1. Figer le nom sur les paiements CONSERVÉS (tous).
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_creator", (q) => q.eq("creatorId", id))
      .collect();
    for (const p of payments) {
      await ctx.db.patch(p._id, { creatorNameSnapshot: name });
    }

    // 2. Assignments : supprimer les opérationnels (combo libéré + purge vidéo),
    //    figer le nom sur les conservés (published/paid/validated).
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", id))
      .collect();
    let deletedAssignments = 0;
    let freedCombos = 0;
    let keptAssignments = 0;
    for (const a of assignments) {
      if (DELETABLE_STATUSES.has(a.status)) {
        if (a.comboKey !== undefined) freedCombos++;
        await purgeAndDeleteAssignment(ctx, a);
        deletedAssignments++;
      } else {
        await ctx.db.patch(a._id, { creatorNameSnapshot: name });
        keptAssignments++;
      }
    }

    // 3. Supprimer les comptes (opérationnels). Les publications gardent leur
    //    handle (string) → restent lisibles sans la row compte.
    for (const c of comptes) {
      await ctx.db.delete(c._id);
    }

    // 4. Supprimer les invitations (tokens one-shot, sans valeur historique).
    const invitations = await ctx.db
      .query("invitations")
      .withIndex("by_creator", (q) => q.eq("creatorId", id))
      .collect();
    for (const inv of invitations) {
      await ctx.db.delete(inv._id);
    }

    // 5. Révoquer l'accès : supprimer le membership creator de CE projet. Le
    //    compte user partagé n'est supprimé que s'il devient totalement orphelin.
    const userId = creator.userId;
    if (userId) {
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      const remaining: typeof memberships = [];
      for (const m of memberships) {
        if (m.projectId === projectId && m.role === "creator") {
          await ctx.db.delete(m._id);
        } else {
          remaining.push(m);
        }
      }
      const otherFiches = await ctx.db
        .query("creators")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      const hasOtherFiche = otherFiches.some((f) => f._id !== id);
      if (remaining.length === 0 && !hasOtherFiche) {
        const resets = await ctx.db
          .query("passwordResetTokens")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
        for (const r of resets) await ctx.db.delete(r._id);
        await ctx.db.delete(userId);
      }
    }

    // 6. Supprimer la fiche créateur (hard-delete).
    await ctx.db.delete(id);

    return {
      ok: true as const,
      alreadyGone: false as const,
      name,
      deleted: {
        comptes: comptes.length,
        assignments: deletedAssignments,
        invitations: invitations.length,
        freedCombos,
      },
      kept: {
        publications: keptPublications,
        payments: payments.length,
        assignments: keptAssignments,
      },
    };
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

// ─── Multi-projets créateur — un compte, N memberships ──────────────────────
//
// MODÈLE : aucun changement de schéma. Un créateur multi-projets = 1 user +
// N memberships (role "creator") + N fiches `creators` (une par projet, qui
// PORTE les données par-projet : statut, paiement, nom affiché). requireCreator
// (convex/functions.ts) résout DÉJÀ la fiche par (userId, projectId) → toutes
// les creatorQuery/creatorMutation sont isolées par le projet courant SANS
// modification. Les créateurs actuels (1 fiche + 1 membership) sont déjà ce
// modèle avec N=1 : 0 migration, 0 perte.

/**
 * Projets du créateur courant (pour le switcher du portail /app). Liste les
 * projets où l'utilisateur a un membership "creator", avec le branding par
 * projet (nom, accent, logo) + payoutDay + le nom de SA fiche sur ce projet.
 * Vide si l'utilisateur n'est creator nulle part. N'expose JAMAIS un projet où
 * il n'est pas membre.
 */
export const getMyCreatorProjects = authedQuery({
  args: {},
  handler: async (ctx) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .collect();
    const fiches = await ctx.db
      .query("creators")
      .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
      .collect();
    const out: {
      projectId: Id<"projects">;
      slug: string;
      name: string;
      accentColor: string;
      logoUrl: string | null;
      payoutDay: number;
      creatorName: string | null;
    }[] = [];
    for (const m of memberships) {
      if (m.role !== "creator") continue;
      const project = await ctx.db.get(m.projectId);
      if (!project) continue;
      const fiche = fiches.find((c) => c.projectId === m.projectId);
      out.push({
        projectId: project._id,
        slug: project.slug,
        name: project.name,
        accentColor: project.accentColor,
        logoUrl: project.logoUrl ?? null,
        payoutDay: project.payoutDay,
        creatorName: fiche?.name ?? null,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * ADMIN — projets vers lesquels l'admin courant peut rattacher CE créateur :
 * les projets dont l'admin a les droits (superadmin → tous ; sinon ses
 * memberships "admin") MOINS ceux où le créateur est déjà membre. Alimente le
 * sélecteur du bouton « Ajouter à un autre projet ». Renvoie [] pour un non-
 * admin (aucun projet admin) → aucun leak.
 */
export const listAddableProjectsForCreator = authedQuery({
  args: { creatorUserId: v.id("users") },
  handler: async (ctx, { creatorUserId }) => {
    const me = await ctx.db.get(ctx.userId);
    let adminProjects: Doc<"projects">[];
    if (me?.role === "superadmin") {
      adminProjects = await ctx.db.query("projects").collect();
    } else {
      const myMemberships = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", ctx.userId))
        .collect();
      adminProjects = [];
      for (const m of myMemberships) {
        if (m.role !== "admin") continue;
        const p = await ctx.db.get(m.projectId);
        if (p) adminProjects.push(p);
      }
    }
    const creatorMemberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", creatorUserId))
      .collect();
    const memberOf = new Set(creatorMemberships.map((m) => m.projectId));
    return adminProjects
      .filter((p) => p.status === "active" && !memberOf.has(p._id))
      .map((p) => ({ projectId: p._id, name: p.name, slug: p.slug }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * ADMIN — rattache un créateur DÉJÀ inscrit (compte existant, identifié par son
 * userId) au projet courant (= projet cible, sur lequel l'adminMutation vérifie
 * les droits de l'appelant). Crée une nouvelle fiche `creators` + un membership
 * "creator" pour ce compte sur ce projet. NE touche NI au login NI au mot de
 * passe (même compte). Identité (nom/email/téléphone) copiée depuis une fiche
 * existante du créateur ; statut initial "onboarding" (il configure ses comptes
 * pour ce projet). Garde-fous : compte existant requis, pas de doublon.
 *
 * Pour un créateur JAMAIS inscrit (aucun compte), ce bouton ne s'applique pas :
 * c'est /join (invitation à token) qui crée un nouveau compte.
 */
export const addCreatorToProject = adminMutation({
  args: { creatorUserId: v.id("users") },
  handler: async (ctx, { creatorUserId }): Promise<{ creatorId: Id<"creators"> }> => {
    const user = await ctx.db.get(creatorUserId);
    if (!user) {
      throw new ConvexError("Compte créateur introuvable.");
    }
    // Identité de référence : une fiche existante de ce créateur (n'importe quel
    // projet). Sans fiche, ce compte n'est pas un créateur → refus.
    const fiches = await ctx.db
      .query("creators")
      .withIndex("by_user", (q) => q.eq("userId", creatorUserId))
      .collect();
    const source = fiches[0];
    if (!source) {
      throw new ConvexError("Ce compte n'est pas un créateur.");
    }
    // Pas de doublon : déjà rattaché (quel que soit le rôle) au projet cible.
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_project", (q) =>
        q.eq("userId", creatorUserId).eq("projectId", ctx.projectId),
      )
      .first();
    if (existing) {
      throw new ConvexError("Ce créateur est déjà rattaché à ce projet.");
    }
    const now = Date.now();
    const creatorId = await ctx.db.insert("creators", {
      projectId: ctx.projectId,
      userId: creatorUserId,
      name: source.name,
      email: source.email,
      phone: source.phone,
      status: "onboarding",
      createdAt: now,
    });
    await ctx.db.insert("memberships", {
      userId: creatorUserId,
      projectId: ctx.projectId,
      role: "creator",
    });
    return { creatorId };
  },
});

// ─── Helpers e2e (gated E2E_SECRET) ──────────────────────────────────────────

/**
 * Rattache (idempotent) un créateur existant (par email) à un projet — setup
 * du test multi-projets sans passer par l'UI admin. Crée la fiche + le
 * membership "creator" si absents. Retourne le creatorId.
 */
export const e2eAddCreatorToProject = e2eMutation({
  args: { email: v.string(), projectId: v.id("projects") },
  handler: async (ctx, { email, projectId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (user === null) throw new ConvexError(`Compte introuvable: ${email}`);
    const fiches = await ctx.db
      .query("creators")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const source = fiches[0];
    if (!source) throw new ConvexError("Ce compte n'est pas un créateur.");
    const existingFiche = fiches.find((c) => c.projectId === projectId);
    if (existingFiche) {
      // Idempotent : s'assure que le membership existe aussi.
      const m = await ctx.db
        .query("memberships")
        .withIndex("by_user_project", (q) =>
          q.eq("userId", user._id).eq("projectId", projectId),
        )
        .first();
      if (!m) {
        await ctx.db.insert("memberships", {
          userId: user._id,
          projectId,
          role: "creator",
        });
      }
      return { creatorId: existingFiche._id };
    }
    const creatorId = await ctx.db.insert("creators", {
      projectId,
      userId: user._id,
      name: source.name,
      email: source.email,
      phone: source.phone,
      status: "onboarding",
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      userId: user._id,
      projectId,
      role: "creator",
    });
    return { creatorId };
  },
});

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
        // Tokens de reset mot de passe liés à ce user (Voie B).
        const resets = await ctx.db
          .query("passwordResetTokens")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
        for (const r of resets) await ctx.db.delete(r._id);
        const u = await ctx.db.get(userId);
        if (u) await ctx.db.delete(u._id);
      }
      // Paliers de bonus débloqués de ce créateur (pricing v2).
      const unlocks = await ctx.db
        .query("bonusUnlocks")
        .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
        .collect();
      for (const u of unlocks) await ctx.db.delete(u._id);
      await ctx.db.delete(c._id);
      deleted++;
    }
    return { deleted };
  },
});
