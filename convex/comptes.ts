import { internalMutation } from "./_generated/server";
import { passesWarmupMode } from "./warmupMode";
import {
  e2eMutation,
  adminMutation,
  adminQuery,
  adminViewAsQuery,
  creatorMutation,
  creatorQuery,
} from "./functions";
import {
  defaultTargetDays,
  todayKey,
  checkedToday,
  isWarmupComplete,
  mustCheckToday,
  isAccountAvailable,
  effectiveTargetDays,
} from "./warmup";
import { isSnytchProject } from "./projects";
import { countryValidator } from "./countries";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const statusValidator = v.union(
  v.literal("warmup"),
  v.literal("actif"),
  v.literal("shadowban"),
  v.literal("archived"),
);

const plateformeValidator = v.union(
  v.literal("TikTok"),
  v.literal("Instagram"),
  v.literal("YouTube"),
);

type CompteStatus = "warmup" | "actif" | "shadowban" | "archived";

// Coercion legacy → statut effectif. ⚠️ Dupliqué côté UI (lib/compte-status
// getEffectiveStatus) : un module Convex ne peut pas importer lib/ (cross-
// tsconfig, cf isFormatAllowedOnPlatform / normalizeSourceId). Toute évolution
// de cette règle doit être répliquée dans les deux fichiers. Rows sans `status`
// (pré-migrateComptesStatus) : actif === false → "archived", sinon "actif".
//
// EXPORTÉ (et non plus privé) pour que convex/notifications.ts s'en serve au
// lieu d'en écrire une TROISIÈME copie : la règle est déjà dédoublée par A6, une
// duplication de plus la rendrait ingérable.
export function effectiveStatus(c: {
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
    // vues de PERF hors warmup (TD-019, helper unique) ; nbPublies/dernierPost
    // restent sur TOUS les posts (un post de chauffe est bien publié).
    if (passesWarmupMode(p.isWarmup === true, "exclude")) {
      perf.vuesCumulees += p.vuesLatest ?? 0;
    }
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

export interface CompteUsage {
  inUse: boolean;
  assignments: number;
  /** Sous-ensemble d'`assignments` NON publiés/payés (missions encore en cours). */
  openAssignments: number;
  publications: number;
  /** Somme des vues du dernier relevé des publications du compte (récap UI). */
  views: number;
  snapshots: number;
  payments: number;
}

/**
 * Statuts d'assignment portant une publication matérialisée et/ou de la paie —
 * ⚠️ DUPLIQUÉ du complément de assignments.DELETABLE_STATUSES (import
 * cross-module évité, même idiome que effectiveStatus/isPublishedDoc). Sert
 * UNIQUEMENT à distinguer « mission en cours » de « historique » dans le récap
 * de réassignation ; aucune décision de paie ne s'appuie dessus.
 */
const CLOSED_ASSIGNMENT_STATUSES = new Set<string>([
  "published",
  "paid",
  "validated", // legacy
]);

/**
 * Chantier D — RÉFÉRENCES d'un compte (garde des mutations destructives). Un
 * compte est UTILISÉ s'il apparaît dans une target d'assignment (ou l'accountId
 * legacy), a ≥1 publication (rapprochée par HANDLE), ≥1 metricSnapshot sur ces
 * publications, ou ≥1 lineItem de paiement sur un assignment le ciblant. VIERGE
 * = aucune de ces références → seul cas où la suppression et le changement de
 * plateforme sont permis (jamais de cascade qui orphelinerait pub/paiement).
 */
async function compteUsage(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  compte: Doc<"comptes">,
): Promise<CompteUsage> {
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const refAssignments = assignments.filter(
    (a) =>
      a.accountId === compte._id ||
      (a.targets ?? []).some((t) => t.accountId === compte._id),
  );
  const pubs = (
    await ctx.db
      .query("publications")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
  ).filter((p) => p.compte === compte.handle);
  let snapshots = 0;
  for (const p of pubs) {
    snapshots += (
      await ctx.db
        .query("metricSnapshots")
        .withIndex("by_publication", (q) => q.eq("publicationId", p._id))
        .collect()
    ).length;
  }
  const refIds = new Set(refAssignments.map((a) => a._id));
  let payments = 0;
  if (refIds.size > 0) {
    const pays = await ctx.db
      .query("payments")
      .withIndex("by_project_period", (q) => q.eq("projectId", projectId))
      .collect();
    for (const pay of pays) {
      payments += pay.lineItems.filter(
        (li) => li.assignmentId !== undefined && refIds.has(li.assignmentId),
      ).length;
    }
  }
  const inUse =
    refAssignments.length > 0 ||
    pubs.length > 0 ||
    snapshots > 0 ||
    payments > 0;
  return {
    inUse,
    assignments: refAssignments.length,
    openAssignments: refAssignments.filter(
      (a) => !CLOSED_ASSIGNMENT_STATUSES.has(a.status),
    ).length,
    publications: pubs.length,
    // vues de PERF hors warmup (TD-019) ; `inUse`/`publications` comptent tout.
    views: pubs.reduce(
      (sum, p) =>
        sum +
        (passesWarmupMode(p.isWarmup === true, "exclude")
          ? (p.vuesLatest ?? 0)
          : 0),
      0,
    ),
    snapshots,
    payments,
  };
}

/**
 * Détail des références d'un compte : arbitre l'UI admin (supprimer vs archiver)
 * et alimente le RÉCAP obligatoire avant action destructive / réassignation
 * (handle + publications + vues + missions en cours). Le serveur re-vérifie de
 * toute façon dans deleteCompte — cette query n'est qu'un affichage.
 */
export const getCompteUsage = adminQuery({
  args: { id: v.id("comptes") },
  handler: async (ctx, { id }) => {
    const compte = await ctx.db.get(id);
    if (!compte || compte.projectId !== ctx.projectId) {
      throw new ConvexError("Compte introuvable.");
    }
    return compteUsage(ctx, ctx.projectId, compte);
  },
});

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
    // Chantier D — `inUse` par compte (référencé par une target/accountId
    // d'assignment OU une publication par handle). Batch : assignments chargés
    // une fois. Garde l'UI (delete vs archive) ; les mutations re-vérifient via
    // compteUsage (autorité serveur).
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
      .collect();
    const usedCompteIds = new Set<string>();
    for (const a of assignments) {
      if (a.accountId) usedCompteIds.add(a.accountId);
      for (const t of a.targets ?? []) {
        if (t.accountId) usedCompteIds.add(t.accountId);
      }
    }
    const usedHandles = new Set(pubs.map((p) => p.compte));
    return sorted.map((c) => {
      const p = c.personneId ? personneMap.get(c.personneId) : null;
      const creator = c.creatorId ? creatorMap.get(c.creatorId) : null;
      return {
        ...c,
        personne: p ? { prenom: p.prenom, nom: p.nom } : null,
        creator: creator ? { name: creator.name } : null,
        perf: perfMap.get(c.handle) ?? EMPTY_PERF,
        inUse: usedCompteIds.has(c._id) || usedHandles.has(c.handle),
      };
    });
  },
});

