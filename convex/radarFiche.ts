/**
 * RADAR — LA FICHE D'UNE APP SUIVIE (règles : convex/radarFicheMath). Toutes les 30 minutes :
 *  1. les apps repérées devenues des apps suivies sont reliées à leur app, qui reçoit leur fiche App Store ou ce que
 *     leurs campagnes paient (les apps suivies à partir du 13/11/2026 la reçoivent dès leur entrée) ;
 *  2. les apps sans niche partent chez Claude Haiku, vingt par appel, avec ce qu'on sait d'elles ; il rend leur niche
 *     et ce qu'elles font en une phrase. Payé sur le poste « Analyse IA » du budget du Radar.
 * Sans la clé du fournisseur de données ni ANTHROPIC_API_KEY (tests, intégration continue), rien ne part.
 */
import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { e2eMutation } from "./functions";
import { FAMILY_MODEL, haikuCostUsd } from "./radarFamiliesMath";
import {
  candidateFiche,
  ficheApp,
  NICHE_BATCH,
  NICHE_BIOS_MAX,
  NICHE_SCHEMA,
  NICHE_SYSTEM,
  NICHES,
  nicheAnswer,
  nicheDue,
  nicheEvidence,
  nichePrompt,
  nicheTexts,
  nicheToWrite,
  type NicheAnswer,
  type NicheToJudge,
} from "./radarFicheMath";
import { allowanceUsd, budgetState } from "./radarSignalsMath";
import { scKeyPresent } from "./scrapeCreatorsApi";

/** Sous ce reste d'enveloppe, on n'appelle pas (un appel coûte moins d'un cent). */
const MIN_ALLOWANCE_USD = 0.01;
/** Apps repérées reliées par passage et par source. */
const LINK_BATCH = 100;
/** Apps regardées par passage pour savoir si leur fiche est à demander. */
const WORK_SCAN = 60;
/** Comptes lus par app pour savoir ce que ses créateurs écrivent, et vidéos lues par compte. */
const ACCOUNTS_READ = 40;
const ACCOUNTS_QUOTED = 6;
const VIDEOS_PER_ACCOUNT = 3;

// ─── 1. La fiche recopiée de l'app repérée ───────────────────────────────────

/** Relie une app repérée à l'app suivie qu'elle est devenue, et y recopie sa fiche (App Store, campagne). */
export async function linkCandidate(ctx: MutationCtx, c: Doc<"radarAppCandidates">, appId: Id<"radarApps">, now: number): Promise<void> {
  const fiche = candidateFiche(c);
  if (fiche.store || fiche.market) await ctx.db.patch(appId, fiche);
  await ctx.db.patch(c._id, { appId, ficheAt: now });
}

/**
 * Les apps repérées déjà « suivies » sans lien vers leur app (suivies avant le 13/11/2026, ou reconnues « déjà
 * suivies ») : l'app est retrouvée par ses motifs, sinon par son nom (radarFicheMath.ficheApp). Introuvable (nom
 * et motifs changés à la main) : l'app repérée est marquée vue, pour ne pas la rechercher à chaque passage.
 */
async function syncFichesCore(ctx: MutationCtx, now: number, only?: (key: string) => boolean): Promise<{ linked: number; lost: number }> {
  let linked = 0;
  let lost = 0;
  let apps: Doc<"radarApps">[] | null = null;
  for (const kind of ["store", "market"] as const) {
    const rows = (
      await ctx.db
        .query("radarAppCandidates")
        .withIndex("by_kind_status_count", (q) => q.eq("kind", kind).eq("status", "followed"))
        .order("desc")
        .take(600)
    )
      .filter((c) => c.ficheAt === undefined && (!only || only(c.key)))
      .slice(0, LINK_BATCH);
    for (const c of rows) {
      let appId = c.appId;
      if (!appId) {
        apps ??= (await ctx.db.query("radarApps").collect()).filter((a) => a.mergedInto === undefined);
        appId = ficheApp(c, apps)?._id;
      }
      if (appId && (await ctx.db.get(appId))) {
        await linkCandidate(ctx, c, appId, now);
        linked++;
      } else {
        await ctx.db.patch(c._id, { ficheAt: now });
        lost++;
      }
    }
  }
  return { linked, lost };
}

