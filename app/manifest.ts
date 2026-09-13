import type { MetadataRoute } from "next";

/**
 * MANIFESTE D'APPLICATION — installer l'espace sur l'écran d'accueil.
 *
 * Servi à `/manifest.webmanifest` (convention Next). L'extension le sort du
 * matcher de `proxy.ts` : il est lisible sans session, ce qu'exige le navigateur
 * qui le lit avant toute connexion.
 *
 * `start_url` = `/app` : l'icône ouvre directement l'espace créatrice. Un membre
 * de l'équipe qui l'installerait est aiguillé vers son espace par la garde de
 * rôle, comme pour tout lien vers `/app`.
 *
 * `display: standalone` : plus de barre d'adresse, l'espace s'ouvre comme une
 * app. Les icônes sont générées depuis le logo de marque (public/icon-*.png).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jarvis Creator Studio",
    short_name: "Jarvis",
    // Le manifeste est un fichier unique, lu avant toute session : aucune langue
    // n'y est connue. On s'en tient au nom de marque plutôt qu'à une phrase
    // française servie aux créatrices anglophones.
    description: "Jarvis Creator Studio",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
