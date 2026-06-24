"use client";

import { use } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import AssignmentDetailScreen from "@/components/portal/screens/AssignmentDetailScreen";

// Fiche détail de mission (portail créateur). L'écran est extrait dans
// AssignmentDetailScreen pour être RÉUTILISÉ en lecture seule par le mode admin
// « voir l'espace d'un créateur ». Chemin créateur normal inchangé.
export default function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <AssignmentDetailScreen assignmentId={id as Id<"assignments">} />;
}
