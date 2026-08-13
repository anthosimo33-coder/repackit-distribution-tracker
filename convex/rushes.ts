import {
  adminMutation,
  adminQuery,
  authedAction,
  e2eMutation,
  talentMutation,
  talentQuery,
} from "./functions";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { openUploadSession, type UploadSessionResult } from "./snytchDrive";
import { googleDriveConfig, deleteDriveFile } from "./googleDriveApi";
import { isFileDropEnabled } from "./fileDrop";
import { pickTalentRush, TALENT_RUSH_FIELDS } from "./talentRushFields";
import { canTransition, isRushExpired, RUSH_STATUSES } from "./rushStatus";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/**
 * RUSHES — le dépôt du TALENT.
 *
 * Un rush est une prise BRUTE : le hook seul, 5 à 10 secondes. Le talent filme et
 * dépose, rien d'autre — il ne monte pas, ne publie pas, ne voit ni script, ni
 * compte, ni statistique, ni le dépôt d'un autre talent.
 *
 * TRANSPORT — identique au dépôt partenaire, et c'est délibéré : session
 * resumable Drive obtenue serveur, puis chunks relayés par
 * /api/snytch-drive/upload (même origine → pas de CORS). Le binaire ne transite
 * jamais par Convex. Le cœur d'octroi de session est PARTAGÉ
 * (snytchDrive.openUploadSession) : deux copies qui divergeraient feraient
 * atterrir le dépôt d'un talent dans le dossier de quelqu'un d'autre.
 *
 * STOCKAGE — ce qui distingue `rushes` de `snytchDriveFiles`, ce n'est pas le
 * transport mais le CYCLE DE VIE (cf convex/rushStatus.ts). Un dépôt de talent
 * n'écrit QUE dans `rushes` ; les deux tables ne se mélangent jamais.
 *
 * SÉCURITÉ — tout passe par talentQuery/talentMutation, donc filtré serveur par
 * `ctx.creatorId` (la fiche du talent authentifié), et projeté par l'allowlist
 * `convex/talentRushFields.ts`.
 */

/** Nom de fichier borné (Drive tolère le reste, cf snytchDrive.sanitizeFileName). */
const MAX_FILE_NAME = 300;

/**
 * Motif de refus : borné SERVEUR, pas seulement dans le formulaire. Ce texte est
 * écrit par un admin et LU PAR LE TALENT — il franchit une frontière de rôle, et
 * ce sont exactement les endroits qui se retournent plus tard. 500 caractères
 * couvrent largement un motif utile ; au-delà on REFUSE plutôt que de tronquer
 * (tronquer changerait silencieusement ce que l'admin a écrit et ce que le talent
 * lit). Rendu en TEXTE BRUT côté écran, jamais en markdown.
 */
const MAX_REJECTION_REASON = 500;

/** Plafond d'expirations par exécution du cron (transaction bornée). */
const EXPIRE_MAX_PER_RUN = 200;

/**
 * Ligne servie au talent. Le type DÉRIVE de l'allowlist : ajouter un champ à
 * `TALENT_RUSH_FIELDS` l'ouvre ici, et rien d'autre ne peut sortir sans y passer.
 */
export type TalentRushRow = Pick<
  Doc<"rushes">,
  (typeof TALENT_RUSH_FIELDS)[number]
>;

/**
 * Session d'upload d'un TALENT. Le rôle est fixé PAR CETTE FONCTION (jamais
 * transmis par le client) : c'est ce qui garantit que le fichier atterrit dans le
 * dossier Drive de la personne authentifiée, et qu'un partenaire ou un clippeur
 * n'obtient rien ici (requireTalent rejette).
 */
