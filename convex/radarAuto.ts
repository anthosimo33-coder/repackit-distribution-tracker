/**
 * RADAR — SUIVI D'OFFICE des apps trouvées (décidé par le fondateur le 13/11/2026 : « les apps trouvées sont
 * suivies d'office »). Toutes les 10 minutes, les apps repérées par les classements de l'App Store et par la
 * place de marché de campagnes sont regardées une fois :
 *  - une app des classements entre quand ses comptes créateurs la prouvent assez (radarAutoMath.autoPlan) ;
 *  - un produit de la place de marché entre dès que l'IA l'a dit « app » ou « logiciel » : une campagne paie ;
 *  - dans les deux cas, seulement si son motif n'est pas un mot de tous les jours (une IA le dit, radarAutoMath) :
 *    sinon la recherche de son réseau rattache des centaines de comptes sans rapport.
 * Entrer = créer l'app (jamais « concurrente » d'un projet), rattacher ses comptes, et lancer sa recherche
 * complète. Ce qui n'entre pas reste PROPOSÉ à l'écran, avec la raison. Les sites cités par de petits comptes
 * (convex/radarNaming) ne sont pas suivis d'office : cette recherche est encore à l'essai.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { e2eMutation } from "./functions";
import { ERR } from "./errorCodes";
import { FAMILY_MODEL, haikuCostUsd } from "./radarFamiliesMath";
import { followCandidateCore, judgeStoredAccount } from "./radarNetworks";
import { AUTO_COMMON_NOTE, AUTO_SCHEMA, AUTO_SYSTEM, autoAnswer, autoPlan, autoPrompt, shortenedPattern, type AutoToJudge, type AutoVerdict } from "./radarAutoMath";
import { ficheApp } from "./radarFicheMath";
import { refreshAppNet } from "./radarSignals";
import { allowanceUsd, budgetState } from "./radarSignalsMath";
import { alreadyFollowed } from "./radarStoreMath";
import { scKeyPresent } from "./scrapeCreatorsApi";

/** Apps regardées par passage et par source. */
const AUTO_BATCH = 15;
/** Sous ce reste d'enveloppe, on n'appelle pas l'IA (un appel coûte moins d'un cent) : rien n'entre d'office. */
const MIN_ALLOWANCE_USD = 0.01;

type AutoRun = { followed: number; kept: number; attached: number };

/** Les apps repérées à regarder à ce passage : jamais regardées, les plus prouvées d'abord. */
async function pickCandidates(ctx: QueryCtx, only?: (key: string) => boolean): Promise<Doc<"radarAppCandidates">[]> {
  const pick = async (kind: "store" | "market") =>
    (
      await ctx.db
        .query("radarAppCandidates")
        .withIndex("by_kind_status_count", (q) => q.eq("kind", kind).eq("status", "new"))
        .order("desc")
        .take(300)
    )
      .filter((c) => c.autoAt === undefined && (!only || only(c.key)))
      .slice(0, AUTO_BATCH);
  return [...(await pick("store")), ...(await pick("market"))];
}

/** Celles qui entreraient : à faire juger (leur motif est-il un mot de tous les jours ?). */
export const autoToJudge = internalQuery({
  args: {},
  handler: async (ctx): Promise<AutoToJudge[]> => {
    const out: AutoToJudge[] = [];
    for (const c of await pickCandidates(ctx)) {
      const plan = autoPlan(c);
      if ("skip" in plan) continue;
      const what = c.store ? `${c.store.genre} app by ${c.store.artist}` : c.market ? (c.market.productKind === "app" ? "mobile app" : "web software") : "";
      out.push({ id: c._id, name: c.label, what, patterns: plan.patterns });
    }
    return out;
  },
});

/**
 * Un passage. `verdicts` : ce que l'IA a dit du motif de chaque app qui entrerait — sans verdict, l'app n'est pas
 * regardée à ce passage (elle le sera au suivant) ; « nom courant », elle reste proposée.
 */
