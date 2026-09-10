"use client";

import { FilterXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterMultiSelect } from "@/components/filters/FilterMultiSelect";
import type { FilterMultiSelectOption } from "@/components/filters/FilterMultiSelect";
import type { CalendarStatusFilter } from "@/components/admin/AssignmentsCalendar";
import { cn } from "@/lib/utils";

export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Tous statuts" },
  { value: "todo", label: "À faire" },
  { value: "in_progress", label: "En cours" },
  { value: "submitted", label: "Soumis" },
  { value: "validated", label: "Validé" },
  { value: "rejected", label: "Rejeté" },
  { value: "paid", label: "Payé" },
];

/** Options du filtre de STATUT CALENDRIER (vue calendrier). Même axe que la
 *  pastille : à l'heure / en retard / manqué / prévu (≠ statut de PRODUCTION). */
export const CAL_STATUS_OPTIONS: {
  value: CalendarStatusFilter;
  label: string;
}[] = [
  { value: "all", label: "Tous statuts" },
  { value: "on_time", label: "À l'heure" },
  { value: "late", label: "En retard" },
  { value: "missed", label: "Manqué" },
  { value: "scheduled", label: "Prévu" },
];

export type AssignmentsFiltersProps = {
  viewMode: "list" | "calendar";
  creatorIds: Set<string>;
  onCreatorIdsChange: (next: Set<string>) => void;
  creatorOptions: { value: string; label: string }[];
  campaignIds: Set<string>;
  onCampaignIdsChange: (next: Set<string>) => void;
  campaignOptions: FilterMultiSelectOption[];
  campaignTriggerLabel: string;
  statusFilter: string;
  onStatusFilterChange: (next: string) => void;
  calStatusFilter: CalendarStatusFilter;
  onCalStatusFilterChange: (next: CalendarStatusFilter) => void;
  overdueOnly: boolean;
  onOverdueOnlyChange: (next: boolean) => void;
  activeFilterCount: number;
  onReset: () => void;
  /**
   * `stacked` : un contrôle par ligne, pleine largeur (panneau mobile).
   * `inline` : la barre historique du desktop, contrôles à largeur fixe.
   */
  layout: "inline" | "stacked";
};

/**
 * Les CONTRÔLES de filtre de l'onglet Assignments, sans la mise en page qui les
 * entoure. Deux hôtes : la barre d'outils desktop (`inline`) et le panneau
 * mobile (`stacked`) — un seul des deux est monté à la fois (cf. useIsCompact),
 * donc aucun libellé n'existe en double dans le DOM.
 *
 * Le filtre de statut change d'AXE selon la vue (production en liste, calendrier
 * en calendrier) mais garde sa place : c'est le même geste pour l'utilisateur.
 */
export function AssignmentsFilters({
  viewMode,
  creatorIds,
  onCreatorIdsChange,
  creatorOptions,
  campaignIds,
  onCampaignIdsChange,
  campaignOptions,
  campaignTriggerLabel,
  statusFilter,
  onStatusFilterChange,
  calStatusFilter,
  onCalStatusFilterChange,
  overdueOnly,
  onOverdueOnlyChange,
  activeFilterCount,
  onReset,
  layout,
}: AssignmentsFiltersProps) {
  const stacked = layout === "stacked";
  const fieldWidth = (w: string) => (stacked ? "w-full" : w);

  return (
    <div
      className={cn(
        stacked
          ? "flex flex-col gap-4"
          : "flex flex-wrap items-end gap-2",
      )}
    >
      {/* Créateur MULTI (Set vide = tous) — partagé liste + calendrier. */}
      <FilterMultiSelect
        label="Créateur"
        selectedValues={creatorIds}
        onChange={onCreatorIdsChange}
        options={creatorOptions}
        allLabel="Tous créateurs"
        width={fieldWidth("w-44")}
      />

      {/* Campagne de scripts MULTI (Set vide = toutes) — partagé liste +
          calendrier. Le déclencheur NOMME la sélection au lieu d'afficher
          « N sélectionnés » : un filtre persistant doit se lire d'un coup
          d'œil au retour sur la page. */}
      <FilterMultiSelect
        label="Campagne"
        selectedValues={campaignIds}
        onChange={onCampaignIdsChange}
        options={campaignOptions}
        sectionLabels={{ active: "Actives", archived: "Archivées" }}
        allLabel="Toutes campagnes"
        triggerLabel={campaignTriggerLabel}
        width={fieldWidth("w-56")}
      />

      {/* Filtre STATUT — MÊME emplacement, axe selon la vue : production en
          liste, calendrier (à l'heure/en retard/manqué/prévu) en calendrier. */}
      {stacked && (
        <span className="-mb-3 text-sm font-medium text-slate-600">Statut</span>
      )}
      {viewMode === "calendar" ? (
        <Select
          value={calStatusFilter}
          onValueChange={(v) =>
            v && onCalStatusFilterChange(v as CalendarStatusFilter)
          }
        >
          <SelectTrigger
            className={fieldWidth("w-40")}
            aria-label="Filtrer par statut calendrier"
          >
            <SelectValue>
              {
                CAL_STATUS_OPTIONS.find((o) => o.value === calStatusFilter)
                  ?.label
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CAL_STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Select
          value={statusFilter}
          onValueChange={(v) => v && onStatusFilterChange(v)}
        >
          <SelectTrigger
            className={fieldWidth("w-40")}
            aria-label="Filtrer par statut"
          >
            <SelectValue>
              {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <label
        className={cn(
          "flex items-center gap-2 text-sm text-slate-600",
          // Cible tactile : 44 px de haut sur téléphone, où la case seule
          // (16 px) est en dessous du seuil confortable.
          stacked && "min-h-11",
        )}
      >
        <Checkbox
          checked={overdueOnly}
          onCheckedChange={(c) => onOverdueOnlyChange(c === true)}
        />
        En retard seulement
      </label>

      {/* Le filtre campagne PERSISTE d'une visite à l'autre : sans un repère
          franc, revenir trois jours plus tard sur une liste restreinte se lit
          comme « des assignations ont disparu ». Ce bouton n'apparaît QUE
          lorsqu'un filtre est actif — il est alors à la fois le signal et le
          remède. */}
      {activeFilterCount > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-1.5 border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
            stacked && "w-full",
          )}
          onClick={onReset}
        >
          <FilterXIcon className="size-3.5" />
          Réinitialiser {activeFilterCount} filtre
          {activeFilterCount > 1 ? "s" : ""}
        </Button>
      )}
    </div>
  );
}
