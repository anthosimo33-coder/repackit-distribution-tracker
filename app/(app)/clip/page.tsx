import { ClipperSpaceScreen } from "@/components/clip/ClipperSpaceScreen";

/**
 * Accueil CLIPPEUR — ses comptes (phase, quota du jour, déclaration) et sa file
 * de clips. Le rôle et le projet sont résolus par le layout (usePortalGate +
 * ClipperProjectProvider), la garde qui compte étant serveur
 * (clipperQuery/clipperMutation).
 */
export default function ClipHomePage() {
  return <ClipperSpaceScreen />;
}
