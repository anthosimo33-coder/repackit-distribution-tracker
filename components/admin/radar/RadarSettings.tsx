"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeftIcon } from "lucide-react";
import { RadarNetworks } from "@/components/admin/radar/RadarNetworks";
import { RadarBudget } from "@/components/admin/radar/RadarBudget";

/**
 * RADAR — RÉGLAGES : ce qu'on surveille (apps suivies, apps repérées chez leurs
 * comptes, réseau de chaque app) et ce que ça coûte (budget du mois, postes,
 * ordre de coupure). On n'y vient que pour ajouter une app ou toucher au budget.
 */
export function RadarSettings({ backHref }: { backHref: string }) {
  const tr = useTranslations("admin.ops.RadarSettings");
  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <Link href={backHref} prefetch={false} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeftIcon className="size-4" aria-hidden />
          {tr("retour")}
        </Link>
        <h2 className="text-xl font-semibold tracking-tight">{tr("titre")}</h2>
        <p className="text-[15px] text-slate-600">{tr("aide")}</p>
      </div>
      <section aria-labelledby="radar-reglages-apps" className="space-y-4">
        <div>
          <h3 id="radar-reglages-apps" className="text-lg font-semibold">
            {tr("appsSuivies")}
          </h3>
          <p className="mt-1 text-sm text-slate-500">{tr("appsSuiviesAide")}</p>
        </div>
        <RadarNetworks />
      </section>
      <section aria-labelledby="radar-reglages-budget" className="space-y-4 border-t border-slate-200 pt-8">
        <div>
          <h3 id="radar-reglages-budget" className="text-lg font-semibold">
            {tr("budget")}
          </h3>
          <p className="mt-1 text-sm text-slate-500">{tr("budgetAide")}</p>
        </div>
        <RadarBudget />
      </section>
    </div>
  );
}