/**
 * Chantier C — comptes d'UN créateur annotés `available`. Alimente les
 * sélecteurs de cibles à la création d'assignment : seuls les comptes
 * disponibles sont choisissables ; une plateforme sans compte disponible est
 * désactivée. Gate STRICT pour Snytch (available = "actif" seulement) ; lenient
 * ailleurs (warmup terminé suffit).
 */
export const listCreatorAvailableComptes = adminQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, { creatorId }) => {
    const strict = await isSnytchProject(ctx, ctx.projectId);
    const comptes = await ctx.db
      .query("comptes")
      .withIndex("by_project_creator", (q) =>
        q.eq("projectId", ctx.projectId).eq("creatorId", creatorId),
      )
      .collect();
    return comptes
      .map((c) => ({
        _id: c._id,
        handle: c.handle,
        plateforme: c.plateforme,
        available: isAccountAvailable(c, { strict }),
      }))
      .sort((a, b) =>
        a.handle.localeCompare(b.handle, "fr", { sensitivity: "base" }),
      );
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
    // Pays ciblé (label informatif, liste fermée partagée). Optional = non défini.
    targetCountry: v.optional(countryValidator),
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
      throw new ConvexError(
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
    const now = Date.now();
    return await ctx.db.insert("comptes", {
      projectId: ctx.projectId,
      handle: args.handle,
      plateforme: args.plateforme,
      notes: args.notes,
      personneId: args.personneId,
      targetCountry: args.targetCountry,
      status,
      warmupStartedAt: status === "warmup" ? args.warmupStartedAt : undefined,
      // Durée FIGÉE au démarrage du warmup (comme declareCompte) → un changement
      // ultérieur du barème plateforme ne recalcule jamais ce warmup. Absent si
      // le compte n'est pas créé en warmup.
      warmupProtocol:
        status === "warmup"
          ? {
              keywords: [],
              instructions: "",
              targetDays: defaultTargetDays(args.plateforme),
              dailyChecks: [],
              updatedAt: now,
            }
          : undefined,
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
    // Chantier D — changement de plateforme : permis UNIQUEMENT si le compte est
    // VIERGE (compteUsage). Reset du warmup sur la nouvelle durée plateforme.
    plateforme: v.optional(plateformeValidator),
    // Legacy : conservé pour les callers e2e existants (setup/cleanup). Mappé
    // sur status quand status est absent (true → "actif", false → "archived").
    actif: v.optional(v.boolean()),
    status: v.optional(statusValidator),
    // number = set, null = unset explicite, absent = ne pas toucher.
    warmupStartedAt: v.optional(v.union(v.number(), v.null())),
    // null = désassigner le gestionnaire (unset), Id = assigner, absent =
    // ne pas toucher. Pattern folderId/thumbnail d'updateInspiration.
    personneId: v.optional(v.union(v.id("personnes"), v.null())),
    // Mode "géré par l'équipe" : true/false pour (dé)marquer un compte EXISTANT,
    // absent = ne pas toucher. Un compte géré DOIT être rattaché à une créatrice
    // (creatorId) — rejet sinon. NB (dénormalisation D1) : le flag figé sur les
    // assignments DÉJÀ créés n'est pas réécrit ; seuls les futurs assignments
    // captent le nouveau mode (sémantique snapshot du repo).
    managedByAdmin: v.optional(v.boolean()),
    // ─── RÉASSIGNATION du propriétaire (admin) ───────────────────────────────
    // Id = rattacher le compte à cette créatrice, null = détacher (compte
    // INTERNE équipe), absent = ne pas toucher (pattern personneId).
    // PUREMENT PROSPECTIF : ne réécrit NI les assignments existants (chacun
    // porte SON creatorId + rateSnapshot figés) NI les publications (rapprochées
    // par HANDLE, sans lien créateur) → l'historique et la paie déjà calculée ne
    // bougent pas. N'agit que sur l'éligibilité FUTURE (listCreatorAvailableComptes,
    // listAssignableCreatorsWithAccounts), « Mes comptes »/warmup côté portail et
    // la bio (le protocole warmup + la bio restent attachés au compte PHYSIQUE :
    // ni reset ni purge, la nouvelle propriétaire reprend l'état en place).
    creatorId: v.optional(v.union(v.id("creators"), v.null())),
    // Pays ciblé (label informatif) : code de la liste fermée = set, null = unset
    // (« non défini »), absent = ne pas toucher. Validé par countryValidator.
    targetCountry: v.optional(v.union(countryValidator, v.null())),
  },
  handler: async (ctx, args) => {
    const { id } = args;
    const compte = await ctx.db.get(id);
    if (!compte || compte.projectId !== ctx.projectId) {
      throw new ConvexError("Compte introuvable.");
    }
    // Rattachement RÉSULTANT (après application des args) : la garde « géré ⇒
    // créatrice » est évaluée sur l'ÉTAT CIBLE, pas sur l'état courant — sinon
    // détacher la créatrice d'un compte géré laisserait un managed orphelin.
    if (args.creatorId !== undefined && args.creatorId !== null) {
      const creator = await ctx.db.get(args.creatorId);
      if (!creator || creator.projectId !== ctx.projectId) {
        throw new ConvexError("Créateur introuvable dans le projet.");
      }
    }
    const nextCreatorId =
      args.creatorId === undefined
        ? compte.creatorId
        : (args.creatorId ?? undefined);
    const nextManagedByAdmin =
      args.managedByAdmin ?? compte.managedByAdmin ?? false;
    if (nextManagedByAdmin && nextCreatorId === undefined) {
      throw new ConvexError(
        "Un compte géré par l'équipe doit être rattaché à une créatrice.",
      );
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
    if (args.managedByAdmin !== undefined) {
      update.managedByAdmin = args.managedByAdmin;
    }
    if (args.creatorId !== undefined) {
      // null → compte INTERNE (unset), Id → nouvelle propriétaire.
      update.creatorId = args.creatorId === null ? undefined : args.creatorId;
    }
    if (args.targetCountry !== undefined) {
      // null → « non défini » (unset) ; sinon code validé (countryValidator).
      update.targetCountry =
        args.targetCountry === null ? undefined : args.targetCountry;
    }

    // Chantier D — changement de PLATEFORME : VIERGE uniquement (sinon le
    // tracking des publications passées serait faussé). Reset du warmup : la
    // durée effective dépend de la plateforme → le compteur de checks repart
    // proprement (dailyChecks vidés, targetDays = défaut de la NOUVELLE
    // plateforme ; warmupStartedAt re-amorcé si le compte est en warmup).
    if (args.plateforme !== undefined && args.plateforme !== compte.plateforme) {
      const usage = await compteUsage(ctx, ctx.projectId, compte);
      if (usage.inUse) {
        throw new ConvexError(
          "Impossible de changer la plateforme d'un compte déjà utilisé — archive-le et le créateur en déclare un nouveau.",
        );
      }
      const finalHandle = args.handle ?? compte.handle;
      const samePlatform = await ctx.db
        .query("comptes")
        .withIndex("by_project_plateforme", (q) =>
          q.eq("projectId", ctx.projectId).eq("plateforme", args.plateforme!),
        )
        .collect();
      if (samePlatform.some((c) => c._id !== id && c.handle === finalHandle)) {
        throw new ConvexError(
          `Le compte ${finalHandle} existe déjà sur ${args.plateforme}.`,
        );
      }
      update.plateforme = args.plateforme;
      const proto = compte.warmupProtocol;
      update.warmupProtocol = {
        keywords: proto?.keywords ?? [],
        instructions: proto?.instructions ?? "",
        targetDays: defaultTargetDays(args.plateforme),
        dailyChecks: [],
        updatedAt: Date.now(),
      };
      if (effectiveStatus(compte) === "warmup") {
        update.warmupStartedAt = Date.now();
      }
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

/**
 * Chantier D — suppression SSI le compte est VIERGE (compteUsage = aucune
 * référence : pas de target d'assignment, publication, snapshot, ni lineItem de
 * paiement). Sinon REJET (archivage à la place) — jamais de cascade qui
 * orphelinerait des publications/paiements.
 */
export const deleteCompte = adminMutation({
  args: { id: v.id("comptes") },
  handler: async (ctx, args) => {
    const compte = await ctx.db.get(args.id);
    if (!compte || compte.projectId !== ctx.projectId) {
      throw new ConvexError("Compte introuvable.");
    }
    const usage = await compteUsage(ctx, ctx.projectId, compte);
    if (usage.inUse) {
      throw new ConvexError(
        `Ce compte est utilisé (${usage.assignments} assignment(s), ${usage.publications} publication(s), ${usage.payments} ligne(s) de paiement) — tu ne peux pas le supprimer, archive-le plutôt.`,
      );
    }
    await ctx.db.delete(args.id);
  },
});

/**
 * Chantier D — archive un compte (admin). Statut "archived" → exclu des cibles
 * d'assignment (isAccountAvailable) et de la notif warmup créateur
 * (countMyWarmupDue) ; warmup GELÉ (warmupStartedAt unset). Données passées
 * (publications/paiements) intactes. Toujours autorisé (vierge ou utilisé).
 */
export const archiveCompte = adminMutation({
  args: { id: v.id("comptes") },
  handler: async (ctx, { id }) => {
    const compte = await ctx.db.get(id);
    if (!compte || compte.projectId !== ctx.projectId) {
      throw new ConvexError("Compte introuvable.");
    }
    await ctx.db.patch(id, {
      status: "archived",
      actif: false,
      warmupStartedAt: undefined,
    });
    return { ok: true };
  },
});

/** Réactive un compte archivé → "actif" (action ADMIN ; le créateur ne peut pas). */
export const unarchiveCompte = adminMutation({
  args: { id: v.id("comptes") },
  handler: async (ctx, { id }) => {
    const compte = await ctx.db.get(id);
    if (!compte || compte.projectId !== ctx.projectId) {
      throw new ConvexError("Compte introuvable.");
    }
    if (effectiveStatus(compte) !== "archived") return { ok: true };
    await ctx.db.patch(id, { status: "actif", actif: true });
    return { ok: true };
  },
});

/**
 * RELANCE le warmup d'un compte (admin only, scopé projet). Le compte repasse
 * en statut "warmup" avec un warmup NEUF de la durée plateforme courante
 * (defaultTargetDays = 7 pour TikTok/YouTube), compteur de checks remis à zéro
 * et warmupStartedAt = now — EXACTEMENT comme un warmup initial (cf
 * declareCompte). keywords/instructions du protocole sont CONSERVÉS (config du
 * compte, pas une progression). Effet immédiat : isAccountAvailable repasse à
 * false → le compte redevient warmup-gated (ni cible d'assignment, ni
 * publication possible) tant que les N checks ne sont pas posés. NE TOUCHE NI
 * les publications NI les assignments existants : ça ne fait que ré-échauffer.
 */
export const restartWarmup = adminMutation({
  args: { id: v.id("comptes") },
  handler: async (ctx, { id }) => {
    const compte = await ctx.db.get(id);
    if (!compte || compte.projectId !== ctx.projectId) {
      throw new ConvexError("Compte introuvable.");
    }
    const now = Date.now();
    const proto = compte.warmupProtocol;
    const targetDays = defaultTargetDays(compte.plateforme);
    await ctx.db.patch(id, {
      status: "warmup",
      // Legacy synchronisé (TD-017) : un compte en warmup n'est pas "actif".
      actif: false,
      warmupStartedAt: now,
      warmupProtocol: {
        keywords: proto?.keywords ?? [],
        instructions: proto?.instructions ?? "",
        targetDays,
        dailyChecks: [],
        updatedAt: now,
      },
    });
    return { ok: true, targetDays };
  },
});

/** Normalise un handle : trim + préfixe @ (convention CompteDialog). */
function normalizeHandle(h: string): string {
  const t = h.trim();
  if (!t) return "";
  return t.startsWith("@") ? t : `@${t}`;
}

// ─── P5 — Protocole de warmup (admin) ────────────────────────────────────────

/**
 * Édite le protocole de warmup d'un compte (keywords / instructions /
 * targetDays). Préserve dailyChecks. Les keywords sont trim + dédupliqués DANS
 * le compte (insensible à la casse, garde la 1re forme). AUCUNE contrainte
 * d'unicité inter-comptes : un même mot-clé peut être partagé entre plusieurs
 * comptes (la règle « unique par compte dans le projet » a été retirée — elle
 * bloquait l'admin qui assigne des niches communes aux comptes d'un créateur).
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
      // Pas d'unicité inter-comptes : un mot-clé peut servir sur plusieurs comptes.
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

// ─── Bio à mettre (par compte) ───────────────────────────────────────────────

type BioStatus = "to_apply" | "applied";

interface BioState {
  bioToApply?: string;
  bioStatus?: BioStatus;
  bioUpdatedAt?: number;
  bioAppliedAt?: number;
}
interface BioPatch {
  bioToApply?: string | undefined;
  bioStatus?: BioStatus | undefined;
  bioUpdatedAt?: number | undefined;
  bioAppliedAt?: number | undefined;
}

/**
 * ⚠️ A6 (cross-tsconfig) — DUPLIQUÉ à l'identique de lib/account-bio.computeBioPatch
 * (convex/ ne peut pas importer lib/). Toute évolution doit être répliquée des
 * deux côtés ; la logique est testée côté lib (vitest) + e2e. Décide le patch
 * résultant quand l'admin enregistre `rawBio` : pose/modif → "to_apply" (+ purge
 * bioAppliedAt) ; même texte → no-op ; bio vidée → efface tout.
 */
function computeBioPatch(
  current: BioState,
  rawBio: string,
  now: number,
): BioPatch | null {
  const bio = rawBio.trim();
  if (bio.length === 0) {
    if (current.bioToApply === undefined) return null;
    return {
      bioToApply: undefined,
      bioStatus: undefined,
      bioUpdatedAt: undefined,
      bioAppliedAt: undefined,
    };
  }
  if (current.bioToApply === bio && current.bioStatus !== undefined) {
    return null;
  }
  return {
    bioToApply: bio,
    bioStatus: "to_apply",
    bioUpdatedAt: now,
    bioAppliedAt: undefined,
  };
}

/**
 * Admin — définit/modifie la « bio à mettre » d'un compte (scopé projet). Toute
 * bio NOUVELLE ou MODIFIÉE repasse le compte en "to_apply" (le créateur devra
 * re-confirmer) ; re-sauver le même texte est un no-op ; vider la bio l'efface.
 * Garanti SERVEUR via computeBioPatch (pas seulement l'UI).
 */
export const setAccountBio = adminMutation({
  args: { id: v.id("comptes"), bio: v.string() },
  handler: async (ctx, { id, bio }) => {
    const compte = await ctx.db.get(id);
    if (!compte || compte.projectId !== ctx.projectId) {
      throw new ConvexError("Compte introuvable.");
    }
    const patch = computeBioPatch(compte, bio, Date.now());
    if (patch !== null) await ctx.db.patch(id, patch);
  },
});

/**
 * Créateur — confirme avoir appliqué la bio sur son vrai compte social →
 * "applied" + bioAppliedAt = now. Strictement scopé : le compte doit appartenir
 * au créateur authentifié (creatorId) ET avoir une bio en attente. Idempotent si
 * déjà appliquée. Un créateur ne peut JAMAIS confirmer le compte d'un autre.
 */
export const confirmAccountBioApplied = creatorMutation({
  args: { id: v.id("comptes") },
  handler: async (ctx, { id }) => {
    const compte = await ctx.db.get(id);
    if (
      !compte ||
      compte.projectId !== ctx.projectId ||
      compte.creatorId !== ctx.creatorId
    ) {
      throw new ConvexError("Compte introuvable.");
    }
    if (compte.bioToApply === undefined || compte.bioStatus === undefined) {
      throw new ConvexError("Aucune bio à appliquer sur ce compte.");
    }
    if (compte.bioStatus === "applied") return; // idempotent
    await ctx.db.patch(id, { bioStatus: "applied", bioAppliedAt: Date.now() });
  },
});

// ─── P5 — Portail créateur (creatorQuery / creatorMutation) ───────────────────
//
// Lecture des écrans portail : helpers PURS de données (ctx.db + projectId +
// creatorId explicites) appelés à la fois par la creatorQuery (créateur sur SA
// fiche) ET par l'adminViewAsQuery (admin « voir l'espace d'un créateur »,
// lecture seule scopée projet). MÊME code → 0 duplication, le chemin créateur
// normal est inchangé (le helper reçoit ctx.creatorId résolu par requireCreator).

async function comptesForCreator(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
) {
  const comptes = await ctx.db
    .query("comptes")
    .withIndex("by_project_creator", (q) =>
      q.eq("projectId", projectId).eq("creatorId", creatorId),
    )
    .collect();
  return comptes.sort((a, b) =>
    a.handle.localeCompare(b.handle, "fr", { sensitivity: "base" }),
  );
}

// Comptes GÉRÉS exclus : c'est l'équipe qui coche leur warmup, jamais la
// créatrice → ils ne doivent JAMAIS peser dans ses compteurs / notifs à faire.
function warmupDueCount(comptes: Doc<"comptes">[], now: number) {
  return comptes.filter(
    (c) =>
      !c.managedByAdmin &&
      effectiveStatus(c) === "warmup" &&
      mustCheckToday(c, now),
  ).length;
}

function warmupInProgressCount(comptes: Doc<"comptes">[]) {
  return comptes.filter(
    (c) =>
      !c.managedByAdmin &&
      effectiveStatus(c) === "warmup" &&
      !isWarmupComplete({
        plateforme: c.plateforme,
        warmupProtocol: c.warmupProtocol,
      }),
  ).length;
}

/** Comptes du créateur courant UNIQUEMENT (filtré serveur par ctx.creatorId). */
export const listMyComptes = creatorQuery({
  args: {},
  handler: async (ctx) => comptesForCreator(ctx, ctx.projectId, ctx.creatorId),
});

/** ADMIN view-as — comptes du créateur ciblé (lecture seule, scopé projet). */
export const listComptesAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) => comptesForCreator(ctx, ctx.projectId, ctx.creatorId),
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
 * Déclaration d'un compte GÉRÉ PAR L'ÉQUIPE (admin) rattaché à une créatrice.
 * Point d'écriture de comptes.creatorId à la CRÉATION côté admin (declareCompte,
 * côté créatrice, reste l'autre ; la RÉASSIGNATION d'un compte existant passe par
 * updateCompte.creatorId). L'appartenance = la créatrice ciblée (elle voit
 * scripts + Mes vidéos + perfs), le MODE = managedByAdmin:true (l'équipe coche le
 * warmup, soumet, publie). Créé en "warmup" (l'admin cochera puis activera) —
 * même init que declareCompte pour rester en phase avec le gate strict #98.
 */
export const declareManagedCompte = adminMutation({
  args: {
    creatorId: v.id("creators"),
    plateforme: plateformeValidator,
    handle: v.string(),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const creator = await ctx.db.get(args.creatorId);
    if (!creator || creator.projectId !== ctx.projectId) {
      throw new ConvexError("Créateur introuvable dans le projet.");
    }
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
      // Appartenance : la créatrice ciblée (comme declareCompte pose ctx.creatorId).
      creatorId: args.creatorId,
      // MODE opératoire : l'équipe tient physiquement le compte.
      managedByAdmin: true,
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
 * Cœur du check warmup du jour — PARTAGÉ par le check CRÉATRICE (markWarmupCheck)
 * et le check ADMIN d'un compte géré (markWarmupCheckAsAdmin). Le compte est déjà
 * AUTORISÉ par l'appelant (appartenance créatrice OU compte géré du projet).
 * REFUSE un 2e check le même jour (UTC) et un warmup déjà terminé — gardes
 * serveur, pas seulement UI. Chantier B : progression par checks RÉELS.
 */
async function applyWarmupCheck(
  ctx: MutationCtx,
  compte: Doc<"comptes">,
): Promise<{ totalChecks: number }> {
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
  if (
    isWarmupComplete({ plateforme: compte.plateforme, warmupProtocol: protocol })
  ) {
    throw new ConvexError(
      "Warmup déjà terminé — en attente de validation admin.",
    );
  }
  if (checkedToday(protocol.dailyChecks, now)) {
    throw new ConvexError("Le check du jour est déjà fait.");
  }
  const dailyChecks = [...protocol.dailyChecks, todayKey(now)];
  await ctx.db.patch(compte._id, {
    warmupProtocol: { ...protocol, dailyChecks },
  });
  return { totalChecks: dailyChecks.length };
}

/**
 * Check warmup du jour (CRÉATRICE). Le compte doit lui appartenir ET être en
 * warmup. Un compte GÉRÉ par l'équipe est REFUSÉ ici : c'est l'admin qui coche
 * (markWarmupCheckAsAdmin) — la créatrice ne touche pas ces comptes.
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
    if (compte.managedByAdmin) {
      throw new ConvexError(
        "Compte géré par l'équipe : le warmup est coché par l'admin.",
      );
    }
    return applyWarmupCheck(ctx, compte);
  },
});

/**
 * Check warmup du jour (ADMIN) d'un compte GÉRÉ. Même logique + garde 1-par-jour
 * que la créatrice, mais gaté sur compte.managedByAdmin + projectId (pas
 * d'appartenance créatrice requise : l'équipe tient le compte). Puis activation
 * via updateCompte status:"actif" (déjà dispo) → le gate strict #98 reste le
 * VRAI passage warmup → disponible.
 */
export const markWarmupCheckAsAdmin = adminMutation({
  args: { id: v.id("comptes") },
  handler: async (ctx, args) => {
    const compte = await ctx.db.get(args.id);
    if (!compte || compte.projectId !== ctx.projectId) {
      throw new ConvexError("Compte introuvable.");
    }
    if (!compte.managedByAdmin) {
      throw new ConvexError(
        "Ce compte n'est pas géré par l'équipe (le créateur coche son warmup).",
      );
    }
    return applyWarmupCheck(ctx, compte);
  },
});

/**
 * Notif in-app créateur : nb de MES comptes ayant un warmup à faire/rattraper
 * AUJOURD'HUI (en warmup, non terminé par les checks, pas encore coché
 * aujourd'hui). Filtré serveur par creatorId. Compteur DÉRIVÉ (pas de table
 * notifications), pattern countMyToPublish.
 */
export const countMyWarmupDue = creatorQuery({
  args: {},
  handler: async (ctx) => {
    const comptes = await comptesForCreator(ctx, ctx.projectId, ctx.creatorId);
    return warmupDueCount(comptes, Date.now());
  },
});

/** ADMIN view-as — warmups à cocher aujourd'hui du créateur ciblé (lecture). */
export const countWarmupDueAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) => {
    const comptes = await comptesForCreator(ctx, ctx.projectId, ctx.creatorId);
    return warmupDueCount(comptes, Date.now());
  },
});

/**
 * Notif in-app créateur : nb de MES comptes dont le warmup est EN COURS (en
 * warmup ET pas encore terminé par les checks), QU'UN CHECK SOIT DÛ AUJOURD'HUI
 * OU NON. Alimente le rappel PERMANENT du dashboard (« reviens le cocher chaque
 * jour ») — distinct de countMyWarmupDue qui ne compte que les checks à faire
 * AUJOURD'HUI. LECTURE seule, filtré serveur par creatorId : aucune écriture,
 * aucune dérivation calendaire (la complétion est fondée sur les checks réels).
 */
export const countMyWarmupInProgress = creatorQuery({
  args: {},
  handler: async (ctx) => {
    const comptes = await comptesForCreator(ctx, ctx.projectId, ctx.creatorId);
    return warmupInProgressCount(comptes);
  },
});

/** ADMIN view-as — warmups EN COURS du créateur ciblé (lecture seule). */
export const countWarmupInProgressAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) => {
    const comptes = await comptesForCreator(ctx, ctx.projectId, ctx.creatorId);
    return warmupInProgressCount(comptes);
  },
});

// ─── SNYTCH — état d'ONBOARDING créatrice (dérivé serveur COMPACT) ────────────
// Alimente la checklist du dashboard (cf lib/onboarding.deriveOnboarding + le
// DashboardScreen). On NE renvoie QUE le strict nécessaire (statut, warmup, bio)
// par compte — jamais le brut (protocole, keywords, notes). SNYTCH UNIQUEMENT :
// hors Snytch → { applicable:false } → la checklist ne s'affiche pas et le
// dashboard garde son comportement historique.

type OnboardingAccountPayload = {
  id: Id<"comptes">;
  handle: string;
  plateforme: Doc<"comptes">["plateforme"];
  status: CompteStatus;
  checksDone: number;
  targetDays: number;
  warmupDone: boolean;
  dueToday: boolean;
  bio: "none" | "to_apply" | "applied";
};

type OnboardingStatePayload = {
  applicable: boolean;
  accounts: OnboardingAccountPayload[];
  fullyManaged: boolean;
};

async function onboardingStateForCreator(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  creatorId: Id<"creators">,
  now: number,
): Promise<OnboardingStatePayload> {
  // Feature Snytch-only : hors Snytch on ne charge même pas les comptes.
  if (!(await isSnytchProject(ctx, projectId))) {
    return { applicable: false, accounts: [], fullyManaged: false };
  }
  const allComptes = await comptesForCreator(ctx, projectId, creatorId);
  // Comptes GÉRÉS exclus de la checklist d'onboarding : la créatrice n'a ni
  // warmup ni bio ni @ à créer dessus (l'équipe tient le compte). « Full gérée »
  // = 0 compte propre + ≥1 géré → aucun onboarding à faire (message dédié au lieu
  // de la checklist, cf DashboardScreen), à distinguer d'une créatrice NEUVE
  // (0 compte du tout → elle doit déclarer).
  const comptes = allComptes.filter((c) => !c.managedByAdmin);
  const fullyManaged =
    comptes.length === 0 && allComptes.some((c) => c.managedByAdmin);
  const accounts = comptes.map((c) => {
    const warmupLike = {
      plateforme: c.plateforme,
      warmupProtocol: c.warmupProtocol,
    };
    const status = effectiveStatus(c);
    return {
      id: c._id,
      handle: c.handle,
      plateforme: c.plateforme,
      status,
      checksDone: c.warmupProtocol?.dailyChecks?.length ?? 0,
      targetDays: effectiveTargetDays(warmupLike),
      warmupDone: isWarmupComplete(warmupLike),
      dueToday: status === "warmup" && mustCheckToday(warmupLike, now),
      bio: (c.bioStatus ?? "none") as "none" | "to_apply" | "applied",
    };
  });
  return { applicable: true, accounts, fullyManaged };
}

/** État d'onboarding de MON espace créateur (Snytch). Cf lib/onboarding. */
export const getMyOnboardingState = creatorQuery({
  args: {},
  handler: async (ctx) =>
    onboardingStateForCreator(ctx, ctx.projectId, ctx.creatorId, Date.now()),
});

/** ADMIN view-as — état d'onboarding du créateur ciblé (lecture seule). */
export const getOnboardingStateAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) =>
    onboardingStateForCreator(ctx, ctx.projectId, ctx.creatorId, Date.now()),
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

