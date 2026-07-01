import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  authedAction,
  creatorMutation,
  creatorQuery,
  requireCreator,
} from "./functions";
import { internal } from "./_generated/api";
import { getProjectBySlug, SNYTCH_SLUG } from "./projects";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  googleDriveConfig,
  createDriveFolder,
  creatorFolderName,
  initResumableUpload,
} from "./googleDriveApi";

/**
 * Dépôt de fichiers Snytch (Google Drive, service account) — orchestration.
 *
 * SNYTCH UNIQUEMENT. Chaque créateur a un sous-dossier Drive (creators.
 * driveFolderId) dans le dossier racine du fondateur ; il y dépose vidéos +
 * photos par UPLOAD DIRECT navigateur → Drive (le gros fichier ne transite
 * JAMAIS par Convex). Cette table `snytchDriveFiles` ne stocke que des
 * métadonnées (liste « ce que tu as déposé »). Aucune vue admin in-app : le
 * fondateur accède aux fichiers via son Google Drive.
 *
 * FLUX (mêmes idiomes que convex/cloudflareStream.ts) :
 *   - Création dossier : à l'invitation (creators.inviteCreator) + rattachement
 *     (addCreatorToProject) → scheduler.runAfter(0, ensureCreatorFolder). Le
 *     backfill (backfillSnytchDriveFolders) couvre les créateurs pré-feature.
 *     getUploadSession se répare aussi tout seul si le dossier manque.
 *   - Upload : le client demande getUploadSession (URL de session resumable
 *     Drive), PUT le binaire directement sur Google, puis confirmUpload
 *     (métadonnées). listMyDriveFiles rend la liste (scopée créateur).
 *
 * GATE : sans env Drive (googleDriveConfig() === null), les actions log + no-op
 *   proprement (le build ne casse jamais, la CI test tourne). La clé service
 *   account n'est JAMAIS exposée ni loggée.
 *
 * SÉCURITÉ : un créateur ne demande une session / ne liste QUE pour SON dossier
 *   (requireCreator → ctx.creatorId). Le backfill est interne (convex run).
 *
 * ⚠️ TS7022 — ensureCreatorFolder / getUploadSession / backfillSnytchDriveFolders
 *   appellent ctx.runQuery/runMutation/runAction(internal.*) : type de retour
 *   ANNOTÉ pour casser l'inférence cyclique. NE PAS retirer les annotations.
 */

/** Backfill : taille de lot, plafond anti-boucle, concurrence (Drive = réseau). */
const BACKFILL_BATCH = 25;
const BACKFILL_MAX = 2000;
const BACKFILL_CONCURRENCY = 3;

/** Message d'erreur lisible (jamais la clé). */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Nettoie un nom de fichier pour Drive. `file.name` (navigateur) est déjà un nom
 * de BASE (sans chemin) → on borne juste la longueur et on réduit les espaces ;
 * Drive tolère le reste. Vide → « fichier ».
 */
function sanitizeFileName(name: string): string {
  const base = name.replace(/\s+/g, " ").trim().slice(0, 200);
  return base.length > 0 ? base : "fichier";
}

// ─── Lecture/écriture internes (runtime query/mutation) ──────────────────────

interface CreatorFolderInfo {
  name: string;
  slug: string | null;
  driveFolderId: string | null;
}

/** Nom + slug projet + dossier courant d'un créateur (pour ensureCreatorFolder). */
export const getCreatorFolderInfo = internalQuery({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, { creatorId }): Promise<CreatorFolderInfo | null> => {
    const creator = await ctx.db.get(creatorId);
    if (!creator) return null;
    const project = await ctx.db.get(creator.projectId);
    return {
      name: creator.name,
      slug: project?.slug ?? null,
      driveFolderId: creator.driveFolderId ?? null,
    };
  },
});

