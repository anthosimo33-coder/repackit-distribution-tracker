/**
 * RADAR — LE FILTRE D'ENTRÉE des comptes (règles : convex/radarVetMath). Un compte trouvé par une recherche est
 * rangé « en attente » : ni relevé, ni montré. Toutes les 5 minutes, les comptes en attente sont lus sur leur page
 * publique, un à la fois avec une pause (le rythme des contrôles des classements, que TikTok sert à nos serveurs) :
 *  - prouvé (pseudo, bio, ou au moins deux vidéos qui citent l'app) : il entre, son premier relevé part ;
 *  - non prouvé : il n'entre pas, et n'est pas revérifié pour cette app avant 30 jours ;
 *  - page illisible pour ce compte, ou jamais servie en 6 heures : il entre, et son premier relevé le juge.
 * Gratuit : aucun crédit. Sans la clé du fournisseur de données (tests, intégration continue), rien ne tourne.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { e2eMutation } from "./functions";
import type { AppRule } from "./radarNetworkMath";
import { refreshAppNet } from "./radarSignals";
import { fetchEmbedPage, profileEmbedUrl, storePauseMs } from "./radarStoreMath";
import { VET_APPLY_BATCH, VET_BREAKER, VET_MAX_MS, VET_PER_RUN, vetOutcome, waitedTooLong, type VetOutcome, type VetPage } from "./radarVetMath";
import { scKeyPresent } from "./scrapeCreatorsApi";

type Queued = { id: Id<"radarTracked">; handle: string; queuedAt: number; rule: AppRule };

/** Les comptes en attente, les plus anciens d'abord, chacun avec les motifs de son app. */
async function vetQueueCore(ctx: QueryCtx, limit: number, only?: (handle: string) => boolean): Promise<Queued[]> {
  const rows = (
    await ctx.db
      .query("radarTracked")
      .withIndex("by_paused", (q) => q.eq("pausedReason", "vetting"))
      .take(only ? 2_000 : limit)
  )
    .filter((t) => !only || only(t.handle))
    .slice(0, limit);
  const apps = new Map<string, Doc<"radarApps"> | null>();
  const out: Queued[] = [];
  for (const t of rows) {
    if (!apps.has(t.appId)) apps.set(t.appId, await ctx.db.get(t.appId));
    const app = apps.get(t.appId);
    if (!app) continue;
    out.push({ id: t._id, handle: t.handle, queuedAt: t.vetAt ?? t.nextReadAt, rule: { strong: app.strong, weak: app.weak, context: app.context, ...(app.not ? { not: app.not } : {}) } });
  }
  return out;
}

export const vetQueue = internalQuery({
  args: { limit: v.number() },
  handler: (ctx, { limit }): Promise<Queued[]> => vetQueueCore(ctx, limit),
});

const verdictValidator = v.object({
  id: v.id("radarTracked"),
  kind: v.union(v.literal("proven"), v.literal("unproven"), v.literal("paid")),
  fans: v.optional(v.number()),
  bio: v.optional(v.string()),
});
type Verdict = { id: Id<"radarTracked">; kind: "proven" | "unproven" | "paid"; fans?: number; bio?: string };
type VetCounts = { proven: number; rejected: number; paid: number };

/**
 * Écrit les verdicts. Prouvé : le compte devient actif, son premier relevé est dû. Non prouvé : un compte jamais
 * relevé est retiré (et noté écarté pour cette app) ; un compte qui a déjà des vidéos rangées — revérifié après
 * coup — passe en pause « hors sujet », son histoire reste. « paid » : il entre sans preuve, son premier relevé le juge.
 */
async function applyVetsCore(ctx: MutationCtx, verdicts: readonly Verdict[], now: number): Promise<VetCounts> {
  const counts: VetCounts = { proven: 0, rejected: 0, paid: 0 };
  const touched = new Map<Id<"radarApps">, number>();
  for (const x of verdicts) {
    const acc = await ctx.db.get(x.id);
    if (!acc || acc.pausedReason !== "vetting") continue;
    if (x.kind === "unproven") {
      if (acc.readAt === undefined) {
        await ctx.db.delete(acc._id);
        await ctx.db.insert("radarRejected", { handle: acc.handle, appId: acc.appId, at: now });
        touched.set(acc.appId, (touched.get(acc.appId) ?? 0) + 1);
      } else {
        await ctx.db.patch(acc._id, { pausedReason: "offTopic", vetAt: undefined });
        touched.set(acc.appId, touched.get(acc.appId) ?? 0);
      }
      counts.rejected++;
      continue;
    }
    await ctx.db.patch(acc._id, {
      status: "active",
      pausedReason: undefined,
      vetAt: undefined,
      // Relevé tout de suite s'il ne l'a jamais été ; sinon à son rythme, comme avant sa vérification : son
      // prochain relevé n'a pas bougé pendant l'attente.
      ...(acc.readAt === undefined ? { nextReadAt: now } : {}),
      ...(x.kind === "proven" ? { proofAt: now } : {}),
      ...(x.fans !== undefined && x.fans > 0 ? { fans: x.fans } : {}),
      ...(x.bio ? { bio: x.bio } : {}),
    });
    touched.set(acc.appId, touched.get(acc.appId) ?? 0);
    counts[x.kind === "proven" ? "proven" : "paid"]++;
  }
  for (const [appId, removed] of touched) {
    const app = await ctx.db.get(appId);
    if (!app) continue;
    if (removed > 0 && app.trackedCount !== undefined) await ctx.db.patch(appId, { trackedCount: Math.max(0, app.trackedCount - removed) });
    await refreshAppNet(ctx, appId, now);
  }
  return counts;
}

