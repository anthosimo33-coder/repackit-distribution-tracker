"use client";

import { useSnapshotAge } from "./SnapshotAgeContext";
import { FIXED_AGES, type SnapshotAge } from "@/lib/snapshot-matching";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const LABELS: Record<SnapshotAge, string> = {
  j1: "J+1",
  j3: "J+3",
  j7: "J+7",
  j14: "J+14",
  j30: "J+30",
  j60: "J+60",
  j90: "J+90",
  latest: "Latest",
  custom: "Custom",
};

const ORDER: readonly SnapshotAge[] = [...FIXED_AGES, "latest", "custom"];

/**
 * Sélecteur global de période d'âge de snapshot. Lit/écrit le SnapshotAgeContext
 * (pas de props value/onChange — c'est un contrôle global). `compact` densifie
 * pour les headers de page étroits.
 */
export function SnapshotAgeSelector({ compact = false }: { compact?: boolean }) {
  const { age, customDay, setAge, setCustomDay } = useSnapshotAge();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!compact && (
        <span className="text-xs font-medium text-slate-500">Période</span>
      )}
      <div
        className="inline-flex flex-wrap rounded-md border border-slate-200 bg-white p-0.5"
        role="radiogroup"
        aria-label="Âge du snapshot"
      >
        {ORDER.map((opt) => (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={age === opt}
            onClick={() => setAge(opt)}
            className={cn(
              "rounded font-medium transition-colors",
              compact ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
              age === opt
                ? "bg-primary text-primary-foreground"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            {LABELS[opt]}
          </button>
        ))}
      </div>
      {age === "custom" && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">J+</span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={String(customDay)}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 0) setCustomDay(n);
            }}
            className="h-7 w-16 text-xs"
            aria-label="Jour personnalisé"
          />
        </div>
      )}
    </div>
  );
}
