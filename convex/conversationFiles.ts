/**
 * FICHIERS d'une brique « conversation » (cf convex/scriptConversation) — dépôt
 * par l'équipe, téléchargement par la créatrice.
 *
 * Dépôt (écran de la campagne) : le navigateur lit l'export pour proposer qui
 * est « elle » et l'écart du dernier message, pousse le fichier
 * (generateUploadUrl), puis l'attache à la brique. Type et poids sont relus dans
 * la table système, jamais crus sur parole ; un refus efface le fichier.
 *
 * Téléchargement (fiche de mission) :
 *  - une IMAGE est servie telle quelle (URL signée dans la fiche) ;
 *  - un EXPORT passe par `downloadConversationExport`, qui le PERSONNALISE pour
 *    la créatrice et pour le jour du téléchargement (dates, prénom — cf
 *    convex/conversationExport). Une action : seule elle peut lire le contenu
 *    d'un fichier du storage.
 */
import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  authedAction,
  permissionMutation,
  requireCreator,
  requireCreatorObservable,
} from "./functions";
import { ERR, err, type ErrCode } from "./errorCodes";
import { deleteStorageBestEffort } from "./storageCleanup";
import {
  firstNameOf,
  inspectExport,
  personalizeExport,
  shiftDaysFor,
} from "./conversationExport";
import { parisDayKey } from "./viewsDaily";

export const MAX_CONVERSATION_FILES = 12;
export const MAX_CONVERSATION_FILE_BYTES = 20 * 1024 * 1024;
/** Écart maximal « dernier message → jour du téléchargement », en jours. */
export const MAX_GAP_DAYS = 365;
const IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];
const MAX_NAME = 200;

type ConversationFile = NonNullable<Doc<"scriptBricks">["conversationFiles"]>[number];

/** Nature d'un fichier déposé, d'après son nom et son type relu en base. null = refusé. */
export function conversationFileKind(
  name: string,
  contentType: string,
): ConversationFile["kind"] | null {
  if (/\.txt$/i.test(name) && (contentType === "" || contentType.startsWith("text/") || contentType === "application/octet-stream")) {
    return "export";
  }
  if (IMAGE_TYPES.includes(contentType)) return "image";
  return null;
}

/** Nom tel que la créatrice le recevra : sans chemin, sans retour à la ligne, borné. */
function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\r\n\t]/g, " ").trim().slice(0, MAX_NAME);
}

function cleanGapDays(n: number | undefined): number | undefined {
  if (n === undefined || !Number.isFinite(n)) return undefined;
  return Math.min(MAX_GAP_DAYS, Math.max(0, Math.round(n)));
}

function cleanSelfName(s: string | null | undefined): string | undefined {
  const t = s?.trim();
  return t ? t.slice(0, 100) : undefined;
}

/** Auteurs d'un export : dix au plus (un export à deux en a deux), sans doublon. */
function cleanParticipants(names: readonly string[] | undefined): string[] | undefined {
  if (!names) return undefined;
  const out = [...new Set(names.map((n) => cleanSelfName(n)).filter((n): n is string => !!n))];
  return out.length > 0 ? out.slice(0, 10) : undefined;
}

async function requireConversationBrick(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  brickId: Id<"scriptBricks">,
): Promise<Doc<"scriptBricks">> {
  const brick = await ctx.db.get(brickId);
  if (!brick || brick.projectId !== projectId || brick.kind !== "conversation") {
    throw err(ERR.BRICK_NOT_FOUND, "Brique introuvable.");
  }
  return brick;
}

/**
 * La conversation d'une mission, si elle est encore servable : la brique existe,
 * est une conversation du même projet, et appartient TOUJOURS à la campagne du
 * combo (une mission passée sur une autre campagne ne garde pas la conv de
 * l'ancienne). null sinon.
 */
export async function conversationBrickOf(
  ctx: QueryCtx,
  a: Doc<"assignments">,
): Promise<Doc<"scriptBricks"> | null> {
  if (!a.conversationBrickId || !a.scriptCombo) return null;
  const brick = await ctx.db.get(a.conversationBrickId);
  if (
    !brick ||
    brick.kind !== "conversation" ||
    brick.projectId !== a.projectId ||
    brick.campaignId !== a.scriptCombo.campaignId
  ) {
    return null;
  }
  return brick;
}

