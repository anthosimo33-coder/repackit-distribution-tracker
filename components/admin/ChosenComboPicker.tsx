"use client";

import { useMemo, useState } from "react";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  assembleScript,
  KIND_LABELS,
  normalizeAssembledForCompare,
  usefulShortLabel,
  type ScriptKind,
} from "@/lib/scriptAssembly";
import { comboKeyOf } from "@/lib/scriptCombos";
import { formatNumber, formatDate } from "@/lib/format";

/**
 * Sélecteur de « combinaison choisie » — cœur UI de « Rejouer ce script » et du
 * mode manuel. Trois sélecteurs (hook/flux/cta, briques ACTIVES uniquement)
 * PORTANT la performance (perfByBrick, fenêtre `latest` = tout l'historique),
 * triés perf ↓ avec retour à l'ordre d'origine. Aperçu du script assemblé
 * (labels:false, comme le voit la créatrice), mis à jour à chaque changement.
 *
 * Quand la modale est pré-remplie depuis une source (`replaySource`), un panneau
 * rappelle la perf du script source (vues·date·créatrice, ou agrégat combo) et
 * SIGNALE les divergences — c'est le seul endroit où le rejeu peut tromper :
 *   - une brique de la source ÉDITÉE depuis (réassemblage ≠ texte figé source) ;
 *   - une brique SUPPRIMÉE (slot vide → à remplir) ;
 *   - une brique DÉSACTIVÉE (plus sélectionnable → à remplacer) ;
 *   - une brique CHANGÉE volontairement (variante → la perf affichée est celle de
 *     l'original, pas de la variante).
 *
 * Contrôlé : la sélection (3 brickIds ou "") vit chez le parent (qui valide
 * l'activité et compose l'imposedCombo). Ce composant n'écrit rien en base.
 */

export type ReplaySource = {
  campaignId: Id<"scriptCampaigns">;
  campaignName: string;
  bricks: {
    hookBrickId: Id<"scriptBricks">;
    fluxBrickId: Id<"scriptBricks">;
    ctaBrickId: Id<"scriptBricks">;
  };
  /** Assignation source (lignage `replayedFrom`) ; null depuis l'entrée analytics. */
  sourceAssignmentId: Id<"assignments"> | null;
  /** Texte FIGÉ de la source → détection « brique éditée depuis ». Null si agrégat. */
  sourceAssembledScript: string | null;
  perf:
    | {
        kind: "post";
        views: number | null;
        date: number | null;
        creatorName: string;
      }
    | { kind: "combo"; viewsMedian: number | null; postCount: number };
};

/** Sélection courante : brickId choisi par slot ("" = non choisi). */
export type ChosenBricks = { hook: string; flux: string; cta: string };
export const EMPTY_CHOSEN: ChosenBricks = { hook: "", flux: "", cta: "" };

type BrickPerf = FunctionReturnType<typeof api.scriptAnalytics.perfByBrick>[number];
type ComboPerf = FunctionReturnType<typeof api.scriptAnalytics.perfByCombo>[number];

const KINDS: ScriptKind[] = ["hook", "flux", "cta"];

/** Libellé perf d'une brique. Sans historique (0 post) → tiret, JAMAIS un zéro. */
function brickPerfLabel(p: BrickPerf | undefined): string {
  if (!p || p.postCount === 0) return "—";
  return `${p.postCount}× · ${formatNumber(p.viewsMedian)} vues méd.`;
}

