import {
  adminMutation,
  adminQuery,
  adminViewAsQuery,
  authedQuery,
  creatorMutation,
  creatorQuery,
  e2eMutation,
  publicQuery,
  requireCreatorViewableByAdmin,
  requireProjectAdmin,
} from "./functions";
import { getProjectBySlug, REPACKIT_SLUG } from "./projects";
import {
  isPortalRole,
  resolveCreatorKind,
  roleForKind,
  type PortalRole,
} from "./roles";
import { internal } from "./_generated/api";
import { syncBonusUnlocks } from "./pricing";
import { DELETABLE_STATUSES, purgeAndDeleteAssignment } from "./assignments";
import { ConvexError, v } from "convex/values";
import { normalizeRef } from "./conversionAttribution";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { normalizeCreatorLocale } from "./locales";

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
    // POPULATION invitée. ABSENT = "partner" (créateur partenaire) → un appelant
    // existant qui n'envoie rien obtient EXACTEMENT le comportement d'avant. Le
    // littéral `memberships.role` en dérivera au signup (convex/roles.roleForKind).
    kind: v.optional(
      v.union(
        v.literal("partner"),
        v.literal("talent"),
        v.literal("clipper"),
      ),
    ),
    // LANGUE d'interface du créateur invité. ABSENT ⇒ français : on ne stocke
    // que la DIVERGENCE, comme pour `kind`. C'est cette valeur qui décide de la
    // langue de l'e-mail d'invitation — envoyé AVANT que le compte existe, donc
    // avant qu'un `users.locale` puisse exister.
    locale: v.optional(v.string()),
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
      // Posé UNIQUEMENT si ce n'est pas un partenaire : une fiche de partenaire
      // reste sans `kind`, indistinguable des fiches existantes (0 bruit, et le
      // défaut de lecture resolveCreatorKind fait le reste).
      kind:
        args.kind === undefined || args.kind === "partner"
          ? undefined
          : args.kind,
      // Même règle que `kind` : « fr » est le défaut, on ne l'écrit pas.
      locale: normalizeCreatorLocale(args.locale),
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
    // Dépôt de fichiers Snytch — crée le sous-dossier Drive du créateur (hors
    // chemin critique). ensureCreatorFolder s'auto-gate (Snytch only) et no-op
    // proprement si l'env Drive est absent → aucun impact sur les autres projets.
    await ctx.scheduler.runAfter(0, internal.snytchDrive.ensureCreatorFolder, {
      creatorId,
    });
    // Envoi du lien d'activation par email (hors transaction : un Resend en
    // panne ne doit pas faire échouer la création de la fiche). Le lien reste
    // affiché dans l'UI pour un partage manuel de secours.
    await ctx.scheduler.runAfter(0, internal.emails.sendCreatorInvite, {
      creatorId,
      token,
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
    // Le nouveau lien part aussi par email (hors transaction).
    await ctx.scheduler.runAfter(0, internal.emails.sendCreatorInvite, {
      creatorId,
      token,
    });
    return { token };
  },
});

/** Patch partiel d'un créateur (statut, paiement, notes admin, contact). */
/** Longueur max d'un @ (handle) — large mais borné (saisie libre). */
const HANDLE_MAX_LENGTH = 64;

const handlesToCreateValidator = v.object({
  tiktok: v.optional(v.string()),
  youtube: v.optional(v.string()),
  instagram: v.optional(v.string()),
});

/** Trim + cap un @ ; vide → undefined. */
function normHandle(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (t.length === 0) return undefined;
  return t.length > HANDLE_MAX_LENGTH ? t.slice(0, HANDLE_MAX_LENGTH) : t;
}

/**
 * Normalise les @ à créer : trim chaque réseau, vide → undefined. Si AUCUN
 * réseau renseigné → undefined (pas d'objet vide stocké). Trivial, sans réplique
 * lib (pas d'A6).
 */
function normalizeHandlesToCreate(
  raw: { tiktok?: string; youtube?: string; instagram?: string } | undefined,
): { tiktok?: string; youtube?: string; instagram?: string } | undefined {
  if (!raw) return undefined;
  const tiktok = normHandle(raw.tiktok);
  const youtube = normHandle(raw.youtube);
  const instagram = normHandle(raw.instagram);
  if (!tiktok && !youtube && !instagram) return undefined;
  return { tiktok, youtube, instagram };
}

