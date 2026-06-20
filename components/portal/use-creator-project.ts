"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";

/**
 * projectId du PROJET COURANT du créateur (portail /app), résolu par le
 * CreatorProjectProvider (switcher multi-projets). Toujours défini sous le
 * provider — toutes les creatorQuery/creatorMutation le passent pour s'isoler
 * sur le projet courant.
 */
export function useCreatorProjectId(): Id<"projects"> {
  return useCreatorProject().current.projectId;
}
