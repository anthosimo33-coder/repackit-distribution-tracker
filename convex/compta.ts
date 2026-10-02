import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { e2eMutation, permissionMutation, permissionQuery } from "./functions";
import { fetchWhopLedger, type NormalizedLedgerLine } from "./whopLedgerApi";
import { cellNum, cellStr, runHogQL } from "./posthogApi";
import { projectFx } from "./whopRevenue";
import { monthKeyParis, parisMonthEndMs } from "./dateFr";
import { err, ERR } from "./errorCodes";
import {
  aggregateLedgerDays,
  balanceByCurrency,
  buildComptaFx,
  bucketOf,
  convert,
  creatorCashOuts,
  creatorsControl,
  grossByDay,
  isBuiltinLineType,
  isChargeCategory,
  isComptaBucket,
  isFailedWithdrawal,
  isScanPaidLow,
  isValidLineType,
  ledgerTotals,
  parisDayKey,
  plannedOccurrences,
  previousMonthKey,
  rateOf,
  referenceCurrency,
  round2,
  scanCostUsd,
  thresholdView,
  totalsByType,
  transferPartsError,
  transferPartsOf,
  type ComptaBucket,
  type ComptaFx,
  type LedgerDayCell,
  type LineRules,
  type ScanMonth,
} from "./comptaMath";

/**
 * COMPTA — l'onglet comptable d'un projet relié à Whop (Snytch).
 *
 * Revenus : le GRAND LIVRE Whop (GET /financial_activity), importé ligne à ligne
 * dans `whopLedgerLines`, réduit par mois dans `comptaMonths.days`. Charges :
 * paie créatrices VERSÉE (table `payments`, au jour du virement), coût des scans
 * (PostHog `cost_usd`, figé à la clôture du mois), autres charges saisies à la
 * main (`comptaCharges`). Résultat = net Whop − créatrices − scans − autres.
 *
 * Tout passe dans la devise de RÉFÉRENCE du projet (celle du revenu) au taux du
 * projet (`projectFx`). Une devise sans taux n'est jamais additionnée : elle est
 * mise de côté, et l'écran le dit.
 *
 * Gardé par `business.read` — l'écran EST le compte d'exploitation, qui est la
 * définition de ce bloc (cf convex/permissions.ts).
 */

const DAY = 86_400_000;
/** L'import horaire repart 3 jours avant la dernière écriture vue. */
const LEDGER_OVERLAP_MS = 3 * DAY;
/** Un mois de scans est figé deux jours après sa fin (événements tardifs). */
const SCAN_FREEZE_DELAY_MS = 2 * DAY;
const INSERT_CHUNK = 200;
const MAX_EXPORT_LOG = 300;

// ─── Contexte commun des lectures ────────────────────────────────────────────

type ComptaContext = {
  project: Doc<"projects">;
  state: Doc<"comptaState"> | null;
  fx: ComptaFx;
  rules: LineRules;
};

