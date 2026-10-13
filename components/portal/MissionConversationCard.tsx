"use client";

import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useViewAs } from "@/components/portal/ViewAsContext";
import {
  ScriptConversationCard,
  type ScriptConversationFileView,
} from "@/components/scripts/ScriptConversationCard";

/**
 * La conversation d'UNE mission, téléchargeable. L'export est personnalisé côté
 * serveur au moment du clic (dates du jour, prénom de la créatrice — cf
 * convex/conversationFiles.downloadConversationExport), puis enregistré par le
 * navigateur sous le nom déposé par l'équipe.
 *
 * En observation (admin « voir l'espace »), le téléchargement reste ouvert :
 * c'est une lecture, et il rend le fichier tel que la créatrice le recevrait.
 */
export function MissionConversationCard({
  projectId,
  assignmentId,
  conversation,
  className,
}: {
  projectId: Id<"projects">;
  assignmentId: Id<"assignments">;
  conversation: {
    text: string;
    instruction: string | null;
    files: ScriptConversationFileView[];
  };
  className?: string;
}) {
  const va = useViewAs();
  const download = useAction(api.conversationFiles.downloadConversationExport);

  async function downloadExport(f: ScriptConversationFileView) {
    const { name, text } = await download({
      projectId,
      assignmentId,
      storageId: f.storageId as Id<"_storage">,
      ...(va ? { viewAsCreatorId: va.creatorId } : {}),
    });
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Laisser au navigateur (Safari iOS en tête) le temps de lire le blob.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return (
    <ScriptConversationCard
      className={className}
      text={conversation.text}
      instruction={conversation.instruction}
      files={conversation.files}
      onDownloadExport={downloadExport}
    />
  );
}
