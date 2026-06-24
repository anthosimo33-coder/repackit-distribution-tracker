"use client";

import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { PaymentInfoNudge } from "@/components/portal/PaymentInfoNudge";
import { useMyPayments, useMyBonusStatus } from "@/components/portal/creator-data";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatEuros } from "@/lib/format-rate";
import { formatDate } from "@/lib/format";
import { nextPayoutDate, daysUntilPayout, formatPeriod } from "@/lib/payout";
import { ChevronRightIcon } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * « Mes paiements / gains » — écran RÉUTILISÉ par le portail créateur normal ET
 * le mode admin « voir l'espace d'un créateur ». Écran PUREMENT en lecture
 * (aucune mutation) → identique dans les deux modes, seules les données sont
 * scopées (useMyPayments / useMyBonusStatus : getMy* en normal, queries admin
 * scopées projet en view-as).
 */

type Payment = FunctionReturnType<typeof api.payments.getMyPayments>[number];

/** Période d'accrual courante "YYYY-MM" (UTC, aligné sur periodOf serveur). */
const currentPeriod = () => new Date().toISOString().slice(0, 7);

const fmtViews = (n: number) => n.toLocaleString("fr-FR");

/**
 * Paliers de bonus (cumul de vues À VIE) — motivant : cumul, jauge vers le
 * prochain palier, et mur des récompenses débloquées (cash + nature).
 */
function BonusTierPanel({ projectId }: { projectId: Id<"projects"> }) {
  const status = useMyBonusStatus(projectId);
  if (!status || (status.tiers.length === 0 && status.natureUnlocked.length === 0))
    return null;
  const next = status.nextTier;
  const prevSeuil = [...status.crossed]
    .map((t) => t.seuilVues)
    .sort((a, b) => b - a)[0] ?? 0;
  const span = next ? next.seuilVues - prevSeuil : 1;
  const done = next ? status.cumulViews - prevSeuil : 1;
  const pct = next ? Math.max(0, Math.min(100, Math.round((done / span) * 100))) : 100;
  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardContent className="space-y-3 py-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-amber-900">
            🏆 Paliers de récompense
          </span>
          <span
            className="text-sm font-medium tabular-nums text-amber-800"
            data-testid="cumul-views"
          >
            {fmtViews(status.cumulViews)} vues cumulées
          </span>
        </div>
        {next ? (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-amber-100">
              <div
                className="h-full rounded-full bg-amber-400"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-amber-800">
              Plus que{" "}
              <span className="font-semibold tabular-nums">
                {fmtViews(status.viewsToNext ?? 0)}
              </span>{" "}
              vues avant{" "}
              <span className="font-semibold">
                {next.rewardType === "cash"
                  ? `${formatEuros(next.montant ?? 0)}`
                  : next.libelle}
              </span>
              .
            </p>
          </div>
        ) : (
          <p className="text-xs text-amber-800">
            Tous les paliers sont débloqués 🎉
          </p>
        )}
        {(status.cashUnlockedTotal > 0 || status.natureUnlocked.length > 0) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {status.cashUnlockedTotal > 0 && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                + {formatEuros(status.cashUnlockedTotal)} débloqués
              </span>
            )}
            {status.natureUnlocked.map((r, i) => (
              <span
                key={i}
                className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700"
              >
                🎁 {r.libelle}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const KIND_TAG: Record<string, { label: string; className: string }> = {
  base: { label: "Base", className: "bg-slate-200 text-slate-600" },
  bonus: { label: "Bonus", className: "bg-indigo-50 text-indigo-600" },
  fixed: { label: "Fixe", className: "bg-emerald-50 text-emerald-600" },
  cpm: { label: "CPM", className: "bg-sky-50 text-sky-600" },
  bonus_tier: { label: "Palier", className: "bg-amber-50 text-amber-600" },
};

function KindTag({
  kind,
}: {
  kind: "base" | "bonus" | "fixed" | "cpm" | "bonus_tier";
}) {
  const t = KIND_TAG[kind] ?? KIND_TAG.base;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase",
        t.className,
      )}
    >
      {t.label}
    </span>
  );
}

/**
 * Aperçu PRICING temps réel d'une période non payée : fixe acquis (X/cible
 * vidéos → Y€ sur montantFixe), CPM accumulé (sur les vues), bonus, total.
 */
function PricingBreakdown({ b }: { b: Payment["pricingBreakdown"] }) {
  if (b.total <= 0 && b.perPricing.length === 0) return null;
  const g = b.perPricing[0];
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Détail (temps réel)
      </p>
      <Row
        label={
          g
            ? `Fixe — ${g.videoCount}/${g.nbVideosCible} vidéos publiées`
            : "Fixe"
        }
        sub={g ? `sur ${formatEuros(g.montantFixe)}` : undefined}
        amount={b.fixedTotal}
      />
      <Row label="CPM accumulé (sur tes vues)" amount={b.cpmTotal} />
      {b.bonusTierCashTotal > 0 && (
        <Row label="Bonus paliers (cumul de vues)" amount={b.bonusTierCashTotal} />
      )}
      <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm font-semibold">
        <span>Sous-total pricing</span>
        <span className="tabular-nums" data-testid="pricing-total">
          {formatEuros(b.total)}
        </span>
      </div>
    </div>
  );
}

