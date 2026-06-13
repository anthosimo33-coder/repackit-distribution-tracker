import {
  adminMutation,
  adminQuery,
  creatorMutation,
  creatorQuery,
  e2eMutation,
} from "./functions";
import { withResolvedExamples } from "./formats";
import { isFormatAllowedOnPlatform } from "./publications";
import {
  accrueBaseLineItem,
  upsertBonusLineItem,
  computeEarnings,
} from "./payments";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * P7 Portail créateur — assignments. ISOLATION serveur non négociable : toutes
 * les fonctions creator (creatorQuery/creatorMutation) ne renvoient/touchent
 * QUE les rows du creator courant (ctx.creatorId). Les fonctions admin
 * (adminQuery/adminMutation) sont inaccessibles au rôle creator.
 */

type Plateforme = "TikTok" | "Instagram" | "YouTube";

/** Détection plateforme depuis l'URL (réplique serveur minimale, règle A6 —
 *  lib/inspiration-url ne peut pas être importée dans convex/). */
function detectPlatform(url: string): Plateforme | undefined {
  const u = url.toLowerCase();
  if (u.includes("tiktok.com")) return "TikTok";
  if (u.includes("instagram.com")) return "Instagram";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "YouTube";
  return undefined;
}

// ─── Admin ─────────────────────────────────────────────────────────────────

/**
 * Créateurs assignables : onboardés (userId posé) et au travail (status
 * active ou onboarding). Exclut invited (pas de compte), paused, churned.
 */
export const listAssignableCreators = adminQuery({
  args: {},
  handler: async (ctx) => {
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    return creators
      .filter(
        (c) =>
          c.userId !== undefined &&
          (c.status === "active" || c.status === "onboarding"),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "fr"))
      .map((c) => ({ _id: c._id, name: c.name, status: c.status }));
  },
});

/**
 * Assignation en masse : 1 assignment = 1 livrable. N créateurs × P posts =
 * N×P rows en "todo". rateSnapshot = copie figée du rateModel du format.
 */
export const assignFormat = adminMutation({
  args: {
    formatId: v.id("formats"),
    creatorIds: v.array(v.id("creators")),
    postsPerCreator: v.number(),
    dueDate: v.number(),
    accountId: v.optional(v.id("comptes")),
  },
  handler: async (ctx, args) => {
    const format = await ctx.db.get(args.formatId);
    if (!format || format.projectId !== ctx.projectId) {
      throw new ConvexError("Format introuvable.");
    }
    if (format.status === "archived") {
      throw new ConvexError("Format archivé : réactive-le pour l'assigner.");
    }
    if (
      !Number.isInteger(args.postsPerCreator) ||
      args.postsPerCreator < 1 ||
      args.postsPerCreator > 50
    ) {
      throw new ConvexError("Nombre de posts par créateur invalide (1–50).");
    }
    if (args.creatorIds.length === 0) {
      throw new ConvexError("Sélectionne au moins un créateur.");
    }
    if (args.accountId) {
      const account = await ctx.db.get(args.accountId);
      if (!account || account.projectId !== ctx.projectId) {
        throw new ConvexError("Compte cible introuvable.");
      }
    }
    const now = Date.now();
    let created = 0;
    for (const creatorId of args.creatorIds) {
      const creator = await ctx.db.get(creatorId);
      if (!creator || creator.projectId !== ctx.projectId) {
        throw new ConvexError("Créateur introuvable dans le projet.");
      }
      // Règle d'assignabilité imposée SERVEUR (pas seulement dans
      // listAssignableCreators) : onboardé (userId) + au travail.
      if (
        creator.userId === undefined ||
        (creator.status !== "active" && creator.status !== "onboarding")
      ) {
        throw new ConvexError(
          `Créateur non assignable (${creator.name} : non onboardé ou inactif).`,
        );
      }
      for (let i = 0; i < args.postsPerCreator; i++) {
        await ctx.db.insert("assignments", {
          projectId: ctx.projectId,
          creatorId,
          formatId: args.formatId,
          accountId: args.accountId,
          dueDate: args.dueDate,
          status: "todo",
          rateSnapshot: format.rateModel,
          createdAt: now,
        });
        created++;
      }
    }
    return { created };
  },
});

/** Table admin : tous les assignments du projet, enrichis. */
export const listAssignments = adminQuery({
  args: {},
  handler: async (ctx) => {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const [creators, formats, comptes] = await Promise.all([
      ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("formats")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("comptes")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);
    const creatorMap = new Map(creators.map((c) => [c._id, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id, f.name]));
    const compteMap = new Map(comptes.map((c) => [c._id, c.handle]));
    return assignments
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((a) => ({
        ...a,
        creatorName: creatorMap.get(a.creatorId) ?? "—",
        formatName: formatMap.get(a.formatId) ?? "—",
        accountHandle: a.accountId
          ? (compteMap.get(a.accountId) ?? null)
          : null,
      }));
  },
});

/** Compteur d'assignments "submitted" — badge sidebar de la file de validation. */
export const countSubmitted = adminQuery({
  args: {},
  handler: async (ctx) => {
    const subs = await ctx.db
      .query("assignments")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", ctx.projectId).eq("status", "submitted"),
      )
      .collect();
    return subs.length;
  },
});

