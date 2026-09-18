/**
 * Point de départ du MODE PARTAGE : les filtres posés sur le Tracker.
 *
 * « Je partage ce que je regarde » — le lien part du même périmètre que la vue,
 * au lieu de repartir de 30 jours. Ce qui ne se traduit pas dans un lien est
 * RENDU dans `dropped` : l'écran le dit, plutôt que d'élargir en silence ce
 * qu'on croyait restreindre.
 */
import type { WarmupMode } from "./warmup-mode";

export type TrackerFiltersSnapshot = {
  /** "YYYY-MM-DD" ou "" (champ date vide). */
  dateFrom: string;
  dateTo: string;
  creatorIds: ReadonlySet<string>;
  comptes: ReadonlySet<string>;
  plateformes: ReadonlySet<string>;
  formatIds: ReadonlySet<string>;
  campaignIds: ReadonlySet<string>;
  warmup: WarmupMode;
};

export type SharePeriodPreset = "7" | "30" | "90" | "fixed" | "all";

export type ShareStart = {
  preset: SharePeriodPreset;
  fixedFrom: string;
  fixedTo: string;
  creatorIds: Set<string>;
  comptes: Set<string>;
  plateformes: Set<string>;
  campaignIds: Set<string>;
  warmup: WarmupMode;
  /** Filtres repris depuis le Tracker (pour l'annoncer). */
  carried: boolean;
  /** Filtres du Tracker qu'un lien ne sait pas porter. */
  dropped: ("format" | "periodEndOnly")[];
};

/** Période par défaut quand le Tracker n'en fixe aucune. */
export const DEFAULT_SHARE_PRESET: SharePeriodPreset = "30";

export function shareStartFromTracker(
  f: TrackerFiltersSnapshot,
  /** Aujourd'hui, "YYYY-MM-DD" dans le fuseau de l'écran. */
  today: string,
): ShareStart {
  const dropped: ShareStart["dropped"] = [];
  let preset: SharePeriodPreset = DEFAULT_SHARE_PRESET;
  let fixedFrom = "";
  let fixedTo = "";
  if (f.dateFrom !== "") {
    // « Du » seul = depuis cette date jusqu'à aujourd'hui, figé : un lien
    // envoyé ne doit pas s'allonger tout seul si on a choisi un début précis.
    preset = "fixed";
    fixedFrom = f.dateFrom;
    fixedTo = f.dateTo !== "" ? f.dateTo : today;
  } else if (f.dateTo !== "") {
    // « Au » seul n'a pas d'équivalent (une période de lien a un début) : on
    // garde le défaut ET on le dit.
    dropped.push("periodEndOnly");
  }
  if (f.formatIds.size > 0) dropped.push("format");

  const carried =
    preset === "fixed" ||
    f.creatorIds.size > 0 ||
    f.comptes.size > 0 ||
    f.plateformes.size > 0 ||
    f.campaignIds.size > 0 ||
    f.warmup !== "exclude";

  return {
    preset,
    fixedFrom,
    fixedTo,
    creatorIds: new Set(f.creatorIds),
    comptes: new Set(f.comptes),
    plateformes: new Set(f.plateformes),
    campaignIds: new Set(f.campaignIds),
    warmup: f.warmup,
    carried,
    dropped,
  };
}
