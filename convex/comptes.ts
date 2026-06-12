import { internalMutation } from "./_generated/server";
import {
  e2eMutation,
  adminMutation,
  adminQuery,
  creatorMutation,
  creatorQuery,
} from "./functions";
import { defaultTargetDays, todayKey, checkedToday } from "./warmup";
import { v, ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";

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

/**
 * Une publication est "publiée" ssi postUrl est une string non vide. ⚠️ Dupliqué
 * de lib/publication-status.isPublished (convex/ ne peut pas importer lib/).
 */
function isPublishedDoc(p: Doc<"publications">): boolean {
  return typeof p.postUrl === "string" && p.postUrl.length > 0;
}

export interface ComptePerf {
  /** Somme des vues du dernier snapshot (vuesLatest) des pubs du compte. */
  vuesCumulees: number;
  /** Nombre de publications publiées (postUrl non vide). */
  nbPublies: number;
  /** datePubli du dernier post publié, ou null. */
  dernierPost: number | null;
}

/**
 * Agrège la performance par handle de compte depuis les publications du projet.
 * Rapprochement compte↔publication = `publications.compte` (string = handle),
 * convention déjà en place (cf CompteDetailView). Une seule passe, Map en O(n).
 */
function buildPerfMap(pubs: Doc<"publications">[]): Map<string, ComptePerf> {
  const map = new Map<string, ComptePerf>();
  for (const p of pubs) {
    let perf = map.get(p.compte);
    if (!perf) {
      perf = { vuesCumulees: 0, nbPublies: 0, dernierPost: null };
      map.set(p.compte, perf);
    }
    perf.vuesCumulees += p.vuesLatest ?? 0;
    if (isPublishedDoc(p)) {
      perf.nbPublies += 1;
      if (perf.dernierPost === null || p.datePubli > perf.dernierPost) {
        perf.dernierPost = p.datePubli;
      }
    }
  }
  return map;
}

const EMPTY_PERF: ComptePerf = {
  vuesCumulees: 0,
  nbPublies: 0,
  dernierPost: null,
};

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
    // Enrichissement créateur (propriétaire) + perf agrégée par handle.
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const creatorMap = new Map(creators.map((c) => [c._id, c]));
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const perfMap = buildPerfMap(pubs);
    return sorted.map((c) => {
      const p = c.personneId ? personneMap.get(c.personneId) : null;
      const creator = c.creatorId ? creatorMap.get(c.creatorId) : null;
      return {
        ...c,
        personne: p ? { prenom: p.prenom, nom: p.nom } : null,
        creator: creator ? { name: creator.name } : null,
        perf: perfMap.get(c.handle) ?? EMPTY_PERF,
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

const plateformeValidator = v.union(
  v.literal("TikTok"),
  v.literal("Instagram"),
  v.literal("YouTube"),
);

/** Normalise un handle : trim + préfixe @ (convention CompteDialog). */
function normalizeHandle(h: string): string {
  const t = h.trim();
  if (!t) return "";
  return t.startsWith("@") ? t : `@${t}`;
}

// ─── P5 — Protocole de warmup (admin) ────────────────────────────────────────

/**
 * Édite le protocole de warmup d'un compte (keywords / instructions /
 * targetDays). Préserve dailyChecks. Les KEYWORDS sont UNIQUES par compte dans
 * le projet (deux comptes ne doivent pas taper les mêmes recherches : pattern
 * détectable) — rejet si collision avec un autre compte.
 */
export const updateWarmupProtocol = adminMutation({
  args: {
    id: v.id("comptes"),
    keywords: v.optional(v.array(v.string())),
    instructions: v.optional(v.string()),
    targetDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const compte = await ctx.db.get(args.id);
    if (!compte || compte.projectId !== ctx.projectId) {
      throw new ConvexError("Compte introuvable.");
    }
    const current = compte.warmupProtocol ?? {
      keywords: [],
      instructions: "",
      targetDays: defaultTargetDays(compte.plateforme),
      dailyChecks: [],
      updatedAt: Date.now(),
    };

    let keywords = current.keywords;
    if (args.keywords !== undefined) {
      // Trim + dedupe intra-compte (insensible à la casse, garde la 1re forme).
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const raw of args.keywords) {
        const k = raw.trim();
        if (k.length === 0) continue;
        const low = k.toLowerCase();
        if (seen.has(low)) continue;
        seen.add(low);
        cleaned.push(k);
      }
      // Unicité INTER-comptes du projet.
      const others = await ctx.db
        .query("comptes")
        .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
        .collect();
      const usedBy = new Map<string, string>();
      for (const o of others) {
        if (o._id === args.id) continue;
        for (const k of o.warmupProtocol?.keywords ?? []) {
          usedBy.set(k.toLowerCase(), o.handle);
        }
      }
      for (const k of cleaned) {
        const owner = usedBy.get(k.toLowerCase());
        if (owner) {
          throw new ConvexError(
            `Mot-clé « ${k} » déjà utilisé par ${owner}. Les mots-clés doivent être uniques par compte.`,
          );
        }
      }
      keywords = cleaned;
    }

    const targetDays = args.targetDays ?? current.targetDays;
    if (!Number.isInteger(targetDays) || targetDays < 1 || targetDays > 60) {
      throw new ConvexError("La durée cible doit être un entier entre 1 et 60.");
    }
    const instructions = args.instructions ?? current.instructions;

    await ctx.db.patch(args.id, {
      warmupProtocol: {
        keywords,
        instructions,
        targetDays,
        dailyChecks: current.dailyChecks,
        updatedAt: Date.now(),
      },
    });
  },
});

// ─── P5 — Portail créateur (creatorQuery / creatorMutation) ───────────────────

/** Comptes du créateur courant UNIQUEMENT (filtré serveur par ctx.creatorId). */
export const listMyComptes = creatorQuery({
  args: {},
  handler: async (ctx) => {
    const comptes = await ctx.db
      .query("comptes")
      .withIndex("by_project_creator", (q) =>
        q.eq("projectId", ctx.projectId).eq("creatorId", ctx.creatorId),
      )
      .collect();
    return comptes.sort((a, b) =>
      a.handle.localeCompare(b.handle, "fr", { sensitivity: "base" }),
    );
  },
});

/**
 * Déclaration d'un compte par le créateur (plateforme, handle, URL). Créé en
 * "warmup", warmupStartedAt = now, lié à SA fiche, protocole initialisé avec
 * targetDays au défaut plateforme. Dedup (handle, plateforme) dans le projet.
 */
export const declareCompte = creatorMutation({
  args: {
    plateforme: plateformeValidator,
    handle: v.string(),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const handle = normalizeHandle(args.handle);
    if (!handle || handle === "@") {
      throw new ConvexError("Handle requis.");
    }
    const samePlatform = await ctx.db
      .query("comptes")
      .withIndex("by_project_plateforme", (q) =>
        q.eq("projectId", ctx.projectId).eq("plateforme", args.plateforme),
      )
      .collect();
    if (samePlatform.some((c) => c.handle === handle)) {
      throw new ConvexError(
        `Le compte ${handle} existe déjà sur ${args.plateforme}.`,
      );
    }
    const now = Date.now();
    return await ctx.db.insert("comptes", {
      projectId: ctx.projectId,
      handle,
      plateforme: args.plateforme,
      notes: "",
      url: args.url?.trim() || undefined,
      creatorId: ctx.creatorId,
      status: "warmup",
      warmupStartedAt: now,
      actif: false,
      warmupProtocol: {
        keywords: [],
        instructions: "",
        targetDays: defaultTargetDays(args.plateforme),
        dailyChecks: [],
        updatedAt: now,
      },
    });
  },
});

/**
 * Check warmup du jour. REFUSE un 2e check le même jour (UTC), même appelée
 * directement (la garde n'est pas que dans l'UI). Le compte doit appartenir au
 * créateur ET être en warmup.
 */
export const markWarmupCheck = creatorMutation({
  args: { id: v.id("comptes") },
  handler: async (ctx, args) => {
    const compte = await ctx.db.get(args.id);
    if (
      !compte ||
      compte.projectId !== ctx.projectId ||
      compte.creatorId !== ctx.creatorId
    ) {
      throw new ConvexError("Compte introuvable.");
    }
    if (effectiveStatus(compte) !== "warmup") {
      throw new ConvexError("Ce compte n'est plus en warmup.");
    }
    const now = Date.now();
    const protocol = compte.warmupProtocol ?? {
      keywords: [],
      instructions: "",
      targetDays: defaultTargetDays(compte.plateforme),
      dailyChecks: [],
      updatedAt: now,
    };
    if (checkedToday(protocol.dailyChecks, now)) {
      throw new ConvexError("Le check du jour est déjà fait.");
    }
    const dailyChecks = [...protocol.dailyChecks, todayKey(now)];
    await ctx.db.patch(args.id, {
      warmupProtocol: { ...protocol, dailyChecks },
    });
    return { totalChecks: dailyChecks.length };
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
      // Marqueur notes [E2E_TEST] (comptes admin) OU handle @e2e… (comptes
      // déclarés par un créateur de test, dont les notes sont vides).
      const isTest =
        compte.notes.startsWith("[E2E_TEST]") ||
        compte.handle.toLowerCase().startsWith("@e2e");
      if (!isTest) continue;
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