export function ChosenComboPicker({
  campaignId,
  bricks,
  value,
  onChange,
  replaySource,
  disabled,
}: {
  campaignId: Id<"scriptCampaigns">;
  bricks: Doc<"scriptBricks">[] | undefined;
  value: ChosenBricks;
  onChange: (v: ChosenBricks) => void;
  replaySource?: ReplaySource;
  disabled?: boolean;
}) {
  // Perf par brique/combo sur TOUT l'historique (fenêtre `latest`), pas j7.
  const perfBricks = useProjectQuery(api.scriptAnalytics.perfByBrick, {
    campaignId,
    window: "latest",
  });
  const perfCombos = useProjectQuery(api.scriptAnalytics.perfByCombo, {
    campaignId,
    window: "latest",
  });
  const [sortByPerf, setSortByPerf] = useState(true);

  const perfByBrickId = useMemo(() => {
    const m = new Map<string, BrickPerf>();
    for (const p of perfBricks ?? []) m.set(p.brickId, p);
    return m;
  }, [perfBricks]);

  const comboByKey = useMemo(() => {
    const m = new Map<string, ComboPerf>();
    for (const c of perfCombos ?? []) m.set(c.comboKey, c);
    return m;
  }, [perfCombos]);

  const bricksById = useMemo(() => {
    const m = new Map<string, Doc<"scriptBricks">>();
    for (const b of bricks ?? []) m.set(b._id, b);
    return m;
  }, [bricks]);

  // Briques actives par kind, triées perf ↓ (nulls en dernier) ou ordre d'origine.
  const activeByKind = useMemo(() => {
    const out: Record<ScriptKind, Doc<"scriptBricks">[]> = {
      hook: [],
      flux: [],
      cta: [],
    };
    for (const b of bricks ?? []) {
      if (b.active && (b.kind === "hook" || b.kind === "flux" || b.kind === "cta")) {
        out[b.kind].push(b);
      }
    }
    const byOrigin = (a: Doc<"scriptBricks">, b: Doc<"scriptBricks">) =>
      (a.order ?? a.createdAt) - (b.order ?? b.createdAt);
    for (const k of KINDS) {
      out[k].sort((a, b) => {
        if (!sortByPerf) return byOrigin(a, b);
        const va = perfByBrickId.get(a._id)?.viewsMedian ?? null;
        const vb = perfByBrickId.get(b._id)?.viewsMedian ?? null;
        if (va === vb) return byOrigin(a, b);
        if (va === null) return 1; // sans historique en dernier
        if (vb === null) return -1;
        return vb - va; // perf décroissante
      });
    }
    return out;
  }, [bricks, sortByPerf, perfByBrickId]);

  const sourceIds = replaySource
    ? {
        hook: replaySource.bricks.hookBrickId as string,
        flux: replaySource.bricks.fluxBrickId as string,
        cta: replaySource.bricks.ctaBrickId as string,
      }
    : null;

  // État d'un slot de la SOURCE (pour messages) : ok / désactivée / supprimée.
  function sourceSlotStatus(kind: ScriptKind): "ok" | "disabled" | "deleted" | null {
    if (!sourceIds) return null;
    const id = sourceIds[kind];
    const active = activeByKind[kind].some((b) => b._id === id);
    if (active) return "ok";
    return bricksById.has(id) ? "disabled" : "deleted";
  }

  const contentOf = (id: string) => bricksById.get(id)?.content ?? "";
  const isChosen = (kind: ScriptKind) =>
    activeByKind[kind].some((b) => b._id === value[kind]);
  const allChosen = KINDS.every((k) => isChosen(k));

  const preview = allChosen
    ? assembleScript(
        {
          hook: contentOf(value.hook),
          flux: contentOf(value.flux),
          cta: contentOf(value.cta),
        },
        { labels: false },
      )
    : null;

  // Variante : la sélection courante diffère des briques de la source.
  const changed =
    !!sourceIds &&
    (value.hook !== sourceIds.hook ||
      value.flux !== sourceIds.flux ||
      value.cta !== sourceIds.cta);

  // Éditée depuis : mêmes briques que la source, mais le réassemblage à neuf
  // diffère du texte FIGÉ de la source → une brique a été éditée entre-temps.
  // Comparaison NORMALISÉE (espaces insécables / invisibles neutralisés) : une
  // alerte qui sonne sur un espace insécable est une alerte qu'on ignore.
  const editedSince =
    !!replaySource?.sourceAssembledScript &&
    !changed &&
    preview !== null &&
    normalizeAssembledForCompare(preview) !==
      normalizeAssembledForCompare(replaySource.sourceAssembledScript);

  const comboKey = allChosen
    ? comboKeyOf({
        hookBrickId: value.hook,
        fluxBrickId: value.flux,
        ctaBrickId: value.cta,
      })
    : null;
  const comboPerf = comboKey ? comboByKey.get(comboKey) : undefined;

  const loading = bricks === undefined || perfBricks === undefined;

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/50 p-3">
      {/* Panneau perf SOURCE — rappelle POURQUOI on rejoue + divergences. */}
      {replaySource && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50/60 p-2.5 text-sm">
          <div className="font-medium text-indigo-900">Script source</div>
          <div className="text-indigo-800">
            {replaySource.perf.kind === "post"
              ? `${formatNumber(replaySource.perf.views)} vues · ${
                  replaySource.perf.date != null
                    ? formatDate(replaySource.perf.date)
                    : "—"
                } · ${replaySource.perf.creatorName}`
              : `médiane ${formatNumber(replaySource.perf.viewsMedian)} vues · ${
                  replaySource.perf.postCount
                } post${replaySource.perf.postCount > 1 ? "s" : ""}`}
          </div>
          {changed && (
            <div className="mt-1 text-xs font-medium text-amber-700">
              ⚠️ Perf affichée = script original, pas ta variante.
            </div>
          )}
          {editedSince && (
            <div className="mt-1 text-xs font-medium text-amber-700">
              ⚠️ Une brique a été éditée depuis — la reprise ne sera pas
              identique à l&apos;original.
            </div>
          )}
        </div>
      )}

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-500">
              Trois briques (actives uniquement)
            </Label>
            <button
              type="button"
              onClick={() => setSortByPerf((s) => !s)}
              disabled={disabled}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              {sortByPerf ? "Tri : performance ↓" : "Tri : ordre d'origine"}
            </button>
          </div>

          {KINDS.map((kind) => {
            const opts = activeByKind[kind];
            const status = sourceSlotStatus(kind);
            const selected = opts.find((b) => b._id === value[kind]);
            return (
              <div key={kind} className="space-y-1">
                <Label className="text-xs">{KIND_LABELS[kind]}</Label>
                {opts.length === 0 ? (
                  <p className="text-xs text-amber-600">
                    Aucune brique {KIND_LABELS[kind].toLowerCase()} active dans
                    cette campagne.
                  </p>
                ) : (
                  <Select
                    value={selected ? value[kind] : ""}
                    onValueChange={(v) =>
                      v && onChange({ ...value, [kind]: v })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger aria-label={KIND_LABELS[kind]}>
                      <SelectValue>
                        {/* content = le texte qui PART à la créatrice (pas label). */}
                        {selected ? (
                          <span className="block truncate text-left">
                            {selected.content}
                          </span>
                        ) : (
                          "Choisir une brique…"
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {opts.map((b) => {
                        const note = usefulShortLabel(b.label, b.content);
                        return (
                          <SelectItem key={b._id} value={b._id}>
                            <span className="flex flex-col gap-0.5">
                              {/* content en évidence = ce qui sera réellement utilisé. */}
                              <span className="line-clamp-3 whitespace-normal">
                                {b.content}
                              </span>
                              {note && (
                                <span className="text-xs italic text-slate-400">
                                  note : {note}
                                </span>
                              )}
                              <span className="text-xs text-slate-500">
                                {brickPerfLabel(perfByBrickId.get(b._id))}
                              </span>
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
                {status === "deleted" && (
                  <p className="text-xs font-medium text-amber-700">
                    Brique {KIND_LABELS[kind].toLowerCase()} de la source
                    supprimée — choisis un remplaçant.
                  </p>
                )}
                {status === "disabled" && (
                  <p className="text-xs font-medium text-amber-700">
                    Brique {KIND_LABELS[kind].toLowerCase()} de la source
                    désactivée — choisis un remplaçant.
                  </p>
                )}
              </div>
            );
          })}

          {/* Aperçu du script assemblé (labels:false = rendu créatrice). */}
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">Aperçu du script</Label>
            {preview ? (
              <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-2.5 text-sm text-slate-800">
                {preview}
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Choisis les trois briques pour voir le script assemblé.
              </p>
            )}
          </div>

          {/* Perf passée de CETTE combinaison exacte (info, pas avertissement). */}
          {comboKey && (
            <p className="text-xs text-slate-500">
              {comboPerf
                ? `Déjà utilisée : médiane ${formatNumber(
                    comboPerf.viewsMedian,
                  )} vues · ${comboPerf.postCount} post${
                    comboPerf.postCount > 1 ? "s" : ""
                  }.`
                : "Combinaison encore jamais utilisée."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
