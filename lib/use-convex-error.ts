"use client";

import { useLocale, useTranslations } from "next-intl";
import { convexErrorCode, convexErrorPayload } from "./convex-error";
import { PHASE_INLINE_KEYS, formatUtcDay } from "@/convex/accountPhase";

/**
 * Rend un rejet métier Convex DANS LA LANGUE DU LECTEUR.
 *
 * Le serveur ne peut pas le faire : le runtime Convex n'a ni requête, ni cookie,
 * ni `Accept-Language`. Et il ne DOIT pas le faire : ces rejets sortent de cœurs
 * PARTAGÉS (`confirmPublicationCore`, `declareCompteCore`, `assertClipperDailyQuota`…)
 * atteints aussi bien par une créatrice que par Kevin sur le chemin de secours.
 * Une phrase figée côté serveur angliciserait l'un en même temps que l'autre.
 *
 * Le serveur envoie donc `{ code, message, params }` :
 *   - `code`   → la clé `error.<code>` du catalogue, rendue ici ;
 *   - `params` → les valeurs interpolées (handle, plateforme, date, compteur) ;
 *   - `message` → le français, gardé comme REPLI et comme trace lisible.
 *
 * REPLI EN CASCADE, et jamais un code brut à l'écran :
 *   1. clé connue du catalogue → phrase traduite ;
 *   2. code inconnu (serveur plus récent que le client) → message serveur ;
 *   3. pas de charge structurée (erreur réseau, crash) → `fallback` de l'appelant.
 */
export function useConvexError(): (error: unknown, fallback?: string) => string {
  const t = useTranslations();
  const tError = useTranslations("error");
  const locale = useLocale();

  return (error, fallback) => {
    const payload = convexErrorPayload(error);
    const code = convexErrorCode(error);
    if (code !== null) {
      const params = { ...(payload?.params ?? {}) };
      // `at` est un instant BRUT : le serveur ne peut pas le formater dans la
      // langue du lecteur, il l'envoie tel quel et on le rend ici. Le `date`
      // français qui l'accompagne ne sert qu'au message de repli.
      if (typeof params.at === "number") {
        params.date = formatUtcDay(params.at, locale);
        delete params.at;
      }
      // `phaseKey` est une CLÉ, pas un libellé : le serveur ne connaît pas la
      // langue, il envoie la clé de la phase et on la résout ici. Sans ça,
      // « en phase de chauffe » resterait français au milieu d'une phrase
      // anglaise.
      if (typeof params.phaseKey === "string") {
        const key = params.phaseKey as (typeof PHASE_INLINE_KEYS)[keyof typeof PHASE_INLINE_KEYS];
        params.phase = t(key as Parameters<typeof t>[0]);
        delete params.phaseKey;
      }
      const hasKey = tError.has(
        code as Parameters<typeof tError.has>[0],
      );
      if (hasKey) {
        return tError(
          code as Parameters<typeof tError>[0],
          params as never,
        );
      }
    }
    if (payload) return payload.message;
    return fallback ?? tError("generic");
  };
}