export const getDepositSession = authedAction({
  args: {
    projectId: v.id("projects"),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (
    ctx,
    { projectId, fileName, mimeType, sizeBytes },
  ): Promise<UploadSessionResult> =>
    openUploadSession(ctx, {
      userId: ctx.userId,
      projectId,
      role: "talent",
      fileName,
      mimeType,
      sizeBytes,
    }),
});

/**
 * Enregistre un rush après un upload Drive réussi.
 *
 * IDEMPOTENT par `driveFileId` : un ré-appel du client (retry réseau, double
 * soumission) renvoie la ligne existante au lieu d'en créer une seconde qui
 * pointerait le même binaire.
 *
 * `sizeBytes` est DÉCLARÉ par le client et n'est pas revérifié auprès de Drive :
 * c'est une donnée opérationnelle (savoir si un talent filme en 4K60 quand 1080p
 * suffirait), jamais une variable de décision — rien n'arbitre dessus, donc rien
 * ne casse si elle est approximative.
 */
export const confirmDeposit = talentMutation({
  args: {
    driveFileId: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    webViewLink: v.optional(v.string()),
    thumbnailLink: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true; rushId: Id<"rushes"> }> => {
    const project = await ctx.db.get(ctx.projectId);
    if (!isFileDropEnabled(project)) {
      throw new ConvexError("Dépôt indisponible pour ce projet.");
    }
    if (args.driveFileId.length === 0) {
      throw new ConvexError("Référence de fichier manquante.");
    }

    const mine = await ctx.db
      .query("rushes")
      .withIndex("by_talent", (q) => q.eq("talentId", ctx.creatorId))
      .collect();
    const existing = mine.find((r) => r.driveFileId === args.driveFileId);
    if (existing) return { ok: true, rushId: existing._id };

    const rushId = await ctx.db.insert("rushes", {
      projectId: ctx.projectId,
      talentId: ctx.creatorId,
      driveFileId: args.driveFileId,
      fileName: args.fileName.slice(0, MAX_FILE_NAME),
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      status: "deposited",
      depositedAt: Date.now(),
      webViewLink: args.webViewLink,
      thumbnailLink: args.thumbnailLink,
    });
    return { ok: true, rushId };
  },
});

/**
 * « Mes dépôts » — les rushes du talent authentifié, récent → ancien.
 *
 * Double filtrage assumé : l'index porte sur `talentId` (la fiche est déjà
 * résolue par `talentMutation`/`talentQuery` pour CE projet), et on re-filtre sur
 * `projectId` — une fiche est scopée projet, mais la lecture ne doit pas dépendre
 * de cette propriété pour rester correcte.
 */
export const listMyRushes = talentQuery({
  args: {},
  handler: async (ctx): Promise<TalentRushRow[]> => {
    const rushes = await ctx.db
      .query("rushes")
      .withIndex("by_talent", (q) => q.eq("talentId", ctx.creatorId))
      .collect();
    return rushes
      .filter((r) => r.projectId === ctx.projectId)
      .sort((a, b) => b.depositedAt - a.depositedAt)
      .map((r) => pickTalentRush(r) as TalentRushRow);
  },
});

// ─── Cycle de vie du binaire : rejet, expiration, purge ──────────────────────

/**
 * Refuse un rush, avec motif.
 *
 * Le motif est OBLIGATOIRE : un refus sans explication est ce qui fait qu'on
 * arrête de filmer. Il est borné SERVEUR (cf MAX_REJECTION_REASON) parce qu'il
 * franchit une frontière de rôle — écrit par un admin, lu par le talent.
 *
 * ⚠️ L'écran admin qui saisira ce champ (chantier revue des rushes) doit dire
 * « visible par le talent » : ce n'est PAS un champ de note interne.
 *
 * La purge du binaire est PLANIFIÉE, pas faite ici : une mutation ne fait pas
 * d'I/O réseau, et le refus ne doit pas échouer parce que Drive est indisponible.
 */
export const rejectRush = adminMutation({
  args: { rushId: v.id("rushes"), reason: v.string() },
  handler: async (ctx, { rushId, reason }): Promise<{ ok: true }> => {
    const rush = await ctx.db.get(rushId);
    if (!rush || rush.projectId !== ctx.projectId) {
      throw new ConvexError("Rush introuvable dans ce projet.");
    }
    if (!canTransition(rush.status, "rejected")) {
      throw new ConvexError("Ce rush n'est plus refusable (déjà traité).");
    }
    const motif = reason.trim();
    if (motif.length === 0) {
      throw new ConvexError("Un motif de refus est obligatoire.");
    }
    if (motif.length > MAX_REJECTION_REASON) {
      throw new ConvexError(
        `Motif trop long (${MAX_REJECTION_REASON} caractères maximum).`,
      );
    }
    await ctx.db.patch(rushId, {
      status: "rejected",
      rejectedAt: Date.now(),
      rejectionReason: motif,
    });
    await ctx.scheduler.runAfter(0, internal.rushes.purgeRushBinary, { rushId });
    return { ok: true };
  },
});

/**
 * CŒUR de l'expiration — partagé par le cron et sa contrepartie e2e, avec `now`
 * INJECTÉ. C'est ce qui rend la règle des 60 jours prouvable en test sans
 * attendre deux mois (même patron que apifySync.upsertApifySnapshot).
 *
 * Ne vise que les rushes ENCORE LIBRES (`deposited`) : un rush déjà retenu ne
 * périme pas, sinon la purge emporterait le binaire sous le clip en cours.
 * Idempotent — un rush déjà expiré n'est plus dans la sélection.
 *
 * Balayage par PROJET (index by_project_status) plutôt que par un index global
 * sur le statut : le scope projet reste la clé de lecture de toute table métier,
 * et le nombre de projets se compte sur une main.
 */
export async function expireDueRushes(
  ctx: MutationCtx,
  now: number,
): Promise<{ expired: number; truncated: boolean }> {
  const projects = await ctx.db.query("projects").collect();
  const due: Id<"rushes">[] = [];
  let truncated = false;

  for (const project of projects) {
    const deposited = await ctx.db
      .query("rushes")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", project._id).eq("status", "deposited"),
      )
      .collect();
    for (const rush of deposited) {
      if (!isRushExpired(rush.depositedAt, now)) continue;
      if (due.length >= EXPIRE_MAX_PER_RUN) {
        truncated = true;
        break;
      }
      due.push(rush._id);
    }
    if (truncated) break;
  }

  for (const rushId of due) {
    await ctx.db.patch(rushId, { status: "expired", expiredAt: now });
    await ctx.scheduler.runAfter(0, internal.rushes.purgeRushBinary, { rushId });
  }

  if (truncated) {
    // Jamais de troncature SILENCIEUSE : sans cette ligne, un run plafonné se
    // lirait comme « tout est traité ». Le reste part au prochain passage.
    console.warn(
      `[rushes] expiration plafonnée à ${EXPIRE_MAX_PER_RUN} par exécution — ` +
        "le reliquat sera traité au prochain passage du cron.",
    );
  }
  return { expired: due.length, truncated };
}

