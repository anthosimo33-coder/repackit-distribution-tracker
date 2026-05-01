"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const FILTER_ALL = "all";

/**
 * Single-select filtre catégoriel partagé entre tracker / hooks / dashboard.
 * Extrait de l'inline tracker pour pouvoir évoluer en parallèle de
 * <FilterMultiSelect> sans toucher chaque page. Le sentinel "all" représente
 * "aucun filtre" — il est volontairement séparé du domaine des valeurs.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  width,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
  width?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <Select value={value} onValueChange={(v) => v !== null && onChange(v)}>
        <SelectTrigger className={width}>
          <SelectValue>{value === FILTER_ALL ? allLabel : value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FILTER_ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
