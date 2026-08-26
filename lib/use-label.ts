"use client";

import { useTranslations } from "next-intl";

/**
 * Résout une clé de message PLEINEMENT QUALIFIÉE (« status.assignment.todo »).
 *
 * Pourquoi ce détour plutôt que `useTranslations("status")` : les tables de
 * libellés partagées vivent dans des modules PURS (`lib/assignment-status.ts`,
 * `convex/rushStatus.ts`, `components/calendar/calendar-status-meta.tsx`). Elles
 * sont importées par du code admin, du code créateur, et parfois par le runtime
 * Convex — elles ne peuvent donc pas importer next-intl pour se typer contre le
 * catalogue. Leurs clés sont des `string`, et c'est ici qu'on les rebranche.
 *
 * La contrepartie est explicite : une clé de table erronée ne se voit pas à la
 * compilation, elle se voit à l'exécution (next-intl rend la clé brute et
 * journalise). Les clés littérales écrites dans du JSX, elles, restent typées —
 * ce hook ne sert QU'aux tables.
 */
export function useLabel(): (
  key: string,
  params?: Record<string, string | number>,
) => string {
  const t = useTranslations();
  // `params` sert les tables dont le libellé est interpolé — « Warmup J+2/7 »
  // (lib/compte-status) ou « 3 vidéos publiées » (lib/progression). Les recoller
  // à la main dans le module pur rendrait la phrase intraduisible.
  return (key, params) =>
    t(key as Parameters<typeof t>[0], params as never);
}
