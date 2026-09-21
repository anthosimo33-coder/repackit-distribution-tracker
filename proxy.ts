import { NextResponse, type NextRequest } from "next/server";
import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  localeFromAcceptLanguage,
  normalizeLocale,
  type Locale,
} from "@/i18n/locales";

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
 * Accueil — `/` est PUBLIC, et c'est ICI qu'on tranche entre ses deux visages
 * (ce que faisait `app/page.tsx` jusqu'au 21/09/2026) :
 *   - session    → on laisse passer vers `app/(app)/page.tsx` (routage par rôle) ;
 *   - visiteur   → RÉÉCRITURE vers `/accueil/<langue>`, la vitrine PRÉRENDUE.
 *
 * POURQUOI DÉPLACER CETTE DÉCISION ICI. Tant que la page lisait le cookie de
 * session pour choisir, elle était dynamique : chaque visite anonyme — chaque
 * passage de robot — invoquait une fonction et rendait la page entière. En
 * sortant la décision de l'arbre de rendu, la vitrine devient un fichier servi
 * par le CDN. C'est une RÉÉCRITURE et pas une redirection : l'URL vue par le
 * visiteur reste `/`.
 *
 * P1 Créateurs — /join/<token> est PUBLIC (pré-session, comme /login) : un
 * invité n'a pas encore de compte. Exclu du gating d'auth ci-dessous.
 */
// `/:slug/login` = login brandé par projet (public, comme /login). Deux
// segments → ne capture pas le /login générique (un seul segment).
const isLoginPage = createRouteMatcher(["/login", "/:slug/login"]);
const isHomePage = createRouteMatcher(["/"]);
const isPublicPage = createRouteMatcher([
  // Accueil : vitrine pour un visiteur, routage par rôle pour un compte
  // connecté. C'est le proxy lui-même qui tranche (cf. plus bas).
  "/",
  // Cibles de la réécriture ci-dessus. Publiques parce que le gating est
  // évalué sur le chemin RÉÉCRIT lors des requêtes RSC du routeur client :
  // les fermer renverrait un visiteur sur /login au premier rafraîchissement.
  // Une seule page indexable : `alternates.canonical` les ramène toutes à `/`.
  "/accueil/(.*)",
  "/login",
  "/:slug/login",
  "/join",
  "/join/(.*)",
  // Reset mot de passe (Voie B) : lien à usage unique, pré-session comme /join.
  "/reset-password",
  "/reset-password/(.*)",
  // Lien public d'un dashboard (/s/<token>) : lu par une marque ou une
  // créatrice SANS compte, et par les robots d'aperçu (WhatsApp, Slack…) qui
  // viennent chercher la page et son image. Le jeton est la seule clé.
  "/s/(.*)",
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
    if (isHomePage(request)) {
      if (await convexAuth.isAuthenticated()) return;
      const url = request.nextUrl.clone();
      url.pathname = `/accueil/${publicHomeLocale(request)}`;
      return NextResponse.rewrite(url);
    }
    if (!isPublicPage(request) && !(await convexAuth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, "/login");
    }
  },
  { cookieConfig: { maxAge: SESSION_COOKIE_MAX_AGE_S } },
);

/**
 * Langue de la vitrine. Les deux premiers maillons de la chaîne habituelle
 * (préférence du compte, fiche créateur — cf. i18n/request.ts) n'existent pas
 * ici : personne n'est connecté sur cette page, par construction. Restent le
 * cookie, l'en-tête du navigateur, puis le défaut du produit.
 */
function publicHomeLocale(request: NextRequest): Locale {
  return (
    normalizeLocale(request.cookies.get(LOCALE_COOKIE)?.value) ??
    localeFromAcceptLanguage(request.headers.get("accept-language")) ??
    DEFAULT_LOCALE
  );
}

export const config = {
  // Tout sauf les assets statiques (fichiers avec extension) et _next.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
