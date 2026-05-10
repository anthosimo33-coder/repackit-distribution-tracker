"use client";

import type { Dispatch } from "react";
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
import type {
  Angle,
  FormatLetter,
  NouveauAction,
  NouveauData,
} from "../useNouveauState";

const FORMATS = [
  { value: "A", label: "A · X erreurs / mythes / vérités" },
  { value: "B", label: "B · Volume analysé" },
  { value: "C", label: "C · Comparaison A vs B" },
  { value: "D", label: "D · Comprendre pourquoi tu cliques (framework vulgarisé)" },
  { value: "E", label: "E · Pourquoi cette vidéo a cartonné" },
  { value: "F", label: "F · Pop culture / Lien improbable" },
  { value: "G", label: "G · Même créateur, 2 vidéos opposées" },
  { value: "H", label: "H · Coulisses / Build in public" },
] as const;

const ANGLES: Angle[] = [
  "Psycho",
  "Accusatoire",
  "Pédagogique",
  "Observation",
  "Provocant",
];

/**
 * StepContenu — étape 3 du modal. Switch sur mediaType :
 *  - carousel → Format A-H + Angle + nbSlides + N Textareas slides
 *  - short → Angle + 1 Textarea script
 *  - screenrecorder → bloqué tant que Batch D n'a pas livré (l'étape 1
 *    n'aurait pas dû laisser passer la sélection)
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
  if (!data.mediaType || data.mediaType === ("screenrecorder" as never)) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        Format non sélectionné ou indisponible.
      </div>
    );
  }

  const isCarousel = data.mediaType === "carousel";
  const isShort = data.mediaType === "short";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {isCarousel && (
          <div className="space-y-1.5 md:col-span-2">
            <Label>Format</Label>
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
                  {FORMATS.find((f) => f.value === data.format)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className={isShort ? "space-y-1.5 md:col-span-3" : "space-y-1.5"}>
          <Label>Angle tonal</Label>
          <Select
            value={data.angleTonal}
            onValueChange={(v) =>
              v !== null &&
              dispatch({ type: "SET_ANGLE", angle: v as Angle })
            }
          >
            <SelectTrigger>
              <SelectValue>{data.angleTonal}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ANGLES.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isCarousel && (
          <div className="space-y-1.5">
            <Label htmlFor="nb-slides">Nombre de slides</Label>
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
            Slides
          </div>
          {data.slides.map((s, i) => (
            <div key={i} className="space-y-1.5">
              <Label htmlFor={`slide-${i}`}>Slide {i + 1}</Label>
              <Textarea
                id={`slide-${i}`}
                rows={2}
                placeholder={`Texte de la slide ${i + 1}...`}
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
          <Label htmlFor="script">Script</Label>
          <Textarea
            id="script"
            rows={12}
            placeholder="Écris ton script complet — le hook reste pré-rempli en haut..."
            value={data.script}
            onChange={(e) =>
              dispatch({ type: "SET_SCRIPT", script: e.target.value })
            }
          />
          <p className="text-xs text-slate-500">
            Texte continu, pas de slides découpées. Saisis le texte intégral
            du Short.
          </p>
        </div>
      )}
    </div>
  );
}
