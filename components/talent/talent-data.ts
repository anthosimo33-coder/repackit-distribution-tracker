"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useViewAs } from "@/components/portal/ViewAsContext";

/**
 * ESPACE TALENT — hooks d'INDIRECTION des données (même patron que
 * `components/portal/creator-data.ts`, dont c'est le pendant pour cette
 * population) :
 *   - talent connecté (useViewAs() === null) → la `talentQuery` `getMy*`, la
 *     query d'observation étant `"skip"` → comportement et runtime IDENTIQUES à
 *     avant ce chantier ;
 *   - admin en observation → la query `*AsAdmin` (adminViewAsTalentQuery :
 *     admin + projet + fiche ∈ projet + fiche de population TALENT) avec la
 *     fiche ciblée.
 *
 * Les deux variantes partagent le MÊME cœur serveur → shapes identiques, aucun
 * branchement de type côté écran. AUCUNE mutation ici, et il ne doit jamais y en
 * avoir : la lecture seule du mode observation tient à ce qu'aucune mutation ne
 * soit atteignable par ce chemin, pas à un bouton désactivé.
 */

export function useTalentBrief(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.formats.getMyTalentBrief,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.formats.getTalentBriefAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

export function useMyRushes(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(api.rushes.listMyRushes, va ? "skip" : { projectId });
  const asAdmin = useQuery(
    api.rushes.listRushesAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}
