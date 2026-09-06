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
import type { WindowedParcours } from "@/convex/analyticsWindowed";

/**
 * RECALCUL À LA DEMANDE des agrégats de l'onglet Parcours, sur une plage libre.
 *
 * ⚠️ CE HOOK EXISTE POUR CACHER UNE LATENCE, PAS POUR L'IGNORER. Mesuré sur la
 * vraie API PostHog le 06/09/2026 : une volée coûte 10,6 s à froid (plus de deux
 * minutes sans requête) et 1,4 s ensuite. La largeur de la fenêtre n'y change
 * rien. Quatre mécanismes, chacun contre un symptôme précis :
 *
 *  1. PRÉCHAUFFE au montage — la volée part pendant que l'écran se lit, donc le
 *     premier vrai changement de dates tombe sur du chaud (~1 s au lieu de 10).
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

export interface WindowedParcoursState {
  /** `undefined` = servez-vous du cache 90 jours (fenêtre totale, ou pas encore prêt). */
  data: WindowedParcours | undefined;
  /** Un recalcul est en cours. Les chiffres affichés sont ceux d'avant. */
  loading: boolean;
  /** Message d'erreur à afficher — jamais un écran vide sans explication. */
  error: string | null;
}

export function useWindowedParcours(
  window: AnalyticsWindow | null,
  range: DataRange | null,
): WindowedParcoursState {
  // `useProjectAction` injecte le projet courant : le même chemin que le reste
  // du hub, plutôt qu'un projectId threadé à la main jusqu'ici.
  const run = useProjectAction(api.analyticsWindowed.getWindowedParcours);
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
      if (clause === null) {
        setPending({ key, error: "Période illisible." });
        return;
      }
      inFlight.current = key;
      setPending({ key, error: null });
      void run({ window: clause, from: window.from, to: window.to })
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
            error: e instanceof Error ? e.message : "Recalcul impossible.",
          });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [key, window, already, run]);

  // PRÉCHAUFFE : au montage, une volée sur la profondeur complète réveille la
  // connexion PostHog. Son résultat n'est pas affiché (l'écran sert le cache du
  // cron), il ne sert qu'à ce que le PREMIER choix de période soit rapide.
  const preheated = useRef(false);
  useEffect(() => {
    if (preheated.current || !range) return;
    preheated.current = true;
    const clause = hogWindowClause(range.first, range.last);
    if (clause === null) return;
    void run({ window: clause, from: range.first, to: range.last }).catch(() => {
      // Silencieux : une préchauffe ratée n'est pas une panne, elle coûte juste
      // la lenteur qu'on cherchait à éviter.
    });
  }, [range, run]);

  const suivi = pending !== null && pending.key === key ? pending : null;
  return {
    data,
    loading: data === undefined && suivi !== null && suivi.error === null,
    error: suivi?.error ?? null,
  };
}
