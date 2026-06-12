"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusIcon, MonitorSmartphoneIcon } from "lucide-react";
import { DeclareCompteDialog } from "@/components/creators/portal/DeclareCompteDialog";
import { WarmupCompteCard } from "@/components/creators/portal/WarmupCompteCard";

/**
 * P5 — portail créateur : « Mes comptes ». Hors ProjectProvider → projectId
 * résolu via getMyPortal puis passé explicitement aux creatorQuery/Mutation.
 * Le serveur ne sert QUE les comptes du créateur (filtrage par creatorId).
 */
export default function CreatorComptesPage() {
  const portal = useQuery(api.creators.getMyPortal, {});
  const projectId =
    portal?.role === "creator" ? portal.projectId : null;
  const comptes = useQuery(
    api.comptes.listMyComptes,
    projectId ? { projectId } : "skip",
  );
  const [declareOpen, setDeclareOpen] = useState(false);

  const loading = portal === undefined || comptes === undefined;

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
        {projectId && (
          <Button onClick={() => setDeclareOpen(true)}>
            <PlusIcon className="mr-2 size-4" />
            Déclarer un compte
          </Button>
        )}
      </header>

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
