"use client";

import { useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FORMAT_CONFIGS,
  RECORDING_DEVICE_ICONS,
  RECORDING_DEVICE_LABELS,
  type FormatKey,
} from "@/lib/format-config";
import { getFolderColor } from "@/lib/folder-colors";
import { SourceStatusBadge } from "@/components/shorts/SourceStatusBadge";
import { cn } from "@/lib/utils";
import { PencilIcon } from "lucide-react";
import Image from "next/image";
import type { Dispatch } from "react";
import type { NouveauAction, NouveauData, Step } from "../useNouveauState";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useFormatLabels } from "@/lib/use-format-labels";

/**
 * StepRecap — étape 5 du modal. Récap lecture seule + boutons "Modifier"
 * par section (qui dispatch GOTO step). Le bouton "Créer" final est dans le
 * footer du NouveauModal — il appelle createPublication.
 */
export function StepRecap({
  data,
  dispatch,
}: {
  data: NouveauData;
  dispatch: Dispatch<NouveauAction>;
}) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.common.StepRecap");
  const fmt = useFormatLabels();
  const allHooks = useProjectQuery(api.hooks.listHooks, {});
  // Batch D — résolution image preview pour le récap ScreenRecorder.
  const imagePreview = useQuery(
    api.storage.getPreviewUrl,
    data.image ? { storageId: data.image } : "skip",
  );
  const selectedHook =
    data.hookMode === "biblio"
      ? allHooks?.find((h) => h._id === data.hookId) ?? null
      : null;
  const hookText =
    data.hookMode === "biblio"
      ? selectedHook?.text ?? ""
      : data.customHook.text.trim();
  // P10 — mécanique/niveau retirés du récap (outillage éditorial interne).
  const hookLangue =
    data.hookMode === "biblio"
      ? selectedHook?.langue
      : data.customHook.langue;

  const config = data.mediaType
    ? FORMAT_CONFIGS[data.mediaType as FormatKey]
    : null;

  // Section Hook masquée pour SR (étape 2 skip). Short : section Publication
  // affiche en plus le statut de la source (anti-shadowban).
  const isSR = data.mediaType === "screenrecorder";
  const isShort = data.mediaType === "short";
  const icps = useProjectQuery(api.icps.listIcps, {});
  const selectedIcp = data.icpId
    ? icps?.find((i) => i._id === data.icpId) ?? null
    : null;
  const icpColor = selectedIcp ? getFolderColor(selectedIcp.color) : null;
  const DeviceIcon =
    data.recordingDevice !== undefined
      ? RECORDING_DEVICE_ICONS[data.recordingDevice]
      : null;

  const dateLabel = new Date(data.datePubli).toLocaleDateString(loc, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-4">
      <Section
        title={tr("format2")}
        onEdit={() => dispatch({ type: "GOTO", step: 1 as Step })}
      >
        {config ? (
          <div className="flex items-center gap-2">
            <config.icon className="size-4 text-slate-700" />
            <span className="font-medium">{fmt.singular(data.mediaType as FormatKey)}</span>
          </div>
        ) : (
          <span className="italic text-slate-400">{tr("nonSelectionne")}</span>
        )}
      </Section>

      {!isSR && (
        <Section
          title={tr("hook")}
          onEdit={() => dispatch({ type: "GOTO", step: 2 as Step })}
        >
          {hookText ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-900">{hookText}</p>
              <div className="flex gap-1.5">
                {hookLangue && <Badge variant="outline">{hookLangue}</Badge>}
                <Badge variant="outline" className="text-slate-500">
                  {data.hookMode === "biblio" ? tr("bibliotheque") : tr("custom")}
                </Badge>
              </div>
            </div>
          ) : (
            <span className="italic text-slate-400">{tr("nonSaisi")}</span>
          )}
        </Section>
      )}

      <Section
        title={tr("contenu")}
        onEdit={() => dispatch({ type: "GOTO", step: 3 as Step })}
      >
        <div className="space-y-2 text-sm">
          {/* P10 — angle tonal retiré du récap (outillage éditorial interne).
              Le champ reste en base mais n'est plus affiché. */}
          {data.mediaType === "carousel" && (
            <>
              <div>
                <span className="text-slate-500">{tr("format")}</span>{" "}
                <span className="font-mono font-medium">{data.format}</span>{" "}{tr("slides", { nbSlides: data.nbSlides })}
              </div>
              <div className="space-y-1">
                {data.slides.map((s, i) => (
                  <div key={i} className="text-xs text-slate-600">
                    <span className="text-slate-400">{tr("slide", { value: i + 1 })}</span>{" "}
                    {s.trim() ? (
                      s.length > 80 ? s.slice(0, 80) + "…" : s
                    ) : (
                      <span className="italic text-slate-400">{tr("vide")}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {data.mediaType === "short" && (
            <div className="space-y-2 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">{tr("source")}</span>
                {data.sourceId.trim() ? (
                  <span className="font-mono text-slate-900">
                    {data.sourceId}
                  </span>
                ) : (
                  <span className="italic text-slate-400">{tr("nonSaisie")}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">{tr("icpCible")}</span>
                {selectedIcp && icpColor ? (
                  <Badge variant="outline" className="gap-1.5">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        icpColor.dotClass,
                      )}
                    />
                    {selectedIcp.nom}
                  </Badge>
                ) : (
                  <span className="italic text-slate-400">
                    {tr("nonSelectionne")}
                  </span>
                )}
              </div>
              <div>
                <span className="text-slate-400">{tr("script")}</span>{" "}
                {data.script.trim() ? (
                  data.script.length > 200
                    ? data.script.slice(0, 200) + "…"
                    : data.script
                ) : (
                  <span className="italic text-slate-400">{tr("vide")}</span>
                )}
              </div>
            </div>
          )}
          {data.mediaType === "screenrecorder" && (
            <div className="space-y-2 text-xs text-slate-600">
              <div>
                <span className="text-slate-400">{tr("titre")}</span>{" "}
                {data.titre.trim() ? (
                  <span className="font-medium text-slate-900">
                    {data.titre}
                  </span>
                ) : (
                  <span className="italic text-slate-400">{tr("vide")}</span>
                )}
              </div>
              <div>
                <span className="text-slate-400">{tr("image")}</span>{" "}
                {data.image && imagePreview ? (
                  <Image
                    src={imagePreview}
                    alt={tr("preview")}
                    width={160}
                    height={90}
                    unoptimized
                    className="mt-1 aspect-video rounded border border-slate-200 object-cover"
                  />
                ) : (
                  <span className="italic text-slate-400">{tr("absente")}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">{tr("appareil")}</span>
                {data.recordingDevice && DeviceIcon ? (
                  <Badge variant="outline" className="gap-1">
                    <DeviceIcon className="size-3" />
                    {RECORDING_DEVICE_LABELS[data.recordingDevice]}
                  </Badge>
                ) : (
                  <span className="italic text-slate-400">
                    {tr("nonSelectionne")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">{tr("type")}</span>
                {data.isRepackaging === true ? (
                  <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                    {tr("repackagingRepackit")}
                  </Badge>
                ) : data.isRepackaging === false ? (
                  <Badge variant="outline" className="text-slate-600">
                    {tr("autreCapture")}
                  </Badge>
                ) : (
                  <span className="italic text-slate-400">{tr("nonChoisi")}</span>
                )}
              </div>
              <div>
                <span className="text-slate-400">{tr("script")}</span>{" "}
                {data.script.trim() ? (
                  data.script.length > 200
                    ? data.script.slice(0, 200) + "…"
                    : data.script
                ) : (
                  <span className="italic text-slate-400">{tr("optionnel")}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section
        title={tr("publication")}
        onEdit={() => dispatch({ type: "GOTO", step: 4 as Step })}
      >
        <div className="space-y-1.5 text-sm">
          <div>
            <span className="text-slate-500">{tr("plateformes")}</span>{" "}
            {data.plateformes.length > 0 ? (
              <span className="font-medium">{data.plateformes.join(", ")}</span>
            ) : (
              <span className="italic text-slate-400">{tr("aucune")}</span>
            )}
          </div>
          <div>
            <span className="text-slate-500">{tr("compte")}</span>{" "}
            {data.compte ? (
              <span className="font-mono font-medium">{data.compte}</span>
            ) : (
              <span className="italic text-slate-400">{tr("nonSelectionne")}</span>
            )}
          </div>
          <div>
            <span className="text-slate-500">{tr("date")}</span>{" "}
            <span className="font-medium">{dateLabel}</span>
          </div>
          {data.notes.trim() && (
            <div>
              <span className="text-slate-500">{tr("notes")}</span>{" "}
              <span className="text-slate-700">{data.notes}</span>
            </div>
          )}
          {isShort && data.sourceId.trim() && (
            <div className="pt-1">
              <SourceStatusBadge sourceId={data.sourceId} />
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  const tr = useTranslations("admin.common.Section");
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          {title}
        </h3>
        <Button
          variant="ghost"
          size="xs"
          onClick={onEdit}
          className="text-slate-500 hover:text-slate-900"
        >
          <PencilIcon className="size-3" />
          {tr("modifier")}
        </Button>
      </div>
      {children}
    </div>
  );
}
