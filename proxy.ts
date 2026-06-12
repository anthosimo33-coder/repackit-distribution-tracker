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
 * Ordre Next : les redirects de next.config.ts (/ → /dashboard, /tracker →
 * /carrousels…) s'appliquent AVANT le proxy → le proxy voit la route cible.
 * La route /api/auth (cookies de session) est gérée par
 * convexAuthNextjsMiddleware lui-même, d'où le matcher qui inclut /api.
 */
const isLoginPage = createRouteMatcher(["/login"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (isLoginPage(request) && (await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/dashboard");
  }
  if (!isLoginPage(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/login");
  }
});

export const config = {
  // Tout sauf les assets statiques (fichiers avec extension) et _next.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
