"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { RadarIcon, UsersIcon, WalletIcon, ZapIcon } from "lucide-react";
import { RadarNetworks } from "@/components/admin/radar/RadarNetworks";
import { RadarSignals } from "@/components/admin/radar/RadarSignals";
import { RadarBudget } from "@/components/admin/radar/RadarBudget";
import { useTranslations } from "next-intl";

const ONGLETS = ["signaux", "comptes", "budget"] as const;
type Onglet = (typeof ONGLETS)[number];

export default function RadarPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <RadarPageInner />
    </Suspense>
  );
}

/**
 * RADAR — veille (ADMIN UNIQUEMENT). « Signaux » : les vidéos qui sortent du lot
 * dans toutes les apps (ScrapeCreators, convex/radarSignals) ; « Comptes suivis » :
 * les apps suivies et le réseau de comptes qui les poussent (convex/radarNetworks) ;
 * « Budget » : ce que la
 * veille coûte chaque mois. L'onglet vit dans l'adresse (`?onglet=`), comme les
 * filtres des signaux. L'accès est gardé serveur : un créateur n'atteint aucune
 * fonction Radar.
 */
function RadarPageInner() {
  const tr = useTranslations("admin.ops.RadarPage");
  const router = useRouter();
  const projectPath = useProjectPath();
  const searchParams = useSearchParams();
  const raw = searchParams.get("onglet");
  const onglet: Onglet = (ONGLETS as readonly string[]).includes(raw ?? "") ? (raw as Onglet) : "signaux";

  function choisir(o: string) {
    const params = new URLSearchParams(searchParams);
    if (o === "signaux") params.delete("onglet");
    else params.set("onglet", o);
    const qs = params.toString();
    router.replace(projectPath(qs ? `/radar?${qs}` : "/radar"), { scroll: false });
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
          <RadarIcon className="size-5" />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tr("radar")}</h1>
          <p className="text-sm text-slate-500">{tr("sousTitre")}</p>
        </div>
      </header>

      <Tabs value={onglet} onValueChange={(v) => choisir(String(v))}>
        <TabsList>
          <TabsTrigger value="signaux">
            <ZapIcon className="size-4" />
            {tr("signaux")}
          </TabsTrigger>
          <TabsTrigger value="comptes">
            <UsersIcon className="size-4" />
            {tr("comptesSuivis")}
          </TabsTrigger>
          <TabsTrigger value="budget">
            <WalletIcon className="size-4" />
            {tr("budget")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="signaux" className="mt-6">
          <RadarSignals />
        </TabsContent>

        <TabsContent value="comptes" className="mt-6">
          <RadarNetworks />
        </TabsContent>

        <TabsContent value="budget" className="mt-6">
          <RadarBudget />
        </TabsContent>
      </Tabs>
    </div>
  );
}