export const updateCreator = adminMutation({
  args: {
    id: v.id("creators"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    status: v.optional(CREATOR_STATUSES),
    paymentMethod: v.optional(PAYMENT_METHODS),
    paymentDetails: v.optional(v.string()),
    adminNotes: v.optional(v.string()),
    // LANGUE d'interface — corrigeable SANS régénérer l'invitation. Une valeur
    // « fr » explicite est normalisée en `undefined` (on ne stocke que la
    // divergence) : repasser un créateur en français EFFACE le champ.
    locale: v.optional(v.string()),
    // Ref du chemin court snytch.co (attribution de conversion). null = retirer.
    refSlug: v.optional(v.union(v.string(), v.null())),
    // Grille de paliers de bonus du créateur (cumul). null = détacher.
    bonusPricingId: v.optional(v.union(v.id("pricings"), v.null())),
    // @ à créer par réseau (saisie libre admin). Absent = ne pas toucher ;
    // objet (réseaux vides) = effacer.
    handlesToCreate: v.optional(handlesToCreateValidator),
    // ─── APPARIEMENT talent → clippeur (Q3 : 1 talent → 1 clippeur) ──────────
    // Écrit sur la fiche du TALENT. null = désapparier, absent = ne pas toucher.
    // L'ÉCRAN d'appariement est le chantier suivant ; ce write-side est posé ici
    // parce que `assignScriptToRush` en dépend — sans lui la mutation est
    // inassignable et intestable. La cible est vérifiée : elle doit être un
    // CLIPPEUR du même projet, et le champ n'a de sens que sur un talent.
    clipperId: v.optional(v.union(v.id("creators"), v.null())),
    // ─── TARIFS des deux nouvelles populations (chantier pricing) ────────────
    // Scalaires, édités depuis l'écran Pricings. `null` = retirer le tarif,
    // absent = ne pas toucher. Aucune validation croisée avec le `kind` : un
    // tarif posé sur la mauvaise population est inerte (le moteur ne lit
    // `clipRate` qu'à l'assignation d'un clip et `cycleRetainer` que sur un
    // talent), et refuser ici obligerait à re-saisir après un changement de
    // population.
    clipRate: v.optional(v.union(v.number(), v.null())),
    cycleRetainer: v.optional(v.union(v.number(), v.null())),
    // ─── CHANGEMENT DE POPULATION ────────────────────────────────────────────
    // Corrige une invitation faite avec la mauvaise population. Autorisé
    // UNIQUEMENT sur une fiche VIERGE (cf garde dans le handler) : basculer
    // quelqu'un qui a déjà des comptes changerait leur modèle de chauffe (D3) et
    // donc leur publiabilité, du jour au lendemain et sans geste humain.
    kind: v.optional(
      v.union(v.literal("partner"), v.literal("talent"), v.literal("clipper")),
    ),
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
    if (args.locale !== undefined) {
      patch.locale = normalizeCreatorLocale(args.locale);
    }
    if (args.status !== undefined) patch.status = args.status;
    // ─── ANCRE DE CYCLE D'UN TALENT — la ligne la plus délicate de ce module ──
    // Posée à la PREMIÈRE activation, jamais réécrite.
    //
    // ⚠️ LE GATE SUR LA POPULATION N'EST PAS UN CONFORT. Sans lui, un PARTENAIRE
    // activé recevrait une ancre antérieure à son premier post : `cycleIndexOf`
    // recalerait TOUS ses cycles, y compris ceux déjà payés, et des euros
    // changeraient de cycle sans qu'aucun humain n'ait rien fait. Une spec le
    // vérifie avec un partenaire réel.
    if (
      args.status === "active" &&
      creator.payAnchorAt === undefined &&
      resolveCreatorKind(creator.kind) === "talent"
    ) {
      patch.payAnchorAt = Date.now();
    }
    for (const champ of ["clipRate", "cycleRetainer"] as const) {
      const valeur = args[champ];
      if (valeur === undefined) continue;
      if (valeur !== null && (!Number.isFinite(valeur) || valeur < 0)) {
        throw new ConvexError("Le tarif doit être un nombre ≥ 0.");
      }
      patch[champ] = valeur === null ? undefined : valeur;
    }
    if (args.paymentMethod !== undefined) patch.paymentMethod = args.paymentMethod;
    if (args.paymentDetails !== undefined) {
      patch.paymentDetails = args.paymentDetails.trim() || undefined;
    }
    if (args.adminNotes !== undefined) {
      patch.adminNotes = args.adminNotes.trim() || undefined;
    }
    if (args.refSlug !== undefined) {
      // Normalisée à l'écriture (minuscules, sans « / » ni « @ ») ; null ET
      // saisie blanche retirent la ref — la créatrice repasse « pas de ref
      // configurée » dans la section conversion, jamais à zéro.
      patch.refSlug =
        args.refSlug === null
          ? undefined
          : (normalizeRef(args.refSlug) ?? undefined);
    }
    if (args.handlesToCreate !== undefined) {
      patch.handlesToCreate = normalizeHandlesToCreate(args.handlesToCreate);
    }
    // ─── BASCULE DE POPULATION — trois effets, pas un menu déroulant ─────────
    if (
      args.kind !== undefined &&
      args.kind !== resolveCreatorKind(creator.kind)
    ) {
      const cible = args.kind;
      // 1. GARDE — fiche vierge seulement. Le refus NOMME ce qui bloque : sans
      //    ça l'admin ne sait ni pourquoi ni quoi défaire.
      const impact = await creatorDeletionImpact(ctx, creator);
      const bloquants: string[] = [];
      if (impact.comptes > 0) bloquants.push(`${impact.comptes} compte(s)`);
      if (impact.publications > 0) {
        bloquants.push(`${impact.publications} publication(s)`);
      }
      if (impact.payments > 0) {
        bloquants.push(`${impact.payments} ligne(s) de paiement`);
      }
      if (bloquants.length > 0) {
        throw new ConvexError(
          `Impossible de changer la population de ${creator.name} : ${bloquants.join(", ")} y sont rattaché(e)s. ` +
            "Un créateur qui a déjà travaillé garde sa population — crée une nouvelle fiche si besoin.",
        );
      }
      patch.kind = cible === "partner" ? undefined : cible;

      // 2. LE PORTAIL — le littéral de membership DÉRIVE de la fiche au signup ;
      //    sans cette mise à jour, la personne resterait renvoyée vers l'ancien
      //    portail et serait rejetée du nouveau (les gardes exigent l'accord
      //    entre membership et `kind`). La bascule serait cosmétique et enfermante.
      if (creator.userId) {
        const membership = await ctx.db
          .query("memberships")
          .withIndex("by_user_project", (q) =>
            q.eq("userId", creator.userId!).eq("projectId", ctx.projectId),
          )
          .first();
        if (membership) {
          await ctx.db.patch(membership._id, { role: roleForKind(cible) });
        }
      }

      // 3. L'ANCRE DE PAIE. `payAnchorAt` se pose à l'activation d'un TALENT ;
      //    quelqu'un déjà actif basculé en talent ne l'aurait jamais eue — il
      //    n'apparaîtrait dans aucun cycle et `markCyclePaid` jetterait.
      const statutCible = args.status ?? creator.status;
      if (
        cible === "talent" &&
        statutCible === "active" &&
        creator.payAnchorAt === undefined
      ) {
        patch.payAnchorAt = Date.now();
      }
      // Quitter la population talent retire l'ancre : la fiche est vierge par
      // construction (garde ci-dessus), donc aucun cycle ne s'y appuie.
      if (cible !== "talent") patch.payAnchorAt = undefined;
    }

    if (args.clipperId !== undefined) {
      if (args.clipperId === null) {
        patch.clipperId = undefined;
      } else {
        // La fiche éditée doit être un TALENT : apparier un partenaire ou un
        // clippeur à un clippeur n'a aucun sens et laisserait un champ mort que
        // personne ne relirait.
        if (resolveCreatorKind(creator.kind) !== "talent") {
          throw new ConvexError(
            "Seul un talent peut être apparié à un clippeur.",
          );
        }
        const clipper = await ctx.db.get(args.clipperId);
        if (!clipper || clipper.projectId !== ctx.projectId) {
          throw new ConvexError("Clippeur introuvable dans le projet.");
        }
        if (resolveCreatorKind(clipper.kind) !== "clipper") {
          throw new ConvexError(
            `${clipper.name} n'est pas un clippeur : impossible de lui rattacher un talent.`,
          );
        }
        patch.clipperId = args.clipperId;
      }
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
      // LANGUE choisie par l'admin à l'invitation. Exposée ici parce que c'est
      // le SEUL moment où /join peut la connaître : le créateur arrive sans
      // session (rien à lire côté users) et sans cookie (premier passage sur le
      // domaine). Sans elle, il clique un e-mail en anglais et atterrit sur un
      // écran français — `Accept-Language` peut le sauver par chance, jamais par
      // choix de l'admin.
      //
      // Aucune fuite ajoutée : le token garde déjà toute cette lecture, et c'est
      // une valeur POSÉE PAR L'ADMIN, pas une donnée personnelle du créateur.
      // `null` = défaut, la page ne pose alors aucun cookie.
      locale: creator.locale ?? null,
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
 *     projet par défaut (cible de redirection depuis / et les portails).
 *   - sinon, au moins un membership de PORTAIL → ce rôle ("creator" partenaire,
 *     "talent" ou "clipper") + nom de la fiche (pour l'accueil du portail).
 *     L'admin PRIME (un humain admin+créateur va sur l'app interne) ; entre
 *     rôles de portail, le PREMIER trouvé dans l'ordre creator → talent →
 *     clipper gagne : un même humain n'est pas censé cumuler deux populations,
 *     et si ça arrive, mieux vaut un choix déterministe qu'un écran vide.
 *   - sinon → role "none".
 *
 * La FORME du retour est volontairement UNIQUE pour les trois portails (mêmes
 * champs projectId/payoutDay/accentColor) : un objet discriminé par rôle
 * obligerait chaque appelant front à narrower avant de lire `projectId`, pour
 * zéro gain — la donnée est la même, seul le portail cible change.
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
    const portalRole: PortalRole | undefined = (
      ["creator", "talent", "clipper"] as const
    ).find((r) => memberships.some((m) => m.role === r));

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

    if (portalRole !== undefined) {
      // Résolution INCHANGÉE (`.first()` par userId) : le partenaire multi-projets
      // continue de passer par getMyCreatorProjects pour la liste ; ici on ne sert
      // que le nom d'accueil + le projet par défaut du portail.
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
        role: portalRole,
        slug: null,
        creatorName: creator?.name ?? null,
        // P5 — projectId du créateur : le portail le passe aux creator/talent/
        // clipperQuery (qui exigent projectId, hors ProjectProvider).
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
async function profileFor(ctx: QueryCtx, creatorId: Id<"creators">) {
  const c = await ctx.db.get(creatorId);
  if (!c) return null;
  return {
    name: c.name,
    email: c.email,
    phone: c.phone ?? null,
    paymentMethod: c.paymentMethod ?? null,
    paymentDetails: c.paymentDetails ?? null,
    // @ à créer par réseau (consigne onboarding). null = aucun.
    handlesToCreate: c.handlesToCreate ?? null,
  };
}

export const getMyProfile = creatorQuery({
  args: {},
  handler: async (ctx) => profileFor(ctx, ctx.creatorId),
});

/** ADMIN view-as — profil (lecture) du créateur ciblé. Scopé projet + superadmin. */
export const getProfileAsAdmin = adminViewAsQuery({
  args: {},
  handler: async (ctx) => profileFor(ctx, ctx.creatorId),
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
 * Projets du PORTAIL de l'utilisateur courant (switcher /app, et résolution du
 * projet pour les portails talent/clippeur). Liste les projets où il a un
 * membership de portail — "creator", "talent" ou "clipper" — avec le branding par
 * projet (nom, accent, logo) + payoutDay + le nom de SA fiche sur ce projet.
 * Vide s'il n'a aucun membership de portail. N'expose JAMAIS un projet où il n'est
 * pas membre, ni un projet où il n'est QU'admin (l'app interne a son propre
 * résolveur, `projects.getProjectForCurrentUser`).
 *
 * Un utilisateur n'ayant qu'UNE population, cette liste reste, pour un partenaire,
 * exactement celle d'avant : le rôle est porté par le membership, jamais mélangé.
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
      /** Devise de la PAIE (dollars pour Snytch). null → montants sans symbole. */
      payCurrency: string | null;
    }[] = [];
    for (const m of memberships) {
      if (!isPortalRole(m.role)) continue;
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
        payCurrency: project.payCurrency ?? null,
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
    // Dépôt de fichiers Snytch — crée le sous-dossier Drive (self-gaté Snytch,
    // no-op sans env Drive). Cf inviteCreator.
    await ctx.scheduler.runAfter(0, internal.snytchDrive.ensureCreatorFolder, {
      creatorId,
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
/**
 * Lecture e2e de la LANGUE, des deux côtés à la fois : la fiche et le compte.
 * Les deux ensemble parce que c'est leur COHÉRENCE qui est testée — la fiche
 * porte le choix de l'admin, le compte en hérite au signup et fait foi ensuite.
 * `null` des deux côtés = français par défaut, rien de stocké.
 */
export const e2eGetCreatorLocaleState = e2eMutation({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, { creatorId }) => {
    const c = await ctx.db.get(creatorId);
    if (!c) throw new ConvexError("Fiche introuvable.");
    const user = c.userId ? await ctx.db.get(c.userId) : null;
    return {
      creatorLocale: c.locale ?? null,
      userLocale: user?.locale ?? null,
    };
  },
});

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

/**
 * Assertion du contrôle d'accès du mode admin « voir l'espace d'un créateur »
 * (adminViewAsQuery), AS l'utilisateur `email`, pour (projectId, creatorId).
 * Exécute la MÊME gate que le wrapper (requireCreatorViewableByAdmin) → prouve
 * le scoping serveur : admin du projet OK ; créateur hors projet / autre projet
 * refusé ; rôle creator refusé. Renvoie { allowed, error } sans lever.
 */
export const e2eAssertViewAsAccess = e2eMutation({
  args: {
    email: v.string(),
    projectId: v.id("projects"),
    creatorId: v.id("creators"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (user === null) return { allowed: false, error: "user introuvable" };
    try {
      await requireCreatorViewableByAdmin(
        ctx,
        user._id,
        args.projectId,
        args.creatorId,
      );
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
/**
 * e2e ONLY — ANTIDATE l'ancre de cycle d'un talent.
 *
 * `payAnchorAt` est posée par le moteur à l'activation (`Date.now()`) et jamais
 * réécrite : sans antidatage, tester un talent qui a plusieurs cycles derrière
 * lui demanderait d'attendre 30 jours par cycle. Même rôle que le `now` injecté
 * de l'expiration des rushes et que le `validatedAt` du seed de compte — le test
 * exerce le VRAI moteur de cycle, il ne le simule pas.
 */
export const e2eSetPayAnchor = e2eMutation({
  args: {
    creatorId: v.id("creators"),
    payAnchorAt: v.optional(v.number()),
    // `firstPostAt` sert aux specs qui ont besoin d'un créateur « qui a publié »
    // sans dérouler une publication complète (classement du cycle).
    firstPostAt: v.optional(v.number()),
  },
  handler: async (ctx, { creatorId, payAnchorAt, firstPostAt }) => {
    await ctx.db.patch(creatorId, {
      ...(payAnchorAt !== undefined ? { payAnchorAt } : {}),
      ...(firstPostAt !== undefined ? { firstPostAt } : {}),
    });
    return { ok: true };
  },
});

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
      // Rushes déposés si la fiche est un TALENT (cascade, comme ci-dessus) :
      // sans ça, chaque run laisse des rushes orphelins pointant une fiche morte.
      const rushes = await ctx.db
        .query("rushes")
        .withIndex("by_talent", (q) => q.eq("talentId", c._id))
        .collect();
      for (const r of rushes) await ctx.db.delete(r._id);
      await ctx.db.delete(c._id);
      deleted++;
    }
    return { deleted };
  },
});


// ─── Outillage : pose des refSlug depuis le CLI (npx convex run --prod) ──────

/**
 * Pose la ref du chemin court snytch.co sur une créatrice, DEPUIS LE CLI.
 *
 * `updateCreator` est une adminMutation (session requise) — inatteignable
 * depuis `npx convex run`. Cette mutation interne sert l'amorçage : les
 * refSlug n'existaient sur aucune fiche après le déploiement de #72, et sans
 * elles la section « Ce que ça a rapporté » affiche « pas de ref configurée »
 * partout.
 *
 * Résolution par (slug de projet, nom de créatrice) : les deux choses lisibles
 * dans un appel CLI. Nom plié (casse/accents/espaces). REFUSE d'écraser une
 * ref DIFFÉRENTE déjà posée sans `force` : une ref est une clé d'attribution —
 * la changer par mégarde rattacherait l'historique à la mauvaise personne.
 * Idempotent si la ref est identique.
 */
export const setCreatorRefSlugBySlug = internalMutation({
  args: {
    projectSlug: v.string(),
    creatorName: v.string(),
    refSlug: v.union(v.string(), v.null()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { projectSlug, creatorName, refSlug, force }) => {
    const project = (await ctx.db.query("projects").collect()).find(
      (p) => p.slug === projectSlug,
    );
    if (!project) throw new ConvexError(`Projet « ${projectSlug} » introuvable.`);
    const fold = (t: string) =>
      t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const matches = creators.filter((c) => fold(c.name) === fold(creatorName));
    if (matches.length !== 1) {
      throw new ConvexError(
        `${matches.length} créatrice(s) « ${creatorName} » sur ${projectSlug} — il en faut exactement une.`,
      );
    }
    const c = matches[0];
    const next = refSlug === null ? undefined : (normalizeRef(refSlug) ?? undefined);
    if (
      c.refSlug !== undefined &&
      next !== undefined &&
      c.refSlug !== next &&
      force !== true
    ) {
      throw new ConvexError(
        `${c.name} porte déjà la ref « ${c.refSlug} » — passer force:true pour la remplacer par « ${next} ».`,
      );
    }
    await ctx.db.patch(c._id, { refSlug: next });
    return {
      creatorId: c._id,
      name: c.name,
      before: c.refSlug ?? null,
      after: next ?? null,
    };
  },
});
