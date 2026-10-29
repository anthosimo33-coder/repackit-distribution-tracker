"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatutFiche as Statut } from "@/convex/playbookFiche";

const COULEUR: Record<Statut, string> = {
  prouve: "border-emerald-200 bg-emerald-50 text-emerald-700",
  en_test: "border-sky-200 bg-sky-50 text-sky-700",
  hypothese: "border-slate-200 bg-slate-50 text-slate-600",
  en_usure: "border-amber-200 bg-amber-50 text-amber-700",
  retire: "border-slate-200 bg-white text-slate-400",
};

/** Le statut d'une fiche de playbook : prouvé, en test, hypothèse, en usure, retiré. */
export function StatutFiche({ statut }: { statut: Statut }) {
  const t = useTranslations("admin.scripts.playbookStatut");
  return (
    <Badge variant="outline" className={cn("text-[10px]", COULEUR[statut])} data-testid="playbook-statut">
      {t(statut)}
    </Badge>
  );
}
