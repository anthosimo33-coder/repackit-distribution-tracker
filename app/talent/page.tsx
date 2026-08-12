import { TalentSpaceScreen } from "@/components/talent/TalentSpaceScreen";

/**
 * Accueil TALENT — et unique écran de l'espace : brief permanent, vidéos
 * d'exemple, dépôt, mes dépôts. Le rôle et le projet sont résolus par le layout
 * (usePortalGate + TalentProjectProvider), la garde qui compte étant serveur
 * (talentQuery/talentMutation).
 */
export default function TalentHomePage() {
  return <TalentSpaceScreen />;
}
