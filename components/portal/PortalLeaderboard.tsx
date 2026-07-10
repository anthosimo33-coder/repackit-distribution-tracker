"use client";

import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { useProjectLeaderboard } from "@/components/portal/creator-data";
import { LeaderboardSection } from "@/components/admin/leaderboard/CreatorLeaderboard";

/**
 * Classement du projet côté PORTAIL créateur — réutilise le présentationnel
 * `LeaderboardSection`. Données via le hook d'indirection `useProjectLeaderboard`
 * (créateur normal → projectLeaderboard scopé serveur ; view-as → leaderboard
 * admin, cf creator-data). Transparence assumée : gains de toutes visibles, la
 * créatrice se voit surlignée (`isMe`). `selfInvite` affiche l'invitation à
 * publier si elle n'est pas encore classée (0 post = pas de cycle).
 */
export function PortalLeaderboard() {
  const { current } = useCreatorProject();
  const data = useProjectLeaderboard(current.projectId);

  return (
    <LeaderboardSection
      data={data}
      title="Classement du projet"
      subtitle="Ton classement sur les gains du cycle en cours. Les gains de chaque créateur sont visibles — vous êtes sur le même projet."
      selfInvite
    />
  );
}
