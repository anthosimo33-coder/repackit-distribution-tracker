"use client";

import { useTranslations } from "next-intl";
import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type Verdict = "en_test" | "a_pousser" | "a_couper" | "neutre";

/** Le verdict d'un scénario — mêmes couleurs et mots que ceux des briques (analytics de campagne). */
export function VerdictScenario({ verdict }: { verdict: Verdict }) {
  const tr = useTranslations("admin.scripts.VerdictBadge");
  switch (verdict) {
    case "a_pousser":
      return (
        <Badge className="shrink-0 gap-1 bg-emerald-600 text-white hover:bg-emerald-600" data-testid="scenario-verdict">
          <TrendingUpIcon className="size-3" />
          {tr("aPousser")}
        </Badge>
      );
    case "a_couper":
      return (
        <Badge className="shrink-0 gap-1 bg-rose-600 text-white hover:bg-rose-600" data-testid="scenario-verdict">
          <TrendingDownIcon className="size-3" />
          {tr("aCouper")}
        </Badge>
      );
    case "neutre":
      return (
        <Badge variant="secondary" className="shrink-0 gap-1" data-testid="scenario-verdict">
          <MinusIcon className="size-3" />
          {tr("neutre")}
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="shrink-0 border-amber-300 text-amber-700" data-testid="scenario-verdict">
          {tr("enTest")}
        </Badge>
      );
  }
}