async function readState(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<Doc<"comptaState"> | null> {
  return ctx.db
    .query("comptaState")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first();
}

function rulesOf(state: Doc<"comptaState"> | null): LineRules {
  const out: Record<string, ComptaBucket> = {};
  for (const r of state?.rules ?? []) if (isComptaBucket(r.bucket)) out[r.lineType] = r.bucket;
  return out;
}

async function loadContext(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  months: Doc<"comptaMonths">[],
): Promise<ComptaContext> {
  const project = (await ctx.db.get(projectId))!;
  const state = await readState(ctx, projectId);
  const conversions = projectFx(project);
  const seen = new Set<string>(state?.referenceCurrency ? [state.referenceCurrency] : []);
  for (const m of months) for (const c of m.days) seen.add(c.currency);
  // La devise de référence est recalculée à la LECTURE (un taux posé change la
  // cible) ; celle mémorisée à l'import porte les devises encaissées hors grand
  // livre (paiements Whop), sans quoi un grand livre tenu en dollars n'aurait
  // aucune devise « sans taux ».
  const target = referenceCurrency(seen, conversions) ?? state?.referenceCurrency ?? null;
  return { project, state, fx: buildComptaFx(target, conversions), rules: rulesOf(state) };
}

async function allMonths(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<Doc<"comptaMonths">[]> {
  return ctx.db
    .query("comptaMonths")
    .withIndex("by_project_month", (q) => q.eq("projectId", projectId))
    .collect();
}

function monthBounds(month: string): { start: number; end: number } {
  return { start: parisMonthEndMs(previousMonthKey(month)), end: parisMonthEndMs(month) };
}

// ─── Créatrices : décaissements ─────────────────────────────────────────────

type CreatorOut = {
  at: number;
  month: string;
  day: string;
  amount: number;
  kind: "advance" | "settlement";
  creatorId: Id<"creators">;
  period: string;
};

async function creatorOuts(ctx: QueryCtx, projectId: Id<"projects">): Promise<CreatorOut[]> {
  const rows = await ctx.db
    .query("payments")
    .withIndex("by_project_period", (q) => q.eq("projectId", projectId))
    .collect();
  const out: CreatorOut[] = [];
  for (const r of rows) {
    for (const c of creatorCashOuts(r)) {
      out.push({
        ...c,
        month: monthKeyParis(c.at),
        day: parisDayKey(c.at),
        creatorId: r.creatorId,
        period: r.period,
      });
    }
  }
  return out;
}

// ─── Autres charges : saisies + prévues ─────────────────────────────────────

type ChargeView = {
  id: string;
  chargeId: Id<"comptaCharges"> | null;
  sourceId: Id<"comptaCharges">;
  day: string;
  month: string;
  label: string;
  category: string;
  amount: number;
  currency: string;
  recurring: boolean;
  planned: boolean;
  /** Dernière charge saisie d'une série « chaque mois » : la supprimer arrête la série. */
  seriesTail: boolean;
  /** Charge née de la ventilation d'un virement : elle se modifie depuis lui. */
  transferLineId: Id<"whopLedgerLines"> | null;
};

async function chargesOf(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  currentMonth: string,
): Promise<ChargeView[]> {
  const docs = await ctx.db
    .query("comptaCharges")
    .withIndex("by_project_month", (q) => q.eq("projectId", projectId))
    .collect();
  const like = docs.map((d) => ({
    id: d._id as string,
    seriesId: (d.seriesId ?? d._id) as string,
    day: d.day,
    recurring: d.recurring,
    doc: d,
  }));
  // Dernière charge saisie de chaque série : c'est elle qui décide si la série
  // continue (cf plannedOccurrences).
  const tails = new Map<string, { id: string; day: string }>();
  for (const c of like) {
    const cur = tails.get(c.seriesId);
    if (cur === undefined || c.day > cur.day) tails.set(c.seriesId, { id: c.id, day: c.day });
  }
  const real: ChargeView[] = like.map((c) => ({
    id: c.id,
    chargeId: c.doc._id,
    sourceId: c.doc._id,
    day: c.day,
    month: c.doc.month,
    label: c.doc.label,
    category: c.doc.category,
    amount: c.doc.amount,
    currency: c.doc.currency,
    recurring: c.recurring,
    planned: false,
    seriesTail: tails.get(c.seriesId)?.id === c.id && c.recurring,
    transferLineId: c.doc.transferLineId ?? null,
  }));
  const planned: ChargeView[] = plannedOccurrences(like, currentMonth).map((p) => ({
    id: `planned:${p.source.id}:${p.month}`,
    chargeId: null,
    sourceId: p.source.doc._id,
    day: p.day,
    month: p.month,
    label: p.source.doc.label,
    category: p.source.doc.category,
    amount: p.source.doc.amount,
    currency: p.source.doc.currency,
    recurring: true,
    planned: true,
    seriesTail: false,
    transferLineId: null,
  }));
  return [...real, ...planned].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Une charge telle qu'elle part au navigateur : champs nommés, contre-valeur. */
function chargeOut(c: ChargeView, fx: ComptaFx) {
  const conv = convert(c.amount, c.currency, fx);
  return {
    id: c.id,
    chargeId: c.chargeId,
    sourceId: c.sourceId,
    day: c.day,
    month: c.month,
    label: c.label,
    category: c.category,
    amount: c.amount,
    currency: c.currency,
    recurring: c.recurring,
    planned: c.planned,
    seriesTail: c.seriesTail,
    transferLineId: c.transferLineId,
    converted: conv === null ? null : round2(conv),
  };
}

/**
 * Scans d'un mois : les PAIEMENTS RÉELS au fournisseur (charges de catégorie
 * « scans », saisies ou comptées depuis un virement) quand il y en a ; sinon
 * l'estimation `cost_usd` de PostHog. L'estimation reste rendue pour comparer.
 */
function monthScans(
  monthCharges: readonly ChargeView[],
  scanDoc: Doc<"comptaMonths">["scan"] | undefined,
  fx: ComptaFx,
): {
  value: number | null;
  source: "paid" | "estimate" | null;
  estimate: number | null;
  paidUnconverted: boolean;
} {
  const usdRate = rateOf("usd", fx);
  const scanUsd = scanCostUsd(scanDoc);
  const estimate =
    scanUsd === null ? null : scanUsd === 0 ? 0 : usdRate === null ? null : round2(scanUsd * usdRate);
  const paid = monthCharges.filter((c) => c.category === "scans");
  if (paid.length === 0) {
    return { value: estimate, source: scanDoc ? "estimate" : null, estimate, paidUnconverted: false };
  }
  let sum = 0;
  let unconverted = false;
  for (const c of paid) {
    const conv = convert(c.amount, c.currency, fx);
    if (conv === null) unconverted = true;
    else sum += conv;
  }
  return { value: unconverted ? null : round2(sum), source: "paid", estimate, paidUnconverted: unconverted };
}

/** Retours de retraits échoués : identifiant `wdrl_…` → date du retour. */
async function reversalsBySource(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<Map<string, number>> {
  const lines = await ctx.db
    .query("whopLedgerLines")
    .withIndex("by_project_type_posted", (q) =>
      q.eq("projectId", projectId).eq("lineType", "withdrawal_reversal"),
    )
    .collect();
  const out = new Map<string, number>();
  for (const l of lines) {
    if (!l.sourceId) continue;
    const cur = out.get(l.sourceId);
    if (cur === undefined || l.postedAt < cur) out.set(l.sourceId, l.postedAt);
  }
  return out;
}

// ─── Vue d'ensemble d'une année ─────────────────────────────────────────────

/**
 * L'onglet entier d'une année : compteur de seuils, tableau mois par mois,
 * totaux, solde Whop calculé, types non classés, règles, état de l'import.
 */
export const getComptaOverview = permissionQuery("business.read")({
  args: { year: v.number() },
  handler: async (ctx, { year }) => {
    const months = await allMonths(ctx, ctx.projectId);
    const { project, state, fx, rules } = await loadContext(ctx, ctx.projectId, months);
    const now = Date.now();
    const today = parisDayKey(now);
    const currentMonth = today.slice(0, 7);
    const y = String(year);

    const byMonth = new Map(months.map((m) => [m.month, m]));
    const outs = await creatorOuts(ctx, ctx.projectId);
    // Tous les virements (quelques dizaines) : dernier réussi, contrôle
    // créatrices par mois, argent à récupérer.
    const reversals = await reversalsBySource(ctx, ctx.projectId);
    const transfers = (
      await ctx.db
        .query("whopLedgerLines")
        .withIndex("by_project_type_posted", (q) =>
          q.eq("projectId", ctx.projectId).eq("lineType", "withdrawal"),
        )
        .collect()
    )
      .sort((a, b) => a.postedAt - b.postedAt)
      .map((l) => transferOut(l, reversals, fx));
    const charges = await chargesOf(ctx, ctx.projectId, currentMonth);
    const payCurrency = project.payCurrency ?? null;
    const payRate = payCurrency ? rateOf(payCurrency, fx) : null;

    // Mois affichés : ceux de l'année qui ont quelque chose, bornés au mois courant.
    const keys = new Set<string>();
    for (const m of months) if (m.month.startsWith(y)) keys.add(m.month);
    for (const o of outs) if (o.month.startsWith(y)) keys.add(o.month);
    for (const c of charges) if (c.month.startsWith(y)) keys.add(c.month);
    if (y === currentMonth.slice(0, 4)) keys.add(currentMonth);
    const monthKeys = [...keys].filter((k) => k <= currentMonth).sort();

    const rows = monthKeys.map((month) => {
      const doc = byMonth.get(month);
      const ledger = ledgerTotals(doc?.days ?? [], rules, fx);
      const creatorsPay = round2(
        outs.filter((o) => o.month === month).reduce((s, o) => s + o.amount, 0),
      );
      const creators = creatorsPay === 0 ? 0 : payRate === null ? null : round2(creatorsPay * payRate);
      const monthCharges = charges.filter((c) => c.month === month);
      const sc = monthScans(monthCharges, doc?.scan, fx);
      const scans = sc.value;
      let other = 0;
      let otherUnconverted = false;
      let plannedCount = 0;
      for (const c of monthCharges.filter((c) => c.category !== "scans")) {
        const conv = convert(c.amount, c.currency, fx);
        if (conv === null) otherUnconverted = true;
        else other += conv;
        if (c.planned) plannedCount += 1;
      }
      other = round2(other);
      const incomplete: string[] = [];
      if (ledger.unclassified.count > 0) incomplete.push("unclassified");
      if (ledger.unconverted.length > 0) incomplete.push("ledgerCurrency");
      if (creators === null) incomplete.push("creatorsCurrency");
      if (scans === null) {
        incomplete.push(
          sc.source === "paid" ? "scanPaidCurrency" : doc?.scan ? "scanUnknown" : "scanMissing",
        );
      }
      if (otherUnconverted) incomplete.push("otherCurrency");
      const result = round2(ledger.net - (creators ?? 0) - (scans ?? 0) - other);
      const sent = creatorsSentOf(transfers.filter((x) => x.day.slice(0, 7) === month));
      return {
        month,
        inProgress: month === currentMonth,
        ledger,
        creators,
        creatorsControl: creatorsControl(creators, sent.sent, sent.count),
        scans,
        scanSource: sc.source,
        scanEstimate: sc.estimate,
        scanPaidLow: isScanPaidLow(sc.source === "paid" ? scans : null, sc.estimate),
        scanFrozen: doc?.scan?.frozen ?? false,
        other,
        plannedCount,
        result,
        incomplete,
      };
    });

    const sum = (pick: (r: (typeof rows)[number]) => number | null) =>
      round2(rows.reduce((s, r) => s + (pick(r) ?? 0), 0));
    const totals = {
      gross: sum((r) => r.ledger.gross),
      refunds: sum((r) => r.ledger.refunds),
      disputes: sum((r) => r.ledger.disputes),
      fees: sum((r) => r.ledger.fees),
      net: sum((r) => r.ledger.net),
      creators: sum((r) => r.creators),
      scans: sum((r) => r.scans),
      other: sum((r) => r.other),
      result: sum((r) => r.result),
      transfersReceived: sum((r) => r.ledger.transfersReceived),
      // Un montant non CHIFFRÉ (devise sans taux, scans sans coût). Les lignes
      // non classées, elles, ont leur bandeau : elles ne rendent pas le total
      // « incomplet », elles le rendent « à ranger ».
      incomplete: rows.some((r) => r.incomplete.some((x) => x !== "unclassified")),
    };

    // Compteur de seuils : CA brut par jour de l'année, règles comprises.
    const grossDays = new Map<string, number>();
    for (const m of months) {
      if (!m.month.startsWith(y)) continue;
      for (const [d, val] of grossByDay(m.days, rules, fx)) {
        grossDays.set(d, (grossDays.get(d) ?? 0) + val);
      }
    }
    const thresholds = fx.target === "eur" ? thresholdView({ year, today, grossByDay: grossDays }) : null;

    // Solde du grand livre (toutes les lignes, depuis le début), par devise.
    const allCells: LedgerDayCell[] = months.flatMap((m) => m.days);
    const balances = balanceByCurrency(allCells).map((b) => {
      const conv = convert(b.amount, b.currency, fx);
      return { currency: b.currency, amount: b.amount, converted: conv === null ? null : round2(conv) };
    });
    // Dernier virement RÉUSSI : un retrait échoué est revenu sur Whop.
    const lastTransfer = [...transfers].reverse().find((x) => !x.failed) ?? null;
    // Argent à récupérer, TOUTES années : il reste signalé jusqu'à ce qu'on
    // change l'usage de la part.
    const toRecover = transfers.flatMap((x) =>
      x.parts
        .filter((p) => p.usage === "recover")
        .map((p) => ({
          lineId: x._id,
          partId: p.id,
          day: x.day,
          destination: x.destination,
          amount: p.amount,
          currency: x.currency,
          converted: p.converted,
          note: p.note,
          ageDays: Math.max(0, Math.round((now - x.postedAt) / DAY)),
        })),
    );

    // Types non classés, sur TOUT l'historique : une règle vaut pour le type.
    const pending = new Map<string, { count: number; amount: number; currency: string; months: Set<string> }>();
    for (const m of months) {
      for (const c of m.days) {
        if (bucketOf(c.lineType, rules) !== "unclassified") continue;
        const key = c.lineType;
        const p = pending.get(key) ?? { count: 0, amount: 0, currency: c.currency, months: new Set<string>() };
        p.count += c.count;
        p.amount += convert(c.amount, c.currency, fx) ?? 0;
        p.months.add(m.month);
        pending.set(key, p);
      }
    }
    const unclassified = await Promise.all(
      [...pending.entries()].map(async ([lineType, p]) => {
        const example = await ctx.db
          .query("whopLedgerLines")
          .withIndex("by_project_type_posted", (q) =>
            q.eq("projectId", ctx.projectId).eq("lineType", lineType),
          )
          .order("desc")
          .first();
        return {
          lineType,
          count: p.count,
          amount: round2(p.amount),
          months: [...p.months].sort(),
          example: example
            ? {
                postedAt: example.postedAt,
                amount: example.amount,
                currency: example.currency,
                paymentId: example.paymentId ?? null,
                label: example.label ?? null,
              }
            : null,
        };
      }),
    );

    const years = new Set<number>([Number(today.slice(0, 4))]);
    for (const m of months) years.add(Number(m.month.slice(0, 4)));
    for (const c of charges) years.add(Number(c.month.slice(0, 4)));

    return {
      configured: project.whop !== undefined,
      posthogConfigured: project.posthog !== undefined,
      currency: fx.target,
      payCurrency,
      conversions: Object.entries(fx.rates)
        .filter(([c]) => c !== fx.target)
        .map(([from, rate]) => ({ from, rate }))
        .sort((a, b) => a.from.localeCompare(b.from)),
      sync: {
        lastSyncAt: state?.lastSyncAt ?? null,
        lastError: state?.lastError ?? null,
        historyComplete: state?.historyComplete ?? false,
        scanError: state?.scanError ?? null,
      },
      today,
      currentMonth,
      year,
      years: [...years].sort((a, b) => b - a),
      rows,
      totals,
      thresholds,
      balance: {
        byCurrency: balances,
        converted: balances.every((b) => b.converted !== null)
          ? round2(balances.reduce((s, b) => s + (b.converted ?? 0), 0))
          : null,
        lastTransfer: lastTransfer
          ? { at: lastTransfer.postedAt, amount: lastTransfer.amount, currency: lastTransfer.currency }
          : null,
      },
      toRecover,
      unclassified: unclassified.sort((a, b) => b.count - a.count),
      // Les mois où chaque type réglé a des lignes : retirer ou changer la
      // règle change ces mois-là, et l'écran prévient s'ils ont été exportés.
      rules: (state?.rules ?? []).map((r) => {
        const cells = months.flatMap((m) =>
          m.days
            .filter((c) => c.lineType === r.lineType)
            .map((c) => ({ month: m.month, amount: c.amount, currency: c.currency, count: c.count })),
        );
        return {
          lineType: r.lineType,
          bucket: r.bucket,
          at: r.at,
          months: [...new Set(cells.map((c) => c.month))].sort(),
          count: cells.reduce((s, c) => s + c.count, 0),
          amount: round2(cells.reduce((s, c) => s + (convert(c.amount, c.currency, fx) ?? 0), 0)),
        };
      }),
      exports: (state?.exports ?? []).map((e) => ({ month: e.month, kind: e.kind, at: e.at })),
    };
  },
});

// ─── Détail d'un mois ───────────────────────────────────────────────────────

export const getComptaMonth = permissionQuery("business.read")({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const months = await allMonths(ctx, ctx.projectId);
    const { project, fx, rules } = await loadContext(ctx, ctx.projectId, months);
    const doc = months.find((m) => m.month === month) ?? null;
    const cells = doc?.days ?? [];
    const types = totalsByType(cells, rules, fx);
    const ledger = ledgerTotals(cells, rules, fx);

    // Solde d'ouverture = toutes les lignes AVANT le mois, en devise d'origine.
    const before = months.filter((m) => m.month < month).flatMap((m) => m.days);
    const openingByCur = balanceByCurrency(before);
    const closingByCur = balanceByCurrency([...before, ...cells]);
    const sumConv = (list: { currency: string; amount: number }[]) =>
      list.every((b) => rateOf(b.currency, fx) !== null)
        ? round2(list.reduce((s, b) => s + (convert(b.amount, b.currency, fx) ?? 0), 0))
        : null;

    const payCurrency = project.payCurrency ?? null;
    const payRate = payCurrency ? rateOf(payCurrency, fx) : null;
    const outs = (await creatorOuts(ctx, ctx.projectId)).filter((o) => o.month === month);
    const creatorIds = [...new Set(outs.map((o) => o.creatorId))];
    const names = new Map<string, string>();
    for (const id of creatorIds) {
      const c = await ctx.db.get(id);
      if (c) names.set(id, c.name);
    }
    const snapshots = new Map<string, string>();
    if (outs.some((o) => !names.has(o.creatorId))) {
      const rows = await ctx.db
        .query("payments")
        .withIndex("by_project_period", (q) => q.eq("projectId", ctx.projectId))
        .collect();
      for (const r of rows) if (r.creatorNameSnapshot) snapshots.set(r.creatorId, r.creatorNameSnapshot);
    }
    const creators = outs
      .sort((a, b) => a.at - b.at)
      .map((o) => ({
        day: o.day,
        name: names.get(o.creatorId) ?? snapshots.get(o.creatorId) ?? null,
        period: o.period,
        kind: o.kind,
        amount: o.amount,
        converted: payRate === null ? null : round2(o.amount * payRate),
      }));

    const usdRate = rateOf("usd", fx);
    const scan = doc?.scan ?? null;
    const scanParts = scan
      ? (["light", "full", "other"] as const).map((k) => {
          const usd = k === "light" ? scan.lightUsd : k === "full" ? scan.fullUsd : scan.otherUsd;
          return { kind: k, usd, converted: usdRate === null ? null : round2(usd * usdRate) };
        })
      : [];

    const currentMonth = parisDayKey(Date.now()).slice(0, 7);
    const monthCharges = (await chargesOf(ctx, ctx.projectId, currentMonth)).filter(
      (c) => c.month === month,
    );
    const sc = monthScans(monthCharges, doc?.scan, fx);
    // Les paiements au fournisseur des scans vivent dans le panneau Scans, pas
    // dans « Autres charges » : ils remplacent l'estimation du mois.
    const charges = monthCharges.filter((c) => c.category !== "scans").map((c) => chargeOut(c, fx));
    const scanPaid = monthCharges.filter((c) => c.category === "scans").map((c) => chargeOut(c, fx));

    const transfers = await transfersOf(ctx, ctx.projectId, month, fx);

    const foreign = balanceByCurrency(cells)
      .filter((b) => b.currency !== fx.target)
      .map((b) => ({ currency: b.currency, rate: rateOf(b.currency, fx) }));

    return {
      month,
      currency: fx.target,
      payCurrency,
      scanCurrency: "usd",
      types,
      ledger,
      foreign,
      reconciliation: (() => {
        const opening = sumConv(openingByCur);
        // Ce qui bouge le solde sans entrer au résultat : réserves, conversions,
        // lignes non classées. Sans ce terme, l'égalité serait fausse dès qu'il y
        // en a — et elle se lirait comme une erreur de la compta.
        const otherMovements = round2(ledger.internal + ledger.unclassified.amount);
        // La clôture est la somme des termes AFFICHÉS : chaque terme est arrondi
        // au centime, et une clôture convertie à part pouvait s'en écarter d'un
        // centime — l'égalité de l'écran aurait été fausse.
        const closing =
          opening === null || sumConv(closingByCur) === null
            ? null
            : round2(opening + ledger.net - ledger.transfersReceived + otherMovements);
        return { opening, closing, net: ledger.net, transfersReceived: ledger.transfersReceived, otherMovements };
      })(),
      creators,
      creatorsTotal: {
        pay: round2(outs.reduce((s, o) => s + o.amount, 0)),
        converted: payRate === null ? null : round2(outs.reduce((s, o) => s + o.amount, 0) * payRate),
        rate: payRate,
      },
      creatorsControl: (() => {
        const pay = round2(outs.reduce((s, o) => s + o.amount, 0));
        const paid = pay === 0 ? 0 : payRate === null ? null : round2(pay * payRate);
        const sent = creatorsSentOf(transfers);
        return creatorsControl(paid, sent.sent, sent.count);
      })(),
      scanSource: sc.source,
      scanPaid,
      scanTotal: sc.value,
      scan: scan
        ? {
            runs: scan.runs,
            withCost: scan.withCost,
            frozen: scan.frozen,
            usd: scanCostUsd(scan),
            converted: (() => {
              const u = scanCostUsd(scan);
              return u === null || usdRate === null ? null : round2(u * usdRate);
            })(),
            parts: scanParts,
            rate: usdRate,
          }
        : null,
      charges,
      transfers,
    };
  },
});

/**
 * Un virement Whop → banque tel qu'il part au navigateur, avec sa ventilation.
 * Un retrait ÉCHOUÉ (revenu sur Whop) est rendu marqué : l'écran le montre, ne
 * le compte pas, et ne propose pas de dire à quoi il a servi.
 */
function transferOut(l: Doc<"whopLedgerLines">, reversals: Map<string, number>, fx: ComptaFx) {
  // Un retrait est négatif dans le grand livre : il est montré « reçu ».
  const amount = round2(-l.amount);
  const returnedAt = l.sourceId ? reversals.get(l.sourceId) : undefined;
  const failed = isFailedWithdrawal(l.sourceStatus, returnedAt !== undefined);
  const conv = convert(amount, l.currency, fx);
  const parts = failed ? [] : transferPartsOf(l, amount);
  return {
    _id: l._id,
    postedAt: l.postedAt,
    day: parisDayKey(l.postedAt),
    amount,
    currency: l.currency,
    converted: conv === null ? null : round2(conv),
    destination: l.destination ?? null,
    sourceId: l.sourceId ?? null,
    status: l.sourceStatus ?? null,
    failed,
    returnedDay: returnedAt === undefined ? null : parisDayKey(returnedAt),
    parts: parts.map((p) => {
      const pc = convert(p.amount, l.currency, fx);
      return {
        id: p.id,
        amount: p.amount,
        usage: p.usage,
        note: p.note ?? null,
        countedAs: p.countedAs ?? null,
        converted: pc === null ? null : round2(pc),
      };
    }),
    annotatedAt: l.annotatedAt ?? null,
  };
}
type TransferOut = ReturnType<typeof transferOut>;

/** Les virements d'un mois, dans l'ordre. */
async function transfersOf(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  month: string,
  fx: ComptaFx,
): Promise<TransferOut[]> {
  const { start, end } = monthBounds(month);
  const lines = await ctx.db
    .query("whopLedgerLines")
    .withIndex("by_project_type_posted", (q) =>
      q.eq("projectId", projectId).eq("lineType", "withdrawal").gte("postedAt", start).lt("postedAt", end),
    )
    .collect();
  const reversals = await reversalsBySource(ctx, projectId);
  return lines.sort((a, b) => a.postedAt - b.postedAt).map((l) => transferOut(l, reversals, fx));
}

/**
 * Argent sorti de Whop POUR LES CRÉATRICES d'après la ventilation : somme des
 * parts « Paiement créatrices » des virements réussis (`null` si une part n'a
 * pas de taux), et leur nombre.
 */
function creatorsSentOf(transfers: readonly TransferOut[]): { sent: number | null; count: number } {
  let sum = 0;
  let count = 0;
  let unconverted = false;
  for (const x of transfers) {
    if (x.failed) continue;
    for (const p of x.parts) {
      if (p.usage !== "creators") continue;
      count += 1;
      if (p.converted === null) unconverted = true;
      else sum += p.converted;
    }
  }
  return { sent: unconverted ? null : round2(sum), count };
}

/** Virements Whop → banque d'un mois (bloc « Virements »). */
export const listComptaTransfers = permissionQuery("business.read")({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const months = await allMonths(ctx, ctx.projectId);
    const { fx } = await loadContext(ctx, ctx.projectId, months);
    return { currency: fx.target, transfers: await transfersOf(ctx, ctx.projectId, month, fx) };
  },
});

/** Autres charges d'un mois, saisies et prévues (bloc « Autres charges »). */
export const listComptaCharges = permissionQuery("business.read")({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const months = await allMonths(ctx, ctx.projectId);
    const { fx } = await loadContext(ctx, ctx.projectId, months);
    const currentMonth = parisDayKey(Date.now()).slice(0, 7);
    const monthCharges = (await chargesOf(ctx, ctx.projectId, currentMonth)).filter((c) => c.month === month);
    const charges = monthCharges.map((c) => chargeOut(c, fx));
    // L'estimation cost_usd du mois : la fenêtre de ventilation montre ce qu'un
    // paiement de scans compté va remplacer.
    const scanEstimate = monthScans([], months.find((m) => m.month === month)?.scan, fx).estimate;
    // Devises qu'une charge peut porter : la référence et celles qui ont un taux.
    const currencies = Object.keys(fx.rates).sort((a, b) =>
      a === fx.target ? -1 : b === fx.target ? 1 : a.localeCompare(b),
    );
    return { currency: fx.target, currencies, rates: fx.rates, charges, scanEstimate };
  },
});

/**
 * Tout ce qu'il faut pour l'EXPORT d'un mois, ligne à ligne. Lu à la demande
 * (pas d'abonnement) : un mois de grand livre, c'est ~3 000 lignes.
 */
export const getComptaJournal = permissionQuery("business.read")({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const months = await allMonths(ctx, ctx.projectId);
    const { project, fx, rules } = await loadContext(ctx, ctx.projectId, months);
    const { start, end } = monthBounds(month);
    const lines = await ctx.db
      .query("whopLedgerLines")
      .withIndex("by_project_posted", (q) =>
        q.eq("projectId", ctx.projectId).gte("postedAt", start).lt("postedAt", end),
      )
      .collect();
    const reversals = await reversalsBySource(ctx, ctx.projectId);
    const outs = (await creatorOuts(ctx, ctx.projectId)).filter((o) => o.month === month);
    const names = new Map<string, string>();
    for (const id of new Set(outs.map((o) => o.creatorId))) {
      const c = await ctx.db.get(id);
      if (c) names.set(id, c.name);
    }
    const currentMonth = parisDayKey(Date.now()).slice(0, 7);
    const charges = (await chargesOf(ctx, ctx.projectId, currentMonth)).filter((c) => c.month === month);
    const doc = months.find((m) => m.month === month);
    return {
      month,
      currency: fx.target,
      rates: fx.rates,
      payCurrency: project.payCurrency ?? null,
      ledger: lines.map((l) => ({
        day: parisDayKey(l.postedAt),
        lineType: l.lineType,
        bucket: bucketOf(l.lineType, rules),
        amount: l.amount,
        currency: l.currency,
        reference: l.paymentId ?? l.sourceId ?? l.whopId,
        label: l.label ?? null,
        destination: l.destination ?? null,
        // Ventilation d'un retrait (vide pour un retrait échoué ou une autre ligne).
        parts:
          l.lineType === "withdrawal" &&
          !isFailedWithdrawal(l.sourceStatus, l.sourceId ? reversals.has(l.sourceId) : false)
            ? transferPartsOf(l, -l.amount).map((p) => ({
                amount: p.amount,
                usage: p.usage,
                note: p.note ?? null,
              }))
            : [],
      })),
      creators: outs
        .sort((a, b) => a.at - b.at)
        .map((o) => ({
          day: o.day,
          name: names.get(o.creatorId) ?? null,
          period: o.period,
          kind: o.kind,
          amount: o.amount,
        })),
      scan: doc?.scan
        ? {
            lightUsd: doc.scan.lightUsd,
            fullUsd: doc.scan.fullUsd,
            otherUsd: doc.scan.otherUsd,
            runs: doc.scan.runs,
            withCost: doc.scan.withCost,
          }
        : null,
      charges: charges.map((c) => ({
        day: c.day,
        label: c.label,
        category: c.category,
        amount: c.amount,
        currency: c.currency,
        planned: c.planned,
      })),
    };
  },
});

