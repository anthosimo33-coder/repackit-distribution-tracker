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
import { listAppAccountsCore, listCandidatesCore, listFormatsCore, listNetworksCore } from "./radarNetworks";
import { listAdsCore } from "./radarSources";
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

export const lireReseaux = mcpPermissionQuery("radar.use")({
  args: {},
  handler: async (ctx) => listNetworksCore(ctx),
});

export const lireFormats = mcpPermissionQuery("radar.use")({
  args: {},
  handler: async (ctx) => listFormatsCore(ctx),
});

export const lireAppsReperees = mcpPermissionQuery("radar.use")({
  args: {},
  handler: async (ctx) => listCandidatesCore(ctx),
});

export const lirePubs = mcpPermissionQuery("radar.use")({
  args: {},
  handler: async (ctx) => listAdsCore(ctx),
});

export const lireComptesApp = mcpPermissionQuery("radar.use")({
  args: { appId: v.id("radarApps") },
  handler: async (ctx, args) => listAppAccountsCore(ctx, args),
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
      origine: { type: "string", description: "« concurrents » (app concurrente DU PROJET, ex. The Ick pour Snytch, What Brandon Thinks pour BLUSH) ou « autres » (toutes les autres apps).", enum: ["concurrents", "autres"] },
      plateforme: { type: "string", description: "tiktok ou instagram (les Reels des comptes suivis dont la bio TikTok donne l'Instagram).", enum: ["tiktok", "instagram"] },
      app: { type: "string", description: "Une app suivie ou citée, par son nom (même partiel : « brandon », « ick ») — outil `reseaux` pour la liste." },
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
  if (args.plateforme === "tiktok" || args.plateforme === "instagram") f.sel.plateforme = [args.plateforme];
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
  if (typeof args.app === "string" && args.app.trim()) {
    const plie = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const voulu = plie(args.app.trim());
    const connues = Array.from(new Set(lu.signals.map((x) => x.app).filter((x): x is string => !!x)));
    const trouvees = connues.filter((a) => plie(a).includes(voulu));
    if (!trouvees.length) throw new ToolError(`App « ${args.app} » absente des signaux. Apps vues : ${connues.join(", ") || "aucune"}.`);
    f.sel.app = trouvees;
  }
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
          ...(s.app ? { app: s.app } : {}),
          ...(s.competitor ? { concurrent: s.competitor } : {}),
          ...(s.multiplier !== null ? { foisMediane: Math.round(s.multiplier * 10) / 10 } : {}),
          statut: s.status,
          ...(s.platform === "instagram" ? { plateforme: "instagram" } : {}),
          ...(s.hook ? { texteEcran: s.hook } : {}),
          ...(s.musicTitle ? { son: s.musicTitle } : {}),
          ...(s.transcript ? { transcription: s.transcript } : {}),
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
          "foisMediane (comptes suivis) = vues ÷ médiane des vues du compte : 10 veut dire 10 fois ce qu'il fait d'habitude — le signal le plus juste pour un compte neuf.",
          "courbe = vues relevées à chaque passage, en heures après la publication ; une vidéo qui double entre H+6 et H+24 décolle.",
          "Les compteurs disent combien de vidéos on aurait en ajoutant chaque valeur, compte tenu des autres filtres.",
        ],
      },
      null,
      1,
    ),
  );
}

// ─── Outil `reseaux` ────────────────────────────────────────────────────────