export const applyVets = internalMutation({
  args: { verdicts: v.array(verdictValidator), now: v.number() },
  handler: (ctx, { verdicts, now }): Promise<VetCounts> => applyVetsCore(ctx, verdicts, now),
});

const toVerdict = (id: Id<"radarTracked">, o: Exclude<VetOutcome, { kind: "retry" }>): Verdict =>
  o.kind === "proven" ? { id, kind: "proven", fans: o.fans, bio: o.bio } : { id, kind: o.kind };

type VetRun = { skipped: "no-key" } | (VetCounts & { waiting: number; stopped: string | null });

export const runVetting = internalAction({
  args: {},
  handler: async (ctx): Promise<VetRun> => {
    if (!scKeyPresent()) return { skipped: "no-key" };
    const started = Date.now();
    const queue: Queued[] = await ctx.runQuery(internal.radarVet.vetQueue, { limit: VET_PER_RUN });
    const total: VetCounts = { proven: 0, rejected: 0, paid: 0 };
    let pending: Verdict[] = [];
    let waiting = 0;
    let suspects = 0;
    let stopped: string | null = null;
    const flush = async () => {
      if (pending.length === 0) return;
      const r: VetCounts = await ctx.runMutation(internal.radarVet.applyVets, { verdicts: pending, now: Date.now() });
      total.proven += r.proven;
      total.rejected += r.rejected;
      total.paid += r.paid;
      pending = [];
    };
    for (const [i, acc] of queue.entries()) {
      if (Date.now() - started >= VET_MAX_MS) break;
      if (i > 0) await new Promise<void>((done) => setTimeout(done, storePauseMs(Math.random())));
      const r = await fetchEmbedPage(profileEmbedUrl(acc.handle));
      const page: VetPage = r.kind === "ok" ? { ok: true, text: r.text } : { ok: false, kind: r.kind };
      const o = vetOutcome(page, acc.handle, acc.rule);
      if (o.kind === "retry") {
        // Refusé : il attend le passage suivant — sauf s'il attend depuis 6 heures, auquel cas son premier relevé jugera.
        suspects++;
        if (waitedTooLong(acc.queuedAt, Date.now())) pending.push({ id: acc.id, kind: "paid" });
        else waiting++;
        if (suspects >= VET_BREAKER) {
          stopped = `${VET_BREAKER} pages refusées d'affilée${r.kind === "suspect" ? ` (${r.reason})` : ""}`;
          break;
        }
      } else {
        suspects = 0;
        pending.push(toVerdict(acc.id, o));
      }
      if (pending.length >= VET_APPLY_BATCH) await flush();
    }
    await flush();
    // Les comptes entrés sont relevés tout de suite.
    if (total.proven + total.paid > 0) await ctx.scheduler.runAfter(0, internal.radarNetworks.runAccountReads, {});
    return { ...total, waiting, stopped };
  },
});

// ─── Revérifier des comptes déjà entrés ──────────────────────────────────────

const REQUEUE_BATCH = 400;

/** À revérifier : actif, rattaché par une légende, jamais prouvé, pas gardé à la main. */
const toRequeue = (t: Doc<"radarTracked">, since: number): boolean =>
  t.status === "active" && t.matchedBy === "caption" && !t.keptByHand && t.proofAt === undefined && t.addedAt >= since;

/**
 * La mise en attente d'un compte déjà entré. Son prochain relevé (`nextReadAt`) n'est PAS touché : prouvé, il reprend
 * son rythme — sinon des milliers de comptes seraient dus d'un coup à leur sortie, et relevés en payant.
 */
const requeued = (now: number) => ({ status: "paused" as const, pausedReason: "vetting" as const, vetAt: now });

