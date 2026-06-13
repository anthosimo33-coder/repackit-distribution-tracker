"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * P7 — projectId du créateur courant (portail /app, hors ProjectProvider).
 * Résolu via getMyPortal ; null tant que non chargé ou non-creator. Sert à
 * passer projectId aux creatorQuery/creatorMutation (qui l'exigent).
 */
export function useCreatorProjectId(): Id<"projects"> | null {
  const portal = useQuery(api.creators.getMyPortal, {});
  return portal?.role === "creator" ? portal.projectId : null;
}