// ─── Écritures de l'écran ───────────────────────────────────────────────────

async function stateForWrite(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<Doc<"comptaState">> {
  const existing = await ctx.db
    .query("comptaState")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first();
  if (existing) return existing;
  const id = await ctx.db.insert("comptaState", { projectId, rules: [], exports: [] });
  return (await ctx.db.get(id))!;
}

/**
 * Range un type de ligne INCONNU dans une colonne. La règle vaut pour toutes
 * les lignes du type, passées et futures. Un type déjà connu de Jarvia est
 * refusé : la table intégrée ne se surcharge pas depuis la page.
 */
export const setLineRule = permissionMutation("business.read")({
  args: { lineType: v.string(), bucket: v.string() },
  handler: async (ctx, { lineType, bucket }) => {
    if (!isValidLineType(lineType) || !isComptaBucket(bucket)) {
      throw err(ERR.COMPTA_RULE_INVALID, "Colonne ou type de ligne invalide.");
    }
    if (isBuiltinLineType(lineType)) {
      throw err(ERR.COMPTA_RULE_BUILTIN, "Ce type de ligne est déjà classé par Jarvia.");
    }
    const state = await stateForWrite(ctx, ctx.projectId);
    const rules = state.rules.filter((r) => r.lineType !== lineType);
    rules.push({ lineType, bucket, at: Date.now(), by: ctx.userId });
    await ctx.db.patch(state._id, { rules });
    return { ok: true as const };
  },
});

/** Retire une règle : ses lignes repassent en « non classé ». */
export const removeLineRule = permissionMutation("business.read")({
  args: { lineType: v.string() },
  handler: async (ctx, { lineType }) => {
    const state = await stateForWrite(ctx, ctx.projectId);
    await ctx.db.patch(state._id, {
      rules: state.rules.filter((r) => r.lineType !== lineType),
    });
    return { ok: true as const };
  },
});

/**
 * VENTILE un retrait Whop → banque : à quoi a servi chaque part. Une part
 * « Charges de l'activité » peut être COMPTÉE EN CHARGE (catégorie) : elle
 * devient une `comptaCharges` liée, au jour du virement, dans sa devise. Les
 * charges liées sont réconciliées à chaque enregistrement (créées, mises à
 * jour, supprimées) : la ventilation est leur seule source.
 *
 * Le reste du virement (rémunération, mise de côté…) ne touche jamais le
 * résultat : c'est de l'argent qui quitte Whop, pas une dépense. Une liste vide
 * efface la ventilation.
 */
export const ventilateTransfer = permissionMutation("business.read")({
  args: {
    lineId: v.id("whopLedgerLines"),
    parts: v.array(
      v.object({
        id: v.string(),
        amount: v.number(),
        usage: v.string(),
        note: v.optional(v.string()),
        countedAs: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { lineId, parts }) => {
    const line = await ctx.db.get(lineId);
    if (!line || line.projectId !== ctx.projectId || line.lineType !== "withdrawal") {
      throw err(ERR.COMPTA_TRANSFER_NOT_FOUND, "Ce virement est introuvable.");
    }
    const reversal = line.sourceId
      ? (
          await ctx.db
            .query("whopLedgerLines")
            .withIndex("by_project_type_posted", (q) =>
              q.eq("projectId", ctx.projectId).eq("lineType", "withdrawal_reversal"),
            )
            .collect()
        ).some((r) => r.sourceId === line.sourceId)
      : false;
    if (isFailedWithdrawal(line.sourceStatus, reversal)) {
      throw err(ERR.COMPTA_TRANSFER_FAILED, "Ce virement a échoué : rien à ventiler.");
    }
    const clean = parts.map((p) => ({
      id: p.id.trim(),
      amount: round2(p.amount),
      usage: p.usage,
      ...(p.note?.trim() ? { note: p.note.trim() } : {}),
      ...(p.countedAs ? { countedAs: p.countedAs } : {}),
    }));
    const total = round2(-line.amount);
    const reason = transferPartsError(clean, total);
    if (reason === "usage") throw err(ERR.COMPTA_USAGE_INVALID, "Usage de virement inconnu.");
    if (reason !== null) {
      throw err(ERR.COMPTA_PARTS_INVALID, "Ventilation invalide.", { reason });
    }
    const now = Date.now();
    await ctx.db.patch(lineId, {
      parts: clean.length > 0 ? clean : undefined,
      usage: undefined,
      note: undefined,
      annotatedAt: now,
      annotatedBy: ctx.userId,
    });

    // Réconciliation des charges liées : une par part comptée, rien d'autre.
    const day = parisDayKey(line.postedAt);
    const existing = await ctx.db
      .query("comptaCharges")
      .withIndex("by_project_transfer", (q) =>
        q.eq("projectId", ctx.projectId).eq("transferLineId", lineId),
      )
      .collect();
    const counted = clean.filter((p) => p.countedAs !== undefined);
    for (const p of counted) {
      const fields = {
        day,
        month: day.slice(0, 7),
        label: p.note!,
        category: p.countedAs!,
        amount: p.amount,
        currency: line.currency,
        recurring: false,
      };
      const doc = existing.find((c) => c.transferPartId === p.id);
      if (doc) await ctx.db.patch(doc._id, { ...fields, updatedAt: now });
      else {
        await ctx.db.insert("comptaCharges", {
          projectId: ctx.projectId,
          ...fields,
          transferLineId: lineId,
          transferPartId: p.id,
          createdAt: now,
          createdBy: ctx.userId,
        });
      }
    }
    for (const c of existing) {
      if (!counted.some((p) => p.id === c.transferPartId)) await ctx.db.delete(c._id);
    }
    return { ok: true as const, counted: counted.length };
  },
});

const chargeFields = {
  day: v.string(),
  label: v.string(),
  category: v.string(),
  amount: v.number(),
  currency: v.string(),
  recurring: v.boolean(),
};

async function validateCharge(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  c: { day: string; label: string; category: string; amount: number; currency: string },
): Promise<{ day: string; month: string; label: string; category: string; amount: number; currency: string }> {
  const label = c.label.trim();
  const currency = c.currency.trim().toLowerCase();
  const day = c.day.trim();
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`));
  const months = await allMonths(ctx, projectId);
  const { fx } = await loadContext(ctx, projectId, months);
  if (
    !dateOk ||
    label === "" ||
    label.length > 120 ||
    !isChargeCategory(c.category) ||
    !(c.amount > 0) ||
    !Number.isFinite(c.amount) ||
    c.amount > 10_000_000 ||
    rateOf(currency, fx) === null
  ) {
    throw err(ERR.COMPTA_CHARGE_INVALID, "Charge invalide.");
  }
  return {
    day,
    month: day.slice(0, 7),
    label,
    category: c.category,
    amount: round2(c.amount),
    currency,
  };
}

export const addComptaCharge = permissionMutation("business.read")({
  args: chargeFields,
  handler: async (ctx, args) => {
    const c = await validateCharge(ctx, ctx.projectId, args);
    const id = await ctx.db.insert("comptaCharges", {
      projectId: ctx.projectId,
      ...c,
      recurring: args.recurring,
      createdAt: Date.now(),
      createdBy: ctx.userId,
    });
    return { chargeId: id };
  },
});

export const updateComptaCharge = permissionMutation("business.read")({
  args: { chargeId: v.id("comptaCharges"), ...chargeFields },
  handler: async (ctx, { chargeId, ...args }) => {
    const doc = await ctx.db.get(chargeId);
    if (!doc || doc.projectId !== ctx.projectId) {
      throw err(ERR.COMPTA_CHARGE_NOT_FOUND, "Cette charge n'existe plus.");
    }
    if (doc.transferLineId) {
      throw err(ERR.COMPTA_CHARGE_LINKED, "Charge issue d'un virement : à modifier depuis lui.");
    }
    const c = await validateCharge(ctx, ctx.projectId, args);
    await ctx.db.patch(chargeId, { ...c, recurring: args.recurring, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

/**
 * Supprime une charge. Si c'était la DERNIÈRE d'une série « chaque mois », la
 * série s'arrête : sans ça, la charge précédente (récurrente) reprévoirait
 * aussitôt le mois qu'on vient de supprimer.
 */
export const deleteComptaCharge = permissionMutation("business.read")({
  args: { chargeId: v.id("comptaCharges") },
  handler: async (ctx, { chargeId }) => {
    const doc = await ctx.db.get(chargeId);
    if (!doc || doc.projectId !== ctx.projectId) {
      throw err(ERR.COMPTA_CHARGE_NOT_FOUND, "Cette charge n'existe plus.");
    }
    if (doc.transferLineId) {
      throw err(ERR.COMPTA_CHARGE_LINKED, "Charge issue d'un virement : à modifier depuis lui.");
    }
    const seriesId = doc.seriesId ?? doc._id;
    await ctx.db.delete(chargeId);
    const series = (
      await ctx.db
        .query("comptaCharges")
        .withIndex("by_project_month", (q) => q.eq("projectId", ctx.projectId))
        .collect()
    ).filter((c) => (c.seriesId ?? c._id) === seriesId);
    const later = series.some((c) => c.day > doc.day);
    if (!later && series.length > 0) {
      const tail = series.reduce((a, b) => (b.day > a.day ? b : a));
      if (tail.recurring) await ctx.db.patch(tail._id, { recurring: false, updatedAt: Date.now() });
    }
    return { ok: true as const };
  },
});

/**
 * Confirme une occurrence PRÉVUE d'une charge « chaque mois » : elle devient
 * une vraie charge (éditable), dans la même série, et reprend la récurrence.
 */
export const confirmPlannedCharge = permissionMutation("business.read")({
  args: { sourceId: v.id("comptaCharges"), day: v.string() },
  handler: async (ctx, { sourceId, day }) => {
    const src = await ctx.db.get(sourceId);
    if (!src || src.projectId !== ctx.projectId) {
      throw err(ERR.COMPTA_CHARGE_NOT_FOUND, "Cette charge n'existe plus.");
    }
    const c = await validateCharge(ctx, ctx.projectId, { ...src, day });
    const seriesId = src.seriesId ?? src._id;
    const duplicate = (
      await ctx.db
        .query("comptaCharges")
        .withIndex("by_project_month", (q) => q.eq("projectId", ctx.projectId).eq("month", c.month))
        .collect()
    ).some((x) => (x.seriesId ?? x._id) === seriesId);
    if (duplicate) return { ok: true as const };
    await ctx.db.insert("comptaCharges", {
      projectId: ctx.projectId,
      ...c,
      recurring: true,
      seriesId,
      createdAt: Date.now(),
      createdBy: ctx.userId,
    });
    return { ok: true as const };
  },
});

/**
 * « Ne plus répéter » : la charge cesse d'être récurrente. Appliqué à la
 * dernière charge d'une série, plus aucun mois n'est prévu.
 */
export const stopChargeSeries = permissionMutation("business.read")({
  args: { chargeId: v.id("comptaCharges") },
  handler: async (ctx, { chargeId }) => {
    const doc = await ctx.db.get(chargeId);
    if (!doc || doc.projectId !== ctx.projectId) {
      throw err(ERR.COMPTA_CHARGE_NOT_FOUND, "Cette charge n'existe plus.");
    }
    await ctx.db.patch(chargeId, { recurring: false, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

/** Journal des exports — pour prévenir qu'une règle changerait un mois envoyé. */
export const logComptaExport = permissionMutation("business.read")({
  args: { month: v.string(), kind: v.union(v.literal("journal"), v.literal("summary")) },
  handler: async (ctx, { month, kind }) => {
    if (!/^\d{4}-\d{2}$/.test(month)) throw err(ERR.COMPTA_RULE_INVALID, "Mois invalide.");
    const state = await stateForWrite(ctx, ctx.projectId);
    const exports = [...state.exports, { month, kind, at: Date.now(), by: ctx.userId }].slice(
      -MAX_EXPORT_LOG,
    );
    await ctx.db.patch(state._id, { exports });
    return { ok: true as const };
  },
});

/** Bouton « Synchroniser » : relit le grand livre et le coût des scans. */
export const requestComptaSync = permissionMutation("business.read")({
  args: {},
  handler: async (ctx): Promise<{ scheduled: boolean }> => {
    const project = await ctx.db.get(ctx.projectId);
    if (!project?.whop) return { scheduled: false };
    await ctx.scheduler.runAfter(0, internal.compta.syncCompta, {
      projectId: ctx.projectId,
      mode: "incremental",
    });
    return { scheduled: true };
  },
});

// ─── Import du grand livre ──────────────────────────────────────────────────

const ledgerLineArg = v.object({
  whopId: v.string(),
  lineType: v.string(),
  amount: v.number(),
  currency: v.string(),
  postedAt: v.number(),
  paymentId: v.optional(v.string()),
  label: v.optional(v.string()),
  sourceId: v.optional(v.string()),
  destination: v.optional(v.string()),
  sourceStatus: v.optional(v.string()),
});

/** Insère les lignes ABSENTES ; rend les mois touchés par une insertion. */
async function insertLedgerLinesCore(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  lines: readonly NormalizedLedgerLine[],
): Promise<string[]> {
  const touched = new Set<string>();
  const now = Date.now();
  for (const l of lines) {
    const exists = await ctx.db
      .query("whopLedgerLines")
      .withIndex("by_project_whop", (q) => q.eq("projectId", projectId).eq("whopId", l.whopId))
      .first();
    if (exists) continue;
    await ctx.db.insert("whopLedgerLines", { projectId, ...l, importedAt: now });
    touched.add(monthKeyParis(l.postedAt));
  }
  return [...touched];
}

/** Reconstruit l'agrégat d'un mois depuis ses lignes. */
async function rebuildLedgerMonthCore(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  month: string,
): Promise<void> {
  const { start, end } = monthBounds(month);
  const lines = await ctx.db
    .query("whopLedgerLines")
    .withIndex("by_project_posted", (q) =>
      q.eq("projectId", projectId).gte("postedAt", start).lt("postedAt", end),
    )
    .collect();
  const days = aggregateLedgerDays(lines);
  const existing = await ctx.db
    .query("comptaMonths")
    .withIndex("by_project_month", (q) => q.eq("projectId", projectId).eq("month", month))
    .first();
  if (existing) await ctx.db.patch(existing._id, { days, ledgerRebuiltAt: Date.now() });
  else await ctx.db.insert("comptaMonths", { projectId, month, days, ledgerRebuiltAt: Date.now() });
}

export const insertLedgerLines = internalMutation({
  args: { projectId: v.id("projects"), lines: v.array(ledgerLineArg) },
  handler: async (ctx, { projectId, lines }): Promise<string[]> =>
    insertLedgerLinesCore(ctx, projectId, lines),
});

export const rebuildLedgerMonth = internalMutation({
  args: { projectId: v.id("projects"), month: v.string() },
  handler: async (ctx, { projectId, month }): Promise<null> => {
    await rebuildLedgerMonthCore(ctx, projectId, month);
    return null;
  },
});

export const syncStateOf = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const state = await readState(ctx, projectId);
    const months = await allMonths(ctx, projectId);
    return {
      lastPostedAt: state?.lastPostedAt ?? null,
      historyComplete: state?.historyComplete ?? false,
      months: months.map((m) => ({ month: m.month, frozen: m.scan?.frozen ?? false })),
    };
  },
});

/**
 * Fin d'un passage : date, erreur, curseur, et devises rencontrées (grand
 * livre + paiements Whop) pour la devise de référence.
 */
export const finishComptaSync = internalMutation({
  args: {
    projectId: v.id("projects"),
    at: v.number(),
    lastError: v.union(v.string(), v.null()),
    lastPostedAt: v.union(v.number(), v.null()),
    historyComplete: v.boolean(),
    scanError: v.union(v.string(), v.null()),
  },
  handler: async (ctx, a): Promise<null> => {
    const state = await stateForWrite(ctx, a.projectId);
    const project = await ctx.db.get(a.projectId);
    const seen = new Set<string>();
    for (const m of await allMonths(ctx, a.projectId)) for (const c of m.days) seen.add(c.currency);
    const payments = await ctx.db
      .query("whopPayments")
      .withIndex("by_project", (q) => q.eq("projectId", a.projectId))
      .collect();
    for (const p of payments) if (p.currency) seen.add(p.currency.toLowerCase());
    const ref = referenceCurrency(seen, projectFx(project));
    await ctx.db.patch(state._id, {
      lastSyncAt: a.at,
      lastError: a.lastError ?? undefined,
      lastPostedAt: a.lastPostedAt ?? state.lastPostedAt,
      historyComplete: state.historyComplete === true || a.historyComplete,
      referenceCurrency: ref ?? state.referenceCurrency,
      scanError: a.scanError ?? undefined,
    });
    return null;
  },
});

export const writeScanMonths = internalMutation({
  args: {
    projectId: v.id("projects"),
    months: v.array(
      v.object({
        month: v.string(),
        scan: v.object({
          lightUsd: v.number(),
          fullUsd: v.number(),
          otherUsd: v.number(),
          runs: v.number(),
          withCost: v.number(),
          computedAt: v.number(),
          frozen: v.boolean(),
        }),
      }),
    ),
  },
  handler: async (ctx, { projectId, months }): Promise<null> => {
    for (const m of months) {
      const existing = await ctx.db
        .query("comptaMonths")
        .withIndex("by_project_month", (q) => q.eq("projectId", projectId).eq("month", m.month))
        .first();
      if (existing?.scan?.frozen) continue;
      if (existing) await ctx.db.patch(existing._id, { scan: m.scan });
      else await ctx.db.insert("comptaMonths", { projectId, month: m.month, days: [], scan: m.scan });
    }
    return null;
  },
});

/**
 * Coût des scans par mois de Paris, en dollars (`cost_usd` de `scan_completed`).
 * TOUS les scans, comptes internes compris : c'est une dépense réelle, quel que
 * soit le compte qui l'a déclenchée (l'onglet Offres, lui, les exclut parce
 * qu'il mesure le coût d'une cible CLIENTE).
 */
export function scanCostQuery(fromMonth: string, toMonth: string): string {
  const from = `${fromMonth}-01 00:00:00`;
  const to = `${nextMonthKeyOf(toMonth)}-01 00:00:00`;
  return `
SELECT formatDateTime(toStartOfDay(timestamp, 'Europe/Paris'), '%Y-%m') AS m,
  multiIf(
    coalesce(nullIf(toString(properties.reason), ''), '') = 'scheduled_full', 'full',
    coalesce(nullIf(toString(properties.reason), ''), '') IN ('scheduled_light', 'baseline', 'manual_refresh'), 'light',
    'other'
  ) AS kind,
  count() AS runs,
  countIf(toFloatOrNull(toString(properties.cost_usd)) IS NOT NULL) AS with_cost,
  round(sum(toFloatOrZero(toString(properties.cost_usd))), 4) AS cost
FROM events
WHERE event = 'scan_completed'
  AND timestamp >= toDateTime('${from}', 'Europe/Paris')
  AND timestamp < toDateTime('${to}', 'Europe/Paris')
GROUP BY m, kind
ORDER BY m
LIMIT 1000`;
}

function nextMonthKeyOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Mois de `from` à `to` inclus. */
function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 240; m = nextMonthKeyOf(m)) out.push(m);
  return out;
}

export interface ComptaSyncSummary {
  projects: number;
  inserted: number;
  errors: string[];
}

/**
 * Import de la compta. `incremental` (cron horaire, bouton) : repart 3 jours
 * avant la dernière écriture vue. `recent` (cron quotidien) : relit depuis le
 * début du mois précédent. Tant que l'historique complet n'a jamais été lu
 * sans coupure, chaque passage le relit en entier (idempotent).
 *
 * Une erreur ou une coupure (429, borne de pages) n'avance JAMAIS le curseur :
 * sinon les lignes non lues passeraient sous la fenêtre de chevauchement.
 */
export const syncCompta = internalAction({
  args: {
    projectId: v.optional(v.id("projects")),
    mode: v.union(v.literal("incremental"), v.literal("recent")),
  },
  handler: async (ctx, { projectId, mode }): Promise<ComptaSyncSummary> => {
    const projects = await ctx.runQuery(
      internal.whopSync.listWhopProjects,
      projectId ? { projectId } : {},
    );
    const errors: string[] = [];
    let inserted = 0;
    for (const proj of projects) {
      const now = Date.now();
      const st = await ctx.runQuery(internal.compta.syncStateOf, { projectId: proj._id });
      const apiKey = process.env[proj.apiKeyEnvVar];
      let ledgerError: string | null = null;
      let lastPostedAt: number | null = null;
      let fullRead = false;
      if (!apiKey) {
        ledgerError = `missing-api-key (${proj.apiKeyEnvVar})`;
      } else {
        const currentMonth = monthKeyParis(now);
        const postedAfter = !st.historyComplete
          ? undefined
          : mode === "recent"
            ? parisMonthEndMs(previousMonthKey(previousMonthKey(currentMonth)))
            : Math.max(0, (st.lastPostedAt ?? 0) - LEDGER_OVERLAP_MS);
        const res = await fetchWhopLedger(apiKey, proj.companyId, { postedAfter });
        const touched = new Set<string>();
        for (let i = 0; i < res.lines.length; i += INSERT_CHUNK) {
          const part = res.lines.slice(i, i + INSERT_CHUNK);
          const months = await ctx.runMutation(internal.compta.insertLedgerLines, {
            projectId: proj._id,
            lines: part,
          });
          for (const m of months) touched.add(m);
        }
        for (const month of touched) {
          await ctx.runMutation(internal.compta.rebuildLedgerMonth, { projectId: proj._id, month });
        }
        inserted += res.lines.length;
        if (res.error || res.truncated) {
          ledgerError = res.error ?? "truncated";
        } else {
          fullRead = postedAfter === undefined;
          const maxPosted = res.lines.reduce((m, l) => Math.max(m, l.postedAt), 0);
          lastPostedAt = maxPosted > 0 ? Math.max(maxPosted, st.lastPostedAt ?? 0) : st.lastPostedAt;
        }
        if (res.skipped > 0) {
          console.warn(`[compta] ${proj.slug} : ${res.skipped} ligne(s) illisible(s) ignorée(s).`);
        }
      }

      // Coût des scans — non bloquant : une panne PostHog ne touche pas le grand livre.
      let scanError: string | null = null;
      const ph = await ctx.runQuery(internal.posthogSync.listPosthogProjects, { projectId: proj._id });
      const phCfg = ph[0];
      if (phCfg) {
        const phKey = process.env[phCfg.apiKeyEnvVar];
        if (!phKey) {
          scanError = `missing-api-key (${phCfg.apiKeyEnvVar})`;
        } else {
          const st2 = await ctx.runQuery(internal.compta.syncStateOf, { projectId: proj._id });
          const currentMonth = monthKeyParis(now);
          const first = st2.months.length > 0 ? st2.months[0].month : currentMonth;
          const frozen = new Set(st2.months.filter((m) => m.frozen).map((m) => m.month));
          const todo = monthRange(first, currentMonth).filter((m) => !frozen.has(m));
          if (todo.length > 0) {
            const res = await runHogQL(
              phKey,
              { posthogProjectId: phCfg.posthogProjectId, host: phCfg.host },
              scanCostQuery(todo[0], currentMonth),
            );
            if (res.error) {
              scanError = res.error;
            } else {
              const acc = new Map<string, ScanMonth>();
              for (const r of res.rows) {
                const m = cellStr(r, 0);
                const s = acc.get(m) ?? { lightUsd: 0, fullUsd: 0, otherUsd: 0, runs: 0, withCost: 0 };
                const kind = cellStr(r, 1);
                const cost = cellNum(r, 4);
                if (kind === "light") s.lightUsd += cost;
                else if (kind === "full") s.fullUsd += cost;
                else s.otherUsd += cost;
                s.runs += cellNum(r, 2);
                s.withCost += cellNum(r, 3);
                acc.set(m, s);
              }
              await ctx.runMutation(internal.compta.writeScanMonths, {
                projectId: proj._id,
                months: todo.map((month) => {
                  const s = acc.get(month) ?? { lightUsd: 0, fullUsd: 0, otherUsd: 0, runs: 0, withCost: 0 };
                  return {
                    month,
                    scan: {
                      lightUsd: round2(s.lightUsd),
                      fullUsd: round2(s.fullUsd),
                      otherUsd: round2(s.otherUsd),
                      runs: s.runs,
                      withCost: s.withCost,
                      computedAt: now,
                      frozen: now >= parisMonthEndMs(month) + SCAN_FREEZE_DELAY_MS,
                    },
                  };
                }),
              });
            }
          }
        }
      }

      await ctx.runMutation(internal.compta.finishComptaSync, {
        projectId: proj._id,
        at: now,
        lastError: ledgerError,
        lastPostedAt,
        historyComplete: fullRead,
        scanError,
      });
      if (ledgerError) errors.push(`${proj.slug}: ${ledgerError}`);
      if (scanError) errors.push(`${proj.slug}: scans ${scanError}`);
      console.info(`[compta] ${proj.slug} : grand livre ${ledgerError ?? "ok"} · scans ${scanError ?? "ok"}.`);
    }
    return { projects: projects.length, inserted, errors };
  },
});

// ─── E2E ─────────────────────────────────────────────────────────────────────

/** E2E — la VRAIE insertion + reconstruction, comme l'import. */
export const e2eSeedLedgerLines = e2eMutation({
  args: { projectId: v.id("projects"), lines: v.array(ledgerLineArg) },
  handler: async (ctx, { projectId, lines }): Promise<string[]> => {
    const months = await insertLedgerLinesCore(ctx, projectId, lines);
    for (const m of months) await rebuildLedgerMonthCore(ctx, projectId, m);
    return months;
  },
});

/** E2E — pose le coût des scans d'un mois (PostHog n'existe pas en e2e). */
export const e2eSetScanMonth = e2eMutation({
  args: {
    projectId: v.id("projects"),
    month: v.string(),
    lightUsd: v.number(),
    fullUsd: v.number(),
    runs: v.number(),
    withCost: v.number(),
  },
  handler: async (ctx, a): Promise<null> => {
    const scan = {
      lightUsd: a.lightUsd,
      fullUsd: a.fullUsd,
      otherUsd: 0,
      runs: a.runs,
      withCost: a.withCost,
      computedAt: Date.now(),
      frozen: false,
    };
    const existing = await ctx.db
      .query("comptaMonths")
      .withIndex("by_project_month", (q) => q.eq("projectId", a.projectId).eq("month", a.month))
      .first();
    if (existing) await ctx.db.patch(existing._id, { scan });
    else await ctx.db.insert("comptaMonths", { projectId: a.projectId, month: a.month, days: [], scan });
    return null;
  },
});

/**
 * E2E — devise de référence et date d'import, comme les poserait la synchro.
 * Sans devise : un import qui n'a pas pu la fixer (plusieurs devises sans taux).
 */
export const e2eSetComptaState = e2eMutation({
  args: {
    projectId: v.id("projects"),
    referenceCurrency: v.optional(v.string()),
    lastSyncAt: v.number(),
  },
  handler: async (ctx, a): Promise<null> => {
    const state = await stateForWrite(ctx, a.projectId);
    await ctx.db.patch(state._id, {
      referenceCurrency: a.referenceCurrency,
      lastSyncAt: a.lastSyncAt,
      historyComplete: true,
      lastError: undefined,
    });
    return null;
  },
});

/** E2E — taux du projet (rend les valeurs précédentes, pour les restaurer). */
export const e2eSetProjectFx = e2eMutation({
  args: {
    projectId: v.id("projects"),
    payCurrency: v.optional(v.string()),
    fxRateToRevenue: v.optional(v.number()),
    fxRatesToRevenue: v.optional(v.array(v.object({ currency: v.string(), rate: v.number() }))),
  },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.projectId);
    await ctx.db.patch(a.projectId, {
      payCurrency: a.payCurrency,
      fxRateToRevenue: a.fxRateToRevenue,
      fxRatesToRevenue: a.fxRatesToRevenue,
    });
    return {
      payCurrency: p?.payCurrency,
      fxRateToRevenue: p?.fxRateToRevenue,
      fxRatesToRevenue: p?.fxRatesToRevenue,
    };
  },
});

/** E2E — efface toute la compta d'un projet (lignes, mois, état, charges). */
export const e2eResetCompta = e2eMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }): Promise<null> => {
    for (const l of await ctx.db
      .query("whopLedgerLines")
      .withIndex("by_project_posted", (q) => q.eq("projectId", projectId))
      .collect())
      await ctx.db.delete(l._id);
    for (const m of await ctx.db
      .query("comptaMonths")
      .withIndex("by_project_month", (q) => q.eq("projectId", projectId))
      .collect())
      await ctx.db.delete(m._id);
    for (const s of await ctx.db
      .query("comptaState")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect())
      await ctx.db.delete(s._id);
    for (const c of await ctx.db
      .query("comptaCharges")
      .withIndex("by_project_month", (q) => q.eq("projectId", projectId))
      .collect())
      await ctx.db.delete(c._id);
    return null;
  },
});
