/**
 * ASSETS PAR CLAUDE — la LECTURE des dossiers d'Assets (`assets`), au droit
 * `library.manage` de l'écran Assets, par ses cœurs (`listAssetFoldersCore`,
 * `listAssetsCore`). Lier un dossier à une mission, c'est `lier_assets`
 * (convex/mcpWritesMissions, domaine « missions ») ; les missions déjà liées
 * se lisent par le cœur de l'écran Assignments, au droit `assignments.manage`
 * — sans lui, la section est refusée, pas l'outil.
 *
 * La durée d'une vidéo n'est pas connue à l'envoi : elle est lue dans
 * l'en-tête du fichier (convex/videoDuration), par plages HTTP — jamais le
 * fichier entier —, la première fois que l'outil la montre, puis gardée sur le
 * fichier (`assets.durationSec`) : un fichier ne change jamais. Illisible =
 * absente, jamais 0.
 */

import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mcpPermissionQuery } from "./functions";
import { listAssetFoldersCore, listAssetsCore } from "./assets";
import { textResult, ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import { ARG_PROJET, designerOuRefuser, refusDe, texteArg } from "./mcpWriteCommon";
import { STATUTS } from "./mcpWritesMissions";
import { plannedDayKey } from "./calendarStatus";
import { parisDayKey } from "./viewsDaily";
import { dureeVideoMp4, estVideoMp4, type LireOctets } from "./videoDuration";

export const OUTILS_ASSETS_LECTURE: readonly McpTool[] = [
  {
    name: "assets",
    title: "Dossiers d'Assets",
    description:
      "Les dossiers d'ASSETS du projet (écran Assets) : les fichiers — images et vidéos — que la créatrice télécharge depuis sa mission quand un dossier y est lié. Sans « dossier » : chaque dossier avec son nombre de fichiers, son statut « À publier » (ses images sont nettoyées de leurs métadonnées à l'envoi : du contenu final, pas du matériel à retravailler), le nombre de missions qui le lient, et pour chaque vidéo sa durée et sa taille. Avec « dossier » : ses fichiers, et les missions qui y sont déjà liées (créatrice, compte, jour prévu, campagne, statut). Pour lier ou délier : `lier_assets`.",
    inputSchema: {
      type: "object",
      properties: {
        projet: ARG_PROJET,
        dossier: {
          type: "string",
          description: "Nom du dossier (exact, ou un morceau qui n'en désigne qu'un) : son détail et ses missions liées.",
        },
      },
      additionalProperties: false,
    },
  },
];

export const NOMS_ASSETS_LECTURE = new Set(OUTILS_ASSETS_LECTURE.map((t) => t.name));

/** Les dossiers et leurs fichiers, par les cœurs de l'écran Assets. */
export const lireAssetsMcp = mcpPermissionQuery("library.manage")({
  args: {},
  handler: async (ctx) =>
    Promise.all(
      (await listAssetFoldersCore(ctx)).map(async (f) => ({
        id: f._id,
        nom: f.name,
        aPublier: f.postprocessImages === true,
        fichiers: (await listAssetsCore(ctx, f._id)).map((a) => ({
          id: a._id,
          nom: a.fileName,
          contentType: a.contentType,
          size: a.size,
          createdAt: a.createdAt,
          durationSec: a.durationSec ?? null,
          // L'adresse du fichier, seulement s'il reste une durée à lire.
          aMesurer: estVideoMp4(a.contentType) && a.durationSec === undefined ? a.url : null,
        })),
      })),
    ),
});

/** Garde la durée lue dans l'en-tête — seulement si elle manque encore (le fichier ne change pas). */
export const noterDurees = internalMutation({
  args: { durees: v.array(v.object({ assetId: v.id("assets"), durationSec: v.number() })) },
  handler: async (ctx, { durees }) => {
    for (const { assetId, durationSec } of durees) {
      const a = await ctx.db.get(assetId);
      if (a && a.durationSec === undefined && Number.isFinite(durationSec) && durationSec > 0) {
        await ctx.db.patch(assetId, { durationSec });
      }
    }
  },
});

/** Au-delà, une plage ignorée par le serveur (réponse 200) n'est pas lue en entier. */
const LECTURE_SANS_PLAGE_MAX = 2 * 1024 * 1024;
const DELAI_LECTURE_MS = 10_000;
const MESURES_EN_PARALLELE = 6;

/** Lit des plages d'un fichier du stockage par HTTP (`Range`). */
function lecteurHttp(url: string): LireOctets {
  return async (debut, fin) => {
    const arret = new AbortController();
    const minuteur = setTimeout(() => arret.abort(), DELAI_LECTURE_MS);
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${debut}-${fin - 1}` }, signal: arret.signal });
      if (r.status === 206) return new Uint8Array(await r.arrayBuffer()).subarray(0, fin - debut);
      if (r.status === 200 && r.body && fin <= LECTURE_SANS_PLAGE_MAX) {
        // Plage ignorée : le début du fichier seulement, puis on coupe.
        const lecteur = r.body.getReader();
        const morceaux: Uint8Array[] = [];
        let lus = 0;
        while (lus < fin) {
          const { done, value } = await lecteur.read();
          if (done) break;
          morceaux.push(value);
          lus += value.length;
        }
        await lecteur.cancel();
        const tout = new Uint8Array(lus);
        let p = 0;
        for (const m of morceaux) {
          tout.set(m, p);
          p += m.length;
        }
        return tout.subarray(debut, fin);
      }
      await r.body?.cancel();
      throw new Error(`HTTP ${r.status}`);
    } finally {
      clearTimeout(minuteur);
    }
  };
}

/** Lit les durées manquantes (quelques fichiers à la fois) et les garde ; rend id → secondes. */
async function mesurerDurees(
  ctx: ActionCtx,
  fichiers: { id: Id<"assets">; size: number; aMesurer: string | null }[],
): Promise<Map<string, number>> {
  const aLire = fichiers.filter((f): f is typeof f & { aMesurer: string } => f.aMesurer !== null);
  const lues = new Map<string, number>();
  for (let i = 0; i < aLire.length; i += MESURES_EN_PARALLELE) {
    await Promise.all(
      aLire.slice(i, i + MESURES_EN_PARALLELE).map(async (f) => {
        const d = await dureeVideoMp4(lecteurHttp(f.aMesurer), f.size).catch(() => null);
        if (d !== null && d > 0) lues.set(f.id, d);
      }),
    );
  }
  if (lues.size > 0) {
    await ctx.runMutation(internal.mcpAssets.noterDurees, {
      durees: [...lues].map(([assetId, durationSec]) => ({ assetId: assetId as Id<"assets">, durationSec })),
    });
  }
  return lues;
}

/** « 3,9 Mo », « 21 Ko » — jamais « 0 Mo » pour un petit fichier. */
export function tailleLisible(octets: number): string {
  if (octets < 1024 * 1024) return `${Math.max(1, Math.round(octets / 1024))} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

/** L'écran d'un dossier (ou la liste). Absolu quand le déploiement connaît son adresse, relatif sinon. */
function lienAssets(projet: string, id?: string): string {
  const base = (process.env.APP_BASE_URL || process.env.SITE_URL || "").replace(/\/+$/, "");
  return `${base}/admin/${projet}/assets${id ? `/${id}` : ""}`;
}

const estImage = (contentType: string) => contentType.startsWith("image/");
const estVideo = (contentType: string) => contentType.startsWith("video/");

export async function appelerAssets(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  ids: { userId: Id<"users">; projectId: Id<"projects"> },
  projet: string,
  lire: <T>(f: () => Promise<T>) => Promise<T>,
): Promise<ToolResult> {
  const dossiers = await lire(() => ctx.runQuery(internal.mcpAssets.lireAssetsMcp, ids));
  const durees = await mesurerDurees(ctx, dossiers.flatMap((d) => d.fichiers));
  const dureeDe = (f: (typeof dossiers)[number]["fichiers"][number]) => {
    const d = f.durationSec ?? durees.get(f.id) ?? null;
    return d === null ? null : Math.round(d * 10) / 10;
  };
  const video = (f: (typeof dossiers)[number]["fichiers"][number]) => ({
    fichier: f.nom,
    dureeSec: dureeDe(f),
    taille: tailleLisible(f.size),
  });

  // Les missions liées : le cœur de l'écran Assignments, à son droit. Refusé = section refusée.
  let missions: Awaited<ReturnType<typeof lirePlanningMcp>> | { refus: string };
  try {
    missions = await lirePlanningMcp(ctx, ids);
  } catch (e) {
    const m = refusDe(e);
    if (m === null) throw e;
    missions = { refus: m };
  }
  const liees = (dossierId: string) =>
    "refus" in missions ? null : missions.filter((r) => r.status !== "cancelled" && r.linkedFolderIds.includes(dossierId as Id<"assetFolders">));
  const lectureDuree =
    "dureeSec : lue dans l'en-tête du fichier (MP4, MOV) ; null = non lue (WebM, en-tête illisible) — pas zéro.";

  const demande = texteArg(args, "dossier");
  if (demande === "") {
    return textResult(
      JSON.stringify(
        {
          projet,
          total: dossiers.length,
          dossiers: dossiers.map((d) => {
            const videos = d.fichiers.filter((f) => estVideo(f.contentType));
            const images = d.fichiers.filter((f) => estImage(f.contentType)).length;
            const lm = liees(d.id);
            return {
              nom: d.nom,
              fichiers: d.fichiers.length,
              aPublier: d.aPublier,
              ...(images > 0 ? { images } : {}),
              ...(videos.length > 0 ? { videos: videos.map(video) } : {}),
              ...(lm !== null ? { missionsLiees: lm.length } : {}),
            };
          }),
          ...("refus" in missions ? { missionsLiees: `non accessibles : ${missions.refus}` } : {}),
          lien: lienAssets(projet),
          lecture: [
            dossiers.length === 0
              ? "Aucun dossier d'Assets : l'équipe les crée et y dépose les fichiers dans Jarvia › Assets."
              : "Appelle `assets` avec « dossier » pour ses fichiers et les missions qui y sont liées ; `lier_assets` pour lier ou délier.",
            "aPublier : « Contenu à publier » — les images déposées dans ce dossier sont nettoyées de leurs métadonnées (C2PA, EXIF) : du contenu final. Sinon : du matériel que la créatrice retravaille.",
            lectureDuree,
            "missionsLiees : missions non abandonnées qui lient ce dossier, publiées comprises.",
          ],
        },
        null,
        1,
      ),
    );
  }

  let d: (typeof dossiers)[number];
  try {
    d = designerOuRefuser(dossiers, (x) => x.nom, demande, "dossiers d'Assets");
  } catch (e) {
    const m = refusDe(e);
    if (m === null) throw e;
    throw new ToolError(m);
  }
  const lm = liees(d.id);
  return textResult(
    JSON.stringify(
      {
        projet,
        dossier: d.nom,
        aPublier: d.aPublier,
        fichiers: d.fichiers.map((f) => ({
          nom: f.nom,
          type: estVideo(f.contentType) ? "vidéo" : estImage(f.contentType) ? "image" : f.contentType,
          taille: tailleLisible(f.size),
          ...(estVideo(f.contentType) ? { dureeSec: dureeDe(f) } : {}),
          ajouteLe: parisDayKey(f.createdAt),
        })),
        missionsLiees:
          lm === null
            ? `non accessibles : ${"refus" in missions ? missions.refus : ""}`
            : lm
                .sort((x, y) => (x.postDate ?? Infinity) - (y.postDate ?? Infinity))
                .map((r) => ({
                  createatrice: r.creatorName,
                  comptes: r.targets.map((t) => (t.accountHandle ? `${t.accountHandle} (${t.platform})` : t.platform)),
                  jourPrevu: r.postDate == null ? null : plannedDayKey(r.postDate),
                  campagne: r.scriptCampaignName ?? r.formatName,
                  statut: STATUTS[r.status] ?? r.status,
                  ...(r.postedAt != null ? { publieeLe: parisDayKey(r.postedAt) } : {}),
                })),
        lien: lienAssets(projet, d.id),
        lecture: [
          lectureDuree,
          "missionsLiees : la créatrice y télécharge ces fichiers depuis sa mission. Une mission se désigne dans `lier_assets` par créatrice + jourPrevu (et compte ou campagne pour départager).",
        ],
      },
      null,
      1,
    ),
  );
}

/** Les missions de l'écran Assignments (cœur partagé avec `planning`), au droit `assignments.manage`. */
function lirePlanningMcp(ctx: ActionCtx, ids: { userId: Id<"users">; projectId: Id<"projects"> }) {
  return ctx.runQuery(internal.mcpTools.lirePlanning, ids);
}
