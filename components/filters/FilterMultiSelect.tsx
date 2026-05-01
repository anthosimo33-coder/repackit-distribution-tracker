"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronDownIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type FilterMultiSelectOption = {
  value: string;
  label: string;
};

/**
 * Multi-select filtre catégoriel. Sémantique : un Set vide = "tous"
 * (aucun filtre actif), Set non vide = matching = selectedSet.has(value).
 *
 * Distinct de <FilterSelect> (binaire vs catégoriel) : pas fusionnable sans
 * complexifier le contrat — séparation gardée volontairement.
 *
 * Trigger : "allLabel" si Set vide, "X sélectionnés" si > 1, valeur unique si 1.
 * Le Popover reste ouvert après chaque toggle (le user en sélectionne plusieurs).
 */
export function FilterMultiSelect({
  label,
  selectedValues,
  onChange,
  options,
  allLabel = "Tous",
  width,
}: {
  label: string;
  selectedValues: Set<string>;
  onChange: (next: Set<string>) => void;
  options: FilterMultiSelectOption[];
  allLabel?: string;
  width?: string;
}) {
  const [open, setOpen] = useState(false);

  const triggerLabel = useMemo(() => {
    if (selectedValues.size === 0) return allLabel;
    if (selectedValues.size === 1) {
      const only = Array.from(selectedValues)[0];
      return options.find((o) => o.value === only)?.label ?? only;
    }
    return `${selectedValues.size} sélectionnés`;
  }, [selectedValues, options, allLabel]);

  const allSelected = selectedValues.size === options.length;

  function toggle(value: string) {
    const next = new Set(selectedValues);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  function selectAll() {
    onChange(new Set(options.map((o) => o.value)));
  }

  function deselectAll() {
    onChange(new Set());
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              size="sm"
              className={cn(
                "h-9 justify-between gap-2 px-3 font-normal",
                selectedValues.size === 0 && "text-slate-500",
                width,
              )}
            >
              <span className="truncate">{triggerLabel}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
            </Button>
          }
        />
        <PopoverContent
          className="w-[220px] p-1"
          align="start"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-2 pb-1.5">
            <button
              type="button"
              onClick={allSelected ? deselectAll : selectAll}
              className="text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
            </button>
            {selectedValues.size > 0 && (
              <span className="text-xs text-slate-400">
                {selectedValues.size}/{options.length}
              </span>
            )}
          </div>
          <ul className="space-y-0.5 pt-1">
            {options.map((o) => {
              const checked = selectedValues.has(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(o.value)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      checked
                        ? "bg-slate-100 text-slate-900"
                        : "text-slate-700 hover:bg-slate-50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border border-slate-300",
                        checked && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      <CheckIcon
                        className={cn("size-3", !checked && "opacity-0")}
                      />
                    </span>
                    <span className="flex-1 truncate">{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
