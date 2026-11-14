import { v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalQuery } from "./_generated/server";
import { e2eMutation } from "./functions";
import { TABLES, exportPage, type ExportTable } from "./swarmExportPage";

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
 * plus rien ne relie à son app ne part pas ; la justification des autres (pseudo, bio, vidéos) reste interne au
 * Radar (14/11/2026). Chaque vidéo et chaque signal disent s'ils citent leur app (`cites`, la règle du Radar :
 * légende, texte à l'écran, transcription, pseudo), pour que Swarm ne compte que celles-là.
 */

const pageArgs = { table: v.union(...TABLES.map((t) => v.literal(t))), cursor: v.union(v.string(), v.null()) };

/** Une page d'une table, réduite. `cursor` null = première page. */
export const page = internalQuery({
  args: pageArgs,
  handler: (ctx, { table, cursor }) => exportPage(ctx, table, cursor),
});

/** e2e : la même page que lit Swarm (sans la clé de l'export, que la base e2e n'a pas). */
export const e2eSwarmExport = e2eMutation({
  args: pageArgs,
  handler: (ctx, { table, cursor }) => exportPage(ctx, table, cursor),
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

/** GET /swarm/export?table=apps|tracked|trackedVideos|formats|signals&cursor=… — Authorization: Bearer <SWARM_EXPORT_SECRET>. */
export const exportHandler = httpAction(async (ctx, request) => {
  const secret = process.env.SWARM_EXPORT_SECRET;
  if (!secret || secret.length < 32) return json(503, { error: "export non configuré" });
  const header = request.headers.get("Authorization") ?? "";
  if (!sameSecret(header, `Bearer ${secret}`)) return json(401, { error: "non autorisé" });

  const url = new URL(request.url);
  const table = url.searchParams.get("table");
  if (!TABLES.includes(table as ExportTable)) return json(400, { error: `table attendue : ${TABLES.join(", ")}` });
  const cursor = url.searchParams.get("cursor") || null;
  const result = await ctx.runQuery(internal.swarmExport.page, { table: table as ExportTable, cursor });
  return json(200, result);
});
