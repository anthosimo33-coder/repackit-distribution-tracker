"use client";

import { useCallback, useEffect, useState } from "react";
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
 * rien. Chaque mécanisme répond à un symptôme précis :
 *
 *  (La PRÉCHAUFFE au montage a été retirée le 2026-09-16 : elle doublait les
 *  requêtes simultanées au moment précis où l'utilisateur choisit une période,
 *  et PostHog n'en accepte que trois par projet — tout sortait en 429.)
 *  2. DÉBOUNCE de 600 ms — faire glisser les dates ne lance pas cinq volées.
 *  3. CACHE PAR PLAGE, le temps de la session — un aller-retour entre deux
 *     périodes déjà vues ne coûte aucune requête.
 *  4. UN SEUL APPEL EN VOL — sans cette garde, un utilisateur pressé empile des
 *     volées de 23 requêtes et PostHog met tout en file (45 s mesurées). La
 *     période choisie pendant le vol part à son retour.
 *  5. AUCUNE RELANCE SEULE APRÈS UN ÉCHEC — seuls un changement de dates ou
 *     « Réessayer » relancent.
 *
 * ⚠️ INCIDENT DU 25/11/2026. Les gardes 4 et 5 n'existaient que sur le papier :
 * la ref « en vol » était écrite mais jamais lue, et la fonction d'appel
 * changeait d'identité à chaque rendu en figurant dans les dépendances de
 * l'effet. Chaque rendu reprogrammait donc une volée, et chaque volée provoquait
 * un rendu : un appel toutes les ~0,62 s, 145 en 2 min en prod, jusqu'à 28 en
 * vol (~84 requêtes PostHog simultanées pour une limite de 3). Tout sortait en
 * 429, ce qui relançait la boucle, et le bandeau rouge clignotait. Tenu par
 * e2e/analytics-recalcul-periode.spec.ts, qui compte les appels réels.
 *
 * La fenêtre qui couvre TOUTE la profondeur ne déclenche rien : le cache du cron
 * porte déjà 90 jours, l'appeler serait payer pour le même chiffre.
 */

const DEBOUNCE_MS = 600;

export interface WindowedAnalyticsState {
  /** `undefined` = servez-vous du cache 90 jours (fenêtre totale, ou pas encore prêt). */
  data: WindowedParcours | undefined;
  /** Un recalcul est attendu ou en cours. Les chiffres affichés sont ceux d'avant. */
  loading: boolean;
  /** Message d'erreur à afficher — jamais un écran vide sans explication. */
  error: string | null;
  /**
   * Relance le recalcul de la période affichée après un échec. C'est la SEULE
   * relance sur une même période : la faire seule, c'est la boucle du 25/11.
   */
  retry: () => void;
}

export function useWindowedAnalytics(
  window: AnalyticsWindow | null,
  range: DataRange | null,
): WindowedAnalyticsState {
  // `useProjectAction` injecte le projet courant : le même chemin que le reste
  // du hub, plutôt qu'un projectId threadé à la main jusqu'ici. Son identité
  // est stable (useCallback) : il peut figurer dans les dépendances de l'effet.
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
  /**
   * Clé de l'appel en vol. En ÉTAT, pas en ref : son retour doit relancer
   * l'effet, pour la période choisie entre-temps.
   */
  const [enVol, setEnVol] = useState<string | null>(null);
  /**
   * Dernier échec. Vidé au lancement suivant : revenir sur une période en échec
   * est un geste, il relance — rester dessus sans rien faire ne relance rien.
   */
  const [echec, setEchec] = useState<{ key: string; message: string } | null>(
    null,
  );

  // La fenêtre totale se sert du cache du cron : rien à demander.
  const total = window === null || coversEverything(window, range);
  // Bornes en CHAÎNES dans les dépendances, pas l'objet fenêtre : une fenêtre
  // recréée à l'identique ne doit pas réarmer le débounce.
  const from = total || !window ? null : window.from;
  const to = total || !window ? null : window.to;
  const key = from === null || to === null ? null : `${from}|${to}`;
  const data = key === null ? undefined : cache.get(key);
  const error = key !== null && echec?.key === key ? echec.message : null;
  const aCalculer = key !== null && data === undefined && error === null;

  useEffect(() => {
    if (!aCalculer || enVol !== null || from === null || to === null) return;
    const k = `${from}|${to}`;
    const t = setTimeout(() => {
      const clause = hogWindowClause(from, to);
      const sur = hogWindowClause(from, to, "t_first_sub");
      if (clause === null || sur === null) {
        setEchec({ key: k, message: "Période illisible." });
        return;
      }
      setEnVol(k);
      setEchec(null);
      void run({ window: clause, windowOnFirstSub: sur, from, to })
        .then((res) => {
          // Rangée même si la période a changé entre-temps : le calcul est fait,
          // le jeter obligerait à le repayer au retour. C'est la clé COURANTE
          // qui décide de ce qui s'affiche, pas l'ordre d'arrivée.
          setCache((prev) => new Map(prev).set(k, res));
        })
        .catch((e: unknown) => {
          setEchec({
            key: k,
            // Jamais `e.message` : c'est la chaîne brute du client Convex
            // (« [Request ID: …] Server Error »), qui ne dit rien.
            message: convexErrorMessage(e, "Recalcul impossible."),
          });
        })
        .finally(() => setEnVol(null));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [aCalculer, enVol, from, to, run]);

  const retry = useCallback(() => setEchec(null), []);

  return { data, loading: aCalculer, error, retry };
}