/**
 * P8 — VALIDATION (logique d'argent, IDEMPOTENTE). Valider un post soumis fait,
 * en UNE transaction :
 *   1. matérialise une publication de plein droit (sauf format "custom") via
 *      internal.publications.createFromAssignment ;
 *   2. pose assignment.publicationId + status "validated" ;
 *   3. crédite la lineItem de BASE (rateSnapshot.basePerPost) sur le paiement
 *      de la période courante du créateur.
 *
 * Idempotence : revalider un assignment déjà "validated" est un no-op (sortie
 * anticipée). Le patch de l'assignment (étape 2) fait que deux validations
 * concurrentes (double-clic) entrent en conflit OCC sur ce doc → Convex
 * réessaie la perdante, qui relit status="validated" et sort. Jamais de double
 * publication ni de double crédit.
 */
export const validateAssignment = adminMutation({
  args: { id: v.id("assignments") },
  // Type de retour ANNOTÉ explicitement : le handler appelle
  // ctx.runMutation(internal.publications.createFromAssignment), et `internal`
  // référence (via _generated/api) le type de CE module → cycle d'inférence
  // (TS7022). L'annotation casse le cycle. NE PAS retirer.
  handler: async (
    ctx,
    { id },
  ): Promise<{
    ok: true;
    alreadyValidated: boolean;
    publicationId: Id<"publications"> | null;
  }> => {
    const a = await ctx.db.get(id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status === "validated") {
      return {
        ok: true,
        alreadyValidated: true,
        publicationId: a.publicationId ?? null,
      };
    }
    if (a.status !== "submitted") {
      throw new ConvexError("Seuls les assignments soumis peuvent être validés.");
    }
    const format = await ctx.db.get(a.formatId);
    if (!format) throw new ConvexError("Format introuvable.");

    // 1. Matérialisation — sauf "custom" (workflow + paiement seulement) ou pub
    // déjà matérialisée (défense).
    let publicationId: Id<"publications"> | null = a.publicationId ?? null;
    if (format.type !== "custom" && publicationId === null) {
      const plateforme = a.submittedPlatform;
      if (plateforme === undefined) {
        throw new ConvexError(
          "Plateforme du post non détectée — impossible de matérialiser la publication.",
        );
      }
      if (a.submittedUrl === undefined) {
        throw new ConvexError("URL soumise manquante.");
      }
      // compte = handle du compte lié, sinon nom du créateur (handle libre).
      let compte: string;
      if (a.accountId) {
        const account = await ctx.db.get(a.accountId);
        compte = account?.handle ?? "—";
      } else {
        const creator = await ctx.db.get(a.creatorId);
        compte = creator?.name ?? "—";
      }
      publicationId = await ctx.runMutation(
        internal.publications.createFromAssignment,
        {
          projectId: ctx.projectId,
          mediaType: format.type,
          plateforme,
          compte,
          datePubli: a.submittedAt ?? Date.now(),
          postUrl: a.submittedUrl,
        },
      );
    }

    // 2. assignment.publicationId + status validated.
    await ctx.db.patch(id, {
      status: "validated",
      publicationId: publicationId ?? undefined,
    });

    // 3. Accrual de la lineItem de BASE (idempotent par assignmentId).
    const now = Date.now();
    const dateLabel = new Date(a.submittedAt ?? now).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    });
    await accrueBaseLineItem(ctx, {
      projectId: ctx.projectId,
      creatorId: a.creatorId,
      assignmentId: id,
      label: `${format.name} — ${dateLabel}`,
      amount: a.rateSnapshot.basePerPost,
      now,
    });

    return { ok: true, alreadyValidated: false, publicationId };
  },
});

/** REJET — feedback obligatoire, visible créateur, resoumission ensuite possible. */
export const rejectAssignment = adminMutation({
  args: { id: v.id("assignments"), feedback: v.string() },
  handler: async (ctx, { id, feedback }) => {
    const a = await ctx.db.get(id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status !== "submitted") {
      throw new ConvexError("Seuls les assignments soumis peuvent être rejetés.");
    }
    const fb = feedback.trim();
    if (fb.length === 0) {
      throw new ConvexError("Un motif de rejet est requis.");
    }
    await ctx.db.patch(id, { status: "rejected", adminFeedback: fb });
    return { ok: true };
  },
});

