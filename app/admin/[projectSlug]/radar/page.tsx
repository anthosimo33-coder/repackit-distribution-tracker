"use client";

import { useProjectQuery } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { RadarIcon, UsersIcon, TrendingUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { RadarSyncButton } from "@/components/admin/radar/RadarSyncButton";
import { AddRadarAccountDialog } from "@/components/admin/radar/AddRadarAccountDialog";
import { RadarAccountsList } from "@/components/admin/radar/RadarAccountsList";
import { RadarVideoWall } from "@/components/admin/radar/RadarVideoWall";

/**
 * RADAR — veille TikTok (ADMIN UNIQUEMENT). Section séparée du tracking
 * créateurs. Brique 1 = comptes favoris + suivi de leurs vidéos. L'onglet
 * « Tendances US » (Brique 2) est réservé en placeholder pour plus tard.
 * L'accès est gardé serveur (adminQuery/adminMutation) : un créateur ne peut
 * atteindre aucune fonction Radar.
 */
export default function RadarPage() {
  const data = useProjectQuery(api.radar.listRadarAccounts, {});
  const accounts = data?.accounts;
  const limit = data?.limit ?? 8;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <RadarIcon className="size-5" />
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Radar
            </h1>
            <p className="text-sm text-slate-500">
              Veille TikTok — suis des comptes en favori et leurs dernières
              vidéos.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RadarSyncButton />
          <AddRadarAccountDialog />
        </div>
      </header>

      <Tabs defaultValue="comptes">
        <TabsList>
          <TabsTrigger value="comptes">
            <UsersIcon className="size-4" />
            Comptes suivis
          </TabsTrigger>
          <TabsTrigger value="tendances">
            <TrendingUpIcon className="size-4" />
            Tendances US
          </TabsTrigger>
        </TabsList>

        <TabsContent value="comptes" className="mt-6 space-y-6">
          {accounts === undefined ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      accounts.length >= limit
                        ? "text-amber-600"
                        : "text-slate-900",
                    )}
                  >
                    {accounts.length} / {limit}
                  </span>{" "}
                  compte{accounts.length > 1 ? "s" : ""} suivi
                  {accounts.length > 1 ? "s" : ""}
                </p>
                {accounts.length >= limit && (
                  <p className="text-xs text-amber-600">
                    Limite conseillée atteinte — quota Apify à surveiller.
                  </p>
                )}
              </div>

              {accounts.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
                  <RadarIcon
                    className="size-14 text-slate-300"
                    strokeWidth={1.5}
                  />
                  <div className="space-y-1">
                    <h2 className="text-base font-semibold text-slate-900">
                      Aucun compte suivi
                    </h2>
                    <p className="text-sm text-slate-500">
                      Ajoute un compte TikTok pour suivre ses dernières vidéos.
                    </p>
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
          )}
        </TabsContent>

        <TabsContent value="tendances" className="mt-6">
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 py-20 text-center">
            <TrendingUpIcon className="size-14 text-slate-300" strokeWidth={1.5} />
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900">
                Tendances US — bientôt
              </h2>
              <p className="max-w-sm text-sm text-slate-500">
                La veille des vidéos qui montent par zone géographique arrivera
                ici (Brique 2).
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