/** Cron quotidien — fait périmer les rushes jamais retenus au bout de 60 jours. */
export const runExpiration = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ expired: number; truncated: boolean }> =>
    expireDueRushes(ctx, Date.now()),
});

/** Même cœur, `now` injecté : prouve la règle des 60 j sans attendre (e2e). */
export const e2eRunExpiration = e2eMutation({
  args: { now: v.number() },
  handler: async (
    ctx,
    { now },
  ): Promise<{ expired: number; truncated: boolean }> =>
    expireDueRushes(ctx, now),
});

/** Référence Drive d'un rush + purge déjà faite ? (pour l'action de purge). */
export const getRushBinaryRef = internalQuery({
  args: { rushId: v.id("rushes") },
  handler: async (
    ctx,
    { rushId },
  ): Promise<{ driveFileId: string; alreadyPurged: boolean } | null> => {
    const rush = await ctx.db.get(rushId);
    if (!rush) return null;
    return {
      driveFileId: rush.driveFileId,
      alreadyPurged: rush.binaryPurgedAt !== undefined,
    };
  },
});

/** Pose `binaryPurgedAt`. Appelée UNIQUEMENT après une suppression confirmée. */
export const markBinaryPurged = internalMutation({
  args: { rushId: v.id("rushes") },
  handler: async (ctx, { rushId }): Promise<void> => {
    const rush = await ctx.db.get(rushId);
    if (!rush || rush.binaryPurgedAt !== undefined) return;
    await ctx.db.patch(rushId, { binaryPurgedAt: Date.now() });
  },
});

