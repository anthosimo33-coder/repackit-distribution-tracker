import { internalMutation } from "./_generated/server";
import { e2eMutation, adminMutation, adminQuery } from "./functions";
import { v, ConvexError } from "convex/values";

const statusValidator = v.union(
  v.literal("warmup"),
  v.literal("actif"),
  v.literal("shadowban"),
  v.literal("archived"),
);

type CompteStatus = "warmup" | "actif" | "shadowban" | "archived";

// Coercion legacy → statut effectif. ⚠️ Dupliqué côté UI (lib/compte-status
// getEffectiveStatus) : un module Convex ne peut pas importer lib/ (cross-
// tsconfig, cf isFormatAllowedOnPlatform / normalizeSourceId). Toute évolution
// de cette règle doit être répliquée dans les deux fichiers. Rows sans `status`
// (pré-migrateComptesStatus) : actif === false → "archived", sinon "actif".
function effectiveStatus(c: {
  status?: CompteStatus;
  actif?: boolean;
}): CompteStatus {
  return c.status ?? (c.actif === false ? "archived" : "actif");
}

export const listComptes = adminQuery({
  args: {
    actifOnly: v.optional(v.boolean()),
    statusFilter: v.optional(statusValidator),
  },
  handler: async (ctx, args) => {
    let results = await ctx.db
      .query("comptes")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    // Backward compat : actifOnly (legacy) est mappé sur statusFilter="actif".
    const filter: CompteStatus | undefined =
      args.statusFilter ?? (args.actifOnly ? "actif" : undefined);
    if (filter) results = results.filter((c) => effectiveStatus(c) === filter);
    const sorted = results.sort((a, b) =>
      a.handle.localeCompare(b.handle, "fr", { sensitivity: "base" }),
    );
    // Enrichissement gestionnaire (scopé projet). N+1 mémoire OK au volume.
    const personnes = await ctx.db
      .query("personnes")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const personneMap = new Map(personnes.map((p) => [p._id, p]));
    return sorted.map((c) => {
      const p = c.personneId ? personneMap.get(c.personneId) : null;
      return {
        ...c,
        personne: p ? { prenom: p.prenom, nom: p.nom } : null,
      };
    });
  },
});

export const createCompte = adminMutation({
  args: {
    handle: v.string(),
    plateforme: v.union(
      v.literal("TikTok"),
      v.literal("Instagram"),
      v.literal("YouTube"),
    ),
    notes: v.string(),
    status: v.optional(statusValidator),
    warmupStartedAt: v.optional(v.number()),
    personneId: v.optional(v.id("personnes")),
  },
  handler: async (ctx, args) => {
    // Dedup (handle, plateforme) DANS le projet (by_project_plateforme).
    const samePlatform = await ctx.db
      .query("comptes")
      .withIndex("by_project_plateforme", (q) =>
        q.eq("projectId", ctx.projectId).eq("plateforme", args.plateforme),
      )
      .collect();
    if (samePlatform.some((c) => c.handle === args.handle)) {
      throw new Error(
        `Compte ${args.handle} existe déjà sur ${args.plateforme}`,
      );
    }
    const status: CompteStatus = args.status ?? "actif";
    if (status === "warmup" && args.warmupStartedAt === undefined) {
      throw new ConvexError("Date de début warmup requise.");
    }
    if (status !== "warmup" && args.warmupStartedAt !== undefined) {
      throw new ConvexError(
        "La date de warmup n'est valide que pour le statut warmup.",
      );
    }
    return await ctx.db.insert("comptes", {
      projectId: ctx.projectId,
      handle: args.handle,
      plateforme: args.plateforme,
      notes: args.notes,
      personneId: args.personneId,
      status,
      warmupStartedAt: status === "warmup" ? args.warmupStartedAt : undefined,
      // Legacy : maintenu synchronisé (actif === status "actif"). TD-017.
      actif: status === "actif",
    });
  },
});

