"use client";

import { useEffect } from "react";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { AssignScriptCampaignDialog } from "@/components/admin/AssignScriptCampaignDialog";
import type { ReplaySource } from "@/components/admin/ChosenComboPicker";

/**
 * « Rejouer ce script » depuis une source qui n'a en main qu'un id : une ligne du
 * tracker (publicationId) ou une fiche d'assignation (assignmentId). Résout le
 * payload via getReplaySource, puis monte la modale d'assignation PRÉ-REMPLIE en
 * mode « Combinaison choisie ». `source` est piloté par le parent (null = fermé) ;
 * une source non-script (ou introuvable) → message + fermeture.
 *
 * (L'entrée ANALYTICS n'utilise PAS ce lanceur : elle construit son payload combo
 * côté client depuis ComboPerf, sans source unique — cf page analytics.)
 */
export type ReplaySourceRef =
  | { publicationId: Id<"publications"> }
  | { assignmentId: Id<"assignments"> };

export function ReplayScriptLauncher({
  source,
  onClose,
}: {
  source: ReplaySourceRef | null;
  onClose: () => void;
}) {
  const data = useProjectQuery(api.scripts.getReplaySource, source ?? "skip");

  useEffect(() => {
    if (source && data === null) {
      toast.error("Ce post n'a pas de script à rejouer.");
      onClose();
    }
  }, [source, data, onClose]);

  // undefined = en cours de résolution, null = pas de script (géré ci-dessus).
  if (!source || !data) return null;

  const replaySource: ReplaySource = {
    campaignId: data.campaignId,
    campaignName: data.campaignName,
    bricks: data.bricks,
    sourceAssignmentId: data.sourceAssignmentId,
    sourceAssembledScript: data.sourceAssembledScript,
    perf: {
      kind: "post",
      views: data.perf.views,
      date: data.perf.date,
      creatorName: data.perf.creatorName,
    },
  };

  return (
    <AssignScriptCampaignDialog
      campaignId={data.campaignId}
      campaignName={data.campaignName}
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      replaySource={replaySource}
    />
  );
}