/**
 * P8 — assignments validés (avec publication) candidats au calcul de bonus,
 * enrichis des vues du dernier snapshot (préremplissage) et du bonus déjà
 * crédité s'il existe.
 */
export const listValidatedForBonus = adminQuery({
  args: {},
  handler: async (ctx) => {
    const validated = (
      await ctx.db
        .query("assignments")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", ctx.projectId).eq("status", "validated"),
        )
        .collect()
    ).filter((a) => a.publicationId !== undefined);

    const [creators, formats, payments] = await Promise.all([
      ctx.db
        .query("creators")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("formats")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
      ctx.db
        .query("payments")
        .withIndex("by_project_period", (q) => q.eq("projectId", ctx.projectId))
        .collect(),
    ]);
    const creatorMap = new Map(creators.map((c) => [c._id, c.name]));
    const formatMap = new Map(formats.map((f) => [f._id, f.name]));
    const bonusByAssignment = new Map<string, number>();
    for (const p of payments) {
      for (const li of p.lineItems) {
        if (li.kind === "bonus") bonusByAssignment.set(li.assignmentId, li.amount);
      }
    }

    const rows = await Promise.all(
      validated.map(async (a) => {
        const pub = a.publicationId ? await ctx.db.get(a.publicationId) : null;
        return {
          assignmentId: a._id,
          creatorName: creatorMap.get(a.creatorId) ?? "—",
          formatName: formatMap.get(a.formatId) ?? "—",
          carouselId: pub?.carouselId ?? null,
          latestViews: pub?.vuesLatest ?? null,
          hasSnapshot: pub?.latestSnapshotAt !== undefined,
          existingBonus: bonusByAssignment.get(a._id) ?? null,
        };
      }),
    );
    // Actionnables (avec snapshot) d'abord.
    return rows.sort((x, y) => Number(y.hasSnapshot) - Number(x.hasSnapshot));
  },
});

/**
 * P8 — BONUS DE VUES (manuel). Sur un assignment validé dont la publication a
 * des snapshots : montant calculé AUTORITATIVEMENT serveur depuis le
 * rateSnapshot figé (jamais un montant fourni par le client) = part liée aux
 * vues (viewBonus + bounty ; la base est déjà créditée à la validation). UN
 * seul bonus par assignment : recalculer REMPLACE la ligne (cf
 * upsertBonusLineItem), jamais d'ajout → idempotent.
 */
export const computeViewBonus = adminMutation({
  args: { id: v.id("assignments"), views: v.number() },
  handler: async (ctx, { id, views }) => {
    const a = await ctx.db.get(id);
    if (!a || a.projectId !== ctx.projectId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status !== "validated") {
      throw new ConvexError("Le bonus se calcule sur un assignment validé.");
    }
    if (a.publicationId === undefined) {
      throw new ConvexError(
        "Pas de publication matérialisée (format custom ?) — bonus non applicable.",
      );
    }
    if (!Number.isFinite(views) || views < 0) {
      throw new ConvexError("Nombre de vues invalide.");
    }
    const format = await ctx.db.get(a.formatId);
    const earnings = computeEarnings(a.rateSnapshot, views);
    // bonus = part liée aux vues uniquement (la base est déjà créditée).
    const bonusAmount =
      Math.round((earnings.viewBonus + earnings.bounty) * 100) / 100;
    await upsertBonusLineItem(ctx, {
      projectId: ctx.projectId,
      creatorId: a.creatorId,
      assignmentId: id,
      label: `${format?.name ?? "Format"} — bonus (${views} vues)`,
      amount: bonusAmount,
      now: Date.now(),
    });
    return { ok: true, bonus: bonusAmount };
  },
});

// ─── Créateur (isolé par ctx.creatorId) ──────────────────────────────────────

async function enrichForCreator(ctx: QueryCtx, a: Doc<"assignments">) {
  const format = await ctx.db.get(a.formatId);
  const account = a.accountId ? await ctx.db.get(a.accountId) : null;
  return {
    ...a,
    formatName: format?.name ?? "—",
    formatType: format?.type ?? "custom",
    accountHandle: account?.handle ?? null,
  };
}

/** Mes assignments UNIQUEMENT (filtre serveur par creatorId), triés deadline. */
export const listMyAssignments = creatorQuery({
  args: {},
  handler: async (ctx) => {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_creator", (q) => q.eq("creatorId", ctx.creatorId))
      .collect();
    const enriched = await Promise.all(
      assignments.map((a) => enrichForCreator(ctx, a)),
    );
    return enriched.sort((a, b) => a.dueDate - b.dueDate);
  },
});

