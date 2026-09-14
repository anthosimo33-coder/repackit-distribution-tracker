"use client";

import { useSnapshotAge } from "./SnapshotAgeContext";
import { FIXED_AGES, type SnapshotAge } from "@/lib/snapshot-matching";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

/**
 * Libellé d'une période. « J+7 » est une convention FRANÇAISE (jour) : en
 * anglais c'est « D+7 ». Le nombre se lit dans la clé (`j7` → 7), la forme vit
 * dans le catalogue.
 */
function useAgeLabel(): (age: SnapshotAge) => string {
  const tDay = useTranslations("admin.common");
  const tr = useTranslations("admin.common.SnapshotAgeSelector");
  return (age) =>
    age === "latest"
      ? tr("latest")
      : age === "custom"
        ? tr("custom")
        : tDay("dayOffset", { days: Number(age.slice(1)) });
}

const ORDER: readonly SnapshotAge[] = [...FIXED_AGES, "latest", "custom"];

/**
 * Sélecteur global de période d'âge de snapshot. Lit/écrit le SnapshotAgeContext
 * (pas de props value/onChange — c'est un contrôle global). `compact` densifie
 * pour les headers de page étroits.
 */
export function SnapshotAgeSelector({ compact = false }: { compact?: boolean }) {
  const tr = useTranslations("admin.common.SnapshotAgeSelector");
  const label = useAgeLabel();
  const { age, customDay, setAge, setCustomDay } = useSnapshotAge();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!compact && (
        <span className="text-xs font-medium text-slate-500">{tr("periode")}</span>
      )}
      <div
        className="inline-flex flex-wrap rounded-md border border-slate-200 bg-white p-0.5"
        role="radiogroup"
        aria-label={tr("ageDuSnapshot")}
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
            {label(opt)}
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
            aria-label={tr("jourPersonnalise")}
          />
        </div>
      )}
    </div>
  );
}
