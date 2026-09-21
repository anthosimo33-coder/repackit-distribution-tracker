import localFont from "next/font/local";

/**
 * Polices de la marque Jarvia (Fontshare, licence ITF Free Font) : Clash
 * Display pour les titres, Switzer pour le texte. Le reste de l'app garde
 * Inter.
 *
 * POURQUOI ICI ET PLUS SOUS `app/login/` : elles sont chargées par DEUX
 * groupes de routes qui ne partagent plus de layout racine — l'écran de
 * connexion (`app/(app)/login`) et l'accueil public (`app/(public)/…`). Un
 * module de police n'a donc rien à faire dans le dossier d'une route.
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
