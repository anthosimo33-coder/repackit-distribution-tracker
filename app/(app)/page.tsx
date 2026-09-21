import { RoleRedirect } from "@/components/layout/RoleRedirect";

/**
 * `/` pour un utilisateur CONNECTÉ — routage par rôle.
 *
 * QUI GARANTIT LA SESSION : le proxy (proxy.ts). Un visiteur sans session
 * n'atteint jamais cette page : sa requête est réécrite vers l'accueil public
 * prérendu (`/accueil/<langue>`), URL inchangée. Cette page n'a donc plus à
 * lire le cookie de session pour trancher — c'est ce qui permet à la vitrine
 * d'être servie depuis le CDN sans invoquer la moindre fonction.
 *
 * `RoleRedirect` garde sa propre barrière côté client (<Authenticated>) : la
 * redirection dépend du rôle, lu par une query Convex une fois le jeton
 * hydraté.
 */
export default function HomePage() {
  return <RoleRedirect />;
}