/**
 * Pose driveFolderId sur le créateur. GUARD idempotent : ne patche QUE si le
 * champ est encore vide → deux créations concurrentes ne s'écrasent pas (la
 * perdante laisse un dossier orphelin toléré). Renvoie true si patché.
 */
export const setDriveFolderId = internalMutation({
  args: { creatorId: v.id("creators"), folderId: v.string() },
  handler: async (ctx, { creatorId, folderId }): Promise<boolean> => {
    const creator = await ctx.db.get(creatorId);
    if (!creator || creator.driveFolderId) return false;
    await ctx.db.patch(creatorId, { driveFolderId: folderId });
    return true;
  },
});

/** creatorId + nom + slug + dossier du créateur AUTHENTIFIÉ (scoping strict). */
export const resolveMyFolder = internalQuery({
  args: { userId: v.id("users"), projectId: v.id("projects") },
  handler: async (
    ctx,
    { userId, projectId },
  ): Promise<{
    creatorId: Id<"creators">;
    name: string;
    slug: string | null;
    driveFolderId: string | null;
  }> => {
    // Rejette si l'appelant n'est pas un créateur de CE projet.
    const creatorId = await requireCreator(ctx, userId, projectId);
    const creator = await ctx.db.get(creatorId);
    const project = await ctx.db.get(projectId);
    return {
      creatorId,
      name: creator?.name ?? "Créateur",
      slug: project?.slug ?? null,
      driveFolderId: creator?.driveFolderId ?? null,
    };
  },
});

/** Créateurs Snytch sans dossier Drive (candidats backfill). */
export const listSnytchCreatorsNeedingFolder = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }): Promise<Id<"creators">[]> => {
    const project = await getProjectBySlug(ctx, SNYTCH_SLUG);
    if (!project) return [];
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect();
    const out: Id<"creators">[] = [];
    for (const c of creators) {
      if (!c.driveFolderId) {
        out.push(c._id);
        if (out.length >= limit) break;
      }
    }
    return out;
  },
});

// ─── Création de dossier (action — fetch Drive) ──────────────────────────────

interface EnsureFolderResult {
  ok: boolean;
  reason?: "not-found" | "not-snytch" | "disabled" | "create-failed";
  folderId?: string;
}

/**
 * Crée (si besoin) le dossier Drive d'UN créateur Snytch. Idempotent (dossier
 * déjà posé → no-op), Snytch-gaté (RepackIt & co ignorés), dégradation propre
 * (env absent → log + no-op). Planifié à la création du créateur + réutilisé par
 * le backfill et le self-heal de getUploadSession.
 */
export const ensureCreatorFolder = internalAction({
  args: { creatorId: v.id("creators") },
  handler: async (ctx, { creatorId }): Promise<EnsureFolderResult> => {
    const info = await ctx.runQuery(internal.snytchDrive.getCreatorFolderInfo, {
      creatorId,
    });
    if (!info) return { ok: false, reason: "not-found" };
    // SNYTCH ONLY — jamais de dossier pour les autres projets (RepackIt Creator).
    if (info.slug !== SNYTCH_SLUG) return { ok: false, reason: "not-snytch" };
    // Idempotent — déjà un dossier.
    if (info.driveFolderId) return { ok: true, folderId: info.driveFolderId };

    const config = googleDriveConfig();
    if (!config) {
      console.info(
        "[snytch-drive] env absent (GOOGLE_SERVICE_ACCOUNT_JSON / " +
          "SNYTCH_DRIVE_ROOT_FOLDER_ID) — création de dossier ignorée. " +
          "Posez : npx convex env set GOOGLE_SERVICE_ACCOUNT_JSON <json> ; " +
          "npx convex env set SNYTCH_DRIVE_ROOT_FOLDER_ID <id>.",
      );
      return { ok: false, reason: "disabled" };
    }

    let folderId: string;
    try {
      folderId = await createDriveFolder(
        config,
        creatorFolderName(info.name, creatorId),
      );
    } catch (e) {
      console.error(
        `[snytch-drive] création dossier échouée pour ${creatorId}: ${errMsg(e)}`,
      );
      return { ok: false, reason: "create-failed" };
    }

    const didSet = await ctx.runMutation(internal.snytchDrive.setDriveFolderId, {
      creatorId,
      folderId,
    });
    if (!didSet) {
      // Un autre appel a posé le dossier entre-temps → celui-ci est orphelin
      // (dossier Drive vide, toléré : le fondateur peut le supprimer). On garde
      // le dossier RÉELLEMENT enregistré sur la fiche (relecture).
      console.info(
        `[snytch-drive] dossier déjà posé pour ${creatorId} — ${folderId} orphelin toléré.`,
      );
      const fresh = await ctx.runQuery(
        internal.snytchDrive.getCreatorFolderInfo,
        { creatorId },
      );
      return { ok: true, folderId: fresh?.driveFolderId ?? folderId };
    }
    return { ok: true, folderId };
  },
});

