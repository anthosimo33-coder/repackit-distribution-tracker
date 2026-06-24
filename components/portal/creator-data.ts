"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useViewAs } from "./ViewAsContext";

/**
 * Admin « voir l'espace d'un créateur » (LECTURE SEULE) — hooks d'INDIRECTION
 * des données portail. Chaque écran réutilisé lit ses données via ces hooks au
 * lieu d'un useQuery(api.*.getMy*) en dur :
 *   - créateur normal (useViewAs() === null) → la creatorQuery `getMy*`
 *     (la query view-as est `"skip"`) → comportement et runtime IDENTIQUES à
 *     avant le chantier ;
 *   - admin view-as → la query `*AsAdmin` (adminViewAsQuery : admin+projet+
 *     vérif creator∈projet côté serveur) avec le creatorId ciblé.
 *
 * Les deux variantes partagent le MÊME helper de lecture serveur → shapes
 * identiques, aucun branchement de type côté écran. AUCUNE mutation ici : la
 * lecture seule est garantie par construction (pas de variante mutation view-as).
 */

export function useMyAssignments(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.assignments.listMyAssignments,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.assignments.listAssignmentsAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

export function useWarmupDue(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.comptes.countMyWarmupDue,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.comptes.countWarmupDueAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

export function useWarmupInProgress(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.comptes.countMyWarmupInProgress,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.comptes.countWarmupInProgressAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

export function useActionable(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.assignments.countMyActionable,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.assignments.countActionableAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

export function useMyComptes(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.comptes.listMyComptes,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.comptes.listComptesAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

export function useMyPayments(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.payments.getMyPayments,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.payments.getPaymentsAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

export function useMyProfile(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.creators.getMyProfile,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.creators.getProfileAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

/** Statut bonus (paliers). View-as → getCreatorBonusStatus (adminQuery existant). */
export function useMyBonusStatus(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.pricing.getMyBonusStatus,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.pricing.getCreatorBonusStatus,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

/** Guide « Comment ça marche ». View-as → getGuideForAdmin (per-projet, existant). */
export function useMyGuide(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(api.guide.getMyGuide, va ? "skip" : { projectId });
  const asAdmin = useQuery(
    api.guide.getGuideForAdmin,
    va ? { projectId } : "skip",
  );
  return va ? asAdmin : mine;
}
