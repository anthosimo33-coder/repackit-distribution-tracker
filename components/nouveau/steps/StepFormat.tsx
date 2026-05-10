"use client";

import type { Dispatch } from "react";
import type { MediaType } from "@/lib/media-type";
import { FORMAT_CONFIGS, type FormatKey } from "@/lib/format-config";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { NouveauAction } from "../useNouveauState";

/**
 * StepFormat — étape 1 du modal. 3 cards cliquables (Carrousel / Short /
 * ScreenRecorder). Click → SET_MEDIATYPE + auto NEXT (passe direct étape 2).
 *
 * ScreenRecorder visible mais disabled tant que Batch D n'a pas livré le
 * mediaType union étendu + Convex storage. Badge "Bientôt disponible".
 */
export function StepFormat({
  selected,
  dispatch,
  onChosen,
}: {
  selected: MediaType | undefined;
  dispatch: Dispatch<NouveauAction>;
  /** Callback fired après SET_MEDIATYPE — utilisé par NouveauModal pour
   *  trigger l'auto-next vers étape 2. Décision tranchée : pas de bouton
   *  "Suivant" en step 1. */
  onChosen: () => void;
}) {
  const formatKeys: FormatKey[] = ["carousel", "short", "screenrecorder"];

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Quel format veux-tu créer ? Tu pourras choisir un hook ensuite.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {formatKeys.map((key) => {
          const config = FORMAT_CONFIGS[key];
          const Icon = config.icon;
          const isSelected = selected === config.mediaType;
          const disabled = config.disabled === true;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                dispatch({ type: "SET_MEDIATYPE", mediaType: config.mediaType });
                onChosen();
              }}
              className={cn(
                "group/card text-left",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <Card
                className={cn(
                  "h-full transition-all",
                  isSelected
                    ? "border-slate-900 ring-2 ring-slate-900/10"
                    : disabled
                      ? ""
                      : "hover:border-slate-400 hover:shadow-sm",
                )}
              >
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between">
                    <Icon className="size-6 text-slate-700" />
                    {disabled && (
                      <Badge variant="outline" className="text-xs">
                        Bientôt disponible
                      </Badge>
                    )}
                  </div>
                  <div>
                    <div className="text-base font-semibold text-slate-900">
                      {config.singular}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {config.cardDescription}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {config.allowedPlatforms.map((p) => (
                      <Badge
                        key={p}
                        variant="secondary"
                        className="text-xs font-normal"
                      >
                        {p}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
