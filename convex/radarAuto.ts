/**
 * RADAR — SUIVI D'OFFICE des apps trouvées (décidé par le fondateur le 13/11/2026 : « les apps trouvées sont
 * suivies d'office »). Toutes les 10 minutes, les apps repérées par les classements de l'App Store et par la
 * place de marché de campagnes sont regardées une fois :
 *  - une app des classements entre quand ses comptes créateurs la prouvent assez (radarAutoMath.autoPlan) ;
 *  - un produit de la place de marché entre dès que l'IA l'a dit « app » ou « logiciel » : une campagne paie ;
 *  - dans les deux cas, seulement si son motif n'est pas un mot de tous les jours (une IA le dit, radarAutoMath) :
 *    sinon la recherche de son réseau rattache des centaines de comptes sans rapport.
 * Entrer = créer l'app (jamais « concurrente » d'un projet), rattacher ses comptes, et lancer sa recherche
 * complète. Depuis le 15/11/2026 (« autant d'apps que FarmSpot »), une app des classements à DEUX comptes créateurs
 * entre À L'ESSAI : sa recherche décide (gardée à 3 comptes actifs, en pause sinon, cf `settleTrials`). Ce qui n'entre pas reste PROPOSÉ à l'écran, avec la raison. Les sites cités par de petits comptes
 * (convex/radarNaming) ne sont pas suivis d'office : cette recherche est encore à l'essai.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { e2eMutation } from "./functions";
import { ERR } from "./errorCodes";
import { FAMILY_MODEL, haikuCostUsd } from "./radarFamiliesMath";
import { followCandidateCore, judgeStoredAccount } from "./radarNetworks";
import {
  AUTO_COMMON_NOTE,
  AUTO_SCHEMA,
  AUTO_SYSTEM,
  autoAnswer,
  autoPlan,
  autoPrompt,
  inTriageScope,
  listFallback,
  listKey,
  listPatterns,
  listSearches,
  broadenCore,
  broadenedRule,
  shadowNot,
  shortenedPattern,
  trialDecision,
  TRIAGE_BATCH,
  TRIAGE_MIN_AUTHORS,
  TRIAGE_OUT_NOTE,
  TRIAGE_SCHEMA,
  TRIAGE_SYSTEM,
  triageAnswer,
  triagePrompt,
  triageSearches,
  type AutoToJudge,
  type AutoVerdict,
  type Triage,
  type TriageToJudge,
} from "./radarAutoMath";
import { ficheApp } from "./radarFicheMath";
import { ensureSettings, refreshAppNet, trackedCounts, type TrackedCounter } from "./radarSignals";
import { MAX_OTHER_TOTAL, MAX_TRACKED } from "./radarNetworkMath";
import { allowanceUsd, budgetState } from "./radarSignalsMath";
import { alreadyFollowed } from "./radarStoreMath";
import { scKeyPresent } from "./scrapeCreatorsApi";

/** Apps regardées par passage et par source. */
const AUTO_BATCH = 15;
/** Apps qui entrent au plus par passage (toutes sources) : le reste passe 10 minutes plus tard. */
const AUTO_MAX_FOLLOWS = 40;
/** Sous ce reste d'enveloppe, on n'appelle pas l'IA (un appel coûte moins d'un cent) : rien n'entre d'office. */
const MIN_ALLOWANCE_USD = 0.01;

type AutoRun = { followed: number; kept: number; attached: number };

/**
 * Les apps repérées à regarder à ce passage : jamais regardées, les plus prouvées d'abord. Lues par leur index
 * (`autoAt` absent) : avant le 15/11/2026, les 300 plus prouvées étaient lues puis filtrées, et une app classée
 * au-delà n'était jamais regardée une fois les 300 premières vues.
 */
async function pickCandidates(ctx: QueryCtx, only?: (key: string) => boolean): Promise<Doc<"radarAppCandidates">[]> {
  const pick = async (kind: "store" | "market" | "ia" | "liste") =>
    (
      await ctx.db
        .query("radarAppCandidates")
        .withIndex("by_kind_status_auto", (q) => q.eq("kind", kind).eq("status", "new").eq("autoAt", undefined))
        // Les plus prouvées d'abord ; une liste importée (toutes à 0 compte), dans SON ordre — celle de FarmSpot va des
        // plus vues aux moins vues (15/11/2026 : prises à l'envers, sa queue sans vues passait la première).
        .order(kind === "liste" ? "asc" : "desc")
        .take(only ? 300 : AUTO_BATCH)
    )
      .filter((c) => !only || only(c.key))
      .slice(0, AUTO_BATCH);
  // Mentions et sites : seulement ceux que l'IA a déjà triés (les autres attendent leur tri, cf runCandidateTriage).
  const triaged = async (kind: "mention" | "domain") =>
    (
      await ctx.db
        .query("radarAppCandidates")
        .withIndex("by_kind_status_auto", (q) => q.eq("kind", kind).eq("status", "new").eq("autoAt", undefined))
        .order("desc")
        .take(only ? 300 : 100)
    )
      .filter((c) => c.triage !== undefined && (!only || only(c.key)))
      .slice(0, AUTO_BATCH);
  return [
    ...(await pick("store")),
    ...(await pick("market")),
    ...(await pick("ia")),
    ...(await pick("liste")),
    ...(await triaged("mention")),
    ...(await triaged("domain")),
  ];
}