function Row({
  label,
  sub,
  amount,
}: {
  label: string;
  sub?: string;
  amount: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 text-slate-600">
        {label}
        {sub ? <span className="text-slate-400"> {sub}</span> : null}
      </span>
      <span className="shrink-0 tabular-nums text-slate-900">
        {formatEuros(amount)}
      </span>
    </div>
  );
}

function LineItems({ p }: { p: Payment }) {
  return (
    <ul className="divide-y divide-slate-100">
      {p.lineItems.map((li, i) => (
        <li
          key={i}
          className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            <KindTag kind={li.kind} />
            <span className="truncate text-slate-700">{li.label}</span>
          </span>
          <span className="shrink-0 tabular-nums text-slate-900">
            {formatEuros(li.amount)}
          </span>
        </li>
      ))}
      <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatEuros(p.totalDue)}</span>
      </li>
    </ul>
  );
}

function PastPeriod({ p }: { p: Payment }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <ChevronRightIcon
            className={cn(
              "size-4 shrink-0 text-slate-400 transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="font-medium capitalize text-slate-900">
            {formatPeriod(p.period)}
          </span>
          {p.status === "paid" ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              Payé{p.paidAt ? ` le ${formatDate(p.paidAt)}` : ""}
            </span>
          ) : (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
              En attente
            </span>
          )}
        </span>
        <span className="shrink-0 tabular-nums font-medium text-slate-900">
          {formatEuros(p.totalDue)}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-100">
          <LineItems p={p} />
        </div>
      )}
    </Card>
  );
}

export default function PaiementsScreen() {
  const { current: currentProject } = useCreatorProject();
  const payoutDay = currentProject.payoutDay;
  const payments = useMyPayments(currentProject.projectId);

  const loading = payments === undefined;
  const period = currentPeriod();
  const current = (payments ?? []).find((p) => p.period === period) ?? null;
  const past = (payments ?? [])
    .filter((p) => p.period !== period)
    .sort((a, b) => b.period.localeCompare(a.period));
  const dueNow = current?.totalDue ?? 0;
  const nextTs = payoutDay ? nextPayoutDate(payoutDay) : null;
  const days = payoutDay ? daysUntilPayout(payoutDay) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Mes paiements
      </h1>

      {/* QW3 — coordonnées de paiement manquantes alors que des gains sont dus. */}
      <PaymentInfoNudge projectId={currentProject.projectId} />

      <BonusTierPanel projectId={currentProject.projectId} />

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {/* Montant dû (période en cours) + prochaine date de paie */}
          <Card>
            <CardContent className="space-y-1 py-7 text-center">
              <p className="text-sm capitalize text-slate-500">
                Dû pour {formatPeriod(period)}
              </p>
              <p
                className="text-4xl font-semibold tabular-nums text-slate-900"
                data-testid="due-now"
              >
                {formatEuros(dueNow)}
              </p>
              {nextTs !== null && days !== null && (
                <p className="text-sm text-slate-500">
                  {dueNow > 0
                    ? `Payé dans ${days} jour${days > 1 ? "s" : ""} (le ${formatDate(nextTs)})`
                    : `Prochaine paie le ${formatDate(nextTs)}`}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Détail — période en cours : aperçu pricing temps réel (nouveau
              modèle) + lineItems legacy éventuelles. */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Détail du mois
            </h2>
            {!current ||
            (current.lineItems.length === 0 &&
              current.pricingBreakdown.total <= 0) ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-slate-500">
                  Aucune vidéo publiée ce mois-ci pour l&apos;instant.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                <PricingBreakdown b={current.pricingBreakdown} />
                {current.lineItems.length > 0 && (
                  <Card>
                    <CardContent className="p-0">
                      <LineItems p={current} />
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </section>

          {/* Historique des périodes passées (repliées) */}
          {past.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Historique
              </h2>
              <div className="space-y-2">
                {past.map((p) => (
                  <PastPeriod key={p._id} p={p} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
