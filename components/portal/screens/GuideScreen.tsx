"use client";

import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { useMyGuide } from "@/components/portal/creator-data";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";

/**
 * « Comment ça marche » — écran RÉUTILISÉ par le portail créateur normal ET le
 * mode admin « voir l'espace d'un créateur ». Contenu par projet (édité par
 * l'admin), purement en lecture dans les deux modes. useMyGuide : getMyGuide en
 * normal, getGuideForAdmin (per-projet) en view-as.
 */
export default function GuideScreen() {
  const projectId = useCreatorProjectId();
  const guide = useMyGuide(projectId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Comment ça marche
      </h1>
      {guide === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card>
          <CardContent className="py-6">
            <SimpleMarkdown content={guide.content} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
