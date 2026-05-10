"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FORMAT_CONFIGS, type FormatKey } from "@/lib/format-config";
import { PencilIcon } from "lucide-react";
import Image from "next/image";
import type { Dispatch } from "react";
import type { NouveauAction, NouveauData, Step } from "../useNouveauState";

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
  const allHooks = useQuery(api.hooks.listHooks, {});
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
  const hookMecanique =
    data.hookMode === "biblio"
      ? selectedHook?.mecanique
      : data.customHook.mecanique;
  const hookNiveau =
    data.hookMode === "biblio"
      ? selectedHook?.niveau
      : data.customHook.niveau;
  const hookLangue =
    data.hookMode === "biblio"
      ? selectedHook?.langue
      : data.customHook.langue;

  const config = data.mediaType
    ? FORMAT_CONFIGS[data.mediaType as FormatKey]
    : null;

  const dateLabel = new Date(data.datePubli).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-4">
      <Section
        title="Format"
        onEdit={() => dispatch({ type: "GOTO", step: 1 as Step })}
      >
        {config ? (
          <div className="flex items-center gap-2">
            <config.icon className="size-4 text-slate-700" />
            <span className="font-medium">{config.singular}</span>
          </div>
        ) : (
          <span className="italic text-slate-400">Non sélectionné</span>
        )}
      </Section>

      <Section
        title="Hook"
        onEdit={() => dispatch({ type: "GOTO", step: 2 as Step })}
      >
        {hookText ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-900">{hookText}</p>
            <div className="flex gap-1.5">
              {hookMecanique && (
                <Badge variant="secondary">{hookMecanique}</Badge>
              )}
              {hookNiveau && <Badge variant="outline">{hookNiveau}</Badge>}
              {hookLangue && <Badge variant="outline">{hookLangue}</Badge>}
              <Badge variant="outline" className="text-slate-500">
                {data.hookMode === "biblio" ? "Bibliothèque" : "Custom"}
              </Badge>
            </div>
          </div>
        ) : (
          <span className="italic text-slate-400">Non saisi</span>
        )}
      </Section>

      <Section
        title="Contenu"
        onEdit={() => dispatch({ type: "GOTO", step: 3 as Step })}
      >
        <div className="space-y-2 text-sm">
          <div>
            <span className="text-slate-500">Angle tonal :</span>{" "}
            <span className="font-medium">{data.angleTonal}</span>
          </div>
          {data.mediaType === "carousel" && (
            <>
              <div>
                <span className="text-slate-500">Format :</span>{" "}
                <span className="font-mono font-medium">{data.format}</span>{" "}
                · {data.nbSlides} slides
              </div>
              <div className="space-y-1">
                {data.slides.map((s, i) => (
                  <div key={i} className="text-xs text-slate-600">
                    <span className="text-slate-400">Slide {i + 1} :</span>{" "}
                    {s.trim() ? (
                      s.length > 80 ? s.slice(0, 80) + "…" : s
                    ) : (
                      <span className="italic text-slate-400">(vide)</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {data.mediaType === "short" && (
            <div className="text-xs text-slate-600">
              <span className="text-slate-400">Script :</span>{" "}
              {data.script.trim() ? (
                data.script.length > 200
                  ? data.script.slice(0, 200) + "…"
                  : data.script
              ) : (
                <span className="italic text-slate-400">(vide)</span>
              )}
            </div>
          )}
          {data.mediaType === "screenrecorder" && (
            <div className="space-y-2 text-xs text-slate-600">
              <div>
                <span className="text-slate-400">Titre :</span>{" "}
                {data.titre.trim() ? (
                  <span className="font-medium text-slate-900">
                    {data.titre}
                  </span>
                ) : (
                  <span className="italic text-slate-400">(vide)</span>
                )}
              </div>
              <div>
                <span className="text-slate-400">Image :</span>{" "}
                {data.image && imagePreview ? (
                  <Image
                    src={imagePreview}
                    alt="Preview"
                    width={160}
                    height={90}
                    unoptimized
                    className="mt-1 aspect-video rounded border border-slate-200 object-cover"
                  />
                ) : (
                  <span className="italic text-slate-400">(absente)</span>
                )}
              </div>
              <div>
                <span className="text-slate-400">Script :</span>{" "}
                {data.script.trim() ? (
                  data.script.length > 200
                    ? data.script.slice(0, 200) + "…"
                    : data.script
                ) : (
                  <span className="italic text-slate-400">(optionnel)</span>
                )}
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Publication"
        onEdit={() => dispatch({ type: "GOTO", step: 4 as Step })}
      >
        <div className="space-y-1.5 text-sm">
          <div>
            <span className="text-slate-500">Plateformes :</span>{" "}
            {data.plateformes.length > 0 ? (
              <span className="font-medium">{data.plateformes.join(", ")}</span>
            ) : (
              <span className="italic text-slate-400">Aucune</span>
            )}
          </div>
          <div>
            <span className="text-slate-500">Compte :</span>{" "}
            {data.compte ? (
              <span className="font-mono font-medium">{data.compte}</span>
            ) : (
              <span className="italic text-slate-400">Non sélectionné</span>
            )}
          </div>
          <div>
            <span className="text-slate-500">Date :</span>{" "}
            <span className="font-medium">{dateLabel}</span>
          </div>
          {data.notes.trim() && (
            <div>
              <span className="text-slate-500">Notes :</span>{" "}
              <span className="text-slate-700">{data.notes}</span>
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
          Modifier
        </Button>
      </div>
      {children}
    </div>
  );
}
