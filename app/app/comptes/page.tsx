"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PlusIcon,
  MonitorSmartphoneIcon,
  FlameIcon,
  BellRingIcon,
} from "lucide-react";
import { DeclareCompteDialog } from "@/components/creators/portal/DeclareCompteDialog";
import { WarmupCompteCard } from "@/components/creators/portal/WarmupCompteCard";
import { WarmupGuideButton } from "@/components/warmup/WarmupGuideButton";
import { getEffectiveStatus } from "@/lib/compte-status";
import { mustCheckToday } from "@/lib/warmup";

/**
 * P5 — portail créateur : « Mes comptes ». Hors ProjectProvider → projectId
 * résolu via le CreatorProjectProvider (projet courant) puis passé explicitement
 * aux creatorQuery/Mutation.
 * Le serveur ne sert QUE les comptes du créateur (filtrage par creatorId).
 */
export default function CreatorComptesPage() {
  const projectId = useCreatorProjectId();
  const comptes = useQuery(api.comptes.listMyComptes, { projectId });
  const [declareOpen, setDeclareOpen] = useState(false);

  const loading = comptes === undefined;

  // Notif in-app : comptes en warmup à faire/rattraper aujourd'hui (compteur
  // dérivé des comptes déjà chargés — même logique que countMyWarmupDue serveur).
  const dueToday = (comptes ?? []).filter(
    (c) => getEffectiveStatus(c) === "warmup" && mustCheckToday(c),
  );

  // Notif in-app : comptes dont l'admin a (re)défini la bio → à (re)appliquer.
  const bioDue = (comptes ?? []).filter(
    (c) => !!c.bioToApply && c.bioStatus === "to_apply",
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Mes comptes
          </h1>
          <p className="text-sm text-slate-500">
            Déclare tes comptes et suis leur warmup.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Même guide warmup que l'admin (source unique : components/warmup),
              en lecture seule. Toujours visible — consultable même sans compte
              déclaré et indépendant du chargement de projectId. */}
          <WarmupGuideButton />
          {projectId && (
            <Button onClick={() => setDeclareOpen(true)}>
              <PlusIcon className="mr-2 size-4" />
              Déclarer un compte
            </Button>
          )}
        </div>
      </header>

      {dueToday.length > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
          data-testid="warmup-due-notif"
        >
          <FlameIcon className="size-5 shrink-0 text-amber-600" />
          <p className="text-sm font-medium text-amber-900">
            Tu as {dueToday.length} warmup{dueToday.length > 1 ? "s" : ""} à
            faire aujourd&apos;hui — coche
            {dueToday.length > 1 ? "-les" : "-le"} ci-dessous.
          </p>
        </div>
      )}

      {bioDue.length > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
          data-testid="bio-due-notif"
        >
          <BellRingIcon className="size-5 shrink-0 text-amber-600" />
          <p className="text-sm font-medium text-amber-900">
            {bioDue.length} bio{bioDue.length > 1 ? "s" : ""} à mettre à jour —
            recopie{bioDue.length > 1 ? "-les" : "-la"} sur{" "}
            {bioDue.length > 1 ? "tes comptes" : "ton compte"} puis confirme
            ci-dessous.
          </p>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : comptes && comptes.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {comptes.map((c) => (
            <WarmupCompteCard key={c._id} compte={c} projectId={projectId!} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <MonitorSmartphoneIcon
              className="size-14 text-slate-300"
              strokeWidth={1.5}
            />
            <p className="text-sm text-slate-500">
              Aucun compte déclaré. Déclare ton premier compte pour démarrer son
              warmup.
            </p>
            {projectId && (
              <Button onClick={() => setDeclareOpen(true)}>
                <PlusIcon className="mr-2 size-4" />
                Déclarer un compte
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {projectId && (
        <DeclareCompteDialog
          open={declareOpen}
          onOpenChange={setDeclareOpen}
          projectId={projectId}
        />
      )}
    </div>
  );
}
