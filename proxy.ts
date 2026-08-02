import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

/**
 * Remédiation sécurité — gating des PAGES : tout sauf /login exige une
 * session Convex Auth. Fichier `proxy.ts` (Next 16 : `middleware.ts` est
 * déprécié et renommé proxy, cf node_modules/next/dist/docs).
 *
 * ⚠️ Ce gating est du confort UX (redirection login). La vraie barrière de
 * sécurité est dans les fonctions Convex elles-mêmes (convex/functions.ts :
 * authedQuery / authedMutation) — protéger les pages Next ne suffit pas,
 * NEXT_PUBLIC_CONVEX_URL étant public dans le bundle.
 *
 * Ordre Next : les redirects de next.config.ts (/dashboard → /admin/repackit/…,
 * /tracker → …) s'appliquent AVANT le proxy → le proxy voit la route cible.
 * La route /api/auth (cookies de session) est gérée par
 * convexAuthNextjsMiddleware lui-même, d'où le matcher qui inclut /api.
 *
 * P3 Multi-tenant — un utilisateur connecté sur /login est renvoyé vers `/`
 * (resolver du projet par défaut → /admin/<slug>/dashboard), pas vers une route
 * scopée codée en dur (le projet dépend de l'utilisateur).
 *
 * P1 Créateurs — /join/<token> est PUBLIC (pré-session, comme /login) : un
 * invité n'a pas encore de compte. Exclu du gating d'auth ci-dessous.
 */
// `/:slug/login` = login brandé par projet (public, comme /login). Deux
// segments → ne capture pas le /login générique (un seul segment).
const isLoginPage = createRouteMatcher(["/login", "/:slug/login"]);
const isPublicPage = createRouteMatcher([
  "/login",
  "/:slug/login",
  "/join",
  "/join/(.*)",
  // Reset mot de passe (Voie B) : lien à usage unique, pré-session comme /join.
  "/reset-password",
  "/reset-password/(.*)",
]);

// « Rester connecté » 90 jours : rend le cookie d'auth PERSISTANT. Sans maxAge,
// Convex Auth pose un cookie de SESSION (détruit à la fermeture du navigateur) →
// la créatrice devrait se reconnecter à chaque relance, même si la session
// serveur vit 90 j. maxAge en SECONDES ; à garder aligné avec la durée de
// session serveur (convex/auth.ts, SESSION_DURATION_MS).
const SESSION_COOKIE_MAX_AGE_S = 90 * 24 * 60 * 60; // 90 jours

export default convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    if (isLoginPage(request) && (await convexAuth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, "/");
    }
    if (!isPublicPage(request) && !(await convexAuth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, "/login");
    }
  },
  { cookieConfig: { maxAge: SESSION_COOKIE_MAX_AGE_S } },
);

export const config = {
  // Tout sauf les assets statiques (fichiers avec extension) et _next.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
