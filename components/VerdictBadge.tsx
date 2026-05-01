import { cn } from "@/lib/utils";
import type { Verdict } from "@/lib/verdict";

const STYLES: Record<NonNullable<Verdict>, string> = {
  WINNER: "bg-emerald-100 text-emerald-800 border-emerald-200",
  MOYEN: "bg-amber-100 text-amber-800 border-amber-200",
  FOLD: "bg-rose-100 text-rose-800 border-rose-200",
};

const PENDING = "bg-slate-100 text-slate-500 border-slate-200";

export function VerdictBadge({
  verdict,
  className,
}: {
  verdict: Verdict;
  className?: string;
}) {
  const label = verdict ?? "En attente";
  const style = verdict ? STYLES[verdict] : PENDING;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        style,
        className,
      )}
    >
      {label}
    </span>
  );
}

const PLATFORM_STYLES: Record<string, string> = {
  TikTok: "bg-zinc-900 text-white border-zinc-900",
  Instagram:
    "border-transparent bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 text-white",
};

export function PlatformBadge({ plateforme }: { plateforme: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        PLATFORM_STYLES[plateforme] ?? "bg-slate-200 text-slate-700",
      )}
    >
      {plateforme}
    </span>
  );
}
