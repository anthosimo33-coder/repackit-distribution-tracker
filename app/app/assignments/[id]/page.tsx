"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeftIcon } from "lucide-react";
import { FormatBriefPreview } from "@/components/formats/FormatBriefPreview";
import { EarningsCalculator } from "@/components/portal/EarningsCalculator";
import { AssignmentActions } from "@/components/portal/AssignmentActions";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";

/**
 * P7 — fiche assignment côté créateur : brief complet (FormatBriefPreview,
 * showRate=false), rémunération depuis le rateSnapshot FIGÉ + calculateur, et
 * les actions (Je commence / soumission / resoumission). Isolé serveur :
 * getMyAssignment renvoie null si l'assignment n'est pas le mien.
 */
export default function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const projectId = useCreatorProjectId();
  const data = useQuery(
    api.assignments.getMyAssignment,
    projectId ? { projectId, id: id as Id<"assignments"> } : "skip",
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/app"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />
        Retour au tableau de bord
      </Link>

      {data === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : data === null ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            Cet assignment est introuvable.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {data.accountHandle && (
            <p className="text-sm text-slate-500">
              Compte cible :{" "}
              <span className="font-mono text-slate-700">
                {data.accountHandle}
              </span>
            </p>
          )}

          {/* Actions (en haut : c'est l'action attendue du créateur) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ta soumission</CardTitle>
            </CardHeader>
            <CardContent>
              <AssignmentActions
                assignment={data.assignment}
                projectId={projectId!}
                submittedVideoUrl={data.submittedVideoUrl}
                submittedVideoMimeType={data.submittedVideoMimeType}
              />
            </CardContent>
          </Card>

          {/* Script monté (assignment de script) OU brief de format. Pour un
              script, le créateur ne voit que le texte fini — aucune brique,
              aucun tier, aucune campagne. */}
          {data.assembledScript ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vidéo à tourner</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleMarkdown content={data.assembledScript} />
              </CardContent>
            </Card>
          ) : data.format ? (
            <FormatBriefPreview format={data.format} showRate={false} />
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-slate-500">
                Le brief de ce format n&apos;est plus disponible.
              </CardContent>
            </Card>
          )}

          {/* Rémunération figée (rateSnapshot) + calculateur */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rémunération</CardTitle>
            </CardHeader>
            <CardContent>
              <EarningsCalculator rate={data.assignment.rateSnapshot} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
