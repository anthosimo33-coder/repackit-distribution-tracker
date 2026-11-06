/**
 * Outil MCP `signaux` — l'écran Signaux du nouveau Radar, par les MÊMES lectures
 * (listSignalsCore, getRadarBudgetCore) et les MÊMES filtres
 * (convex/radarSignalFilters). Lecture seule : rien n'est relancé chez
 * ScrapeCreators, rien n'est dépensé.
 */
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { mcpPermissionQuery } from "./functions";
import { textResult, ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import { ARG_PROJET } from "./mcpWriteCommon";
import { dayKeyParis } from "./dateFr";
import { getRadarBudgetCore, listSignalsCore } from "./radarSignals";
import { LANG_BUCKETS, viewsPerHour } from "./radarSignalsMath";
import {
  STATUSES,
  applyFilters,
  defaultFilters,
  facets,
  listSince,
  type AgeKey,
  type Filters,
  type SeuilKey,
  type SortKey,
} from "./radarSignalFilters";

export const lireSignaux = mcpPermissionQuery("radar.use")({
  args: { since: v.number() },
  handler: async (ctx, args) => listSignalsCore(ctx, args),
});

export const lireBudgetRadar = mcpPermissionQuery("radar.use")({
  args: {},
  handler: async (ctx) => getRadarBudgetCore(ctx),
});

const PERIODES: Record<string, AgeKey> = { "24h": "1", "3j": "3", "7j": "7", "30j": "30", "90j": "90", tout: "all" };
const TAILLES: Record<string, string> = { "moins-1k": "xs", "1k-10k": "s", "10k-50k": "m", "50k-plus": "l" };
const TRIS: Record<string, SortKey> = { ratio: "ratio", vitesse: "vph", vues: "views", recent: "recent" };

export const OUTIL_SIGNAUX: McpTool = {
  name: "signaux",
  title: "Radar : les vidéos qui sortent du lot",
  description:
    "Les vidéos TikTok qui sortent du lot en ce moment, dans TOUTES les apps (pas seulement les concurrents), comme l'écran Signaux du Radar : mêmes filtres, mêmes compteurs. Une vidéo est relevée par la découverte quand elle dépasse 10 000 vues et 10 fois les abonnés de son compte ; les plus jeunes et rapides ont une courbe (relevés à H+6, H+24, H+48). Dans un filtre, les valeurs s'additionnent (ou) ; entre filtres, elles se cumulent (et). Défaut : 7 derniers jours, sans les vidéos ignorées, trié par vues ÷ abonnés. Rend aussi le budget du mois. Ne relance rien chez ScrapeCreators. Pour en faire un script : prends le hook et la structure, transpose-les à Snytch ou BLUSH dans la langue du marché, jamais mot pour mot.",
  inputSchema: {
    type: "object",
    properties: {
      projet: ARG_PROJET,
      periode: { type: "string", description: "Âge des vidéos (défaut : 7j).", enum: Object.keys(PERIODES) },
      origine: { type: "string", description: "« concurrents » (app concurrente reconnue, ex. The Ick) ou « autres » (toutes les autres apps).", enum: ["concurrents", "autres"] },
      langue: { type: "array", description: `Langues (ou) : ${LANG_BUCKETS.join(", ")} — pt = Brésil, es-am = espagnol d'Amérique, es-es = Espagne.`, items: { type: "string" } },
      taille: { type: "array", description: `Taille du compte (ou) : ${Object.keys(TAILLES).join(", ")}.`, items: { type: "string" } },
      seuil: { type: "integer", description: "Vues ÷ abonnés au moins : 0 (défaut), 10, 50 ou 200." },
      statut: { type: "array", description: `Statut posé par l'équipe (ou) : ${STATUSES.join(", ")}. Défaut : nouveau, enregistre, adapte.`, items: { type: "string" } },
      recherche: { type: "string", description: "Texte cherché dans la légende, le pseudo ou le concurrent." },
      tri: { type: "string", description: "Ordre (défaut : ratio = vues ÷ abonnés).", enum: Object.keys(TRIS) },
      limite: { type: "integer", description: "Vidéos listées au plus (défaut 20).", minimum: 1, maximum: 100 },
    },
    additionalProperties: false,
  },
};

export const NOMS_SIGNAUX = new Set([OUTIL_SIGNAUX.name]);

/** Les arguments de l'outil, traduits en filtres de l'écran. */
export function filtresDepuis(args: Record<string, unknown>): Filters {
  const f = defaultFilters();
  const liste = (x: unknown) => (Array.isArray(x) ? x.filter((e): e is string => typeof e === "string") : []);
  if (typeof args.periode === "string") {
    if (!(args.periode in PERIODES)) throw new ToolError(`« periode » : ${Object.keys(PERIODES).join(", ")}.`);
    f.age = PERIODES[args.periode];
  }
  if (args.origine === "concurrents") f.sel.origine = ["concurrent"];
  else if (args.origine === "autres") f.sel.origine = ["autre"];
  f.sel.langue = liste(args.langue).filter((l) => (LANG_BUCKETS as readonly string[]).includes(l));
  f.sel.taille = liste(args.taille).map((t) => TAILLES[t]).filter(Boolean);
  if (args.statut !== undefined) f.sel.statut = liste(args.statut).filter((s) => (STATUSES as readonly string[]).includes(s));
  if (typeof args.seuil === "number") {
    const s = String(args.seuil);
    if (!["0", "10", "50", "200"].includes(s)) throw new ToolError("« seuil » : 0, 10, 50 ou 200.");
    f.seuil = s as SeuilKey;
  }
  if (typeof args.recherche === "string") f.q = args.recherche;
  if (typeof args.tri === "string" && args.tri in TRIS) f.sort = TRIS[args.tri];
  return f;
}

const usd = (x: number) => Math.round(x * 100) / 100;

export async function appelerSignaux(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  ids: { userId: Id<"users">; projectId: Id<"projects"> },
  projet: string,
  lire: <T>(f: () => Promise<T>) => Promise<T>,
): Promise<ToolResult> {
  const now = Date.now();
  const f = filtresDepuis(args);
  const limite = typeof args.limite === "number" ? Math.max(1, Math.min(100, Math.round(args.limite))) : 20;
  const lu = await lire(() => ctx.runQuery(internal.mcpSignaux.lireSignaux, { ...ids, since: listSince(now) }));
  const b = await lire(() => ctx.runQuery(internal.mcpSignaux.lireBudgetRadar, ids));
  const res = applyFilters(lu.signals, f, now);
  const fc = facets(lu.signals, f, now);
  const compteurs = Object.fromEntries(fc.groups.map((g) => [g.key, Object.fromEntries(g.options.map((o) => [o.value, o.count]))]));
  return textResult(
    JSON.stringify(
      {
        projet,
        total: res.length,
        ...(lu.truncated ? { tronque: "les 3 000 vidéos les plus récentes seulement" } : {}),
        compteurs,
        videos: res.slice(0, limite).map((s) => ({
          compte: s.handle,
          abonnes: s.fans,
          vues: s.views,
          foisAbonnes: Math.round(s.ratio * 10) / 10,
          vuesParHeure: Math.round(viewsPerHour(s.views, s.publishedAt, now)),
          publieLe: dayKeyParis(s.publishedAt),
          ageHeures: Math.round((now - s.publishedAt) / 3_600_000),
          langue: s.lang,
          ...(s.competitor ? { concurrent: s.competitor } : {}),
          statut: s.status,
          legende: s.caption,
          likes: s.likes,
          commentaires: s.comments,
          partages: s.shares,
          enregistrements: s.saves,
          ...(s.durationSec !== null ? { dureeSec: s.durationSec } : {}),
          courbe: s.snapshots.map((p) => ({ heuresApresPublication: Math.round((p.at - s.publishedAt) / 3_600_000), vues: p.views })),
          lien: s.url,
        })),
        budget: {
          mois: b.month,
          depenseUsd: usd(b.state.spentUsd),
          plafondUsd: b.budget.capUsd,
          prevuUsd: usd(b.plannedUsd),
          projectionUsd: usd(b.state.projectedUsd),
          plafondAtteint: b.state.capReached,
          postesCoupes: b.state.cut,
          creditsRestantsScrapeCreators: b.jobs.creditsRemaining,
          derniereDecouverte: b.jobs.lastDiscoveryAt === null ? null : new Date(b.jobs.lastDiscoveryAt).toISOString(),
          collecteActive: b.jobs.keyPresent,
        },
        lecture: [
          "foisAbonnes = vues ÷ abonnés du compte (au moins 100) : 50 veut dire 50 fois son audience.",
          "courbe = vues relevées à chaque passage, en heures après la publication ; une vidéo qui double entre H+6 et H+24 décolle.",
          "Les compteurs disent combien de vidéos on aurait en ajoutant chaque valeur, compte tenu des autres filtres.",
        ],
      },
      null,
      1,
    ),
  );
}