/**
 * e2e ONLY (gated E2E_SECRET) — pose un historique de checks de warmup arbitraire
 * sur un compte. markWarmupCheck est limité à 1 check/jour (Date.now non
 * injectable) ; ce helper permet aux tests de simuler des jours cochés/manqués
 * (rattrapage, warmup terminé) de façon déterministe. Initialise un protocole par
 * défaut si absent.
 */
export const e2eSetWarmupChecks = e2eMutation({
  args: { id: v.id("comptes"), dailyChecks: v.array(v.string()) },
  handler: async (ctx, { id, dailyChecks }) => {
    const compte = await ctx.db.get(id);
    if (!compte) throw new ConvexError("Compte introuvable.");
    const protocol = compte.warmupProtocol ?? {
      keywords: [],
      instructions: "",
      targetDays: defaultTargetDays(compte.plateforme),
      dailyChecks: [],
      updatedAt: Date.now(),
    };
    await ctx.db.patch(id, {
      warmupProtocol: { ...protocol, dailyChecks },
    });
    return { totalChecks: dailyChecks.length };
  },
});

/**
 * e2e ONLY (gated E2E_SECRET) — crée un compte ACTIF (donc DISPONIBLE) lié à un
 * créateur, pour servir de CIBLE d'assignment dans les tests multi-plateformes
 * (chantier C). Évite d'avoir à déclarer un compte côté créateur puis compléter
 * son warmup. Marqué [E2E_TEST] → nettoyé par cleanupTestComptes.
 */
export const e2eSeedAvailableCompte = e2eMutation({
  args: {
    creatorId: v.id("creators"),
    plateforme: plateformeValidator,
    handle: v.string(),
  },
  handler: async (ctx, { creatorId, plateforme, handle }): Promise<Id<"comptes">> => {
    const creator = await ctx.db.get(creatorId);
    if (!creator) throw new ConvexError("Créateur introuvable.");
    return ctx.db.insert("comptes", {
      projectId: creator.projectId,
      handle,
      plateforme,
      notes: "[E2E_TEST] compte cible",
      status: "actif",
      actif: true,
      creatorId,
    });
  },
});