/**
 * Supprime le binaire Drive d'un rush écarté (refusé) ou périmé. Les métadonnées
 * restent en base : on garde l'historique de ce qui a été déposé, pas le fichier.
 *
 * `binaryPurgedAt` n'est posé QUE si la suppression a réellement eu lieu. Sans
 * env Drive (déploiement de test, dev), la purge no-ope et le trace — un faux
 * « purgé » sur un fichier encore présent serait pire que pas de champ du tout,
 * puisque plus rien ne repasserait jamais dessus.
 *
 * Idempotent : un rush déjà purgé sort tout de suite, et un 404 côté Drive vaut
 * succès (cf googleDriveApi.deleteDriveFile).
 */
export const purgeRushBinary = internalAction({
  args: { rushId: v.id("rushes") },
  handler: async (
    ctx,
    { rushId },
  ): Promise<{ ok: boolean; reason?: "not-found" | "already" | "disabled" }> => {
    const ref = await ctx.runQuery(internal.rushes.getRushBinaryRef, { rushId });
    if (!ref) return { ok: false, reason: "not-found" };
    if (ref.alreadyPurged) return { ok: true, reason: "already" };

    const config = googleDriveConfig();
    if (!config) {
      console.info(
        "[rushes] purge ignorée — env Drive absent. Le binaire reste sur Drive " +
          "et le rush n'est PAS marqué purgé (aucun faux positif).",
      );
      return { ok: false, reason: "disabled" };
    }

    const deleted = await deleteDriveFile(config, ref.driveFileId);
    if (!deleted) return { ok: false };
    await ctx.runMutation(internal.rushes.markBinaryPurged, { rushId });
    return { ok: true };
  },
});

/**
 * Le clip issu de ce rush est SORTI → le rush passe `published`.
 *
 * DERNIÈRE TRANSITION DE LA MACHINE À ÉTATS, et elle manquait : l'état existait
 * dans `convex/rushStatus.ts` et dans les libellés du talent (« Publié »), mais
 * rien ne l'écrivait — un talent dont le clip était sorti lisait « Validé » à
 * vie. C'est le genre de trou qu'aucune spec de segment ne voit, parce qu'il est
 * exactement À LA JOINTURE entre le dépôt et la publication.
 *
 * Sens de lecture INVERSE du lien (index `by_assignment`) : c'est pour lui que
 * cet index a été posé plutôt qu'un champ `rushId` sur `assignments`.
 *
 * NO-OP COMPLET pour une assignation sans rush — donc pour 100 % du flux
 * partenaire : aucune ligne ne remonte, on sort. Et no-op si la transition est
 * illégale (rush déjà refusé ou expiré entre-temps) : la machine à états tranche,
 * pas cet appelant.
 */
export async function markRushPublishedForAssignment(
  ctx: MutationCtx,
  assignmentId: Id<"assignments">,
  at: number,
): Promise<void> {
  const rush = await ctx.db
    .query("rushes")
    .withIndex("by_assignment", (q) => q.eq("assignmentId", assignmentId))
    .first();
  if (!rush) return;
  if (!canTransition(rush.status, "published")) return;
  await ctx.db.patch(rush._id, { status: "published", publishedAt: at });
}

/**
 * e2e ONLY — ANTIDATE la validation d'un compte.
 *
 * `comptes.validatedAt` est posée par le moteur à la validation (`Date.now()`) :
 * un compte tout juste validé est en phase de CHAUFFE, quota 0. Sans antidatage,
 * une spec qui traverse déclaration → validation → publication devrait attendre
 * 14 jours réels. Même rôle que le `now` injecté de l'expiration et que
 * `e2eSetPayAnchor` — le test exerce le vrai moteur de phase, il ne le simule pas.
 */
