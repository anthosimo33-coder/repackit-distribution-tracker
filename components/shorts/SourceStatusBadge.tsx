"use client";

import { useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/format";
import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/components/project/use-permissions";

/**
 * SourceStatusBadge — indicateur informatif du statut multi-plateforme d'un
 * sourceId (étape Hook du modal nouveau Short). Lit getSourceStatus.
 *
 * - source inédite (exists=false) → message neutre "toutes plateformes dispo".
 * - source existante → liste des publications par plateforme + plateformes
 *   encore disponibles. Style amber (avertissement) : un repost cross-plateforme
 *   est légitime mais doit être conscient (anti-shadowban).
 */
export function SourceStatusBadge({ sourceId }: { sourceId: string }) {
  // L'indicateur anti-shadowban lit `publications` sous `legacy.access`, un bloc
  // que le manager n'a pas. Sans cette garde, la query LÈVE et emporte l'écran.
  // On dégrade : l'indication disparaît, la création reste possible — retirer un
  // conseil est acceptable, retirer un geste ne le serait pas.
  const droitsSrc = usePermissions();
  const trimmed = sourceId.trim();
  const status = useProjectQuery(
    api.publications.getSourceStatus,
    droitsSrc.skipUnless("legacy.access", trimmed ? { sourceId } : "skip"),
  );

  if (!trimmed) return null;
  if (status === undefined) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400">
        Vérification de la source…
      </div>
    );
  }

  if (!status.exists) {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
          "border-slate-200 bg-slate-50 text-slate-600",
        )}
      >
        <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
        <span>
          Source inédite. Toutes les plateformes sont disponibles.
        </span>
      </div>
    );
  }

  const postedText = status.publications
    .map(
      (p) =>
        `${p.plateforme} (${p.carouselId} ${p.compte} ${formatDate(p.datePubli)})`,
    )
    .join(" + ");

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        "border-amber-200 bg-amber-50 text-amber-900",
      )}
    >
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
      <div className="space-y-0.5">
        <div>
          <span className="font-medium">Déjà posté sur :</span> {postedText}.
        </div>
        {status.availablePlatforms.length > 0 ? (
          <div>
            <span className="font-medium">Disponible :</span>{" "}
            {status.availablePlatforms.join(", ")}.
          </div>
        ) : (
          <div className="font-medium">
            Couverture complète (TikTok + Instagram + YouTube).
          </div>
        )}
      </div>
    </div>
  );
}
