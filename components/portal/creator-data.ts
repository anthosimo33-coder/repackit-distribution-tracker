"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useLocale } from "next-intl";
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

/** Fiche détail d'une mission. View-as → getAssignmentDetailAsAdmin (scopé serveur). */
export function useMyAssignment(
  projectId: Id<"projects">,
  id: Id<"assignments">,
) {
  const va = useViewAs();
  const mine = useQuery(
    api.assignments.getMyAssignment,
    va ? "skip" : { projectId, id },
  );
  const asAdmin = useQuery(
    api.assignments.getAssignmentDetailAsAdmin,
    va ? { projectId, creatorId: va.creatorId, id } : "skip",
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

/** État d'onboarding (Snytch). View-as → getOnboardingStateAsAdmin (scopé serveur). */
export function useOnboardingState(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.comptes.getMyOnboardingState,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.comptes.getOnboardingStateAsAdmin,
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

/** Mes vidéos publiées (Snytch). View-as → listPublishedVideosAsAdmin (scopé serveur). */
export function useMyPublishedVideos(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.creatorVideos.listMyPublishedVideos,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.creatorVideos.listPublishedVideosAsAdmin,
    va ? { projectId, creatorId: va.creatorId } : "skip",
  );
  return va ? asAdmin : mine;
}

/** Récap vidéos du mois (Snytch). View-as → getVideoStatsAsAdmin. */
export function useMyVideoStats(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.creatorVideos.getMyVideoStats,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.creatorVideos.getVideoStatsAsAdmin,
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

/**
 * Classement du projet (portail créateur). Créateur normal → creatorQuery
 * `projectLeaderboard` (vérifie l'appartenance au projet côté serveur, injecte
 * isMe). View-as admin → adminQuery `leaderboard` EXISTANTE (l'admin y a accès) +
 * isMe recalculé pour le créateur ciblé — pas de query view-as dédiée (un seul
 * nouveau query backend). Shapes identiques → aucun branchement de type côté écran.
 */
export function useProjectLeaderboard(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.payments.projectLeaderboard,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.payments.leaderboard,
    va ? { projectId } : "skip",
  );
  if (va) {
    return asAdmin?.map((e) => ({ ...e, isMe: e.creatorId === va.creatorId }));
  }
  return mine;
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

/** Progression (échelle des paliers + victoires + célébrations). View-as →
 *  getProgressionAsAdmin (adminViewAsQuery : admin+projet+creator∈projet). */
export function useMyProgression(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(
    api.progression.getMyProgression,
    va ? "skip" : { projectId },
  );
  const asAdmin = useQuery(
    api.progression.getProgressionAsAdmin,
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

/** Guide « Comment ça marche » LEGACY (mono-bloc). View-as → getGuideForAdmin
 *  (per-projet, existant). Sert de FALLBACK quand aucun module n'est publié. */
export function useMyGuide(projectId: Id<"projects">) {
  const va = useViewAs();
  const mine = useQuery(api.guide.getMyGuide, va ? "skip" : { projectId });
  const asAdmin = useQuery(
    api.guide.getGuideForAdmin,
    va ? { projectId } : "skip",
  );
  return va ? asAdmin : mine;
}

/** Modules « Comment ça marche » v2 (published, triés par order) DANS LA LANGUE
 *  RENDUE. View-as → listModulesAsAdmin (adminViewAsQuery, même contenu que le
 *  créateur).
 *
 *  La langue passée est celle du provider next-intl COURANT — donc, en mode
 *  « voir l'espace d'un créateur », celle de la personne observée (provider
 *  imbriqué) et non celle de l'admin. C'est la même valeur qui a choisi tous les
 *  autres mots de l'écran : le guide ne peut pas diverger du reste de la page.
 *
 *  Le serveur rend `servedLocale` à côté de `requestedLocale` — c'est l'écran
 *  qui décide quoi en faire (cf GuideScreen : le bandeau de repli). */
export function useMyGuideModules(projectId: Id<"projects">) {
  const va = useViewAs();
  const locale = useLocale();
  const mine = useQuery(
    api.guideModules.listMyModules,
    va ? "skip" : { projectId, locale },
  );
  const asAdmin = useQuery(
    api.guideModules.listModulesAsAdmin,
    va ? { projectId, creatorId: va.creatorId, locale } : "skip",
  );
  return va ? asAdmin : mine;
}
