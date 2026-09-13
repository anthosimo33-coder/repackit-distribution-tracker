"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import {
  useArgentObservable,
  useMyPayments,
  useMyProgression,
} from "@/components/portal/creator-data";
import { usePortalBase } from "@/components/portal/ViewAsContext";
import { Skeleton } from "@/components/ui/skeleton";
import { buildProgression } from "@/lib/progression";
import { formatMoney, formatViews } from "@/lib/format-rate";
import { formatMoneyDate } from "@/lib/format";
import { portalHref } from "@/lib/view-as";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useLabel } from "@/lib/use-label";
import { useTranslations } from "next-intl";

/**
 * GAINS DU CYCLE, VUS DE L'ACCUEIL — combien, quand, et le prochain palier.
 *
 * Remplace deux cartes (« Mes gains » et « Prochain palier ») par une : c'est
 * la même question, « qu'est-ce que je gagne ? ». Montant et date viennent du
 * cycle J+30 EN COURS (`useMyPayments`), le palier de `useMyProgression` — les
 * deux sources que lisaient déjà ces cartes, rien n'est recalculé ici.
 *
 * Masquée à l'observateur sans le droit « Paiements » (ses queries ne partent
 * pas : un squelette tournerait pour rien).
 */
export function CycleGainsCard() {
  const t = useTranslations("portal");
  const tLabel = useLabel();
  const loc = useIntlLocale();
  const { current } = useCreatorProject();
  const base = usePortalBase();
  const argent = useArgentObservable();
  const payments = useMyPayments(current.projectId);
  const raw = useMyProgression(current.projectId);
  const [now] = useState(() => Date.now());

  if (!argent) return null;
  if (payments === undefined) return <Skeleton className="h-44 w-full rounded-xl" />;

  const cycle =
    payments.find((p) => now >= p.cycleStart && now < p.cycleEnd) ?? payments[0] ?? null;
  const due = cycle?.totalDue ?? 0;
  const payoutTs = cycle?.cycleEnd ?? null;
  const days =
    payoutTs !== null ? Math.max(0, Math.ceil((payoutTs - now) / 86_400_000)) : null;
  const p = raw ? buildProgression(raw) : null;
  const reward = p?.nextReward ?? null;

  return (
    <section
      data-testid="cycle-gains-card"
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {t("home.gainsTitle")}
          </p>
          <p
            data-testid="dashboard-due"
            className="text-3xl font-bold tracking-tight tabular-nums text-slate-900"
          >
            {formatMoney(due, current.payCurrency, loc)}
          </p>
        </div>
      </div>

      {payoutTs !== null && days !== null && (
        <p className="text-xs text-slate-500">
          {due > 0
            ? t("dashboard.earnings.paidIn", { days, date: formatMoneyDate(payoutTs, loc) })
            : t("dashboard.earnings.nextPayout", { date: formatMoneyDate(payoutTs, loc) })}
        </p>
      )}

      {p && reward && (
        <div className="space-y-1.5" data-testid="next-tier-card">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium text-slate-600">
              {t("progression.nextTier")} ·{" "}
              {reward.kind === "cash"
                ? `+${formatMoney(reward.amount, current.payCurrency, loc)}`
                : (reward.label ?? tLabel("progression.reward"))}
            </span>
            {p.nextThreshold !== null && (
              <span className="tabular-nums text-slate-500">
                {formatViews(p.cumulViews, loc)} / {formatViews(p.nextThreshold, loc)}
              </span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.round(p.progressToNext * 100)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">
            {t("progression.viewsToGo", {
              count: p.remainingViews,
              views: formatViews(p.remainingViews, loc),
            })}
          </p>
        </div>
      )}

      <Link
        href={portalHref(base, "/gains")}
        className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
      >
        {t("dashboard.seeDetail")}
        <ArrowRightIcon className="size-3.5" />
      </Link>
    </section>
  );
}
