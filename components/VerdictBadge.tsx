import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { Verdict } from "@/lib/verdict";

const STYLES: Record<NonNullable<Verdict>, string> = {
  WINNER: "bg-emerald-50 text-emerald-700 border-emerald-200",
  MOYEN: "bg-amber-50 text-amber-700 border-amber-200",
  FOLD: "bg-rose-50 text-rose-700 border-rose-200",
};

const PENDING = "bg-slate-50 text-slate-500 border-slate-200";

const BASE =
  "inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-semibold";

export function VerdictBadge({
  verdict,
  className,
}: {
  verdict: Verdict;
  className?: string;
}) {
  const t = useTranslations("portal");
  const label = verdict ?? t("verdict.pending");
  const style = verdict ? STYLES[verdict] : PENDING;
  return (
    <span className={cn(BASE, style, className)}>{label}</span>
  );
}

// Couleurs : TikTok = noir (signature de la marque), Instagram = pink/magenta
// (gradient officiel simplifié), YouTube = rouge (Material Red officiel YouTube).
// Aucun conflit avec les couleurs verdict (emerald/amber/rose) : rose
// ≠ red 50/700 (rose est plus rosé, red plus chaud).
const PLATFORM_STYLES: Record<string, string> = {
  TikTok: "bg-slate-900 text-white border-slate-900",
  Instagram: "bg-pink-50 text-pink-700 border-pink-200",
  YouTube: "bg-red-50 text-red-700 border-red-200",
};

export function PlatformBadge({ plateforme }: { plateforme: string }) {
  return (
    <span
      className={cn(
        BASE,
        PLATFORM_STYLES[plateforme] ?? "bg-slate-50 text-slate-700 border-slate-200",
      )}
    >
      {plateforme}
    </span>
  );
}
