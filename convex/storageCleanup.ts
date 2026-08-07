import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * TD-011 — purge des blobs File Storage quand la row qui les porte disparaît.
 *
 * Une row supprimée sans son blob laisse un ORPHELIN : plus aucun document ne
 * le référence, il n'apparaît dans aucune vue, et il continue d'occuper le
 * quota (constaté sur giddy-bass-969 : 6 .mov de 80 à 138 Mo, 471 Mo sur 789).
 *
 * Deux règles portées par ce module :
 *  - BEST-EFFORT : un blob déjà absent (champ optional vide, cleanup e2e
 *    rejoué, purge manuelle depuis le dashboard) ne doit JAMAIS faire échouer
 *    la mutation qui supprime la row — sinon on troque une fuite de storage
 *    contre une suppression impossible. Même pattern que cleanupTestFormats.
 *  - PARTAGE : certains blobs sont référencés par PLUSIEURS rows
 *    (duplicateCarousel partage délibérément `image` entre la source et son
 *    duplicat) → on ne purge qu'après avoir vérifié qu'aucune autre row ne le
 *    référence encore.
 */
export async function deleteStorageBestEffort(
  ctx: MutationCtx,
  storageId: Id<"_storage"> | null | undefined,
): Promise<void> {
  if (!storageId) return;
  try {
    await ctx.storage.delete(storageId);
  } catch {
    /* blob déjà supprimé / introuvable — rien à purger */
  }
}

/**
 * Purge une image de publication SEULEMENT si plus aucune publication du projet
 * ne la référence. `excludePublicationId` sert quand la row porteuse est encore
 * en base (appel AVANT le ctx.db.delete) : dans une boucle de suppression, les
 * premiers passages voient encore leurs jumeaux et s'abstiennent, le dernier
 * survivant du partage emporte le blob.
 *
 * Pas d'index sur `image` → scan par projet. Acceptable : ces chemins sont des
 * suppressions unitaires ou des cleanups, jamais du hot path (même compromis
 * que deleteOrphanBlobs dans formats.ts).
 */
export async function purgeUnreferencedImage(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  image: Id<"_storage"> | null | undefined,
  excludePublicationId?: Id<"publications">,
): Promise<void> {
  if (!image) return;
  const siblings = await ctx.db
    .query("publications")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const stillReferenced = siblings.some(
    (p) => p._id !== excludePublicationId && p.image === image,
  );
  if (stillReferenced) return;
  await deleteStorageBestEffort(ctx, image);
}

/** Purge l'image d'une publication qu'on s'apprête à supprimer. */
export async function purgePublicationImage(
  ctx: MutationCtx,
  pub: Doc<"publications">,
): Promise<void> {
  await purgeUnreferencedImage(ctx, pub.projectId, pub.image, pub._id);
}

/**
 * Purge les DEUX blobs que peut porter une row assets : le fichier courant et
 * la sauvegarde de l'original (postprocessBackup, posée par le rattrapage du
 * stock). La sauvegarde est invisible de l'UI et pèse autant que l'original —
 * oubliée ici, elle survit à la suppression de l'asset.
 */
export async function purgeAssetBlobs(
  ctx: MutationCtx,
  asset: Doc<"assets">,
): Promise<void> {
  await deleteStorageBestEffort(ctx, asset.storageId);
  await deleteStorageBestEffort(ctx, asset.postprocessBackup?.storageId);
}

// ─── Balayage des blobs orphelins ────────────────────────────────────────────

/**
 * Nombre de champs `v.id("_storage")` du schéma que le balayage sait lire (cf.
 * collecterStorageIdsReferences juste en dessous). Le balayage traite comme
 * ORPHELIN tout blob que cette fonction ne produit pas.
 *
 * ⚠️ DANGER — ajouter un champ `v.id("_storage")` au schéma SANS le câbler
 * ci-dessous fait supprimer ses blobs par le cron au bout de 24 h, en silence.
 * Garde-fou : lib/storage-fields.test.ts compte les `v.id("_storage")` de
 * schema.ts et échoue dès que le compte diverge de cette constante.
 */
export const STORAGE_FIELD_COUNT = 6;

async function collecterStorageIdsReferences(
  ctx: MutationCtx,
): Promise<Set<string>> {
  const refs = new Set<string>();
  const ajouter = (id: Id<"_storage"> | null | undefined) => {
    if (id) refs.add(id);
  };

  // 1 seul passage par table, pour TOUT le lot (jamais une requête par blob).
  for (const p of await ctx.db.query("publications").collect()) {
    ajouter(p.image);
  }
  for (const i of await ctx.db.query("inspirations").collect()) {
    ajouter(i.thumbnail);
  }
  for (const f of await ctx.db.query("formats").collect()) {
    for (const e of f.exampleVideos) {
      if (e.kind === "file") ajouter(e.storageId);
    }
  }
  for (const a of await ctx.db.query("assignments").collect()) {
    ajouter(a.submittedVideoStorageId);
  }
  for (const a of await ctx.db.query("assets").collect()) {
    ajouter(a.storageId);
    ajouter(a.postprocessBackup?.storageId);
  }
  return refs;
}

/**
 * FENÊTRE DE GRÂCE — un blob de moins de 24 h peut être un upload EN COURS : le
 * POST navigateur crée le blob AVANT que la mutation d'attache ne l'écrive en
 * base (generateUploadUrl → POST → submitVideo/createAsset/…). Entre les deux,
 * il est indistinguable d'un orphelin. 24 h couvre très largement le pire cas.
 */