/** Celles qui entreraient : à faire juger (leur motif est-il un mot de tous les jours ?). */
export const autoToJudge = internalQuery({
  args: {},
  handler: async (ctx): Promise<AutoToJudge[]> => {
    const out: AutoToJudge[] = [];
    for (const c of await pickCandidates(ctx)) {
      const plan = autoPlan(c);
      if ("skip" in plan) continue;
      const what = c.store
        ? `${c.store.genre} app by ${c.store.artist}`
        : c.market
          ? c.market.productKind === "app"
            ? "mobile app"
            : "web software"
          : c.kind === "ia"
            ? "product promoted by TikTok creators"
            : c.triage
              ? `${c.triage.kind === "software" ? "web software" : c.triage.kind === "game" ? "mobile game" : "mobile app"} cited by TikTok creators`
              : c.liste
                ? `${c.liste.category ? `${c.liste.category} ` : ""}app promoted by TikTok creator farms`
                : "";
      out.push({ id: c._id, name: c.triage?.name || c.label, what, patterns: plan.patterns });
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
  // Les apps suivies et le compteur des comptes, lus UNE fois pour tout le passage (cf radarNetworks.CreateOpts).
  const apps = (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
  const counter: TrackedCounter = {};
  const shared = { followed: apps, counter };
  for (const c of await pickCandidates(ctx, only)) {
    if (followed >= AUTO_MAX_FOLLOWS) break;
    const plan = autoPlan(c);
    if ("skip" in plan) {
      await ctx.db.patch(c._id, { autoAt: now, autoNote: plan.skip });
      kept++;
      continue;
    }
    // Déjà suivie sous ce motif (liste de départ, ou suivie à l'écran entre-temps) : plus à proposer.
    if (alreadyFollowed(plan.patterns, apps)) {
      await ctx.db.patch(c._id, { status: "followed", autoAt: now, autoNote: "déjà suivie" });
      continue;
    }
    const common = verdicts.get(c._id);
    if (common === undefined) continue;
    // Une app d'une liste au nom courant (Simple, Glow) : sous « nomapp », sans les tournures qui le contiennent.
    const fallback = c.kind === "liste" && (common || listPatterns(c.label).length === 0) ? listFallback(c.label) : null;
    if (common && !fallback) {
      await ctx.db.patch(c._id, { autoAt: now, autoNote: AUTO_COMMON_NOTE });
      kept++;
      continue;
    }
    // Une app d'une liste dont le motif est dans celui d'une app suivie (« shelfapp » dans « bookshelfapp ») : elle
    // retire le nom et les motifs de l'autre avant de chercher (cf radarAutoMath.shadowNot) ; sinon, à la main.
    const unshadow = c.kind === "liste" ? (shadowNot(fallback ? fallback.patterns : plan.patterns, apps) ?? []) : [];
    try {
      // Une mention ou un site trié : le nom du produit dit par l'IA, ses motifs marqués (@, #), ses propres recherches.
      const r = c.triage
        ? await followCandidateCore(ctx, c, c.triage.name, [], plan.patterns, now, true, { ...shared, marks: true, searches: triageSearches(c, c.triage.name) })
        : fallback
          ? await followCandidateCore(ctx, c, c.label, [], fallback.patterns, now, true, { ...shared, searches: fallback.searches, not: [...fallback.not, ...unshadow] })
          : c.kind === "liste"
            ? await followCandidateCore(ctx, c, c.label, [], plan.patterns, now, true, { ...shared, searches: listSearches(c.label), ...(unshadow.length ? { not: unshadow } : {}) })
            : await followCandidateCore(ctx, c, c.label, [], plan.patterns, now, true, shared);
      // La nouvelle app compte pour les suivantes du passage (motif déjà pris, déjà suivie).
      const created = await ctx.db.get(r.appId);
      if (created) apps.push(created);
      if (plan.trial) await ctx.db.patch(r.appId, { trialSince: now });
      await ctx.db.patch(c._id, { autoAt: now, autoNote: plan.trial ? (fallback ? `${TRIAL_NOTE} (nom courant : sous « ${fallback.patterns[0]} »)` : TRIAL_NOTE) : "suivie d'office" });
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
    await ctx.runMutation(internal.radarAuto.requeueTrialCandidates, {});
    const batch: AutoToJudge[] = await ctx.runQuery(internal.radarAuto.autoToJudge, {});
    let verdicts: AutoVerdict[] = [];
    let usd = 0;
    let lastError: string | undefined;
    let asked = false;
    // Sans IA (clé absente, enveloppe épuisée, réponse illisible), rien n'entre d'office : les apps attendent.
    if (batch.length > 0 && process.env.ANTHROPIC_API_KEY) {
      const st = await ctx.runQuery(internal.radarSignals.jobState, { now });
      if (allowanceUsd(st.budget, budgetState(st.budget, st.usage, st.balance), "ai") >= MIN_ALLOWANCE_USD) {
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

// ─── Le tri des mentions et des sites (15/11/2026) ───────────────────────────

/** Les mentions et les sites cités par deux comptes ou plus, jamais triés : les plus cités d'abord. */
async function toTriage(ctx: QueryCtx, only?: (key: string) => boolean): Promise<TriageToJudge[]> {
  const names = new Map((await ctx.db.query("radarApps").collect()).map((a) => [a._id as string, a.name]));
  const out: TriageToJudge[] = [];
  for (const kind of ["domain", "mention"] as const) {
    const rows = await ctx.db
      .query("radarAppCandidates")
      .withIndex("by_kind_status_count", (q) => q.eq("kind", kind).eq("status", "new").gte("authorCount", TRIAGE_MIN_AUTHORS))
      .order("desc")
      .take(300);
    for (const c of rows) {
      if (c.triage !== undefined || c.autoAt !== undefined || (only && !only(c.key))) continue;
      out.push({ id: c._id, kind, label: c.label, authors: c.authorCount, apps: c.fromApps.map((id) => names.get(id as string) ?? "").filter(Boolean) });
      if (out.length >= TRIAGE_BATCH) return out;
    }
  }
  return out;
}

export const triageToDo = internalQuery({ args: {}, handler: (ctx) => toTriage(ctx) });

async function applyTriageCore(ctx: MutationCtx, rows: readonly Triage[], now: number): Promise<{ inScope: number; out: number }> {
  let inScope = 0;
  let out = 0;
  for (const t of rows) {
    const id = ctx.db.normalizeId("radarAppCandidates", t.id);
    if (!id) continue;
    if (inTriageScope(t.kind)) {
      await ctx.db.patch(id, { triage: { at: now, kind: t.kind, name: t.name } });
      inScope++;
    } else {
      // Ni app, ni logiciel, ni jeu mobile : il reste proposé à l'écran, avec la raison, et n'est plus regardé d'office.
      await ctx.db.patch(id, { triage: { at: now, kind: t.kind, name: "" }, autoAt: now, autoNote: TRIAGE_OUT_NOTE });
      out++;
    }
  }
  return { inScope, out };
}

export const applyTriage = internalMutation({
  args: { now: v.number(), rows: v.array(v.object({ id: v.string(), kind: v.union(v.literal("app"), v.literal("software"), v.literal("game"), v.literal("other")), name: v.string() })) },
  handler: (ctx, { now, rows }) => applyTriageCore(ctx, rows, now),
});

/** Toutes les 30 minutes : Claude Haiku trie 40 mentions ou sites (moins d'un cent l'appel). */
export const runCandidateTriage = internalAction({
  args: {},
  handler: async (ctx): Promise<{ skipped: "no-key" | "budget" | "rien" } | { inScope: number; out: number; usd: number }> => {
    if (!process.env.ANTHROPIC_API_KEY) return { skipped: "no-key" };
    const now = Date.now();
    const st = await ctx.runQuery(internal.radarSignals.jobState, { now });
    if (allowanceUsd(st.budget, budgetState(st.budget, st.usage, st.balance), "ai") < MIN_ALLOWANCE_USD) return { skipped: "budget" };
    const batch: TriageToJudge[] = await ctx.runQuery(internal.radarAuto.triageToDo, {});
    if (batch.length === 0) return { skipped: "rien" };
    let usd = 0;
    let lastError: string | undefined;
    let r = { inScope: 0, out: 0 };
    try {
      const response = await new Anthropic().messages.create({
        model: FAMILY_MODEL,
        max_tokens: 4_000,
        system: TRIAGE_SYSTEM,
        // Dire ce qu'est un nom, pas raisonner longuement : effort bas.
        output_config: { effort: "low", format: { type: "json_schema", schema: TRIAGE_SCHEMA } },
        messages: [{ role: "user", content: triagePrompt(batch) }],
      });
      usd = haikuCostUsd(response.usage);
      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") lastError = `Analyse IA : réponse interrompue (${response.stop_reason})`;
      else r = await ctx.runMutation(internal.radarAuto.applyTriage, { now, rows: triageAnswer(JSON.parse(response.content.find((b) => b.type === "text")?.text ?? ""), batch) });
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
    await ctx.runMutation(internal.radarSignals.recordRun, { poste: "ai", credits: 0, calls: 1, errors: lastError ? 1 : 0, now, usd, ...(lastError ? { lastError } : {}) });
    return { ...r, usd };
  },
});

/**
 * e2e : trie les mentions et sites dont la clé contient un des `markers`, comme l'aurait fait l'IA. `answer` donne,
 * par CLÉ, ce qu'elle aurait répondu ; la réponse passe par la même validation qu'en vrai (`triageAnswer`).
 */
export const e2eTriageCandidates = e2eMutation({
  args: { markers: v.array(v.string()), answer: v.array(v.object({ key: v.string(), kind: v.string(), name: v.string() })) },
  handler: async (ctx, { markers, answer }) => {
    const batch = await toTriage(ctx, (key) => markers.some((m) => key.includes(m)));
    const idOf = new Map<string, string>();
    for (const t of batch) {
      const c = await ctx.db.get(ctx.db.normalizeId("radarAppCandidates", t.id)!);
      if (c) idOf.set(c.key, t.id);
    }
    const raw = { items: answer.map((a) => ({ id: idOf.get(a.key) ?? "", kind: a.kind, name: a.name })) };
    return applyTriageCore(ctx, triageAnswer(raw, batch), Date.now());
  },
});

/** e2e : ce qu'est devenue l'app suivie depuis une mention, un site ou une liste (motifs, recherches, tournures, essai). */
export const e2eAppRules = e2eMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const a = await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
    return a ? { name: a.name, strong: a.strong, searches: a.searches, not: a.not, trial: a.trialSince !== undefined } : null;
  },
});

// ─── L'import d'une liste (15/11/2026) ───────────────────────────────────────

/** Apps d'une liste écrites par appel : un import se fait en plusieurs appels. */
export const LIST_IMPORT_MAX = 400;

const listItem = v.object({ name: v.string(), category: v.optional(v.string()) });

/**
 * Pose les apps d'une liste comme apps repérées (genre « liste ») : le suivi d'office les prend, 15 par passage, et
 * chacune entre à l'essai. Une app déjà repérée sous la même clé, ou au nom trop court, n'est pas reposée. Les noms
 * viennent de l'appel, jamais du code : la liste n'est pas publiée avec le dépôt.
 */
async function importListCore(ctx: MutationCtx, source: string, items: readonly { name: string; category?: string }[], now: number) {
  if (items.length > LIST_IMPORT_MAX) throw new ConvexError({ code: "LIST_TOO_LONG", message: `${LIST_IMPORT_MAX} apps au plus par appel.` });
  const out = { added: 0, existing: 0, skipped: 0 };
  for (const it of items) {
    const name = it.name.replace(/\s+/g, " ").trim().slice(0, 60);
    const key = listKey(name);
    if (!key) {
      out.skipped++;
      continue;
    }
    if (await ctx.db.query("radarAppCandidates").withIndex("by_key", (q) => q.eq("key", key)).first()) {
      out.existing++;
      continue;
    }
    await ctx.db.insert("radarAppCandidates", {
      key,
      kind: "liste",
      label: name,
      authors: [],
      authorCount: 0,
      fromApps: [],
      examples: [],
      status: "new",
      firstSeenAt: now,
      lastSeenAt: now,
      liste: { source: source.slice(0, 40), ...(it.category ? { category: it.category.slice(0, 60) } : {}) },
    });
    out.added++;
  }
  return out;
}

/**
 * Écarte des apps d'une liste importée, encore proposées : elles ne seront ni suivies ni cherchées (statut « ignorée »,
 * avec la raison). 15/11/2026 : les 132 marques de FarmSpot à 0 vue sur 30 jours (aucune ferme active : chercher leur
 * réseau, c'est payer pour rien). Rend combien ont été écartées, déjà traitées, inconnues.
 */
async function ignoreListCore(ctx: MutationCtx, names: readonly string[], note: string, now: number) {
  if (names.length > LIST_IMPORT_MAX) throw new ConvexError({ code: "LIST_TOO_LONG", message: `${LIST_IMPORT_MAX} apps au plus par appel.` });
  const out = { ignored: 0, settled: 0, unknown: 0 };
  for (const name of names) {
    const key = listKey(name);
    const c = key ? await ctx.db.query("radarAppCandidates").withIndex("by_key", (q) => q.eq("key", key)).first() : null;
    if (!c || c.kind !== "liste") out.unknown++;
    else if (c.status !== "new") out.settled++;
    else {
      await ctx.db.patch(c._id, { status: "ignored", autoAt: now, autoNote: note.slice(0, 120) });
      out.ignored++;
    }
  }
  return out;
}

export const ignoreListCandidates = internalMutation({
  args: { names: v.array(v.string()), note: v.string() },
  handler: (ctx, { names, note }) => ignoreListCore(ctx, names, note, Date.now()),
});

export const e2eIgnoreList = e2eMutation({
  args: { names: v.array(v.string()), note: v.string() },
  handler: (ctx, { names, note }) => ignoreListCore(ctx, names, note, Date.now()),
});

/** À lancer sur la prod avec la liste (`convex-prod.sh run radarAuto:importListCandidates '<json>'`), par lots de 400. */
export const importListCandidates = internalMutation({
  args: { source: v.string(), items: v.array(listItem) },
  handler: (ctx, { source, items }) => importListCore(ctx, source, items, Date.now()),
});

export const e2eImportList = e2eMutation({
  args: { source: v.string(), items: v.array(listItem) },
  handler: (ctx, { source, items }) => importListCore(ctx, source, items, Date.now()),
});

// ─── L'essai (15/11/2026) ────────────────────────────────────────────────────

export const TRIAL_NOTE = "à l'essai : sa recherche décide";
/** Apps repérées relues par appel de la reprise. */
const TRIAL_REQUEUE_SCAN = 200;
/** Apps à l'essai jugées par passage (toutes les heures). */
const TRIAL_SETTLE_BATCH = 60;

/**
 * Une fois : les apps des classements laissées « preuve insuffisante » avant l'essai sont regardées de nouveau (leur
 * `autoAt` effacé) ; celles à deux comptes créateurs entrent à l'essai. Par lots, à chaque passage, jusqu'au bout.
 */
export const requeueTrialCandidates = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const s = await ensureSettings(ctx);
    if (s.trialRequeueDoneAt !== undefined) return 0;
    const r = await ctx.db
      .query("radarAppCandidates")
      .withIndex("by_kind_status_count", (q) => q.eq("kind", "store").eq("status", "new"))
      .paginate({ cursor: s.trialRequeueCursor ?? null, numItems: TRIAL_REQUEUE_SCAN });
    let requeued = 0;
    for (const c of r.page) {
      if (c.autoNote !== "preuve insuffisante") continue;
      await ctx.db.patch(c._id, { autoAt: undefined, autoNote: undefined });
      requeued++;
    }
    await ctx.db.patch(s._id, r.isDone ? { trialRequeueCursor: undefined, trialRequeueDoneAt: Date.now() } : { trialRequeueCursor: r.continueCursor });
    return requeued;
  },
});

/** Juge les apps à l'essai (cf radarAutoMath.trialDecision) : gardées, ou en pause « essai » — leurs comptes ne sont plus relevés. */
/** Une app à l'essai repart de zéro : sa recherche refaite à fond, en tête de file, et son essai recommencé. */
async function relaunchTrial(ctx: MutationCtx, a: Doc<"radarApps">, now: number): Promise<void> {
  // Les refus du plafond appartiennent à la recherche d'avant : la nouvelle part sans eux.
  const ns = { ...(a.networkSearch ?? { requestedAt: now, step: 0, steps: 0, attached: 0, signals: 0 }) };
  delete ns.full;
  await ctx.db.patch(a._id, { networkSearchedAt: undefined, deepSearchedAt: undefined, trialSince: now, networkSearch: ns });
}

/** Le plafond des comptes suivis laisse-t-il de la place à une app non concurrente ? */
async function hasRoom(ctx: MutationCtx): Promise<boolean> {
  const c = await trackedCounts(ctx);
  return c.total < MAX_TRACKED && c.others < MAX_OTHER_TOTAL;
}

async function settleTrialsCore(ctx: MutationCtx, now: number, only?: (slug: string) => boolean): Promise<{ kept: number; paused: number; waiting: number; relaunched: number }> {
  const out = { kept: 0, paused: 0, waiting: 0, relaunched: 0 };
  let room: boolean | undefined;
  const trials = (await ctx.db.query("radarApps").collect()).filter((a) => a.trialSince !== undefined && a.status === "active" && (!only || only(a.slug)));
  // Pas encore cherchée : elle attend sa recherche, sans relire ses comptes. Les autres, les plus anciennement
  // cherchées d'abord, `TRIAL_SETTLE_BATCH` au plus par passage (chacune relit ses comptes).
  const searched = trials.filter((a) => a.networkSearchedAt !== undefined).sort((x, y) => x.networkSearchedAt! - y.networkSearchedAt!);
  out.waiting += trials.length - searched.length;
  for (const a of searched.slice(0, TRIAL_SETTLE_BATCH)) {
    const rows = await ctx.db.query("radarTracked").withIndex("by_app", (q) => q.eq("appId", a._id as Id<"radarApps">)).collect();
    const n = { active: rows.filter((t) => t.status === "active").length, vetting: rows.filter((t) => t.status === "paused" && t.pausedReason === "vetting").length };
    const d = trialDecision(a, n, now);
    if (d === "keep") {
      await ctx.db.patch(a._id, { trialSince: undefined });
      out.kept++;
    } else if (d === "pause") {
      await ctx.db.patch(a._id, { status: "paused", pausedReason: "essai" });
      out.paused++;
    } else if (d === "relaunch") {
      // Relancée seulement s'il y a de la place ; sinon elle attend (jamais mise en pause pour un plafond plein).
      room ??= await hasRoom(ctx);
      if (room) {
        await relaunchTrial(ctx, a, now);
        out.relaunched++;
      } else out.waiting++;
    } else out.waiting++;
  }
  return out;
}

export const settleTrials = internalMutation({
  args: {},
  handler: (ctx) => settleTrialsCore(ctx, Date.now()),
});

/**
 * Une fois (15/11/2026) : les apps à l'essai cherchées depuis `since` sans rien rattacher — le plafond (13 000 comptes
 * d'apps non concurrentes) était plein depuis 22 h 25, mais ces recherches ne le notaient pas encore (`full`) —
 * repartent de zéro. `dryRun` : rien n'est écrit, la liste est rendue.
 * Le 16/11/2026, le plafond était en fait plein depuis 20 h 09 (relevé le 16/11 à 00 h 39, cf #525) : 87 apps cherchées
 * dans l'intervalle n'avaient rien rattaché, dont 68 apps SUIVIES (Tripbff, Lingopanda, Wyndy…) que cette reprise ne
 * regardait pas. `until` borne l'intervalle ; `followed` y ajoute les apps suivies, dont la recherche complète repart
 * (sans toucher à leur statut).
 */
async function relaunchBlockedCore(
  ctx: MutationCtx,
  o: { since: number; until?: number; followed?: boolean; dryRun: boolean },
  only?: (slug: string) => boolean,
) {
  const now = Date.now();
  const hit = (await ctx.db.query("radarApps").collect()).filter(
    (a) =>
      (a.trialSince !== undefined || (o.followed === true && a.rivalOf.length === 0)) &&
      a.status === "active" &&
      a.mergedInto === undefined &&
      (a.networkSearchedAt ?? 0) >= o.since &&
      (o.until === undefined || (a.networkSearchedAt ?? 0) <= o.until) &&
      (a.networkSearch?.attached ?? 0) === 0 &&
      (!only || only(a.slug)),
  );
  if (!o.dryRun) {
    for (const a of hit) {
      if (a.trialSince !== undefined) await relaunchTrial(ctx, a, now);
      else await ctx.db.patch(a._id, { networkSearchedAt: undefined, deepSearchedAt: undefined });
    }
  }
  return { relaunched: o.dryRun ? 0 : hit.length, names: hit.map((a) => a.name) };
}

export const relaunchBlockedTrials = internalMutation({
  args: { since: v.number(), until: v.optional(v.number()), followed: v.optional(v.boolean()), dryRun: v.boolean() },
  handler: (ctx, o) => relaunchBlockedCore(ctx, o),
});

export const e2eRelaunchBlockedTrials = e2eMutation({
  args: { since: v.number(), until: v.optional(v.number()), followed: v.optional(v.boolean()), dryRun: v.boolean(), prefix: v.string() },
  handler: (ctx, { prefix, ...o }) => relaunchBlockedCore(ctx, o, (slug) => slug.startsWith(prefix)),
});

/**
 * Remet en jeu des apps d'une liste (par leur nom) : écartées à tort, ou laissées « motif déjà pris » avant que
 * `shadowNot` sache les séparer. Le 16/11/2026, Clipa était écartée « 0 vue chez FarmSpot » — c'était « Clipa- », un
 * homonyme ; la vraie avait 18 comptes. Elles redeviennent proposées, jamais regardées : le suivi d'office les reprend.
 */
async function reopenListCore(ctx: MutationCtx, names: readonly string[], dryRun: boolean) {
  if (names.length > LIST_IMPORT_MAX) throw new ConvexError({ code: "LIST_TOO_LONG", message: `${LIST_IMPORT_MAX} apps au plus par appel.` });
  const out = { reopened: [] as string[], untouched: [] as string[] };
  for (const name of names) {
    const key = listKey(name);
    const c = key ? await ctx.db.query("radarAppCandidates").withIndex("by_key", (q) => q.eq("key", key)).first() : null;
    if (!c || c.kind !== "liste" || c.status === "followed" || (c.status === "new" && c.autoAt === undefined)) {
      out.untouched.push(name);
      continue;
    }
    if (!dryRun) await ctx.db.patch(c._id, { status: "new", autoAt: undefined, autoNote: undefined });
    out.reopened.push(c.label);
  }
  return out;
}

export const reopenListCandidates = internalMutation({
  args: { names: v.array(v.string()), dryRun: v.boolean() },
  handler: (ctx, { names, dryRun }) => reopenListCore(ctx, names, dryRun),
});

export const e2eReopenList = e2eMutation({
  args: { names: v.array(v.string()), dryRun: v.boolean() },
  handler: (ctx, { names, dryRun }) => reopenListCore(ctx, names, dryRun),
});

/** e2e : pose la dernière recherche d'une app (il y a `searchedAgoMs`, `attached` rattachés, `full` refusés par le plafond). */
export const e2eSetSearchResult = e2eMutation({
  args: { slug: v.string(), searchedAgoMs: v.number(), attached: v.number(), full: v.number() },
  handler: async (ctx, { slug, searchedAgoMs, attached, full }) => {
    const a = await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
    if (!a) return null;
    const at = Date.now() - searchedAgoMs;
    await ctx.db.patch(a._id, {
      networkSearchedAt: at,
      networkSearch: { requestedAt: at, startedAt: at, finishedAt: at, step: 1, steps: 1, attached, signals: 0, outcome: "done", ...(full ? { full } : {}) },
    });
    return null;
  },
});

/** e2e : juge les apps à l'essai dont le slug commence par `prefix`, à l'heure `now` (pour passer les délais). */
export const e2eSettleTrials = e2eMutation({
  args: { prefix: v.string(), now: v.number() },
  handler: (ctx, { prefix, now }) => settleTrialsCore(ctx, now, (slug) => slug.startsWith(prefix)),
});

/** e2e : où en est une app (essai, statut, raison de la pause, date de sa recherche). */
export const e2eTrialState = e2eMutation({
  args: { slug: v.string(), searchedAgoMs: v.optional(v.number()) },
  handler: async (ctx, { slug, searchedAgoMs }) => {
    const a = await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
    if (!a) return null;
    // Simule une recherche faite il y a `searchedAgoMs` (la vraie ne tourne pas en e2e : pas de clé).
    if (searchedAgoMs !== undefined) await ctx.db.patch(a._id, { networkSearchedAt: Date.now() - searchedAgoMs });
    const b = (await ctx.db.get(a._id))!;
    return { trial: b.trialSince !== undefined, status: b.status, pausedReason: b.pausedReason ?? null };
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

// ─── Une app suivie élargie à son nom (16/11/2026) ───────────────────────────

/** Ce qu'on demanderait à l'IA pour élargir ces apps (par slug) : celles que `broadenCore` retient, avec leur nom collé. */
async function broadenBatch(ctx: QueryCtx, slugs: readonly string[]): Promise<AutoToJudge[]> {
  const apps = (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
  const out: AutoToJudge[] = [];
  for (const slug of new Set(slugs)) {
    const a = apps.find((x) => x.slug === slug);
    if (!a || a.status !== "active") continue;
    const core = broadenCore(a, apps.filter((x) => x._id !== a._id));
    if (core) out.push({ id: a._id, name: a.name, what: "app promoted by TikTok creators", patterns: [core] });
  }
  return out;
}

export const broadenToJudge = internalQuery({
  args: { slugs: v.array(v.string()) },
  handler: (ctx, { slugs }) => broadenBatch(ctx, slugs),
});

/**
 * Élargit les apps que l'IA a dites distinctives : leur nom collé rejoint leurs motifs, leurs recherches gagnent leur
 * nom, leur hashtag et « nom app », et leur recherche COMPLÈTE repart (au palier du solde : quand un pack le permet).
 * Revérifié à l'écriture (une app changée entre-temps n'est pas touchée). Ses comptes déjà suivis restent.
 */
async function applyBroadenCore(ctx: MutationCtx, ids: readonly string[], dryRun: boolean): Promise<{ name: string; motif: string }[]> {
  const apps = (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
  const out: { name: string; motif: string }[] = [];
  for (const id of new Set(ids)) {
    const a = apps.find((x) => x._id === id);
    if (!a || a.status !== "active") continue;
    const core = broadenCore(a, apps.filter((x) => x._id !== a._id));
    if (!core) continue;
    const rule = broadenedRule(a, core);
    if (!dryRun) await ctx.db.patch(a._id, { strong: rule.strong, searches: rule.searches, networkSearchedAt: undefined, deepSearchedAt: undefined });
    out.push({ name: a.name, motif: core });
  }
  return out;
}

export const applyBroaden = internalMutation({
  args: { ids: v.array(v.string()), dryRun: v.boolean() },
  handler: (ctx, { ids, dryRun }) => applyBroadenCore(ctx, ids, dryRun),
});

/**
 * À lancer sur la prod, une fois, avec les apps à élargir (`convex-prod.sh run radarAuto:broadenAppNames '{"slugs":
 * [...],"dryRun":true}'`). L'IA (Claude Haiku, le juge du suivi d'office) dit chaque nom distinctif ou courant ; seuls
 * les distinctifs changent. Rend ce qui a été (ou serait) élargi, et ce qui reste tel quel.
 */
export const broadenAppNames = internalAction({
  args: { slugs: v.array(v.string()), dryRun: v.boolean() },
  handler: async (ctx, { slugs, dryRun }): Promise<{ skipped: "no-key" } | { broadened: { name: string; motif: string }[]; common: string[]; unjudged: string[]; usd: number }> => {
    if (!process.env.ANTHROPIC_API_KEY) return { skipped: "no-key" };
    const now = Date.now();
    const batch: AutoToJudge[] = await ctx.runQuery(internal.radarAuto.broadenToJudge, { slugs });
    const verdicts: AutoVerdict[] = [];
    let usd = 0;
    let errors = 0;
    for (let i = 0; i < batch.length; i += TRIAGE_BATCH) {
      const part = batch.slice(i, i + TRIAGE_BATCH);
      try {
        const response = await new Anthropic().messages.create({
          model: FAMILY_MODEL,
          max_tokens: 3_000,
          system: AUTO_SYSTEM,
          output_config: { effort: "low", format: { type: "json_schema", schema: AUTO_SCHEMA } },
          messages: [{ role: "user", content: autoPrompt(part) }],
        });
        usd += haikuCostUsd(response.usage);
        if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") errors++;
        else verdicts.push(...autoAnswer(JSON.parse(response.content.find((b) => b.type === "text")?.text ?? ""), part));
      } catch {
        errors++;
      }
    }
    if (batch.length) await ctx.runMutation(internal.radarSignals.recordRun, { poste: "ai", credits: 0, calls: Math.ceil(batch.length / TRIAGE_BATCH), errors, now, usd });
    const name = (id: string) => batch.find((b) => b.id === id)?.name ?? id;
    const broadened: { name: string; motif: string }[] = await ctx.runMutation(internal.radarAuto.applyBroaden, {
      ids: verdicts.filter((x) => !x.common).map((x) => x.id),
      dryRun,
    });
    return {
      broadened,
      common: verdicts.filter((x) => x.common).map((x) => name(x.id)),
      unjudged: batch.filter((b) => !verdicts.some((x) => x.id === b.id)).map((b) => b.name),
      usd,
    };
  },
});

// ─── e2e ─────────────────────────────────────────────────────────────────────

/** e2e : l'élargissement sans IA — `common` : les slugs qu'elle aurait dits courants ; les autres, distinctifs. */
export const e2eBroaden = e2eMutation({
  args: { slugs: v.array(v.string()), common: v.array(v.string()), dryRun: v.boolean() },
  handler: async (ctx, { slugs, common, dryRun }) => {
    const batch = await broadenBatch(ctx, slugs);
    const apps = await Promise.all(batch.map((b) => ctx.db.get(b.id as Id<"radarApps">)));
    const distinctive = batch.filter((_, i) => !common.includes(apps[i]?.slug ?? "")).map((b) => b.id);
    return applyBroadenCore(ctx, distinctive, dryRun);
  },
});

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