async function autoFollowCore(ctx: MutationCtx, now: number, verdicts: ReadonlyMap<string, boolean>, only?: (key: string) => boolean): Promise<AutoRun> {
  let followed = 0;
  let kept = 0;
  let attached = 0;
  for (const c of await pickCandidates(ctx, only)) {
    const plan = autoPlan(c);
    if ("skip" in plan) {
      await ctx.db.patch(c._id, { autoAt: now, autoNote: plan.skip });
      kept++;
      continue;
    }
    // Déjà suivie sous ce motif (liste de départ, ou suivie à l'écran entre-temps) : plus à proposer.
    const apps = (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
    if (alreadyFollowed(plan.patterns, apps)) {
      await ctx.db.patch(c._id, { status: "followed", autoAt: now, autoNote: "déjà suivie" });
      continue;
    }
    const common = verdicts.get(c._id);
    if (common === undefined) continue;
    if (common) {
      await ctx.db.patch(c._id, { autoAt: now, autoNote: AUTO_COMMON_NOTE });
      kept++;
      continue;
    }
    try {
      const r = await followCandidateCore(ctx, c, c.label, [], plan.patterns, now);
      await ctx.db.patch(c._id, { autoAt: now, autoNote: "suivie d'office" });
      followed++;
      attached += r.attached;
    } catch (e) {
      // Le même nom qu'une app suivie : c'est elle. Un motif pris dans celui d'une autre : à trancher à la main.
      const code = e instanceof ConvexError ? (e.data as { code?: string } | undefined)?.code : undefined;
      if (code === undefined) throw e;
      if (code === ERR.RADAR_APP_ALREADY_FOLLOWED) await ctx.db.patch(c._id, { status: "followed", autoAt: now, autoNote: "déjà suivie" });
      else {
        await ctx.db.patch(c._id, { autoAt: now, autoNote: code === ERR.RADAR_APP_PATTERN_TAKEN ? "motif déjà pris par une autre app" : "à suivre à la main" });
        kept++;
      }
    }
  }
  return { followed, kept, attached };
}

export const autoFollow = internalMutation({
  args: { now: v.number(), verdicts: v.array(v.object({ id: v.string(), common: v.boolean() })) },
  handler: (ctx, { now, verdicts }): Promise<AutoRun> => autoFollowCore(ctx, now, new Map(verdicts.map((x) => [x.id, x.common]))),
});

export const runAutoFollow = internalAction({
  args: {},
  handler: async (ctx): Promise<{ skipped: "no-key" } | (AutoRun & { usd: number })> => {
    // Sans la clé du fournisseur de données (tests, intégration continue), rien n'est suivi d'office.
    if (!scKeyPresent()) return { skipped: "no-key" };
    const now = Date.now();
    const batch: AutoToJudge[] = await ctx.runQuery(internal.radarAuto.autoToJudge, {});
    let verdicts: AutoVerdict[] = [];
    let usd = 0;
    let lastError: string | undefined;
    let asked = false;
    // Sans IA (clé absente, enveloppe épuisée, réponse illisible), rien n'entre d'office : les apps attendent.
    if (batch.length > 0 && process.env.ANTHROPIC_API_KEY) {
      const st = await ctx.runQuery(internal.radarSignals.jobState, { now });
      if (allowanceUsd(st.budget, budgetState(st.budget, st.usage), "ai") >= MIN_ALLOWANCE_USD) {
        asked = true;
        try {
          const response = await new Anthropic().messages.create({
            model: FAMILY_MODEL,
            max_tokens: 3_000,
            system: AUTO_SYSTEM,
            // Dire si un mot est courant, pas raisonner longuement : effort bas.
            output_config: { effort: "low", format: { type: "json_schema", schema: AUTO_SCHEMA } },
            messages: [{ role: "user", content: autoPrompt(batch) }],
          });
          usd = haikuCostUsd(response.usage);
          if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") lastError = `Analyse IA : réponse interrompue (${response.stop_reason})`;
          else verdicts = autoAnswer(JSON.parse(response.content.find((b) => b.type === "text")?.text ?? ""), batch);
        } catch (e) {
          lastError =
            e instanceof Anthropic.RateLimitError
              ? "Analyse IA : trop de demandes, nouvel essai au prochain passage"
              : e instanceof Anthropic.AuthenticationError
                ? "Analyse IA : clé ANTHROPIC_API_KEY refusée"
                : e instanceof Anthropic.APIError
                  ? `Analyse IA : erreur ${e.status ?? "réseau"}`
                  : "Analyse IA : réponse illisible";
        }
      }
    }
    if (asked) await ctx.runMutation(internal.radarSignals.recordRun, { poste: "ai", credits: 0, calls: 1, errors: lastError ? 1 : 0, now, usd, ...(lastError ? { lastError } : {}) });
    const r: AutoRun = await ctx.runMutation(internal.radarAuto.autoFollow, { now, verdicts });
    // Les comptes rattachés sont relevés tout de suite ; la recherche complète de l'app part à la tâche de l'heure.
    if (r.attached) await ctx.scheduler.runAfter(0, internal.radarNetworks.runAccountReads, {});
    return { ...r, usd };
  },
});

// ─── Réparation du 13/11/2026 ────────────────────────────────────────────────

/** Apps réparées par appel (chacune relit ses comptes). */
const REPAIR_BATCH = 4;
/** Comptes traités par app et par appel. */
const REPAIR_ACCOUNTS = 400;

/**
 * Répare les apps entrées d'office le 13/11/2026 sous un motif trop large, par lots (se relance jusqu'au bout) :
 *  - une app entrée sous un hashtag raccourci (« hush » pour « hushapp ») reprend son hashtag prouvé ;
 *  - une app dont le NOM est un mot courant (`pause` : ses slugs) est mise en pause — à suivre à la main avec un
 *    motif précis, ou à laisser.
 * Dans les deux cas, ses comptes rattachés par le motif trop large et JAMAIS relevés sont retirés (on ne sait rien
 * d'eux, ils n'ont aucune vidéo rangée) ; ceux déjà relevés sont rejugés sur leurs vidéos rangées avec le bon
 * motif — hors sujet, ils passent en pause comme à tout relevé. Puis la recherche du réseau repart avec le bon motif.
 * `dryRun` : ne rien écrire, rendre ce qui serait fait. À lancer à la main, une fois.
 */
export const repairAutoPatterns = internalMutation({
  args: { dryRun: v.boolean(), pause: v.array(v.string()), done: v.optional(v.array(v.string())) },
  handler: async (ctx, { dryRun, pause, done }) => {
    const now = Date.now();
    const seen = new Set(done ?? []);
    const apps = (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
    const cands = await ctx.db
      .query("radarAppCandidates")
      .withIndex("by_kind_status_count", (q) => q.eq("kind", "store").eq("status", "followed"))
      .take(600);
    // L'app, le motif à lui rendre (null : mise en pause), et le motif fautif.
    const todo: { app: Doc<"radarApps">; tag: string | null }[] = [];
    for (const c of cands) {
      const short = c.store ? shortenedPattern(c.store.tag) : null;
      if (!c.store || !short || c.autoNote !== "suivie d'office") continue;
      const app = (c.appId ? apps.find((a) => a._id === c.appId) : undefined) ?? ficheApp(c, apps);
      // Seulement si elle porte encore le motif raccourci, et lui seul : un motif corrigé à la main reste.
      if (app && app.strong.length === 1 && app.strong[0] === short) todo.push({ app, tag: c.store.tag });
    }
    for (const slug of pause) {
      const app = apps.find((a) => a.slug === slug);
      if (app && !todo.some((t) => t.app._id === app._id)) todo.push({ app, tag: null });
    }
    const report: { app: string; motif: string; removed: number; paused: number; kept: number }[] = [];
    const batch = todo.filter((t) => !seen.has(t.app._id)).slice(0, REPAIR_BATCH);
    for (const { app, tag } of batch) {
      const fixed: Doc<"radarApps"> = tag ? { ...app, strong: [tag], searches: [tag, `#${tag}`] } : app;
      const accounts = await ctx.db.query("radarTracked").withIndex("by_app", (q) => q.eq("appId", app._id)).take(REPAIR_ACCOUNTS);
      let removed = 0;
      let paused = 0;
      let kept = 0;
      for (const acc of accounts) {
        if (acc.matchedBy === "manual" || acc.keptByHand) {
          kept++;
        } else if (acc.readAt === undefined) {
          if (!dryRun) await ctx.db.delete(acc._id);
          removed++;
        } else if (acc.status === "active" && (tag === null || (await judgeStoredAccount(ctx, acc, fixed, apps)) === "offTopic")) {
          if (!dryRun) await ctx.db.patch(acc._id, { status: "paused", pausedReason: "offTopic" });
          paused++;
        } else kept++;
      }
      if (!dryRun) {
        if (tag) {
          // Le compteur de comptes est recompté à la prochaine entrée ; la recherche du réseau repart avec le bon motif.
          await ctx.db.patch(app._id, { strong: fixed.strong, searches: fixed.searches, trackedCount: undefined, deepSearchedAt: undefined, networkSearchedAt: undefined });
        } else await ctx.db.patch(app._id, { status: "paused", trackedCount: undefined });
        await refreshAppNet(ctx, app._id, now);
      }
      seen.add(app._id);
      report.push({ app: app.name, motif: tag ? `${app.strong[0]} → ${tag}` : "mise en pause", removed, paused, kept });
    }
    const left = todo.filter((t) => !seen.has(t.app._id)).length;
    if (!dryRun && left > 0) await ctx.scheduler.runAfter(0, internal.radarAuto.repairAutoPatterns, { dryRun, pause, done: [...seen] });
    return { apps: todo.length, treated: report, left };
  },
});

// ─── e2e ─────────────────────────────────────────────────────────────────────

/**
 * e2e : un passage du suivi d'office sur les apps repérées dont la clé contient un de ces marqueurs (la tâche ne
 * tourne pas sans la clé du fournisseur). L'IA n'est pas appelée : `common` donne les clés dont elle aurait dit
 * le motif « courant », `unjudged` celles dont elle n'aurait rien dit ; les autres sont jugées distinctives.
 */
export const e2eAutoFollow = e2eMutation({
  args: { markers: v.array(v.string()), common: v.optional(v.array(v.string())), unjudged: v.optional(v.array(v.string())) },
  handler: async (ctx, { markers, common, unjudged }): Promise<AutoRun> => {
    const only = (key: string) => markers.some((m) => key.includes(m));
    const verdicts = new Map<string, boolean>();
    for (const c of await pickCandidates(ctx, only)) {
      if (!(unjudged ?? []).some((m) => c.key.includes(m))) verdicts.set(c._id, (common ?? []).some((m) => c.key.includes(m)));
    }
    return autoFollowCore(ctx, Date.now(), verdicts, only);
  },
});

/** e2e : pose une app et sa proposition dans l'état du 13/11/2026 (entrée d'office sous son hashtag raccourci). */
export const e2eShortenAutoPattern = e2eMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }): Promise<string | null> => {
    const app = await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
    const c = app ? (await ctx.db.query("radarAppCandidates").withIndex("by_kind_status_count", (q) => q.eq("kind", "store").eq("status", "followed")).take(600)).find((x) => x.appId === app._id) : null;
    const short = c?.store ? shortenedPattern(c.store.tag) : null;
    if (!app || !short) return null;
    await ctx.db.patch(app._id, { strong: [short], searches: [short, `#${short}`] });
    return short;
  },
});

/** e2e : la réparation (`pause` : les slugs des apps à mettre en pause). */
export const e2eRepairAutoPatterns = e2eMutation({
  args: { dryRun: v.boolean(), pause: v.array(v.string()) },
  handler: async (ctx, { dryRun, pause }): Promise<{ apps: number; treated: { app: string; motif: string; removed: number; paused: number; kept: number }[]; left: number }> =>
    ctx.runMutation(internal.radarAuto.repairAutoPatterns, { dryRun, pause }),
});
