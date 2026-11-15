import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalQuery } from "./_generated/server";
import { e2eMutation } from "./functions";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { EXPORT_MAX_APPS, TABLES, exportPage, type ExportTable } from "./swarmExportPage";

/**
 * Export du Radar vers Swarm (le SaaS de veille, projet Convex à part).
 *
 * Swarm ne lit jamais la base de Jarvia : une fois par jour, après le relevé, sa
 * synchronisation appelle GET /swarm/export?table=…&cursor=… page par page, avec
 * la clé partagée SWARM_EXPORT_SECRET (posée sur les deux déploiements, jamais
 * affichée). Lecture seule ; chaque table est réduite aux champs que Swarm affiche.
 *
 * Seul ce que le Radar suit ENCORE part (14/11/2026) : les comptes actifs et leurs vidéos, les signaux qui ne
 * viennent pas d'un compte en pause, les membres actifs des formats. Jusque-là tout partait, et Swarm comptait sous
 * une app les vidéos de ses comptes mis en pause « hors sujet » : 55 % des vues affichées le 13/11, l'accueil tenu
 * par Hush (117,9 M de vues, dont 278 de comptes actifs), une recette italienne en tête de Piatto. Un compte que
 * plus rien ne relie à son app part « en pause » (pas un créateur pour Swarm) ; aucune justification ne part
 * (pseudo, bio, vidéos : interne au Radar, 14/11/2026). Chaque vidéo et chaque signal disent s'ils citent leur app (`cites`, la règle du Radar :
 * légende, texte à l'écran, transcription, pseudo), pour que Swarm ne compte que celles-là.
 */

/**
 * `apps` (15/11/2026, demande de Swarm, qui se synchronise par groupes d'apps) : les ids des apps dont on veut les
 * lignes de `tracked` ou `trackedVideos`, lues par leur index ; une app fondue n'est pas remplacée par la vraie.
 */
const pageArgs = { table: v.union(...TABLES.map((t) => v.literal(t))), cursor: v.union(v.string(), v.null()), apps: v.optional(v.array(v.string())) };

/** Les ids reçus, vérifiés : un id qui n'est pas celui d'une app refuse l'appel. */
function appIdsOf(ctx: QueryCtx, apps: readonly string[] | undefined): Id<"radarApps">[] | undefined {
  if (apps === undefined) return undefined;
  return apps.map((a) => {
    const id = ctx.db.normalizeId("radarApps", a);
    if (!id) throw new ConvexError({ code: "EXPORT_BAD_APP", message: `« ${a.slice(0, 40)} » n'est pas l'id d'une app du Radar.` });
    return id;
  });
}

/** Une page d'une table, réduite. `cursor` null = première page. */
export const page = internalQuery({
  args: pageArgs,
  handler: (ctx, { table, cursor, apps }) => exportPage(ctx, table, cursor, appIdsOf(ctx, apps)),
});

/** e2e : la même page que lit Swarm (sans la clé de l'export, que la base e2e n'a pas). */
export const e2eSwarmExport = e2eMutation({
  args: pageArgs,
  handler: (ctx, { table, cursor, apps }) => exportPage(ctx, table, cursor, appIdsOf(ctx, apps)),
});

/** Comparaison en temps constant : la durée ne dit rien de la clé. */
function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/**
 * GET /swarm/export?table=apps|tracked|trackedVideos|formats|signals&cursor=…[&apps=<id>,<id>,…] — Authorization:
 * Bearer <SWARM_EXPORT_SECRET>. `apps` : tracked et trackedVideos seulement (cf `exportPage`) ; sinon 400.
 */
export const exportHandler = httpAction(async (ctx, request) => {
  const secret = process.env.SWARM_EXPORT_SECRET;
  if (!secret || secret.length < 32) return json(503, { error: "export non configuré" });
  const header = request.headers.get("Authorization") ?? "";
  if (!sameSecret(header, `Bearer ${secret}`)) return json(401, { error: "non autorisé" });

  const url = new URL(request.url);
  const table = url.searchParams.get("table");
  if (!TABLES.includes(table as ExportTable)) return json(400, { error: `table attendue : ${TABLES.join(", ")}` });
  const cursor = url.searchParams.get("cursor") || null;
  const appsParam = url.searchParams.get("apps");
  const apps = appsParam === null ? undefined : appsParam.split(",").map((a) => a.trim()).filter(Boolean);
  if (apps && table !== "tracked" && table !== "trackedVideos") return json(400, { error: "apps ne vaut que pour tracked et trackedVideos" });
  if (apps && apps.length > EXPORT_MAX_APPS) return json(400, { error: `${EXPORT_MAX_APPS} apps au plus par appel` });
  try {
    const result = await ctx.runQuery(internal.swarmExport.page, { table: table as ExportTable, cursor, ...(apps ? { apps } : {}) });
    return json(200, result);
  } catch (e) {
    const data = e instanceof ConvexError ? (e.data as { message?: string } | undefined) : undefined;
    if (data?.message) return json(400, { error: data.message });
    throw e;
  }
});