/**
 * Remet en attente du filtre d'entrée les comptes ACTIFS rattachés par une légende et jamais prouvés, ajoutés
 * depuis `since` (0 : tous) — par lots, se relance jusqu'au bout. Pendant l'attente ils ne sont ni relevés ni
 * montrés ; prouvés, ils reprennent comme avant ; non prouvés, ils sont retirés (jamais relevés) ou mis en pause
 * « hors sujet » (déjà relevés, leur histoire reste). `dryRun` : ne rien écrire, rendre combien. À lancer à la main.
 */
export const requeueVetting = internalMutation({
  args: { dryRun: v.boolean(), since: v.number(), after: v.optional(v.number()), sofar: v.optional(v.number()) },
  handler: async (ctx, { dryRun, since, after, sofar }): Promise<{ queued: number; done: boolean }> => {
    const now = Date.now();
    const rows = await ctx.db
      .query("radarTracked")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", after ?? 0))
      .take(REQUEUE_BATCH);
    let queued = sofar ?? 0;
    for (const t of rows) {
      if (!toRequeue(t, since)) continue;
      if (!dryRun) await ctx.db.patch(t._id, requeued(now));
      queued++;
    }
    const done = rows.length < REQUEUE_BATCH;
    if (!done) {
      const next = { dryRun, since, after: rows[rows.length - 1]._creationTime, sofar: queued };
      // À blanc, tout se compte dans cet appel (lecture seule) ; pour de bon, la suite part en tâche de fond.
      if (dryRun) return ctx.runMutation(internal.radarVet.requeueVetting, next);
      await ctx.scheduler.runAfter(0, internal.radarVet.requeueVetting, next);
    } else if (!dryRun && queued > 0) {
      // Le résumé de chaque réseau (comptes relevés) suit tout de suite, sans attendre la tâche de l'heure.
      await ctx.scheduler.runAfter(0, internal.radarNetworks.refreshAppNets, {});
    }
    return { queued, done };
  },
});

// ─── e2e ─────────────────────────────────────────────────────────────────────

/**
 * e2e : un passage du filtre sur les comptes en attente dont le pseudo contient `marker`, avec les pages données ici
 * (ce que TikTok aurait servi : une page absente de la liste « n'existe pas », une page `refused` est refusée).
 * `waited` : fait comme si ces comptes attendaient depuis plus de 6 heures.
 */
export const e2eVet = e2eMutation({
  args: { marker: v.string(), pages: v.array(v.object({ handle: v.string(), html: v.optional(v.string()), refused: v.optional(v.boolean()) })), waited: v.optional(v.boolean()) },
  handler: async (ctx, { marker, pages, waited }): Promise<VetCounts & { waiting: number }> => {
    const now = Date.now();
    const queue = await vetQueueCore(ctx, VET_PER_RUN, (handle) => handle.includes(marker));
    const verdicts: Verdict[] = [];
    let waiting = 0;
    for (const acc of queue) {
      const p = pages.find((x) => x.handle === acc.handle);
      const page: VetPage = !p ? { ok: false, kind: "absent" } : p.refused ? { ok: false, kind: "suspect" } : { ok: true, text: p.html ?? "" };
      const o = vetOutcome(page, acc.handle, acc.rule);
      if (o.kind !== "retry") verdicts.push(toVerdict(acc.id, o));
      else if (waited) verdicts.push({ id: acc.id, kind: "paid" });
      else waiting++;
    }
    return { ...(await applyVetsCore(ctx, verdicts, now)), waiting };
  },
});

/** e2e : remet en attente les comptes actifs jamais prouvés dont le pseudo contient `marker` (la revérification). */
export const e2eRequeueVetting = e2eMutation({
  args: { marker: v.string() },
  handler: async (ctx, { marker }): Promise<number> => {
    const now = Date.now();
    let n = 0;
    const touched = new Set<Id<"radarApps">>();
    for (const t of await ctx.db.query("radarTracked").withIndex("by_due", (q) => q.eq("status", "active")).take(8_000)) {
      if (!t.handle.includes(marker) || !toRequeue(t, 0)) continue;
      await ctx.db.patch(t._id, requeued(now));
      touched.add(t.appId);
      n++;
    }
    for (const appId of touched) await refreshAppNet(ctx, appId, now);
    return n;
  },
});

/** e2e : les comptes ACTIFS dont le pseudo contient `marker` et dont un relevé est dû maintenant. */
export const e2eDue = e2eMutation({
  args: { marker: v.string() },
  handler: async (ctx, { marker }): Promise<string[]> => {
    const now = Date.now();
    const rows = await ctx.db
      .query("radarTracked")
      .withIndex("by_due", (q) => q.eq("status", "active").lte("nextReadAt", now))
      .take(8_000);
    return rows
      .filter((t) => t.handle.includes(marker))
      .map((t) => t.handle)
      .sort();
  },
});