export const syncFiches = internalMutation({
  args: { now: v.number() },
  handler: (ctx, { now }): Promise<{ linked: number; lost: number }> => syncFichesCore(ctx, now),
});

// ─── 2. La niche et la phrase ────────────────────────────────────────────────

/** Ce qu'on sait d'une app, à donner à lire : sa fiche, et ce que ses comptes les plus en vue écrivent. */
async function evidenceOf(ctx: QueryCtx, app: Doc<"radarApps">): Promise<NicheToJudge> {
  const accounts = (await ctx.db.query("radarTracked").withIndex("by_app", (q) => q.eq("appId", app._id)).take(ACCOUNTS_READ)).sort(
    (a, b) => (b.best7d?.views ?? 0) - (a.best7d?.views ?? 0) || (b.medianViews ?? 0) - (a.medianViews ?? 0),
  );
  const texts: (string | undefined)[] = [];
  for (const acc of accounts.slice(0, ACCOUNTS_QUOTED)) {
    const videos = await ctx.db
      .query("radarTrackedVideos")
      .withIndex("by_account_published", (q) => q.eq("accountId", acc._id))
      .order("desc")
      .take(VIDEOS_PER_ACCOUNT);
    // Le texte à l'écran dit le mieux ce que la vidéo vend ; à défaut, la légende.
    for (const x of videos) texts.push(x.hook, x.caption);
  }
  return {
    id: app._id,
    name: app.name,
    searches: app.searches,
    ...(app.store ? { store: { genre: app.store.genre, artist: app.store.artist } } : {}),
    ...(app.market ? { market: { productKind: app.market.productKind, ...(app.market.about ? { about: app.market.about } : {}) } } : {}),
    texts: nicheTexts(texts),
    bios: nicheTexts(accounts.map((a) => a.bio), NICHE_BIOS_MAX),
  };
}

/** Les apps dont la fiche est à demander : jamais demandée d'abord, puis celles dont l'IA n'avait pas su dire. */
async function ficheWorkCore(ctx: QueryCtx, now: number, limit: number, only?: (slug: string) => boolean): Promise<NicheToJudge[]> {
  const apps = (await ctx.db.query("radarApps").collect())
    .filter((a) => a.mergedInto === undefined && (!only || only(a.slug)))
    .filter((a) => a.nicheAt === undefined || nicheDue(a, 0, now))
    .sort((a, b) => (a.nicheAt ?? 0) - (b.nicheAt ?? 0) || a.createdAt - b.createdAt)
    .slice(0, WORK_SCAN);
  const out: NicheToJudge[] = [];
  for (const app of apps) {
    if (out.length >= limit) break;
    const e = await evidenceOf(ctx, app);
    if (nicheDue(app, nicheEvidence(e), now)) out.push(e);
  }
  return out;
}

export const ficheWork = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: (ctx, { now, limit }): Promise<NicheToJudge[]> => ficheWorkCore(ctx, now, limit),
});

const answerValidator = v.object({ id: v.string(), niche: v.union(...NICHES.map((n) => v.literal(n))), pitch: v.string() });

/** Écrit la niche et la phrase de chaque app ; la niche posée à la main fait foi. */
async function applyNichesCore(ctx: MutationCtx, answers: readonly NicheAnswer[], now: number): Promise<number> {
  let written = 0;
  for (const a of answers) {
    const id = ctx.db.normalizeId("radarApps", a.id);
    const app = id ? await ctx.db.get(id) : null;
    if (!app) continue;
    const w = nicheToWrite(app.name, a);
    // Redemandée sans réponse utile : la phrase déjà écrite reste.
    await ctx.db.patch(app._id, { niche: w.niche, nicheBy: w.nicheBy, nicheAt: now, ...(w.pitch ? { pitch: w.pitch } : {}) });
    written++;
  }
  return written;
}

