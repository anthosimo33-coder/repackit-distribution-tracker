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
  /**
   * Effectif derrière l'option, rendu en suffixe « (46) ». Évite de cocher une
   * entrée pour découvrir qu'elle ne contient qu'une ligne. Absent = rien affiché.
   */
  count?: number;
  /**
   * Regroupement optionnel. Deux options consécutives de sections différentes
   * font apparaître un intertitre — l'ORDRE reste entièrement décidé par
   * l'appelant (aucun tri interne), ce qui permet p.ex. un classement par
   * effectif décroissant à l'intérieur de chaque section.
   */
  section?: string;
  /** Rendu atténué (option encore sélectionnable mais secondaire, ex. archivée). */
  muted?: boolean;
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
  sectionLabels,
  triggerLabel: triggerLabelOverride,
}: {
  label: string;
  selectedValues: Set<string>;
  onChange: (next: Set<string>) => void;
  options: FilterMultiSelectOption[];
  allLabel?: string;
  width?: string;
  /** Intertitre affiché par clé de section (clé absente = pas d'intertitre). */
  sectionLabels?: Record<string, string>;
  /**
   * Remplace le libellé du déclencheur. Sans lui, le comportement historique est
   * conservé (nom unique, sinon « N sélectionnés »).
   */
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  const triggerLabel = useMemo(() => {
    if (triggerLabelOverride !== undefined) return triggerLabelOverride;
    if (selectedValues.size === 0) return allLabel;
    if (selectedValues.size === 1) {
      const only = Array.from(selectedValues)[0];
      return options.find((o) => o.value === only)?.label ?? only;
    }
    return `${selectedValues.size} sélectionnés`;
  }, [selectedValues, options, allLabel, triggerLabelOverride]);

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
          // Largeur ADAPTÉE au contenu, bornée. À 220 px fixes, deux campagnes
          // dont les noms ne divergent qu'après 20 caractères se rendaient
          // identiques (« Format 3 - POV Dem… ») — on ne pouvait plus les
          // distinguer pour cocher la bonne.
          className="w-max min-w-[220px] max-w-[420px] p-1"
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
            {options.map((o, i) => {
              const checked = selectedValues.has(o.value);
              // Intertitre au CHANGEMENT de section (l'ordre vient de l'appelant).
              const prev = i > 0 ? options[i - 1].section : undefined;
              const heading =
                o.section !== undefined && o.section !== prev
                  ? sectionLabels?.[o.section]
                  : undefined;
              return (
                <li key={o.value}>
                  {heading !== undefined && (
                    <div className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                      {heading}
                    </div>
                  )}
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
                    <span
                      className={cn(
                        "flex-1 truncate",
                        o.muted && !checked && "text-slate-500 italic",
                      )}
                    >
                      {o.label}
                    </span>
                    {o.count !== undefined && (
                      <span className="shrink-0 text-xs tabular-nums text-slate-400">
                        {o.count}
                      </span>
                    )}
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
