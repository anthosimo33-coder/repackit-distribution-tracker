"use client";

import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckIcon, XIcon } from "lucide-react";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { VideoExample } from "./VideoExample";
import { rateSummary } from "@/lib/format-rate";

/**
 * P6 — rendu du brief d'un format TEL QUE LE CRÉATEUR LE VERRA. Composant
 * PARTAGEABLE : la page détail admin l'utilise en aperçu, et le portail
 * créateur le réutilisera tel quel (chantier suivant). Aucun téléchargement,
 * jamais : on ne montre que les hooks EMBARQUÉS (pas la biblio).
 */

export type FormatForPreview = NonNullable<
  FunctionReturnType<typeof api.formats.getFormat>
>;

const TYPE_LABELS: Record<string, string> = {
  carousel: "Carrousel",
  short: "Short",
  screenrecorder: "ScreenRecorder",
  custom: "Custom",
};

export function FormatBriefPreview({ format }: { format: FormatForPreview }) {
  const rate = rateSummary(format.rateModel);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          {format.name}
        </h2>
        <Badge variant="secondary">
          {TYPE_LABELS[format.type] ?? format.type}
        </Badge>
      </div>

      {format.brief.trim().length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Brief</CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleMarkdown content={format.brief} />
          </CardContent>
        </Card>
      )}

      {format.hooks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hooks à utiliser</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {format.hooks.map((h, i) => (
                <li
                  key={i}
                  className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-800"
                >
                  {h}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(format.guidelines.do.length > 0 ||
        format.guidelines.dont.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-emerald-700">
                <CheckIcon className="size-4" /> À faire
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm text-slate-700">
                {format.guidelines.do.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-emerald-500">•</span>
                    {d}
                  </li>
                ))}
                {format.guidelines.do.length === 0 && (
                  <li className="text-slate-400">—</li>
                )}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-rose-700">
                <XIcon className="size-4" /> À éviter
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm text-slate-700">
                {format.guidelines.dont.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-rose-500">•</span>
                    {d}
                  </li>
                ))}
                {format.guidelines.dont.length === 0 && (
                  <li className="text-slate-400">—</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {format.exampleVideos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vidéos exemples</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {format.exampleVideos.map((ex, i) => (
              <VideoExample key={i} example={ex} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rémunération</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm text-slate-800">
            {rate.map((line, i) => (
              <li
                key={i}
                className={i === 0 ? "font-semibold text-slate-900" : ""}
              >
                {line}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
