"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TYPES_SCENARIO, type TypeScenario } from "@/convex/scenarioBible";

export type Statut = "brouillon" | "actif" | "archive";

const COULEUR: Record<Statut, string> = {
  brouillon: "border-slate-200 bg-slate-50 text-slate-600",
  actif: "border-emerald-200 bg-emerald-50 text-emerald-700",
  archive: "border-slate-200 bg-white text-slate-400",
};

/** Le statut d'un scénario : brouillon, actif (tirable par les campagnes), archivé. */
export function StatutScenario({ statut }: { statut: Statut }) {
  const t = useTranslations("admin.scripts.scenarioStatut");
  return (
    <Badge variant="outline" className={cn("text-[10px]", COULEUR[statut])} data-testid="scenario-statut">
      {t(statut)}
    </Badge>
  );
}

/** Le libellé d'un type de relation (couple, talking stage…) ; un type inconnu s'affiche tel quel. */
export function useTypeScenario(): (type: string) => string {
  const t = useTranslations("admin.scripts.scenarioType");
  return (type) =>
    (TYPES_SCENARIO as readonly string[]).includes(type) ? t(type as TypeScenario) : type;
}
