"use client";

import { useQuery } from "convex/react";
import type { Dispatch } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUploader } from "@/components/ImageUploader";
import { IcpCombobox } from "@/components/icps/IcpCombobox";
import {
  RECORDING_DEVICES,
  RECORDING_DEVICE_ICONS,
  RECORDING_DEVICE_LABELS,
  type RecordingDevice,
} from "@/lib/format-config";
import { cn } from "@/lib/utils";
import type {
  FormatLetter,
  NouveauAction,
  NouveauData,
} from "../useNouveauState";
import { useTranslations } from "next-intl";

// Libellés dans `admin.common.StepContenu.formats.<lettre>`.
const FORMATS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

/**
 * StepContenu — étape 3 du modal. Switch sur mediaType :
 *  - carousel → Format A-H + nbSlides + N Textareas slides
 *  - short → ICP ciblé + 1 Textarea script
 *  - screenrecorder (Batch D) → Titre + ImageUploader + appareil + Script
 *
 * P10 — l'angle tonal (outillage éditorial interne) n'est plus exposé. Le
 * champ reste en base (défaut "Psycho" du reducer), aucune saisie UI.
 *
 * Le pre-fill slide 1 / script depuis le hook est géré au niveau
 * NouveauModal — pas ici.
 */
export function StepContenu({
  data,
  dispatch,
}: {
  data: NouveauData;
  dispatch: Dispatch<NouveauAction>;
}) {
  const tr = useTranslations("admin.common.StepContenu");
  // Résolution lazy de l'imageUrl pour ScreenRecorder : on cherche dans
  // listPublications les pubs avec storageId === data.image. Si présent
  // (ex: l'utilisateur a uploadé l'image, on a le storageId mais pas
  // l'URL), on récupère via la query enrichie. Edge case : freshly
  // uploaded image n'est pas encore dans listPublications → pas d'URL.
  // Pour l'usage ImageUploader.preview pendant le flow nouveau, on
  // résout via l'API _storage directement.
  const previewUrl = useQuery(
    api.storage.getPreviewUrl,
    data.image ? { storageId: data.image } : "skip",
  );

  if (!data.mediaType) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        {tr("formatNonSelectionne")}
      </div>
    );
  }

  const isCarousel = data.mediaType === "carousel";
  const isShort = data.mediaType === "short";
  const isScreenRecorder = data.mediaType === "screenrecorder";

  if (isScreenRecorder) {
    // Refinement SR — l'étape Hook étant skip, on retire l'Angle tonal
    // (concept hook-level). Ajout des 2 champs SR-specific : Appareil
    // d'enregistrement (cards radio Phone/Desktop) + Type de capture
    // (Repackaging vs Autre). Les 2 sont required pour la validation
    // finale (cf NouveauModal.handleCreate).
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="sr-titre">{tr("titre")}</Label>
          <Input
            id="sr-titre"
            value={data.titre}
            onChange={(e) =>
              dispatch({ type: "SET_TITRE", titre: e.target.value })
            }
            placeholder={tr("titreDuScreenrecorder3200")}
            maxLength={200}
          />
          {data.titre.trim().length > 0 &&
            data.titre.trim().length < 3 && (
              <p className="text-xs text-amber-700">
                {tr("leTitreDoitFaireAu")}
              </p>
            )}
        </div>

        <div className="space-y-1.5">
          <Label>{tr("image")}</Label>
          <ImageUploader
            value={data.image}
            imageUrl={previewUrl ?? null}
            onChange={(storageId) =>
              dispatch({ type: "SET_IMAGE", image: storageId as Id<"_storage"> | null })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label>{tr("appareilDEnregistrement")}</Label>
          <div className="grid grid-cols-2 gap-3">
            {RECORDING_DEVICES.map((device) => {
              const Icon = RECORDING_DEVICE_ICONS[device];
              const selected = data.recordingDevice === device;
              return (
                <button
                  key={device}
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: "SET_RECORDING_DEVICE",
                      device: device as RecordingDevice,
                    })
                  }
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors",
                    selected
                      ? "border-slate-900 bg-slate-50 text-slate-900"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                  )}
                  aria-pressed={selected}
                >
                  <Icon className="size-6" />
                  <span className="font-medium">
                    {RECORDING_DEVICE_LABELS[device]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{tr("typeDeCapture")}</Label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() =>
                dispatch({ type: "SET_IS_REPACKAGING", value: true })
              }
              className={cn(
                "rounded-lg border p-4 text-left text-sm transition-colors",
                data.isRepackaging === true
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              )}
              aria-pressed={data.isRepackaging === true}
            >
              <div className="font-medium">{tr("repackagingRepackit")}</div>
              <div className="mt-1 text-xs text-slate-500">
                {tr("captureLieeAUnRepack")}
              </div>
            </button>
            <button
              type="button"
              onClick={() =>
                dispatch({ type: "SET_IS_REPACKAGING", value: false })
              }
              className={cn(
                "rounded-lg border p-4 text-left text-sm transition-colors",
                data.isRepackaging === false
                  ? "border-slate-400 bg-slate-100 text-slate-900"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              )}
              aria-pressed={data.isRepackaging === false}
            >
              <div className="font-medium">{tr("autreCapture")}</div>
              <div className="mt-1 text-xs text-slate-500">
                {tr("captureStandaloneHorsRepack")}
              </div>
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="script">{tr("scriptOptionnel")}</Label>
          <Textarea
            id="script"
            rows={8}
            placeholder={tr("scriptDeLaNarrationOptionnel")}
            value={data.script}
            onChange={(e) =>
              dispatch({ type: "SET_SCRIPT", script: e.target.value })
            }
          />
        </div>
      </div>
    );
  }

  if (isShort) {
    // Refinement Shorts — l'Angle tonal (concept hook-level) est retiré.
    // L'ICP ciblé devient le champ structurant, required à la création.
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>{tr("icpCible")}</Label>
          <IcpCombobox
            value={data.icpId ?? null}
            onChange={(id) => dispatch({ type: "SET_ICP", icpId: id })}
            required
          />
          <p className="text-xs text-slate-500">
            {tr("requisLAudienceViseePar")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="script">{tr("script")}</Label>
          <Textarea
            id="script"
            rows={12}
            placeholder={tr("ecrisTonScriptCompletLe")}
            value={data.script}
            onChange={(e) =>
              dispatch({ type: "SET_SCRIPT", script: e.target.value })
            }
          />
          <p className="text-xs text-slate-500">
            {tr("texteContinuPasDeSlides")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {isCarousel && (
          <div className="space-y-1.5 md:col-span-2">
            <Label>{tr("format")}</Label>
            <Select
              value={data.format}
              onValueChange={(v) =>
                v !== null &&
                dispatch({
                  type: "SET_FORMAT",
                  format: v as FormatLetter,
                })
              }
            >
              <SelectTrigger>
                <SelectValue>
                  {data.format ? tr(`formats.${data.format}`) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {tr(`formats.${f}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {isCarousel && (
          <div className="space-y-1.5">
            <Label htmlFor="nb-slides">{tr("nombreDeSlides")}</Label>
            <Input
              id="nb-slides"
              type="number"
              min={5}
              max={8}
              value={data.nbSlides}
              onChange={(e) =>
                dispatch({
                  type: "SET_NB_SLIDES",
                  nbSlides: Number(e.target.value) || 5,
                })
              }
            />
          </div>
        )}
      </div>

      {isCarousel ? (
        <div className="space-y-3">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {tr("slides")}
          </div>
          {data.slides.map((s, i) => (
            <div key={i} className="space-y-1.5">
              <Label htmlFor={`slide-${i}`}>{tr("slide", { value: i + 1 })}</Label>
              <Textarea
                id={`slide-${i}`}
                rows={2}
                placeholder={tr("texteDeLaSlide", { value: i + 1 })}
                value={s}
                onChange={(e) =>
                  dispatch({
                    type: "SET_SLIDE",
                    index: i,
                    texte: e.target.value,
                  })
                }
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="script">{tr("script")}</Label>
          <Textarea
            id="script"
            rows={12}
            placeholder={tr("ecrisTonScriptCompletLe")}
            value={data.script}
            onChange={(e) =>
              dispatch({ type: "SET_SCRIPT", script: e.target.value })
            }
          />
          <p className="text-xs text-slate-500">
            {tr("texteContinuPasDeSlides2")}
          </p>
        </div>
      )}
    </div>
  );
}
