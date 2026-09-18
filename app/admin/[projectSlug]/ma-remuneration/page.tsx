"use client";

import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { ManagerPayReport } from "@/components/admin/ManagerPayReport";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * « Ma rémunération » — le manager voit les vues des créatrices qu'il gère et ce
 * qu'elles lui rapportent au CPM (convex/managerCpm.ts).
 *
 * Pas de `PermissionGate` : ce n'est pas un bloc du catalogue qu'on accorde,
 * c'est la paie de la personne connectée. La query rend `null` à qui n'est pas
 * manager, et l'écran le dit au lieu de lever.
 */
export default function MaRemunerationPage() {
  const tr = useTranslations("admin.money.ManagerPayPage");
  const data = useProjectQuery(api.managerPay.getMyManagerPay, {});

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          {tr("titre")}
        </h1>
        <p className="text-sm text-slate-500">{tr("sousTitre")}</p>
      </header>

      {data === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : data === null ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-slate-500">
            {tr("pasManager")}
          </CardContent>
        </Card>
      ) : data.creators.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-slate-500">
            {tr("aucunCpm")}
          </CardContent>
        </Card>
      ) : (
        <ManagerPayReport data={data} />
      )}
    </div>
  );
}
