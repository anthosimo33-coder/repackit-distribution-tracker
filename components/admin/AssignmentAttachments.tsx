"use client";

import { ClapperboardIcon, ExternalLinkIcon, ImagesIcon } from "lucide-react";
import { detectInspirationType } from "@/lib/inspiration-url";
import { ModelVideoEmbed } from "@/components/portal/ModelVideoEmbed";

/** Vidéo « à reproduire » attachée à l'assignation (assignments.modelVideos). */
type ModelVideoItem = {
  id: string;
  url: string;
  title?: string;
  note?: string;
};

/**
 * Blocs « Vidéos modèles » + « Assets » rattachés à une assignation — MÊME donnée
 * que le brief créateur (assignments.modelVideos / dossiers d'assets liés). Rendu
 * UNIQUEMENT s'il y a quelque chose (aucun bloc vide). Partagé par le panneau de
 * détail (variant "panel" : lecteurs intégrés ModelVideoEmbed + pastilles dossiers)
 * et la vue liste (variant "list" : version compacte, liens + noms de dossiers).
 *
 * Purement présentationnel (aucune mutation) : on RÉUTILISE l'existant, on ne
 * réinvente pas l'attachement (qui se fait via les modales dédiées de la liste).
 */
export function AssignmentAttachments({
  assetFolderNames,
  assetFolderCount,
  modelVideos,
  variant = "panel",
}: {
  assetFolderNames: string[];
  assetFolderCount: number;
  modelVideos: ModelVideoItem[];
  variant?: "panel" | "list";
}) {
  const hasVideos = modelVideos.length > 0;
  const hasAssets = assetFolderNames.length > 0;
  if (!hasVideos && !hasAssets) return null;

  if (variant === "list") {
    // Compact : la liste est une table dense → pas d'embed, juste les liens des
    // vidéos modèles + les noms de dossiers d'assets (info que les colonnes
    // « Modèles »/« Assets » — de simples compteurs — ne montrent pas).
    return (
      <div className="space-y-1 text-xs text-slate-500">
        {hasVideos && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <ClapperboardIcon className="size-3.5 shrink-0 text-slate-400" />
            {modelVideos.map((mv) => {
              const platform = detectInspirationType(mv.url)?.plateforme ?? "Lien";
              return (
                <a
                  key={mv.id}
                  href={mv.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={mv.title ?? mv.url}
                  className="inline-flex max-w-[12rem] items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 hover:text-primary"
                >
                  <span className="truncate">{mv.title ?? platform}</span>
                  <ExternalLinkIcon className="size-3 shrink-0" />
                </a>
              );
            })}
          </div>
        )}
        {hasAssets && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <ImagesIcon className="size-3.5 shrink-0 text-slate-400" />
            <span className="truncate">
              {assetFolderNames.join(" · ")}
              {assetFolderCount > 0 && (
                <span className="text-slate-400">
                  {" "}
                  ({assetFolderCount} fichier{assetFolderCount > 1 ? "s" : ""})
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    );
  }

  // Panneau : rendu riche, aligné sur le brief créateur.
  return (
    <div className="space-y-5">
      {hasVideos && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <ClapperboardIcon className="size-4 text-slate-400" />
            Vidéos modèles
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {modelVideos.map((mv) => (
              <ModelVideoEmbed
                key={mv.id}
                video={{ url: mv.url, title: mv.title, note: mv.note }}
              />
            ))}
          </div>
        </section>
      )}

      {hasAssets && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <ImagesIcon className="size-4 text-slate-400" />
            Assets
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {assetFolderNames.map((name) => (
              <span
                key={name}
                className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600"
              >
                {name}
              </span>
            ))}
            {assetFolderCount > 0 && (
              <span className="text-xs text-slate-400">
                {assetFolderCount} fichier{assetFolderCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
