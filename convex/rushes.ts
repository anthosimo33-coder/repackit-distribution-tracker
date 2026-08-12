import { authedAction, talentMutation, talentQuery } from "./functions";
import { openUploadSession, type UploadSessionResult } from "./snytchDrive";
import { isFileDropEnabled } from "./fileDrop";
import { pickTalentRush, TALENT_RUSH_FIELDS } from "./talentRushFields";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

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
