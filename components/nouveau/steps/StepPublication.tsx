"use client";

import { useMemo, type Dispatch } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";
import { FORMAT_CONFIGS, type FormatKey } from "@/lib/format-config";
import {
  getEffectiveStatus,
  isSelectableForPublication,
} from "@/lib/compte-status";
import { cn } from "@/lib/utils";
import type { NouveauAction, NouveauData } from "../useNouveauState";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { dateFnsLocale } from "@/lib/date-fns-locale";

export type SourceStatus = FunctionReturnType<
  typeof api.publications.getSourceStatus
>;

/**
 * StepPublication — étape 4 du modal. Plateformes (filtrées par mediaType
 * via FORMAT_CONFIGS), compte filtré par plateforme cochée, date, notes.
 *
 * Reset compte quand plateformes change : géré au niveau NouveauModal pour
 * éviter un useEffect setState ici.
 */
export function StepPublication({
  data,
  dispatch,
  sourceStatus,
  confirmOverride,
  onConfirmOverrideChange,
}: {
  data: NouveauData;
  dispatch: Dispatch<NouveauAction>;
  // Anti-shadowban — statut du sourceId (Short uniquement, undefined sinon).
  sourceStatus?: SourceStatus;
  confirmOverride: boolean;
  onConfirmOverrideChange: (value: boolean) => void;
}) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.common.StepPublication");
  const projectPath = useProjectPath();
  // On récupère TOUS les comptes (pas seulement les actifs) pour pouvoir
  // afficher, quand aucun n'est sélectionnable, combien sont en warmup /
  // shadowban sur les plateformes ciblées. Le dropdown ne propose que les
  // comptes "actif" (isSelectableForPublication).
  const comptesData = useProjectQuery(api.comptes.listComptes, {});

  // Plateformes déjà couvertes par ce sourceId (Short). blocked = TikTok (strict
  // bloquant) ; warning = Instagram/YouTube (repost autorisé après confirmation).
  const blockedSet = useMemo(
    () => new Set(sourceStatus?.blockedPlatforms ?? []),
    [sourceStatus],
  );
  const warningSet = useMemo(
    () => new Set(sourceStatus?.warningPlatforms ?? []),
    [sourceStatus],
  );
  const selectedWarnings = useMemo(
    () => data.plateformes.filter((p) => warningSet.has(p)),
    [data.plateformes, warningSet],
  );

  const allowedPlatforms = useMemo<readonly string[]>(() => {
    if (!data.mediaType) return [];
    const key = data.mediaType as FormatKey;
    return FORMAT_CONFIGS[key]?.allowedPlatforms ?? [];
  }, [data.mediaType]);

  // Comptes sur les plateformes ciblées (tous statuts) — sert au message.
  const comptesOnPlatforms = useMemo(() => {
    if (!comptesData) return [];
    return comptesData.filter((c) => data.plateformes.includes(c.plateforme));
  }, [comptesData, data.plateformes]);

  // Sélectionnables = uniquement les comptes "actif".
  const filteredComptes = useMemo(
    () =>
      comptesOnPlatforms.filter((c) =>
        isSelectableForPublication(getEffectiveStatus(c)),
      ),
    [comptesOnPlatforms],
  );

  const warmupCount = comptesOnPlatforms.filter(
    (c) => getEffectiveStatus(c) === "warmup",
  ).length;
  const shadowbanCount = comptesOnPlatforms.filter(
    (c) => getEffectiveStatus(c) === "shadowban",
  ).length;
  const platformLabel =
    data.plateformes.length === 1
      ? data.plateformes[0]
      : tr("lesPlateformesSelectionnees");

  const datePubliDate = new Date(data.datePubli);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label>{tr("plateformes")}</Label>
        <div className="flex flex-col gap-2 pt-2">
          {allowedPlatforms.map((p) => {
            const blocked = blockedSet.has(p);
            const warning = warningSet.has(p);
            return (
              <label
                key={p}
                title={
                  blocked
                    ? tr("bloqueDejaPosteSurRisque", { p: p })
                    : undefined
                }
                className={cn(
                  "flex items-center gap-2",
                  blocked
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer",
                )}
              >
                <Checkbox
                  checked={data.plateformes.includes(p)}
                  disabled={blocked}
                  onCheckedChange={() =>
                    dispatch({ type: "TOGGLE_PLATEFORME", plateforme: p })
                  }
                />
                <span className="text-sm">{p}</span>
                {blocked && (
                  <Badge className="border-rose-200 bg-rose-50 text-rose-700">
                    {tr("bloqueDejaPoste")}
                  </Badge>
                )}
                {warning && !blocked && (
                  <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                    {tr("dejaPosteSur", { p: p })}
                  </Badge>
                )}
              </label>
            );
          })}
        </div>
        {selectedWarnings.length > 0 && (
          <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2">
            <Checkbox
              checked={confirmOverride}
              onCheckedChange={(checked) =>
                onConfirmOverrideChange(checked === true)
              }
            />
            <span className="text-xs text-amber-900">
              {tr("jeConfirmeMalgreLAvertissement", { value: selectedWarnings.join(", ") })}
            </span>
          </label>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>{tr("compte")}</Label>
        {comptesData === undefined ? (
          <Skeleton className="h-9 w-full" />
        ) : filteredComptes.length === 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {tr("aucunCompteActifSur", { platformLabel: platformLabel })}
            {(warmupCount > 0 || shadowbanCount > 0) && (
              <>
                {" "}{tr("enWarmupEnShadowban", { warmupCount: warmupCount, shadowbanCount: shadowbanCount })}
              </>
            )}{" "}
            <Link
              href={projectPath("/comptes")}
              className="font-medium underline underline-offset-2"
            >
              {tr("gererLesComptes")}
            </Link>
            .
          </div>
        ) : (
          <Select
            value={data.compte}
            onValueChange={(v) =>
              v !== null && dispatch({ type: "SET_COMPTE", compte: v })
            }
          >
            <SelectTrigger>
              <SelectValue>{data.compte || tr("selectionneUnCompte")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {filteredComptes.map((c) => (
                <SelectItem key={c._id} value={c.handle}>
                  <span className="font-mono">{c.handle}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {c.plateforme}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>{tr("dateDePublication")}</Label>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className="w-full justify-start text-left font-normal"
              >
                <CalendarIcon className="mr-2 size-4" />
                {datePubliDate.toLocaleDateString(loc, {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </Button>
            }
          />
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={datePubliDate}
              onSelect={(d) =>
                d &&
                dispatch({ type: "SET_DATE_PUBLI", datePubli: d.getTime() })
              }
              locale={dateFnsLocale(loc)}
              weekStartsOn={1}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="notes">{tr("notes")}</Label>
        <Textarea
          id="notes"
          rows={2}
          placeholder={tr("optionnel")}
          value={data.notes}
          onChange={(e) =>
            dispatch({ type: "SET_NOTES", notes: e.target.value })
          }
        />
      </div>
    </div>
  );
}