export const e2eBackdateCompteValidation = e2eMutation({
  args: { compteId: v.id("comptes"), validatedAt: v.number() },
  handler: async (ctx, { compteId, validatedAt }) => {
    await ctx.db.patch(compteId, { validatedAt });
    return { ok: true };
  },
});

// ─── Revue admin ─────────────────────────────────────────────────────────────

/** Ligne de la file de revue : le rush + de quoi décider sans rien rouvrir. */
export interface RushReviewRow {
  id: Id<"rushes">;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: Doc<"rushes">["status"];
  depositedAt: number;
  webViewLink: string | null;
  thumbnailLink: string | null;
  rejectionReason: string | null;
  talentId: Id<"creators">;
  talentName: string;
  /** Clippeur apparié au talent — `null` = appariement manquant, l'assignation
   *  est alors impossible et l'écran doit le dire AVANT d'ouvrir la modale. */
  clipperId: Id<"creators"> | null;
  clipperName: string | null;
  assignmentId: Id<"assignments"> | null;
}

/**
 * File de revue des rushes (admin). Le statut est filtrable ; par défaut on rend
 * TOUT, récent → ancien, pour que l'écran garde son historique sous la main.
 *
 * Aucune allowlist ici, à la différence de la sortie talent : un admin du projet
 * voit ses propres données (même contrat que `listComptes` ou `listCreators`).
 * L'appariement est RÉSOLU côté serveur pour que l'écran n'ait pas à recharger
 * les fiches une par une.
 */
export const listRushesForReview = adminQuery({
  args: {
    status: v.optional(
      v.union(
        v.literal("deposited"),
        v.literal("assigned"),
        v.literal("published"),
        v.literal("rejected"),
        v.literal("expired"),
      ),
    ),
  },
  handler: async (ctx, { status }): Promise<RushReviewRow[]> => {
    // Sans filtre, on balaie les 5 états PAR L'INDEX plutôt que de scanner la
    // table : `by_project_status` reste la seule porte d'entrée, et le scope
    // projet est garanti par la clé, pas par un filtre en mémoire.
    const wanted = status ? [status] : [...RUSH_STATUSES];
    const rushes = (
      await Promise.all(
        wanted.map((s) =>
          ctx.db
            .query("rushes")
            .withIndex("by_project_status", (q) =>
              q.eq("projectId", ctx.projectId).eq("status", s),
            )
            .collect(),
        ),
      )
    ).flat();

    // Fiches chargées UNE fois (un talent dépose plusieurs rushes).
    const fiches = new Map<string, Doc<"creators"> | null>();
    const fiche = async (id: Id<"creators">) => {
      const key = id as string;
      if (!fiches.has(key)) fiches.set(key, await ctx.db.get(id));
      return fiches.get(key) ?? null;
    };

    const rows: RushReviewRow[] = [];
    for (const r of rushes) {
      const talent = await fiche(r.talentId);
      const clipper = talent?.clipperId ? await fiche(talent.clipperId) : null;
      rows.push({
        id: r._id,
        fileName: r.fileName,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        status: r.status,
        depositedAt: r.depositedAt,
        webViewLink: r.webViewLink ?? null,
        thumbnailLink: r.thumbnailLink ?? null,
        rejectionReason: r.rejectionReason ?? null,
        talentId: r.talentId,
        talentName: talent?.name ?? "Talent supprimé",
        clipperId: clipper?._id ?? null,
        clipperName: clipper?.name ?? null,
        assignmentId: r.assignmentId ?? null,
      });
    }
    return rows.sort((a, b) => b.depositedAt - a.depositedAt);
  },
});

/** Badge de sidebar : nombre de rushes en attente de décision. */
export const countRushesToReview = adminQuery({
  args: {},
  handler: async (ctx): Promise<number> => {
    const waiting = await ctx.db
      .query("rushes")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", ctx.projectId).eq("status", "deposited"),
      )
      .collect();
    return waiting.length;
  },
});
