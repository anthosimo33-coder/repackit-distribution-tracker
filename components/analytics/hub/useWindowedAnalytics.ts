"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useProjectAction } from "@/components/project/use-project-convex";
import {
  coversEverything,
  type AnalyticsWindow,
  type DataRange,
} from "@/lib/analytics-window";
import { hogWindowClause } from "@/lib/hog-window";
import { convexErrorMessage } from "@/lib/convex-error";
import type { WindowedParcours } from "@/convex/analyticsWindowed";

/**
 * RECALCUL À LA DEMANDE des agrégats PostHog, sur une plage libre.
 *
 * UNE seule volée sert Parcours ET Offres & tests : deux appels séparés
 * paieraient deux fois la latence de démarrage, et pourraient rendre deux
 * périodes différentes si l'utilisateur change de dates entre les deux.
 *
 * ⚠️ CE HOOK EXISTE POUR CACHER UNE LATENCE, PAS POUR L'IGNORER. Mesuré sur la
 * vraie API PostHog le 06/09/2026 : une volée coûte 10,6 s à froid (plus de deux
 * minutes sans requête) et 1,4 s ensuite. La largeur de la fenêtre n'y change
 * rien. Trois mécanismes, chacun contre un symptôme précis :
 *
 *  (La PRÉCHAUFFE au montage a été retirée le 2026-09-16 : elle doublait les
 *  requêtes simultanées au moment précis où l'utilisateur choisit une période,
 *  et PostHog n'en accepte que trois par projet — tout sortait en 429.)
 *  2. DÉBOUNCE de 600 ms — faire glisser les dates ne lance pas cinq volées.
 *  3. CACHE PAR PLAGE, le temps de la session — un aller-retour entre deux
 *     périodes déjà vues ne coûte aucune requête.
 *  4. UN SEUL APPEL EN VOL — sans cette garde, un utilisateur pressé empile des
 *     volées de 24 requêtes et PostHog met tout en file (45 s mesurées).
 *
 * La fenêtre qui couvre TOUTE la profondeur ne déclenche rien : le cache du cron
 * porte déjà 90 jours, l'appeler serait payer pour le même chiffre.
 */

const DEBOUNCE_MS = 600;

export interface WindowedAnalyticsState {
  /** `undefined` = servez-vous du cache 90 jours (fenêtre totale, ou pas encore prêt). */
  data: WindowedParcours | undefined;
  /** Un recalcul est en cours. Les chiffres affichés sont ceux d'avant. */
  loading: boolean;
  /** Message d'erreur à afficher — jamais un écran vide sans explication. */
  error: string | null;
}

export function useWindowedAnalytics(
  window: AnalyticsWindow | null,
  range: DataRange | null,
): WindowedAnalyticsState {
  // `useProjectAction` injecte le projet courant : le même chemin que le reste
  // du hub, plutôt qu'un projectId threadé à la main jusqu'ici.
  const run = useProjectAction(api.analyticsWindowed.getWindowedAnalytics);
  /**
   * Cache de session, en ÉTAT et non en ref : les règles React du dépôt
   * interdisent de lire une ref au rendu, et c'est justifié ici — une ref ne
   * déclencherait aucun rendu quand une volée revient, l'écran resterait sur
   * l'ancienne période sans qu'on comprenne pourquoi.
   */
  const [cache, setCache] = useState<ReadonlyMap<string, WindowedParcours>>(
    () => new Map(),
  );
  /** Clé de l'appel en vol. Lue et écrite hors rendu uniquement. */
  const inFlight = useRef<string | null>(null);
  /** Période en cours de calcul, et son erreur éventuelle. */
  const [pending, setPending] = useState<{
    key: string;
    error: string | null;
  } | null>(null);

  // La fenêtre totale se sert du cache du cron : rien à demander.
  const total = window === null || coversEverything(window, range);
  const key = total || !window ? null : `${window.from}|${window.to}`;
  const data = key === null ? undefined : cache.get(key);
  const already = key !== null && cache.has(key);

  useEffect(() => {
    if (key === null || !window || already) {
      inFlight.current = key;
      return;
    }
    const t = setTimeout(() => {
      const clause = hogWindowClause(window.from, window.to);
      const sur = hogWindowClause(window.from, window.to, "t_first_sub");
      if (clause === null || sur === null) {
        setPending({ key, error: "Période illisible." });
        return;
      }
      inFlight.current = key;
      setPending({ key, error: null });
      void run({
        window: clause,
        windowOnFirstSub: sur,
        from: window.from,
        to: window.to,
      })
        .then((res) => {
          // Rangée même si la période a changé entre-temps : le calcul est fait,
          // le jeter obligerait à le repayer au retour. C'est la clé COURANTE
          // qui décide de ce qui s'affiche, pas l'ordre d'arrivée.
          setCache((prev) => new Map(prev).set(key, res));
          setPending((p) => (p?.key === key ? null : p));
        })
        .catch((e: unknown) => {
          setPending({
            key,
            // Jamais `e.message` : c'est la chaîne brute du client Convex
            // (« [Request ID: …] Server Error »), qui ne dit rien.
            error: convexErrorMessage(e, "Recalcul impossible."),
          });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [key, window, already, run]);

  const suivi = pending !== null && pending.key === key ? pending : null;
  return {
    data,
    loading: data === undefined && suivi !== null && suivi.error === null,
    error: suivi?.error ?? null,
  };
}
