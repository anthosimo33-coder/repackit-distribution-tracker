"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon, LockIcon, TrendingUpIcon } from "lucide-react";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import {
  useMyPayments,
  useMyProgression,
  useMyPublishedVideos,
} from "@/components/portal/creator-data";
import { usePortalBase } from "@/components/portal/ViewAsContext";
import { PaymentInfoNudge } from "@/components/portal/PaymentInfoNudge";
import { RankCard } from "@/components/portal/RankCard";
import { AnimatedNumber } from "@/components/portal/AnimatedNumber";
import { ViewsPulseCard } from "@/components/portal/ViewsPulseCard";
import { useMyViewsPulse } from "@/components/portal/creator-data";
import { Skeleton } from "@/components/ui/skeleton";
import { buildProgression, type ProgressionReward } from "@/lib/progression";
import { formatMoney, formatViews } from "@/lib/format-rate";
import { formatMoneyDate } from "@/lib/format";
import { formatCycleRange } from "@/lib/pay-cycle";
import { isSnytchProject } from "@/lib/snytch-drive";
import { portalHref } from "@/lib/view-as";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useLabel } from "@/lib/use-label";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * « GAINS » — l'onglet de ce que la créatrice a gagné et de ce qui arrive.
 *
 * Réunit trois écrans qu'il fallait ouvrir un par un : le cycle en cours (qui
 * était « Mes paiements »), les paliers (« Ma progression ») et le classement
 * (au fond de l'accueil). Les écrans détaillés restent, et se rejoignent d'ici :
 * `/paiements` pour le relevé ligne à ligne et l'historique, `/progression` pour
 * les victoires, `/videos` pour chaque vidéo.
 *
 * Aucun chiffre n'est calculé ici : montants, répartition et paliers viennent
 * des mêmes queries que les écrans détaillés (moteur de paie, progression).
 *
 * Écran RÉUTILISÉ en observation (« voir son espace ») : la coque refuse l'URL
 * sans le droit « Paiements » (cf `MONEY_SUBS`), les queries view-as ne partent
 * pas non plus.
 */
export default function GainsScreen() {
  const t = useTranslations("portal");
  const loc = useIntlLocale();
  const { current } = useCreatorProject();
  const base = usePortalBase();
  const currency = current.payCurrency;
  const payments = useMyPayments(current.projectId);
  const [now] = useState(() => Date.now());

  const cycle =
    payments?.find((p) => now >= p.cycleStart && now < p.cycleEnd) ?? payments?.[0] ?? null;
  const due = cycle?.totalDue ?? 0;
  const payoutTs = cycle?.cycleEnd ?? null;
  const days =
    payoutTs !== null ? Math.max(0, Math.ceil((payoutTs - now) / 86_400_000)) : null;

  // Répartition du cycle, lue sur l'aperçu pricing temps réel. La prime de défi
  // compte avec les bonus : c'est un gain au-delà du barème, comme un palier.
  const b = cycle?.pricingBreakdown;
  const split = b
    ? [
        { key: "fixed" as const, amount: b.fixedTotal, color: "bg-slate-900" },
        { key: "views" as const, amount: b.cpmTotal, color: "bg-primary" },
        {
          key: "bonus" as const,
          amount:
            b.bonusTierCashTotal + b.challengeWins.reduce((s, w) => s + w.montant, 0),
          color: "bg-emerald-500",
        },
      ]
    : [];
  const splitTotal = split.reduce((s, x) => s + x.amount, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("gains.title")}</h1>
        <p className="text-sm text-slate-500">{t("gains.subtitle")}</p>
      </header>

      <PaymentInfoNudge projectId={current.projectId} />

      <ViewsPulseCard />

      {payments === undefined ? (
        <Skeleton className="h-52 w-full rounded-xl" />
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <p className="text-sm text-slate-500">
                {cycle
                  ? t("gains.cycle", { range: formatCycleRange(cycle.cycleStart, cycle.cycleEnd, loc) })
                  : t("paiements.dueThisCycle")}
              </p>
              <AnimatedNumber
                testId="gains-due"
                value={due}
                format={(n) => formatMoney(n, currency, loc)}
                className="block text-4xl font-bold tracking-tight tabular-nums text-slate-900 sm:text-5xl"
              />
              <p className="text-sm text-slate-500">
                {payoutTs !== null && days !== null
                  ? due > 0
                    ? t("paiements.paidIn", { days, date: formatMoneyDate(payoutTs, loc) })
                    : t("paiements.nextPayout", { date: formatMoneyDate(payoutTs, loc) })
                  : t("paiements.firstPayHint")}
              </p>
            </div>
            <Link
              href={portalHref(base, "/paiements")}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
            >
              {t("gains.detail")}
              <ArrowRightIcon className="size-4" />
            </Link>
          </div>

          {splitTotal > 0 && (
            <div className="mt-5 space-y-3">
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-4 motion-safe:duration-700">
                {split
                  .filter((x) => x.amount > 0)
                  .map((x) => (
                    <div
                      key={x.key}
                      className={x.color}
                      style={{ width: `${(x.amount / splitTotal) * 100}%` }}
                    />
                  ))}
              </div>
              <dl className="grid grid-cols-3 gap-3">
                {split.map((x) => (
                  <div key={x.key} className="min-w-0 space-y-0.5">
                    <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className={cn("size-2 rounded-sm", x.color)} />
                      {t(`gains.split.${x.key}`)}
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums break-words text-slate-900 sm:text-base">
                      {formatMoney(x.amount, currency, loc)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-6">
          <TiersCard />
          <VideosCard />
        </div>
        <RankCard variant="full" />
      </div>
    </div>
  );
}

function RewardText({ reward, currency }: { reward: ProgressionReward; currency?: string | null }) {
  const loc = useIntlLocale();
  const tLabel = useLabel();
  return (
    <>
      {reward.kind === "cash"
        ? `+${formatMoney(reward.amount, currency, loc)}`
        : (reward.label ?? tLabel("progression.reward"))}
    </>
  );
}

/** Échelle des paliers : débloqués, celui en cours (avec sa barre), verrouillés. */
function TiersCard() {
  const t = useTranslations("portal");
  const loc = useIntlLocale();
  const { current } = useCreatorProject();
  const base = usePortalBase();
  const raw = useMyProgression(current.projectId);
  if (raw === undefined) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (raw === null) return null;
  const p = buildProgression(raw);
  if (p.ladder.length === 0) return null;
  const nextIndex = p.ladder.findIndex((l) => !l.unlocked);

  return (
    <section data-testid="gains-tiers" className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <h2 className="text-base font-semibold text-slate-900">{t("gains.tiersTitle")}</h2>
        <p className="text-xs tabular-nums text-slate-500">
          {formatViews(p.cumulViews, loc)} · {t("progression.cumulViews")}
        </p>
      </div>
      <ol>
        {p.ladder.map((l, i) => {
          const state = l.unlocked ? "done" : i === nextIndex ? "now" : "todo";
          return (
            <li
              key={l.threshold}
              data-state={state}
              className="flex gap-3 border-t border-slate-100 py-3"
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full",
                  state === "done" && "bg-emerald-500 text-white",
                  state === "now" && "bg-primary text-primary-foreground",
                  state === "todo" && "bg-slate-100 text-slate-400",
                )}
              >
                {state === "done" ? (
                  <CheckIcon className="size-3.5" strokeWidth={3} />
                ) : state === "now" ? (
                  <TrendingUpIcon className="size-3.5" />
                ) : (
                  <LockIcon className="size-3" />
                )}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      state === "todo" ? "text-slate-500" : "text-slate-900",
                    )}
                  >
                    {t("progression.thresholdViews", { views: formatViews(l.threshold, loc) })}
                  </p>
                  <p
                    className={cn(
                      "text-sm font-bold",
                      state === "done" && "text-emerald-600",
                      state === "now" && "text-primary",
                      state === "todo" && "text-slate-400",
                    )}
                  >
                    <RewardText reward={l.reward} currency={current.payCurrency} />
                  </p>
                </div>
                {state === "now" && (
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.round(p.progressToNext * 100)}%` }}
                    />
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  {state === "done"
                    ? l.unlockedAt
                      ? `${t("progression.unlocked")} · ${formatMoneyDate(l.unlockedAt, loc)}`
                      : t("progression.unlocked")
                    : state === "now"
                      ? t("progression.viewsToGo", {
                          count: p.remainingViews,
                          views: formatViews(p.remainingViews, loc),
                        })
                      : t("gains.toGo", {
                          views: formatViews(Math.max(0, l.threshold - p.cumulViews), loc),
                        })}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <Link
        href={portalHref(base, "/progression")}
        className="inline-flex items-center gap-1 pt-1 text-sm font-semibold text-primary hover:underline"
      >
        {t("paiements.seeProgress")}
        <ArrowRightIcon className="size-3.5" />
      </Link>
    </section>
  );
}

/** Les dernières vidéos en ligne (Snytch) : vues et gain de chacune. */
function VideosCard() {
  const t = useTranslations("portal");
  const loc = useIntlLocale();
  const { current } = useCreatorProject();
  const base = usePortalBase();
  const videos = useMyPublishedVideos(current.projectId);
  const pulse = useMyViewsPulse(current.projectId);
  const yesterdayOf = (assignmentId: string) =>
    pulse?.perAssignment.find((p) => p.assignmentId === assignmentId)?.views ?? 0;
  if (!isSnytchProject(current.slug)) return null;
  if (videos === undefined) return <Skeleton className="h-48 w-full rounded-xl" />;
  const online = videos
    .filter((v) => v.publishedAt !== null && (v.status === "published" || v.status === "paid"))
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, 4);
  if (online.length === 0) return null;

  return (
    <section data-testid="gains-videos" className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-slate-900">{t("gains.videosTitle")}</h2>
        <Link
          href={portalHref(base, "/videos")}
          className="text-sm font-semibold text-primary hover:underline"
        >
          {t("gains.videosAll")}
        </Link>
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {online.map((v, i) => (
          <li key={`${i}-${v.publishedAt}`} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{v.formatName}</p>
              <p className="text-xs text-slate-500">
                {v.publishedAt !== null && formatMoneyDate(v.publishedAt, loc)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums text-slate-900">
                {v.gain === null ? "—" : formatMoney(v.gain, current.payCurrency, loc)}
              </p>
              <p className="text-xs tabular-nums text-slate-500">
                {v.views === null ? "—" : t("gains.views", { views: formatViews(v.views, loc) })}
              </p>
              {yesterdayOf(v.id) > 0 && (
                <p className="text-[11px] font-semibold tabular-nums text-emerald-600">
                  {t("pulse.perVideo", { views: formatViews(yesterdayOf(v.id), loc) })}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