export const applyNiches = internalMutation({
  args: { answers: v.array(answerValidator), now: v.number() },
  handler: (ctx, { answers, now }): Promise<number> => applyNichesCore(ctx, answers, now),
});

type FicheRun = { skipped: "no-key" } | { linked: number; lost: number; judged: number; usd: number; note?: "budget" | "rien" | "no-ai-key" };

export const runFiches = internalAction({
  args: {},
  handler: async (ctx): Promise<FicheRun> => {
    // Sans la clé du fournisseur de données (tests, intégration continue), rien ne s'écrit tout seul.
    if (!scKeyPresent()) return { skipped: "no-key" };
    const now = Date.now();
    const sync: { linked: number; lost: number } = await ctx.runMutation(internal.radarFiche.syncFiches, { now });
    if (!process.env.ANTHROPIC_API_KEY) return { ...sync, judged: 0, usd: 0, note: "no-ai-key" };
    const st = await ctx.runQuery(internal.radarSignals.jobState, { now });
    if (allowanceUsd(st.budget, budgetState(st.budget, st.usage), "ai") < MIN_ALLOWANCE_USD) return { ...sync, judged: 0, usd: 0, note: "budget" };
    const batch: NicheToJudge[] = await ctx.runQuery(internal.radarFiche.ficheWork, { now, limit: NICHE_BATCH });
    if (batch.length === 0) return { ...sync, judged: 0, usd: 0, note: "rien" };

    const client = new Anthropic();
    let usd = 0;
    let judged = 0;
    let lastError: string | undefined;
    try {
      const response = await client.messages.create({
        model: FAMILY_MODEL,
        max_tokens: 6_000,
        system: NICHE_SYSTEM,
        // Ranger et résumer, pas raisonner longuement : effort bas.
        output_config: { effort: "low", format: { type: "json_schema", schema: NICHE_SCHEMA } },
        messages: [{ role: "user", content: nichePrompt(batch) }],
      });
      usd = haikuCostUsd(response.usage);
      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
        lastError = `Analyse IA : réponse interrompue (${response.stop_reason})`;
      } else {
        const text = response.content.find((b) => b.type === "text")?.text ?? "";
        judged = await ctx.runMutation(internal.radarFiche.applyNiches, { answers: nicheAnswer(JSON.parse(text), batch), now });
      }
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
    return { ...sync, judged, usd };
  },
});

// ─── e2e ─────────────────────────────────────────────────────────────────────

/** e2e : relie les apps repérées suivies dont la clé contient un de ces marqueurs (la tâche ne tourne pas sans clé). */
export const e2eSyncFiches = e2eMutation({
  args: { markers: v.array(v.string()) },
  handler: (ctx, { markers }): Promise<{ linked: number; lost: number }> => syncFichesCore(ctx, Date.now(), (key) => markers.some((m) => key.includes(m))),
});

/**
 * e2e : ce que la tâche donnerait à lire à l'IA pour ces apps, puis la réponse donnée ici écrite comme la sienne
 * (`answers` par slug d'app ; l'appel à l'IA lui-même n'est pas joué).
 */
export const e2eJudgeNiches = e2eMutation({
  args: { slugs: v.array(v.string()), answers: v.array(v.object({ slug: v.string(), niche: v.string(), pitch: v.string() })) },
  handler: async (ctx, { slugs, answers }) => {
    const now = Date.now();
    const batch = await ficheWorkCore(ctx, now, NICHE_BATCH, (slug) => slugs.includes(slug));
    const idOf = new Map<string, string>();
    for (const slug of slugs) {
      const app = await ctx.db.query("radarApps").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
      if (app) idOf.set(slug, app._id);
    }
    const raw = { products: answers.map((a) => ({ id: idOf.get(a.slug) ?? a.slug, niche: a.niche, pitch: a.pitch })) };
    const written = await applyNichesCore(ctx, nicheAnswer(raw, batch), now);
    return { asked: batch.map((b) => ({ name: b.name, texts: b.texts, bios: b.bios, store: b.store ?? null, market: b.market ?? null })), prompt: nichePrompt(batch), written };
  },
});
