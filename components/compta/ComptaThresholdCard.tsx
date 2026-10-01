"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/InfoTip";
import { VAT_THRESHOLDS_EUR } from "@/convex/comptaMath";
import { cn } from "@/lib/utils";
import { useComptaFormat } from "./compta-format";
import type { ComptaOverview } from "./ComptaPage";

/**
 * CA BRUT CUMULÉ de l'exercice face aux deux seuils (franchise TVA, services).
 * Jauge de 0 à max(45 000 €, projection) : l'encaissé en plein, la projection
 * au 31 déc. hachurée, la zone entre les seuils en ambre, au-delà en rouge.
 * Les seuils sont en euros : sans référence en euros, seul le cumul s'affiche.
 */
export function ComptaThresholdCard({ data }: { data: ComptaOverview }) {
  const t = useTranslations("admin.money.Compta.threshold");
  const f = useComptaFormat();
  const v = data.thresholds;
  const cur = data.currency;

  if (v === null) {
    return (
      <Card className="py-0 lg:col-span-2">
        <CardContent className="space-y-2 p-5">
          <div className="text-sm font-medium text-slate-700">{t("cumulOnly")}</div>
          <div className="text-4xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {f.money(data.totals.gross, cur)}
          </div>
          <p className="text-xs text-slate-400">{t("notEur")}</p>
        </CardContent>
      </Card>
    );
  }

  const { base, majored } = VAT_THRESHOLDS_EUR;
  const scaleMax = Math.max(45_000, (v.endOfYear ?? 0) * 1.05, v.cumul * 1.05);
  const pos = (x: number) => `${(Math.min(Math.max(x, 0), scaleMax) / scaleMax) * 100}%`;
  const statusTone =
    v.status === "below"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : v.status === "between"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-red-200 bg-red-50 text-red-700";
  const statusDot =
    v.status === "below" ? "bg-emerald-500" : v.status === "between" ? "bg-amber-500" : "bg-red-500";
  const statusLabel =
    v.status === "below" ? t("statusBelow") : v.status === "between" ? t("statusBetween") : t("statusAbove");
  const isCurrentYear = data.today.startsWith(String(data.year));
  // « aujourd'hui » sous la jauge seulement s'il ne chevauche ni 0 ni les seuils.
  const cumulShare = v.cumul / scaleMax;
  const showToday = isCurrentYear && cumulShare > 0.06 && 0.7 > cumulShare;
  const hatch = (alpha: number, size: number) =>
    `repeating-linear-gradient(135deg, color-mix(in oklab, var(--primary) ${alpha}%, transparent) 0 ${size}px, transparent ${size}px ${size * 2}px)`;

  const thresholdHint = (th: typeof v.base) =>
    th.reached
      ? t("crossedOn", { date: f.dayMonth(th.reachedOn!) })
      : th.reachedOn
        ? t("reachedOn", { date: f.dayMonth(th.reachedOn) })
        : isCurrentYear && v.dailyRate !== null && v.dailyRate > 0
          ? t("notThisYear")
          : "—";

  return (
    <Card className="py-0 lg:col-span-2" data-testid="compta-threshold-card">
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
              {t("title", { year: data.year })}
              <InfoTip label={t("infoLabel")}>
                {t("info", { base: f.whole(base, cur), majored: f.whole(majored, cur) })}
              </InfoTip>
            </div>
            <div
              className="text-4xl font-semibold tracking-tight text-slate-900 tabular-nums"
              data-testid="compta-gross-cumul"
            >
              {f.money(v.cumul, cur)}
            </div>
            <div className="text-xs text-slate-500">
              {isCurrentYear
                ? t("sub", { date: f.dayMonth(data.today), pct: f.pct(v.cumul / base) })
                : t("subClosed", { year: data.year, pct: f.pct(v.cumul / base) })}
            </div>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              statusTone,
            )}
          >
            <span className={cn("size-1.5 rounded-full", statusDot)} />
            {statusLabel}
          </span>
        </div>

        <div className="pt-1">
          <div className="relative h-3.5 rounded-full bg-slate-100">
            <div
              className="absolute inset-y-0 bg-amber-100"
              style={{ left: pos(base), width: `calc(${pos(majored)} - ${pos(base)})` }}
            />
            <div className="absolute inset-y-0 right-0 rounded-r-full bg-red-100" style={{ left: pos(majored) }} />
            {v.endOfYear !== null && v.endOfYear > v.cumul && (
              <div
                className="absolute inset-y-0 left-0 rounded-l-full"
                style={{ width: pos(v.endOfYear), backgroundImage: hatch(28, 4) }}
              />
            )}
            <div className="absolute inset-y-0 left-0 rounded-l-full bg-primary" style={{ width: pos(v.cumul) }} />
            {[base, majored].map((th, i) => (
              <div
                key={th}
                className={cn("absolute -top-1 -bottom-1 w-0.5 rounded-full", i === 0 ? "bg-amber-500" : "bg-red-500")}
                style={{ left: pos(th) }}
              />
            ))}
          </div>
          <div className="relative mt-1.5 h-4 text-[11px] tabular-nums text-slate-400">
            <span className="absolute left-0">{f.whole(0, cur)}</span>
            {showToday && (
              <span className="absolute -translate-x-1/2 font-medium text-slate-700" style={{ left: pos(v.cumul) }}>
                {t("today")}
              </span>
            )}
            <span className="absolute -translate-x-full pr-1.5 font-medium text-amber-700" style={{ left: pos(base) }}>
              {f.whole(base, cur)}
            </span>
            {/* Près du bord droit, l'étiquette s'aligne sur la fin de la jauge :
                posée à droite du repère, elle sortait de la carte sur téléphone. */}
            <span
              className={cn("absolute font-medium text-red-700", majored / scaleMax > 0.8 ? "right-0" : "pl-1.5")}
              style={majored / scaleMax > 0.8 ? undefined : { left: pos(majored) }}
            >
              {f.whole(majored, cur)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm bg-primary" />
              {t("legendCashed")}
            </span>
            {v.endOfYear !== null && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-3 rounded-sm" style={{ backgroundImage: hatch(45, 2) }} />
                {t("legendProjection")}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm bg-amber-100 ring-1 ring-amber-300" />
              {t("legendBetween")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm bg-red-100 ring-1 ring-red-300" />
              {t("legendAbove")}
            </span>
          </div>
        </div>

        <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3">
          <Stat
            label={t("remaining", { threshold: f.whole(base, cur) })}
            value={f.money(v.base.remaining, cur)}
            hint={thresholdHint(v.base)}
            tone="amber"
          />
          <Stat
            label={t("remaining", { threshold: f.whole(majored, cur) })}
            value={f.money(v.majored.remaining, cur)}
            hint={thresholdHint(v.majored)}
            tone="red"
          />
          <Stat
            label={t("rate")}
            value={v.dailyRate === null ? "—" : t("perDay", { amount: f.money(v.dailyRate, cur) })}
            hint={
              v.endOfYear === null
                ? "—"
                : v.dailyRate === 0
                  ? t("noRate")
                  : t("endOfYear", { amount: f.whole(Math.round(v.endOfYear / 100) * 100, cur) })
            }
          />
        </div>
        {isCurrentYear && <p className="text-xs text-slate-400">{t("footnote")}</p>}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "amber" | "red";
}) {
  return (
    <div className="space-y-0.5 bg-white px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900 tabular-nums">{value}</div>
      <div
        className={cn(
          "text-xs tabular-nums",
          tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-slate-500",
        )}
      >
        {hint}
      </div>
    </div>
  );
}
