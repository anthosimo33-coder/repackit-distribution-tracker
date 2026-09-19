import localFont from "next/font/local";

/**
 * Polices de la landing Jarvia (Fontshare, licence ITF Free Font), chargées
 * UNIQUEMENT par l'écran de connexion : le reste de l'app garde Inter.
 * Clash Display pour les titres, Switzer pour le texte.
 */
export const clashDisplay = localFont({
  src: [
    { path: "./fonts/ClashDisplay-Medium.woff2", weight: "500" },
    { path: "./fonts/ClashDisplay-Semibold.woff2", weight: "600" },
  ],
  variable: "--font-clash",
  display: "swap",
});

export const switzer = localFont({
  src: [
    { path: "./fonts/Switzer-Regular.woff", weight: "400" },
    { path: "./fonts/Switzer-Medium.woff", weight: "500" },
    { path: "./fonts/Switzer-Semibold.woff", weight: "600" },
  ],
  variable: "--font-switzer",
  display: "swap",
});
