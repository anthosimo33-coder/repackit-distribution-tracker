"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TYPES_SCENARIO, type TypeScenario } from "@/convex/scenarioBible";

/** Ce qu'enregistre la base ; « brouillon » est un ancien statut, montré et tiré comme « actif ». */
export type Statut = "brouillon" | "actif" | "archive";
/** Les deux états qu'on choisit : tiré à l'assignation, ou archivé. */
export type StatutAffiche = "actif" | "archive";

export const statutAffiche = (s: Statut): StatutAffiche => (s === "archive" ? "archive" : "actif");

const COULEUR: Record<StatutAffiche, string> = {
  actif: "border-emerald-200 bg-emerald-50 text-emerald-700",
  archive: "border-slate-200 bg-white text-slate-400",
};

/** Le statut d'un scénario : actif (tiré quand une assignation choisit son thème) ou archivé. */
export function StatutScenario({ statut }: { statut: Statut }) {
  const t = useTranslations("admin.scripts.scenarioStatut");
  const s = statutAffiche(statut);
  return (
    <Badge variant="outline" className={cn("text-[10px]", COULEUR[s])} data-testid="scenario-statut">
      {t(s)}
    </Badge>
  );
}

/** Le libellé d'un type de relation (couple, talking stage…) ; un type inconnu s'affiche tel quel. */
export function useTypeScenario(): (type: string) => string {
  const t = useTranslations("admin.scripts.scenarioType");
  return (type) =>
    (TYPES_SCENARIO as readonly string[]).includes(type) ? t(type as TypeScenario) : type;
}