const FENETRE_DE_GRACE_MS = 24 * 60 * 60 * 1000;

/** Blobs examinés par transaction. Le coût fixe d'un lot = 1 scan des 5 tables. */
const TAILLE_LOT = 200;

type CandidatOrphelin = {
  storageId: Id<"_storage">;
  size: number;
  contentType: string | null;
  creationTime: number;
};

const cumulValidator = v.object({
  lots: v.number(),
  examines: v.number(),
  orphelins: v.number(),
  octets: v.number(),
  tropRecents: v.number(),
});

type Cumul = {
  lots: number;
  examines: number;
  orphelins: number;
  octets: number;
  tropRecents: number;
};

type ResultatPurge = {
  simule: boolean;
  termine: boolean;
  /** Candidats de CE lot uniquement (les suivants sont dans les logs). */
  candidats: CandidatOrphelin[];
  cumul: Cumul;
};

function mo(octets: number): string {
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * BALAYAGE des blobs orphelins — filet de sécurité pour les uploads ABANDONNÉS,
 * que les purges à la suppression (TD-011, ci-dessus) ne peuvent pas rattraper :
 * un blob POSTé puis jamais attaché (onglet fermé, réseau coupé, session
 * expirée, mutation refusée) n'est référencé par AUCUNE row, donc aucune
 * suppression de row ne le fera disparaître. Origine des 6 .mov orphelins
 * (471 Mo) trouvés sur giddy-bass-969.
 *
 * Parcourt `_storage` par lots de 200, CHAÎNÉS via scheduler.runAfter (une
 * transaction par lot — jamais un balayage complet dans une seule mutation).
 * Chaque lot construit UNE FOIS l'ensemble des storageIds référencés (5 scans de
 * table, pas un par blob) puis le teste contre les 200 blobs du lot.
 *
 * Un blob n'est supprimé que si les DEUX conditions tiennent :
 *   - référencé par aucun des 6 champs du schéma ;
 *   - créé il y a plus de 24 h (cf FENETRE_DE_GRACE_MS).
 *
 * `simuler: true` → liste les candidats (taille + contentType) sans rien
 * supprimer. Le lot 1 revient dans la valeur de retour ; les suivants ne sont
 * visibles qu'en logs (une mutation planifiée n'a pas d'appelant) :
 *   ./node_modules/.bin/convex run storageCleanup:purgerBlobsOrphelins '{"simuler":true}'
 */
export const purgerBlobsOrphelins = internalMutation({
  args: {
    curseur: v.optional(v.union(v.string(), v.null())),
    simuler: v.optional(v.boolean()),
    cumul: v.optional(cumulValidator),
  },
  // Annotation explicite : le handler se référence lui-même via le scheduler
  // (TS7022 sinon), comme requestApifySync.
  handler: async (ctx, args): Promise<ResultatPurge> => {
    const simule = args.simuler === true;
    const page = await ctx.db.system
      .query("_storage")
      .paginate({ cursor: args.curseur ?? null, numItems: TAILLE_LOT });

    const candidats: CandidatOrphelin[] = [];
    let tropRecents = 0;

    if (page.page.length > 0) {
      const references = await collecterStorageIdsReferences(ctx);
      const limite = Date.now() - FENETRE_DE_GRACE_MS;
      for (const blob of page.page) {
        if (references.has(blob._id)) continue;
        if (blob._creationTime > limite) {
          tropRecents += 1;
          continue;
        }
        candidats.push({
          storageId: blob._id,
          size: blob.size,
          contentType: blob.contentType ?? null,
          creationTime: blob._creationTime,
        });
      }
      if (!simule) {
        for (const c of candidats) {
          await deleteStorageBestEffort(ctx, c.storageId);
        }
      }
    }

    const octetsDuLot = candidats.reduce((s, c) => s + c.size, 0);
    const cumul: Cumul = {
      lots: (args.cumul?.lots ?? 0) + 1,
      examines: (args.cumul?.examines ?? 0) + page.page.length,
      orphelins: (args.cumul?.orphelins ?? 0) + candidats.length,
      octets: (args.cumul?.octets ?? 0) + octetsDuLot,
      tropRecents: (args.cumul?.tropRecents ?? 0) + tropRecents,
    };

    if (candidats.length > 0) {
      console.info(
        `[purge-blobs] lot ${cumul.lots} — ${page.page.length} blob(s) examiné(s), ` +
          `${candidats.length} orphelin(s) ${simule ? "détecté(s) [SIMULATION]" : "supprimé(s)"} ` +
          `(${mo(octetsDuLot)}), ${tropRecents} épargné(s) (< 24 h).`,
      );
      for (const c of candidats) {
        console.info(
          `[purge-blobs]   ${c.storageId} — ${c.contentType ?? "type inconnu"}, ${mo(c.size)}`,
        );
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.storageCleanup.purgerBlobsOrphelins,
        { curseur: page.continueCursor, simuler: args.simuler, cumul },
      );
    } else {
      console.info(
        `[purge-blobs] TERMINÉ — ${cumul.lots} lot(s), ${cumul.examines} blob(s) examiné(s), ` +
          `${cumul.orphelins} orphelin(s) ${simule ? "détecté(s) [SIMULATION, rien supprimé]" : "supprimé(s)"}, ` +
          `${mo(cumul.octets)} ${simule ? "récupérables" : "libérés"}, ` +
          `${cumul.tropRecents} épargné(s) (< 24 h).`,
      );
    }

    return { simule, termine: page.isDone, candidats, cumul };
  },
});