// ─── Upload : session resumable (action) + confirmation (mutation) ───────────

type UploadSessionResult =
  | { ok: true; uploadUrl: string }
  | { ok: false; reason: "disabled" | "not-snytch" };

/**
 * Renvoie une URL de session d'upload RESUMABLE pour le dossier du créateur
 * courant. Le client PUT ensuite le fichier DIRECTEMENT sur cette URL (Google) —
 * le gros fichier ne passe pas par Convex. Self-heal : crée le dossier s'il
 * manque encore. `disabled` = env Drive absent (rien à faire côté client) ;
 * `not-snytch` = projet non concerné (défense en profondeur).
 */
export const getUploadSession = authedAction({
  args: {
    projectId: v.id("projects"),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (
    ctx,
    { projectId, fileName, mimeType, sizeBytes },
  ): Promise<UploadSessionResult> => {
    const me = await ctx.runQuery(internal.snytchDrive.resolveMyFolder, {
      userId: ctx.userId,
      projectId,
    });
    if (me.slug !== SNYTCH_SLUG) return { ok: false, reason: "not-snytch" };

    let folderId = me.driveFolderId;
    if (!folderId) {
      const ensured = await ctx.runAction(
        internal.snytchDrive.ensureCreatorFolder,
        { creatorId: me.creatorId },
      );
      folderId = ensured.folderId ?? null;
    }
    if (!folderId) return { ok: false, reason: "disabled" };

    const config = googleDriveConfig();
    if (!config) return { ok: false, reason: "disabled" };

    try {
      const uploadUrl = await initResumableUpload(
        config,
        folderId,
        sanitizeFileName(fileName),
        mimeType,
        sizeBytes,
      );
      // Diagnostic : confirme que l'ÉTAPE 1 (init resumable côté serveur) réussit.
      // L'upload du binaire est ensuite relayé par /api/snytch-drive/upload
      // (même origine → pas de CORS). On ne logge JAMAIS l'uploadUrl (capacité).
      console.info(
        "[snytch-drive] session resumable initiée (étape 1 OK) — upload relayé same-origin.",
      );
      return { ok: true, uploadUrl };
    } catch (e) {
      console.error(`[snytch-drive] init upload échoué: ${errMsg(e)}`);
      throw new ConvexError(
        "Impossible de démarrer l'upload vers Drive. Réessaie.",
      );
    }
  },
});

/**
 * Enregistre les métadonnées d'un fichier déposé (après upload direct → Drive
 * réussi). Scopé au créateur courant (ctx.creatorId). Idempotent par driveFileId
 * (un ré-appel du client ne duplique pas). Snytch only (défense en profondeur).
 */
export const confirmUpload = creatorMutation({
  args: {
    driveFileId: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    webViewLink: v.optional(v.string()),
    thumbnailLink: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const project = await ctx.db.get(ctx.projectId);
    if (project?.slug !== SNYTCH_SLUG) {
      throw new ConvexError("Dépôt de fichiers réservé à Snytch.");
    }
    const existing = await ctx.db
      .query("snytchDriveFiles")
      .withIndex("by_creator", (q) => q.eq("creatorId", ctx.creatorId))
      .collect();
    if (existing.some((f) => f.driveFileId === args.driveFileId)) {
      return { ok: true };
    }
    await ctx.db.insert("snytchDriveFiles", {
      creatorId: ctx.creatorId,
      projectId: ctx.projectId,
      driveFileId: args.driveFileId,
      fileName: args.fileName.slice(0, 300),
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      uploadedAt: Date.now(),
      webViewLink: args.webViewLink,
      thumbnailLink: args.thumbnailLink,
    });
    return { ok: true };
  },
});

interface DriveFileRow {
  id: Id<"snytchDriveFiles">;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: number;
  webViewLink: string | null;
  thumbnailLink: string | null;
}

/** Liste « ce que tu as déposé » (fichiers du créateur courant, récent → ancien). */
export const listMyDriveFiles = creatorQuery({
  args: {},
  handler: async (ctx): Promise<DriveFileRow[]> => {
    const files = await ctx.db
      .query("snytchDriveFiles")
      .withIndex("by_creator", (q) => q.eq("creatorId", ctx.creatorId))
      .collect();
    return files
      .sort((a, b) => b.uploadedAt - a.uploadedAt)
      .map((f) => ({
        id: f._id,
        fileName: f.fileName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        uploadedAt: f.uploadedAt,
        webViewLink: f.webViewLink ?? null,
        thumbnailLink: f.thumbnailLink ?? null,
      }));
  },
});

// ─── Backfill (admin one-shot, runnable via convex run) ──────────────────────

/**
 * BACKFILL idempotent — crée le dossier Drive des créateurs Snytch qui n'en ont
 * pas encore (feature déployée après leur création). Réutilise ensureCreatorFolder
 * (même chemin que la création). Concurrence bornée. S'arrête dès qu'un tour ne
 * crée plus rien (anti-boucle sur des échecs). Sans env Drive → annulé proprement.
 *
 * Lancement prod :
 *   npx convex run snytchDrive:backfillSnytchDriveFolders --prod
 */
export const backfillSnytchDriveFolders = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ ok: boolean; reason?: string; created: number; skipped: number }> => {
    if (!googleDriveConfig()) {
      console.error(
        "[snytch-drive] backfill annulé — env Drive absent. " +
          "Posez GOOGLE_SERVICE_ACCOUNT_JSON + SNYTCH_DRIVE_ROOT_FOLDER_ID.",
      );
      return { ok: false, reason: "disabled", created: 0, skipped: 0 };
    }

    let created = 0;
    let skipped = 0;
    while (created + skipped < BACKFILL_MAX) {
      const batch = await ctx.runQuery(
        internal.snytchDrive.listSnytchCreatorsNeedingFolder,
        { limit: BACKFILL_BATCH },
      );
      if (batch.length === 0) break;

      let roundCreated = 0;
      for (let i = 0; i < batch.length; i += BACKFILL_CONCURRENCY) {
        const slice = batch.slice(i, i + BACKFILL_CONCURRENCY);
        const results = await Promise.all(
          slice.map((creatorId) =>
            ctx.runAction(internal.snytchDrive.ensureCreatorFolder, {
              creatorId,
            }),
          ),
        );
        for (const r of results) {
          if (r.ok && r.folderId) {
            created += 1;
            roundCreated += 1;
          } else {
            skipped += 1;
          }
        }
      }
      // Aucun dossier posé ce tour (échecs) → les rows reviendraient : on stoppe.
      if (roundCreated === 0) break;
    }

    console.info(
      `[snytch-drive] backfill terminé — ${created} dossier(s) créé(s), ${skipped} ignoré(s).`,
    );
    return { ok: true, created, skipped };
  },
});
