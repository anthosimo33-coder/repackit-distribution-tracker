"use client";

import { use } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import AssignmentDetailScreen from "@/components/portal/screens/AssignmentDetailScreen";

// Détail de mission — vue admin (lecture seule) de l'espace d'un créateur. Même
// écran que la fiche créateur (AssignmentDetailScreen), alimenté par les données
// de la mission ciblée via getAssignmentDetailAsAdmin (ViewAsContext du layout).
// Le segment d'URL est [assignmentId] car [id] désigne déjà le créateur ciblé.
export default function ViewAsAssignmentDetailPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = use(params);
  return (
    <AssignmentDetailScreen assignmentId={assignmentId as Id<"assignments">} />
  );
}
