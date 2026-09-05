"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckIcon, XIcon } from "lucide-react";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { VideoExample, type FormatExample } from "./VideoExample";
import { rateSummary, type RateModel } from "@/lib/format-rate";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";

/**
 * P6/P7 — rendu du brief d'un format TEL QUE LE CRÉATEUR LE VERRA. Composant
 * PARTAGEABLE : page détail admin (aperçu) ET portail créateur (fiche
 * assignment). Aucun téléchargement ; seuls les hooks EMBARQUÉS (pas la biblio).
 *
 * Type STRUCTUREL (pas lié à getFormat) pour être réutilisable : getFormat ET
 * getMyAssignment.format le satisfont. `showRate` permet à la fiche assignment
 * de masquer la grille générique (elle affiche le rateSnapshot + calculateur).
 */
export type FormatBrief = {
  name: string;
  type: string;
  brief: string;
  hooks: string[];
  guidelines: { do: string[]; dont: string[] };
  exampleVideos: FormatExample[];
  /** ABSENTE ⇔ jamais renseignée (cf. schema.formats). La section rému n'est
   *  alors pas rendue : afficher « 0 » ferait passer une décision non prise pour
   *  une décision prise. */
  rateModel?: RateModel | null;
};

const TYPE_LABELS: Record<string, string> = {
  carousel: "Carrousel",
  short: "Short",
  screenrecorder: "ScreenRecorder",
  custom: "Custom",
};

export function FormatBriefPreview({
  format,
  showRate = true,
  currency,
}: {
  format: FormatBrief;
  showRate?: boolean;
  /** Devise de la PAIE créatrices (dollars) pour la grille de rému. Composant
   *  présentationnel : la devise est fournie par l'appelant (portail →
   *  current.payCurrency). Absente → montants sans symbole. */
  currency?: string | null;
}) {
  const tf = useTranslations("format");
  const loc = useIntlLocale();
  const rate = format.rateModel ? rateSummary(format.rateModel, currency, loc) : null;
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
            <CardTitle className="text-base">{tf("brief")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SimpleMarkdown content={format.brief} />
          </CardContent>
        </Card>
      )}

      {format.hooks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tf("hooks")}</CardTitle>
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
                <CheckIcon className="size-4" />{tf("todo")}</CardTitle>
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
                <XIcon className="size-4" />{tf("avoid")}</CardTitle>
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
            <CardTitle className="text-base">{tf("examples")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {format.exampleVideos.map((ex, i) => (
              <VideoExample key={i} example={ex} />
            ))}
          </CardContent>
        </Card>
      )}

      {showRate && rate !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tf("pay")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-slate-800">
              {rate.map((line, i) => (
                <li
                  key={i}
                  className={i === 0 ? "font-semibold text-slate-900" : ""}
                >
                  {tf(line.key as Parameters<typeof tf>[0], line.params)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