// ─── Dépôt (équipe) ──────────────────────────────────────────────────────────

export const generateConversationUploadUrl = permissionMutation("scripts.manage")({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

/**
 * Attache un fichier DÉJÀ dans le storage à une brique conversation. Pour un
 * export : `selfName` = le nom de « elle » dans l'export (remplacé par le prénom
 * de la créatrice), `gapDays` = l'écart voulu entre le dernier message et le
 * jour du téléchargement, `messages` = le compte lu au dépôt (affichage).
 */
export const addConversationFile = permissionMutation("scripts.manage")({
  args: {
    brickId: v.id("scriptBricks"),
    storageId: v.id("_storage"),
    name: v.string(),
    selfName: v.optional(v.string()),
    participants: v.optional(v.array(v.string())),
    gapDays: v.optional(v.number()),
    messages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const refuse = async (code: ErrCode, message: string): Promise<never> => {
      await deleteStorageBestEffort(ctx, args.storageId);
      throw err(code, message);
    };
    const brick = await ctx.db.get(args.brickId);
    if (!brick || brick.projectId !== ctx.projectId || brick.kind !== "conversation") {
      return refuse(ERR.BRICK_NOT_FOUND, "Brique introuvable.");
    }
    const files = brick.conversationFiles ?? [];
    if (files.length >= MAX_CONVERSATION_FILES) {
      return refuse(ERR.CONVERSATION_FILES_TOO_MANY, `Trop de fichiers sur cette conversation (${MAX_CONVERSATION_FILES} au plus).`);
    }
    const meta = await ctx.db.system.get(args.storageId);
    const name = cleanFileName(args.name);
    const kind = meta && name ? conversationFileKind(name, meta.contentType ?? "") : null;
    if (!meta || !kind) {
      return refuse(ERR.CONVERSATION_FILE_INVALID, "Fichier refusé : un export WhatsApp (.txt) ou une image (PNG, JPEG, WebP).");
    }
    if (meta.size > MAX_CONVERSATION_FILE_BYTES) {
      return refuse(ERR.CONVERSATION_FILE_TOO_LARGE, "Fichier trop lourd (20 Mo au plus).");
    }
    const file: ConversationFile = {
      storageId: args.storageId,
      name,
      contentType: meta.contentType ?? "",
      size: meta.size,
      kind,
      ...(kind === "export"
        ? {
            selfName: cleanSelfName(args.selfName),
            participants: cleanParticipants(args.participants),
            gapDays: cleanGapDays(args.gapDays) ?? 0,
            messages:
              args.messages !== undefined && Number.isFinite(args.messages)
                ? Math.max(0, Math.round(args.messages))
                : undefined,
          }
        : {}),
      uploadedAt: Date.now(),
    };
    await ctx.db.patch(brick._id, { conversationFiles: [...files, file] });
    return { ok: true };
  },
});

/** Réglages d'un export déjà déposé : qui est « elle », écart du dernier message. */
export const updateConversationFile = permissionMutation("scripts.manage")({
  args: {
    brickId: v.id("scriptBricks"),
    storageId: v.id("_storage"),
    // null = ne plus remplacer le prénom.
    selfName: v.optional(v.union(v.string(), v.null())),
    gapDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const brick = await requireConversationBrick(ctx, ctx.projectId, args.brickId);
    const files = brick.conversationFiles ?? [];
    const i = files.findIndex((f) => f.storageId === args.storageId);
    if (i < 0) throw err(ERR.CONVERSATION_FILE_NOT_FOUND, "Fichier introuvable : il a peut-être été retiré de la conversation.");
    const f = files[i]!;
    if (f.kind !== "export") return { ok: true };
    const next: ConversationFile = { ...f };
    if (args.selfName !== undefined) next.selfName = cleanSelfName(args.selfName);
    if (args.gapDays !== undefined) next.gapDays = cleanGapDays(args.gapDays) ?? f.gapDays;
    await ctx.db.patch(brick._id, {
      conversationFiles: files.map((x, j) => (j === i ? next : x)),
    });
    return { ok: true };
  },
});

/** Retire un fichier de la conversation, et l'efface du storage. */
export const removeConversationFile = permissionMutation("scripts.manage")({
  args: { brickId: v.id("scriptBricks"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const brick = await requireConversationBrick(ctx, ctx.projectId, args.brickId);
    const files = brick.conversationFiles ?? [];
    if (!files.some((f) => f.storageId === args.storageId)) return { ok: true };
    await ctx.db.patch(brick._id, {
      conversationFiles: files.filter((f) => f.storageId !== args.storageId),
    });
    await deleteStorageBestEffort(ctx, args.storageId);
    return { ok: true };
  },
});

// ─── Téléchargement (créatrice) ──────────────────────────────────────────────

/**
 * Ce qu'il faut pour personnaliser UN export d'UNE mission : la garde d'accès
 * (la créatrice de la mission, ou une personne de l'équipe qui observe son
 * espace) et les réglages du fichier. Interne : appelée par l'action seule.
 */
export const exportDownloadPlan = internalQuery({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    assignmentId: v.id("assignments"),
    storageId: v.id("_storage"),
    viewAsCreatorId: v.optional(v.id("creators")),
  },
  handler: async (ctx, args) => {
    const creatorId = args.viewAsCreatorId
      ? (await requireCreatorObservable(ctx, args.userId, args.projectId, args.viewAsCreatorId))._id
      : await requireCreator(ctx, args.userId, args.projectId);
    const a = await ctx.db.get(args.assignmentId);
    // Isolation : la mission d'une autre créatrice est INTROUVABLE, pas refusée.
    const brick = a && a.creatorId === creatorId && a.projectId === args.projectId
      ? await conversationBrickOf(ctx, a)
      : null;
    const file = brick?.conversationFiles?.find(
      (f) => f.storageId === args.storageId && f.kind === "export",
    );
    if (!file) {
      throw err(ERR.CONVERSATION_FILE_NOT_FOUND, "Fichier introuvable : il a peut-être été retiré de la conversation.");
    }
    const creator = await ctx.db.get(creatorId);
    return {
      storageId: file.storageId,
      name: file.name,
      selfName: file.selfName ?? null,
      gapDays: file.gapDays ?? null,
      creatorFirstName: firstNameOf(creator?.name ?? ""),
    };
  },
});

/**
 * L'export tel que la créatrice l'importe, AUJOURD'HUI : dernier message posé
 * `gapDays` jours avant le jour de Paris du téléchargement, nom de « elle »
 * remplacé par son prénom. Le client en fait un fichier à enregistrer.
 */
export const downloadConversationExport = authedAction({
  args: {
    projectId: v.id("projects"),
    assignmentId: v.id("assignments"),
    storageId: v.id("_storage"),
    viewAsCreatorId: v.optional(v.id("creators")),
  },
  handler: async (ctx, args): Promise<{ name: string; text: string }> => {
    const plan = await ctx.runQuery(internal.conversationFiles.exportDownloadPlan, {
      userId: ctx.userId,
      projectId: args.projectId,
      assignmentId: args.assignmentId,
      storageId: args.storageId,
      ...(args.viewAsCreatorId ? { viewAsCreatorId: args.viewAsCreatorId } : {}),
    });
    const blob = await ctx.storage.get(plan.storageId);
    if (!blob) {
      throw err(ERR.CONVERSATION_FILE_NOT_FOUND, "Fichier introuvable : il a peut-être été retiré de la conversation.");
    }
    const text = await blob.text();
    const lastDay = inspectExport(text).lastDay;
    if (!lastDay) {
      throw err(ERR.CONVERSATION_EXPORT_UNREADABLE, "Aucun message lisible dans ce fichier : ce n'est pas un export WhatsApp.");
    }
    const shiftDays =
      plan.gapDays === null
        ? 0
        : shiftDaysFor({ lastDay, gapDays: plan.gapDays, today: parisDayKey(Date.now()) });
    const rename =
      plan.selfName && plan.creatorFirstName
        ? { fromName: plan.selfName, toName: plan.creatorFirstName }
        : undefined;
    return {
      name: plan.name,
      text: personalizeExport(text, { shiftDays, ...(rename ? { rename } : {}) }),
    };
  },
});
