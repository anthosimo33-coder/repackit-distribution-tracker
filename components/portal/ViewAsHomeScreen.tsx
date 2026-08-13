"use client";

import DashboardScreen from "@/components/portal/screens/DashboardScreen";
import { TalentSpaceScreen } from "@/components/talent/TalentSpaceScreen";
import { ClipperSpaceScreen } from "@/components/clip/ClipperSpaceScreen";
import { useViewAs } from "@/components/portal/ViewAsContext";

/**
 * Écran d'ACCUEIL du mode observation — aiguillé sur la population.
 *
 * Une route Next est statique ; c'est donc ici que se fait le choix de l'écran,
 * pas dans le fichier de route. Chaque population reçoit SON écran d'accueil,
 * celui-là même que sa personne voit en se connectant :
 *   - partenaire → tableau de bord (/app) ;
 *   - talent     → son espace de dépôt (/talent) ;
 *   - clippeur   → ses comptes et ses clips (/clip).
 *
 * Hors mode observation, `useViewAs()` vaut null → tableau de bord partenaire,
 * exactement comme avant ce chantier.
 */
export default function ViewAsHomeScreen() {
  const viewAs = useViewAs();
  switch (viewAs?.creatorKind) {
    case "talent":
      return <TalentSpaceScreen />;
    case "clipper":
      return <ClipperSpaceScreen />;
    default:
      return <DashboardScreen />;
  }
}
