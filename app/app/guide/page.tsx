"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCreatorProjectId } from "@/components/portal/use-creator-project";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";

/**
 * P7 — « Comment ça marche » côté créateur (lecture seule). Contenu édité par
 * l'admin (getMyGuide → creatorQuery, isolé au projet du créateur).
 */
export default function CreatorGuidePage() {
  const projectId = useCreatorProjectId();
  const guide = useQuery(
    api.guide.getMyGuide,
    projectId ? { projectId } : "skip",
  );

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
