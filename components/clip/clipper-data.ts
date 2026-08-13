"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useViewAs } from "@/components/portal/ViewAsContext";

/**
 * ESPACE CLIPPEUR — hooks d'INDIRECTION des données (pendant de
 * `components/portal/creator-data.ts` et de `components/talent/talent-data.ts`) :
 *   - clippeur connecté (useViewAs() === null) → la `clipperQuery` `getMy*` ;
 *   - admin en observation → la query `*AsAdmin` (adminViewAsClipperQuery :
 *     admin + projet + fiche ∈ projet + fiche de population CLIPPEUR).
 *
 * Cœur serveur partagé → shapes identiques. AUCUNE mutation ici : le mode
 * observation n'expose aucun chemin d'écriture, et c'est ce qui le rend sûr quoi
 * que rende l'écran.
 */

export function useClipperComptes(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.comptes.listMyClipperComptes,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.comptes.listClipperComptesAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

export function useQuotaWindow(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.clipQuota.myQuotaWindow,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.clipQuota.getQuotaWindowAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

export function useMyClips(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.assignments.listMyClips,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.assignments.listClipsAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

export function useMyClip(
  projectId: Id<"projects">,
  id: Id<"assignments">,
) {
  const va = useViewAs();
  const mine = useQuery(
    api.assignments.getMyClip,
    va ? "skip" : { projectId, id },
  );
  const asAdmin = useQuery(
    api.assignments.getClipDetailAsAdmin,
    va ? { projectId, creatorId: va.creatorId, id } : "skip",
  );
  return va ? asAdmin : mine;
}

/**
 * Base path des liens internes de l'espace clippeur : "/clip" pour le clippeur
 * connecté, la base d'observation sinon. Distinct de `usePortalBase()`, qui
 * retombe sur "/app" (le portail PARTENAIRE) — s'en servir ici enverrait
 * l'observateur sur l'espace d'une autre population.
 */
export function useClipperBase(): string {
  return useViewAs()?.basePath ?? "/clip";
}
