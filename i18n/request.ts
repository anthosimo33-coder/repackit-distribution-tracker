import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  localeFromAcceptLanguage,
  normalizeLocale,
  type Locale,
} from "./locales";

/**
 * RÉSOLUTION DE LA LANGUE — côté SERVEUR, avant le premier rendu.
 *
 * Ordre, du plus autoritaire au plus large :
 *   1. `users.locale`     — la préférence explicite du compte connecté
 *   2. `creators.locale`  — la langue posée par l'admin sur la fiche, tant que
 *                           le compte n'a pas de préférence propre
 *   3. cookie NEXT_LOCALE — survit AVANT toute session (page de login)
 *   4. `Accept-Language`  — ce que le navigateur déclare
 *   5. « fr »             — le défaut du produit
 *
 * Les maillons 1 et 2 sont rendus par UNE seule query Convex (convex/i18n.ts).
 *
 * PAS DE PRÉFIXE DE ROUTE. Le segment dynamique racine est déjà pris par
 * `app/[projectSlug]` (login brandé) : un `app/[locale]` casserait les URLs
 * existantes et les redirects de next.config.ts, pour zéro bénéfice sur une app
 * authentifiée. `requestLocale` de next-intl est donc toujours `undefined` ici.
 *
 * POURQUOI LA LECTURE CONVEX EST TOLÉRÉE ICI. Elle coûte un aller-retour par
 * rendu serveur. C'est assumé : sans elle, une préférence changée sur un autre
 * appareil ne s'appliquerait qu'après un premier rendu dans l'ancienne langue —
 * exactement la bascule visible qu'on veut éviter. L'appel est entièrement
 * encapsulé dans un try/catch : toute panne (jeton expiré, backend injoignable,
 * appel hors contexte de requête) retombe silencieusement sur le cookie. La
 * langue de l'interface ne doit jamais pouvoir faire échouer un rendu.
 */
async function localeFromConvex(): Promise<Locale | null> {
  try {
    const token = await convexAuthNextjsToken();
    if (!token) return null;
    const res = await fetchQuery(api.i18n.getMyLocale, {}, { token });
    return normalizeLocale(res?.locale);
  } catch {
    // Pas de session, jeton périmé, backend indisponible : ce n'est pas une
    // erreur, c'est simplement « on ne sait pas ». On passe au maillon suivant.
    return null;
  }
}

export async function resolveLocale(): Promise<Locale> {
  const fromConvex = await localeFromConvex();
  if (fromConvex) return fromConvex;

  const cookieStore = await cookies();
  const fromCookie = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  if (fromCookie) return fromCookie;

  const headerStore = await headers();
  const fromHeader = localeFromAcceptLanguage(
    headerStore.get("accept-language"),
  );
  if (fromHeader) return fromHeader;

  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Fuseau ÉPINGLÉ. Le produit a trois conventions d'horodatage qui coexistent
    // volontairement (Paris épinglé / UTC délibéré / navigateur), documentées
    // champ par champ ; les unifier réintroduirait le décalage d'un jour sur
    // 28 % des publications corrigé en #51/#52. next-intl ne doit surtout pas
    // deviner un fuseau à partir de la langue : « en » ne veut pas dire UTC.
    timeZone: "Europe/Paris",
  };
});
