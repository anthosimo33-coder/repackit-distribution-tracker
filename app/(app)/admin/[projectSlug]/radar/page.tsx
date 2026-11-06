"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { RadarIcon, UsersIcon, WalletIcon, ZapIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { RadarSyncButton } from "@/components/admin/radar/RadarSyncButton";
import { AddRadarAccountDialog } from "@/components/admin/radar/AddRadarAccountDialog";
import { RadarAccountsList } from "@/components/admin/radar/RadarAccountsList";
import { RadarVideoWall } from "@/components/admin/radar/RadarVideoWall";
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
 * les comptes favoris et leur mur (Apify, convex/radar) ; « Budget » : ce que la
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

        <TabsContent value="comptes" className="mt-6 space-y-6">
          <ComptesSuivis />
        </TabsContent>

        <TabsContent value="budget" className="mt-6">
          <RadarBudget />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Les comptes favoris suivis (relevé Apify) et leur mur de vidéos — l'ancien premier onglet. */
function ComptesSuivis() {
  const tr = useTranslations("admin.ops.RadarPage");
  const data = useProjectQuery(api.radar.listRadarAccounts, {});
  const accounts = data?.accounts;
  const limit = data?.limit ?? 8;

  if (accounts === undefined) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          <span className={cn("font-medium tabular-nums", accounts.length >= limit ? "text-amber-600" : "text-slate-900")}>
            {accounts.length} / {limit}
          </span>{" "}
          {tr("compteSuivi", { count: accounts.length })}
          {accounts.length >= limit && <span className="ml-2 text-xs text-amber-600">{tr("limiteConseilleeAtteinteQuotaApify")}</span>}
        </p>
        <div className="flex items-center gap-2">
          <RadarSyncButton />
          <AddRadarAccountDialog />
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
          <RadarIcon className="size-14 text-slate-300" strokeWidth={1.5} />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900">{tr("aucunCompteSuivi")}</h2>
            <p className="text-sm text-slate-500">{tr("ajouteUnCompteTiktokPour")}</p>
          </div>
          <AddRadarAccountDialog />
        </div>
      ) : (
        <>
          <RadarAccountsList accounts={accounts} />
          <RadarVideoWall accounts={accounts} />
        </>
      )}
    </>
  );
}