export const OUTIL_RESEAUX: McpTool = {
  name: "reseaux",
  title: "Radar : les réseaux d'apps suivis",
  description:
    "Les apps dont le Radar suit le réseau de comptes TikTok (concurrentes du projet en tête : The Ick, Stalkie, FollowSpy, Snitchy… pour Snytch ; What Brandon Thinks, The Cringe, Rizz App, Plug AI… pour BLUSH ; et une vingtaine d'autres apps à armée de comptes), comme l'onglet Comptes suivis : comptes, publications de la semaine, meilleure vidéo (multiplicateur = vues ÷ médiane du compte). Avec « app » : les comptes de cette app, les plus en forme d'abord. vue « formats » : les hooks (texte à l'écran) et les sons repris par au moins deux comptes suivis en 14 jours, ceux poussés par une concurrente d'abord — le format à transposer. vue « apps_reperees » : les comptes mentionnés et les sites cités par plusieurs comptes, des apps qu'on ne suit pas encore. vue « pubs » : leurs pubs dans les bibliothèques TikTok et Meta — une pub qui tourne longtemps est un format que l'app paie pour pousser, le gagnant le plus sûr. Lecture seule. Les vidéos qui sortent du lot de ces comptes se lisent avec `signaux` (filtre « app »).",
  inputSchema: {
    type: "object",
    properties: {
      projet: ARG_PROJET,
      vue: { type: "string", description: "apps (défaut), formats, apps_reperees ou pubs.", enum: ["apps", "formats", "apps_reperees", "pubs"] },
      app: { type: "string", description: "Une app, par son nom (même partiel), pour la liste de ses comptes (vue apps)." },
      limite: { type: "integer", description: "Comptes listés au plus (défaut 30).", minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  },
};

export const NOMS_RESEAUX = new Set([OUTIL_RESEAUX.name]);

const GROUPE_LIBELLE = { rival: "concurrente du projet", otherRival: "concurrente d'un autre projet", other: "autre app" } as const;

export async function appelerReseaux(
  ctx: ActionCtx,
  args: Record<string, unknown>,
  ids: { userId: Id<"users">; projectId: Id<"projects"> },
  projet: string,
  lire: <T>(f: () => Promise<T>) => Promise<T>,
): Promise<ToolResult> {
  const jour = (t: number | null) => (t === null ? null : dayKeyParis(t));
  const vue = args.vue ?? "apps";
  if (vue !== "apps" && vue !== "formats" && vue !== "apps_reperees" && vue !== "pubs") throw new ToolError("« vue » : apps, formats, apps_reperees ou pubs.");
  if (vue === "pubs") {
    const ads = await lire(() => ctx.runQuery(internal.mcpSignaux.lirePubs, ids));
    return textResult(
      JSON.stringify(
        {
          projet,
          pubs: ads.length,
          lecture: "Concurrentes du projet d'abord, actives d'abord, puis les plus longues à tourner. joursDeDiffusion = de la première à la dernière apparition (aujourd'hui si active).",
          liste: ads.slice(0, 40).map((a) => ({
            app: a.app,
            ...(a.rival ? { concurrente: true } : {}),
            bibliotheque: a.platform,
            annonceur: a.advertiser,
            active: a.active,
            joursDeDiffusion: a.runDays,
            depuis: jour(a.firstShownAt),
            ...(a.text ? { texte: a.text } : {}),
            ...(a.variants !== null ? { variantes: a.variants } : {}),
            ...(a.audience ? { audience: a.audience } : {}),
            lien: a.url,
          })),
        },
        null,
        1,
      ),
    );
  }
  if (vue === "formats") {
    const f = await lire(() => ctx.runQuery(internal.mcpSignaux.lireFormats, ids));
    return textResult(
      JSON.stringify(
        {
          projet,
          formats: f.length,
          lecture: "type hook = même gabarit de texte à l'écran (ses 4 premiers mots : variantes listées) ; son = même son. comptes = comptes suivis distincts (TikTok ou Instagram) qui l'ont publié en 14 jours. foisMediane = vues ÷ médiane du compte.",
          liste: f.slice(0, 40).map((x) => ({
            type: x.kind === "hook" ? "hook" : "son",
            texte: x.label,
            ...(x.variants > 1 ? { variantes: [...new Set(x.members.map((m) => m.hook).filter(Boolean))] } : {}),
            comptes: x.accountCount,
            apps: x.apps.map((a) => a.name),
            ...(x.rival ? { pousseParUnConcurrent: true } : {}),
            vuesMax: x.maxViews,
            ...(x.bestMultiplier !== null ? { foisMedianeMax: Math.round(x.bestMultiplier * 10) / 10 } : {}),
            dernierePublication: jour(x.lastPostAt),
            exemples: x.members.slice(0, 4).map((m) => ({ compte: m.handle, app: m.app, vues: m.views, lien: m.url })),
          })),
        },
        null,
        1,
      ),
    );
  }
  if (vue === "apps_reperees") {
    const c = await lire(() => ctx.runQuery(internal.mcpSignaux.lireAppsReperees, ids));
    return textResult(
      JSON.stringify(
        {
          projet,
          lecture: "Citées par au moins deux comptes (suivis ou découverts), pas encore suivies. Les suivre se fait dans l'onglet Comptes suivis.",
          liste: c.map((x) => ({
            app: x.label,
            type: x.kind === "mention" ? "compte mentionné" : "site",
            citeePar: x.authorCount,
            chezLesComptesDe: x.fromApps,
            exemples: x.examples.map((e) => e.handle),
            depuis: jour(x.firstSeenAt),
          })),
        },
        null,
        1,
      ),
    );
  }
  const r = await lire(() => ctx.runQuery(internal.mcpSignaux.lireReseaux, ids));
  if (typeof args.app !== "string" || !args.app.trim()) {
    return textResult(
      JSON.stringify(
        {
          projet,
          comptesSuivis: r.total,
          comptesActifs: r.active,
          plafond: r.max,
          apps: r.apps.map((a) => ({
            app: a.name,
            groupe: GROUPE_LIBELLE[a.group],
            statut: a.status,
            comptes: a.accounts,
            comptesActifs: a.activeAccounts,
            publicationsSemaine: a.posts7d,
            meilleureSemaine: a.best ? { compte: a.best.handle, vues: a.best.views, foisMediane: Math.round(a.best.multiplier * 10) / 10, lien: a.best.url } : null,
            reseauCherche: jour(a.networkSearchedAt),
          })),
        },
        null,
        1,
      ),
    );
  }
  const plie = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const voulu = plie(args.app.trim());
  const app = r.apps.find((a) => plie(a.name).includes(voulu) || a.slug.includes(voulu));
  if (!app) throw new ToolError(`App « ${args.app} » non suivie. Apps : ${r.apps.map((a) => a.name).join(", ") || "aucune"}.`);
  const limite = typeof args.limite === "number" ? Math.max(1, Math.min(200, Math.round(args.limite))) : 30;
  const comptes = await lire(() => ctx.runQuery(internal.mcpSignaux.lireComptesApp, { ...ids, appId: app.id }));
  return textResult(
    JSON.stringify(
      {
        projet,
        app: app.name,
        groupe: GROUPE_LIBELLE[app.group],
        comptes: comptes.length,
        liste: comptes.slice(0, limite).map((c) => ({
          compte: c.handle,
          statut: c.status,
          rattache: c.matchedBy === "manual" ? "à la main" : "légende qui cite l'app",
          abonnes: c.fans,
          medianeVues: c.medianViews,
          publicationsSemaine: c.posts7d,
          derniereVideo: jour(c.lastPostAt),
          meilleureSemaine: c.best7d ? { vues: c.best7d.views, foisMediane: Math.round(c.best7d.multiplier * 10) / 10, lien: c.best7d.url } : null,
          lien: c.url,
        })),
      },
      null,
      1,
    ),
  );
}