export const updateCompte = adminMutation({
  args: {
    id: v.id("comptes"),
    handle: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Legacy : conservé pour les callers e2e existants (setup/cleanup). Mappé
    // sur status quand status est absent (true → "actif", false → "archived").
    actif: v.optional(v.boolean()),
    status: v.optional(statusValidator),
    // number = set, null = unset explicite, absent = ne pas toucher.
    warmupStartedAt: v.optional(v.union(v.number(), v.null())),
    // null = désassigner le gestionnaire (unset), Id = assigner, absent =
    // ne pas toucher. Pattern folderId/thumbnail d'updateInspiration.
    personneId: v.optional(v.union(v.id("personnes"), v.null())),
  },
  handler: async (ctx, args) => {
    const { id } = args;
    const compte = await ctx.db.get(id);
    if (!compte || compte.projectId !== ctx.projectId) {
      throw new ConvexError("Compte introuvable.");
    }

    // Garde-fou rename (scopé projet) : publications.compte = handle string.
    // Bloque le rename tant que des publications du projet l'utilisent.
    if (args.handle !== undefined && args.handle !== compte.handle) {
      const pubs = await ctx.db
        .query("publications")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect();
      const used = pubs.filter((p) => p.compte === compte.handle);
      if (used.length > 0) {
        throw new ConvexError(
          `Impossible de renommer ce compte : ${used.length} publication${
            used.length > 1 ? "s" : ""
          } l'utilise${
            used.length > 1 ? "nt" : ""
          }. Renommer le handle créerait des publications orphelines.`,
        );
      }
    }

    const update: Record<string, unknown> = {};
    if (args.handle !== undefined) update.handle = args.handle;
    if (args.notes !== undefined) update.notes = args.notes;
    if (args.personneId !== undefined) {
      update.personneId =
        args.personneId === null ? undefined : args.personneId;
    }

    // Statut cible : status explicite prioritaire, sinon legacy actif mappé.
    const targetStatus: CompteStatus | undefined =
      args.status ??
      (args.actif !== undefined
        ? args.actif
          ? "actif"
          : "archived"
        : undefined);

    if (targetStatus !== undefined) {
      if (targetStatus === "warmup") {
        // Date requise : fournie en arg OU déjà présente (compte déjà warmup).
        const start =
          typeof args.warmupStartedAt === "number"
            ? args.warmupStartedAt
            : compte.warmupStartedAt;
        if (start === undefined || start === null) {
          throw new ConvexError("Date de début warmup requise.");
        }
        update.warmupStartedAt = start;
      } else {
        // Transition vers un statut non-warmup → unset warmupStartedAt.
        update.warmupStartedAt = undefined;
      }
      update.status = targetStatus;
      // Legacy synchronisé (TD-017).
      update.actif = targetStatus === "actif";
    } else if (args.warmupStartedAt !== undefined) {
      // Édition de la date de warmup sans changer le statut.
      update.warmupStartedAt =
        args.warmupStartedAt === null ? undefined : args.warmupStartedAt;
    }

    await ctx.db.patch(id, update);
  },
});

export const deleteCompte = adminMutation({
  args: { id: v.id("comptes") },
  handler: async (ctx, args) => {
    const compte = await ctx.db.get(args.id);
    if (!compte || compte.projectId !== ctx.projectId) {
      throw new Error("Compte not found");
    }

    // Cascade par handle SCOPÉE projet (A3).
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const used = pubs.filter((p) => p.compte === compte.handle);
    if (used.length > 0) {
      throw new Error(
        `Compte utilisé par ${used.length} publication(s). Archive-le plutôt que de le supprimer.`,
      );
    }
    await ctx.db.delete(args.id);
  },
});

/**
 * Migration data ONE-SHOT (internal — à lancer UNE SEULE FOIS post-deploy via
 * `pnpm dlx convex@latest run --prod comptes:migrateComptesStatus`, testable
 * d'abord en dev). Backfill `status` à partir du legacy `actif` :
 *  - status déjà défini → skip (idempotence, pas de flag dédié)
 *  - actif === true → "actif"
 *  - actif === false → "archived"
 *  - actif === undefined (edge) → "actif" (assumption documentée)
 * Re-sync `actif` au passage. Ne touche pas warmupStartedAt (aucun compte
 * legacy n'était en warmup). Relançable sans effet de bord.
 */
export const migrateComptesStatus = internalMutation({
  args: {},
  handler: async (ctx) => {
    const comptes = await ctx.db.query("comptes").collect();
    let migrated = 0;
    let skipped = 0;
    for (const c of comptes) {
      if (c.status !== undefined) {
        skipped++;
        continue;
      }
      const status: CompteStatus = c.actif === false ? "archived" : "actif";
      await ctx.db.patch(c._id, { status, actif: status === "actif" });
      migrated++;
    }
    return { migrated, skipped };
  },
});

/**
 * Remédiation sécurité — cleanup e2e server-side (cf cleanupTestPublications
 * dans publications.ts). Supprime les comptes marqués [E2E_TEST] dans notes ;
 * fallback archive si des publications référencent encore le handle
 * (comportement historique du helper e2e). Gated E2E_SECRET.
 */
export const cleanupTestComptes = e2eMutation({
  args: {},
  handler: async (ctx) => {
    const comptes = await ctx.db.query("comptes").collect();
    const pubs = await ctx.db.query("publications").collect();
    let deleted = 0;
    let archived = 0;
    for (const compte of comptes) {
      if (!compte.notes.startsWith("[E2E_TEST]")) continue;
      const used = pubs.some((p) => p.compte === compte.handle);
      if (used) {
        await ctx.db.patch(compte._id, {
          status: "archived",
          actif: false,
          warmupStartedAt: undefined,
        });
        archived++;
      } else {
        await ctx.db.delete(compte._id);
        deleted++;
      }
    }
    return { deleted, archived };
  },
});