/** Une fiche assignment (brief complet + rateSnapshot). null si pas la mienne. */
export const getMyAssignment = creatorQuery({
  args: { id: v.id("assignments") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    // Isolation : un assignment d'un autre créateur → introuvable.
    if (!a || a.creatorId !== ctx.creatorId) return null;
    const format = await ctx.db.get(a.formatId);
    const account = a.accountId ? await ctx.db.get(a.accountId) : null;
    const brief = format ? await withResolvedExamples(ctx, format) : null;
    return {
      assignment: a,
      format: brief,
      accountHandle: account?.handle ?? null,
    };
  },
});

/** todo → in_progress (« Je commence »). */
export const startAssignment = creatorMutation({
  args: { id: v.id("assignments") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || a.creatorId !== ctx.creatorId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status !== "todo") {
      throw new ConvexError("Cet assignment est déjà démarré.");
    }
    await ctx.db.patch(id, { status: "in_progress" });
  },
});

/**
 * Soumission par URL. Autorisée depuis "in_progress" (1re soumission) ou
 * "rejected" (resoumission UNIQUEMENT). Plateforme détectée serveur.
 */
export const submitAssignment = creatorMutation({
  args: { id: v.id("assignments"), url: v.string() },
  handler: async (ctx, { id, url }) => {
    const a = await ctx.db.get(id);
    if (!a || a.creatorId !== ctx.creatorId) {
      throw new ConvexError("Assignment introuvable.");
    }
    if (a.status !== "in_progress" && a.status !== "rejected") {
      throw new ConvexError(
        "Soumission impossible dans cet état (resoumission autorisée seulement après un rejet).",
      );
    }
    const trimmed = url.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      throw new ConvexError("URL du post invalide (lien http(s) attendu).");
    }
    const platform = detectPlatform(trimmed);

    // P8 — garde plateforme à la SOUMISSION pour les formats matérialisables
    // (non "custom") : le post deviendra une publication à la validation, donc
    // la cohérence format/plateforme doit être garantie dès ici (carrousel
    // interdit sur YouTube ; plateforme reconnue obligatoire pour pouvoir
    // matérialiser). Les formats "custom" (jamais matérialisés) ne sont pas
    // gardés — n'importe quelle URL http(s) passe.
    const format = await ctx.db.get(a.formatId);
    if (format && format.type !== "custom") {
      if (platform === undefined) {
        throw new ConvexError(
          "Plateforme du lien non reconnue (TikTok, Instagram ou YouTube attendu).",
        );
      }
      if (!isFormatAllowedOnPlatform(format.type, platform)) {
        throw new ConvexError(
          `Le format « ${format.name} » (${format.type}) ne peut pas être publié sur ${platform}.`,
        );
      }
    }

    await ctx.db.patch(id, {
      status: "submitted",
      submittedUrl: trimmed,
      submittedAt: Date.now(),
      submittedPlatform: platform,
      // Purge le motif de rejet précédent lors d'une (re)soumission.
      adminFeedback: undefined,
    });
  },
});

// ─── Cleanup e2e (gated E2E_SECRET) ──────────────────────────────────────────

/**
 * Force le statut (+ feedback) d'un assignment — UNIQUEMENT pour les tests
 * (la validation/rejet admin arrive au chantier suivant). Permet de tester la
 * resoumission depuis "rejected".
 */
export const e2eSetAssignmentStatus = e2eMutation({
  args: {
    id: v.id("assignments"),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("submitted"),
      v.literal("validated"),
      v.literal("rejected"),
      v.literal("paid"),
    ),
    adminFeedback: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, adminFeedback }) => {
    await ctx.db.patch(id, { status, adminFeedback });
    return { ok: true };
  },
});

/** Supprime les assignments liés à un créateur/format de test ([E2E_TEST]). */
export const cleanupTestAssignments = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("assignments").collect();
    let deleted = 0;
    for (const a of all) {
      const creator = await ctx.db.get(a.creatorId);
      const format = await ctx.db.get(a.formatId);
      const isTest =
        (creator && creator.name.startsWith("[E2E_TEST]")) ||
        (creator && creator.email.includes("e2e-creator")) ||
        (format && format.name.startsWith("[E2E_TEST]"));
      if (isTest) {
        // P8 — cascade : la publication matérialisée a notes="" (non captée par
        // cleanupTestPublications) → on la supprime ici, avec ses snapshots.
        const pubId = a.publicationId;
        if (pubId) {
          const snaps = await ctx.db
            .query("metricSnapshots")
            .withIndex("by_publication", (q) => q.eq("publicationId", pubId))
            .collect();
          for (const s of snaps) await ctx.db.delete(s._id);
          await ctx.db.delete(pubId);
        }
        await ctx.db.delete(a._id);
        deleted++;
      }
    }
    return { deleted };
  },
});
