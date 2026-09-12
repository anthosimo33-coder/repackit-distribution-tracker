"use client";

import { cn } from "@/lib/utils";
import { largeurRemboursement } from "@/lib/market-plot";
import type { MarketDerived } from "@/lib/market-aggregate";

/**
 * REMBOURSÉ EN COMBIEN DE TEMPS — une barre par marché.
 *
 * Le tableau donne le jour ; ici on le VOIT, et surtout on voit les trois états
 * qui ne sont pas des jours : remboursé d'emblée, jamais remboursé dans la
 * fenêtre mesurée, et pas de verdict du tout.
 *
 * ⚠️ « JAMAIS » REMPLIT LA PISTE, IL NE LA LAISSE PAS VIDE. Une barre courte se
 * lirait comme un bon résultat, et une piste vide comme une donnée manquante.
 * C'est le MOTIF hachuré qui dit « hors mesure », jamais la longueur — la règle
 * vit dans `lib/market-plot`, avec son test.
 */
export function MarketPayback({
  marches,
  selection,
  onSelect,
}: {
  marches: MarketDerived[];
  selection: string | null;
  onSelect: (key: string) => void;
}) {
  // Les marchés sans client NI coût n'ont rien à dire ici : ils ne sont ni
  // remboursés ni non remboursés, ils sont absents du sujet.
  const lignes = marches.filter((m) => m.clients > 0 || m.cost > 0);
  if (lignes.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-xs text-slate-400">
        Aucun marché à comparer sur cette période.
      </p>
    );
  }

  const ordonnees = [...lignes].sort((a, b) => {
    // Du plus vite remboursé au moins. Les états sans jour passent après, ce
    // qui range naturellement « jamais » et « inconnu » en bas.
    const va = a.payback.day ?? 999;
    const vb = b.payback.day ?? 999;
    return va - vb || b.clients - a.clients;
  });

  return (
    <div className="divide-y divide-slate-100">
      {ordonnees.map((m) => {
        const { state, day } = m.payback;
        const largeur = largeurRemboursement(m.payback) * 100;
        const horsMesure = state === "jamais" || state === "inconnu";
        const texte =
          state === "gratuit"
            ? "immédiat"
            : state === "jamais"
              ? "jamais"
              : state === "inconnu"
                ? "pas de verdict"
                : `J+${day}`;
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => onSelect(m.key)}
            aria-pressed={selection === m.key}
            className={cn(
              "grid w-full grid-cols-[minmax(0,9rem)_1fr_5.5rem] items-center gap-3 px-1 py-1.5 text-left transition-colors hover:bg-slate-50",
              selection === m.key ? "bg-slate-50" : "",
            )}
          >
            <span className="truncate text-xs text-slate-700">{m.label}</span>
            <span className="h-3 overflow-hidden rounded bg-slate-100">
              <span
                className={cn(
                  "block h-full rounded",
                  horsMesure
                    ? "border border-rose-300 bg-[repeating-linear-gradient(135deg,#fee2e6_0_5px,transparent_5px_10px)]"
                    : "bg-emerald-500",
                )}
                style={{ width: `${largeur.toFixed(0)}%` }}
              />
            </span>
            <span
              className={cn(
                "text-right font-mono text-xs tabular-nums",
                state === "jamais"
                  ? "text-rose-600"
                  : state === "inconnu"
                    ? "text-slate-400"
                    : "text-emerald-600",
              )}
            >
              {texte}
            </span>
          </button>
        );
      })}
    </div>
  );
}
