"use client";

import type { FunctionReturnType } from "convex/server";
import {
  BellIcon,
  CalendarIcon,
  ClapperboardIcon,
  ClipboardListIcon,
  FileTextIcon,
  ImagesIcon,
  Loader2Icon,
  LockIcon,
  MoreHorizontalIcon,
  PanelRightOpenIcon,
  PencilIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AssignmentAttachments } from "@/components/admin/AssignmentAttachments";
import { ImposedComboBadge } from "@/components/admin/ImposedComboBadge";
import { countryFlag } from "@/lib/countries";
import { canDeleteAssignment } from "@/lib/assignment-delete";
import { canEditScriptCombo } from "@/lib/script-combo-edit";
import { useLabel } from "@/lib/use-label";
import {
  ASSIGNMENT_STATUS,
  assignmentUrgency,
  type AssignmentStatus,
} from "@/lib/assignment-status";
import { cn } from "@/lib/utils";

type AssignmentRow =
  FunctionReturnType<typeof api.assignments.listAssignments>[number];

const formatDate = (ts: number) => new Date(ts).toLocaleDateString("fr-FR");

/** Les gestes de la vue liste, injectés par la page (qui tient les modales). */
export type AssignmentRowActions = {
  onDetail: (id: Id<"assignments">) => void;
  onScript: (id: Id<"assignments">) => void;
  onEditCombo: (id: Id<"assignments">) => void;
  onEditText: (id: Id<"assignments">) => void;
  onModelVideos: (id: Id<"assignments">) => void;
  onAssets: (id: Id<"assignments">) => void;
  onOverlay: (id: Id<"assignments">) => void;
  onInstructions: (id: Id<"assignments">) => void;
  onPostDate: (id: Id<"assignments">) => void;
  onNudge: (id: Id<"assignments">, creatorName: string) => void;
  onDelete: (id: Id<"assignments">) => void;
  nudgingId: Id<"assignments"> | null;
};

/**
 * Vue LISTE sur téléphone : une carte par assignation, à la place du tableau.
 *
 * Le tableau desktop porte onze colonnes. Sous 768 px il ne rentre pas, et le
 * `overflow-x-auto` qui le sauvait techniquement laissait à l'écran les deux
 * premières colonnes — créateur et format — pendant que l'échéance, le statut et
 * TOUTES les actions vivaient hors champ, atteignables seulement par un
 * défilement horizontal qu'aucune affordance n'annonce.
 *
 * La carte inverse la logique : ce qui décide (retard, statut, échéance) est
 * lisible sans geste ; les gestes rares partent dans un menu unique plutôt que
 * de s'étaler en six boutons-icônes de 32 px. Le corps de la carte ouvre le
 * MÊME panneau de détail que le calendrier — une seule surface de détail pour
 * les deux vues.
 */
export function AssignmentMobileList({
  rows,
  now,
  actions,
}: {
  rows: AssignmentRow[];
  now: number;
  actions: AssignmentRowActions;
}) {
  return (
    <ul className="space-y-2" data-testid="assignments-mobile-list">
      {rows.map((a) => (
        <li key={a._id}>
          <AssignmentCard row={a} now={now} actions={actions} />
        </li>
      ))}
    </ul>
  );
}

function AssignmentCard({
  row,
  now,
  actions,
}: {
  row: AssignmentRow;
  now: number;
  actions: AssignmentRowActions;
}) {
  const tLabel = useLabel();
  const status = row.status as AssignmentStatus;
  const st = ASSIGNMENT_STATUS[status];
  const overdue = assignmentUrgency(row.dueDate, status, now) === "overdue";
  const editable = canEditScriptCombo({ postedAt: row.postedAt });
  const hasScript = row.scriptCombo?.assembledScript != null;
  // Relance : uniquement quand la balle est au créateur (même règle que le garde
  // serveur nudgeAssignment — `to_publish`, géré par l'équipe, en est exclu).
  const canNudge =
    overdue &&
    (status === "todo" ||
      status === "in_progress" ||
      status === "video_rejected");
  const nudging = actions.nudgingId === row._id;
  const mission = row.origin === "script" ? row.scriptCampaignName : row.formatName;

  return (
    <div
      className={cn(
        "rounded-lg border bg-white p-3",
        overdue ? "border-rose-200 bg-rose-50/40" : "border-slate-200",
      )}
    >
      <div className="flex items-start gap-2">
        {/* Le corps de la carte = ouvrir le détail. Bouton explicite plutôt que
            `onClick` posé sur la carte entière : la carte contient d'autres
            boutons, et un clic qui traverse deux cibles n'est jamais le bon. */}
        <button
          type="button"
          onClick={() => actions.onDetail(row._id)}
          className="min-w-0 flex-1 space-y-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-slate-900">{row.creatorName}</span>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                st.className,
              )}
            >
              {tLabel(st.labelKey)}
            </span>
          </div>
          {mission && (
            <div className="truncate text-sm text-slate-700">{mission}</div>
          )}
          {row.comboImposed && <ImposedComboBadge />}
          {row.comboSummary && (
            <div className="truncate text-xs text-slate-500">
              {row.comboSummary}
            </div>
          )}
        </button>

        <AssignmentRowMenu
          row={row}
          actions={actions}
          editable={editable}
          hasScript={hasScript}
        />
      </div>

      {/* Comptes ciblés — le drapeau distingue FR/US d'un coup d'œil, comme au
          calendrier. */}
      {row.targets.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {row.targets.map((t) => (
            <span
              key={t.platform}
              className="inline-flex min-w-0 items-center gap-1"
            >
              {countryFlag(t.country) && (
                <span aria-hidden>{countryFlag(t.country)}</span>
              )}
              <span className="truncate font-mono text-slate-600">
                {t.accountHandle ?? "—"}
              </span>
              <span className="shrink-0 text-slate-400">{t.platform}</span>
            </span>
          ))}
        </div>
      )}

      {/* Les deux DATES côte à côte : l'échéance de production (subie) et la date
          de publication (pilotable, donc cliquable ici même). */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className={cn("inline-flex items-center gap-1", overdue ? "text-rose-700" : "text-slate-500")}>
          <span className="text-slate-400">Échéance</span>
          <span className={cn("font-medium", overdue && "font-semibold")}>
            {formatDate(row.dueDate)}
          </span>
          {overdue && <span className="font-semibold">(retard)</span>}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "-ml-1 h-8 gap-1.5 px-2 text-xs",
            row.postDate ? "text-slate-700" : "text-slate-500",
          )}
          onClick={() => actions.onPostDate(row._id)}
          aria-label="Modifier la date de publication"
        >
          <CalendarIcon className="size-3.5" />
          {/* Le mot compte : deux dates côte à côte sans étiquette, on ne sait
              plus laquelle est l'échéance de PRODUCTION et laquelle la date de
              PUBLICATION. « Post » reprend le nom de la colonne desktop. */}
          <span className="text-slate-400">Post</span>
          {row.postDate ? formatDate(row.postDate) : "Planifier"}
        </Button>
      </div>

      <AssignmentAttachments
        variant="list"
        assetFolderNames={row.assetFolderNames}
        assetFolderCount={row.assetFolderCount}
        modelVideos={row.modelVideos ?? []}
      />

      {(hasScript || canNudge) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
          {hasScript && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs text-primary"
              onClick={() => actions.onScript(row._id)}
            >
              <FileTextIcon className="size-3.5" />
              Voir le script
            </Button>
          )}
          {canNudge && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs text-rose-700 hover:bg-rose-100 hover:text-rose-800"
              onClick={() => actions.onNudge(row._id, row.creatorName)}
              disabled={nudging}
              data-testid={`nudge-${row._id}`}
            >
              {nudging ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <BellIcon className="size-3.5" />
              )}
              Relancer
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Menu des gestes ADMIN d'une ligne, PARTAGÉ par la carte mobile et la ligne du
 * tableau desktop.
 *
 * Sur téléphone (`variant="full"`) il porte TOUT, libellés compris : une icône
 * de 32 px sans texte se devine, elle ne se lit pas. Sur desktop
 * (`variant="row"`) les quatre gestes de brief (modèles, assets, overlay,
 * instructions) restent des boutons visibles dans la colonne « Brief » — les
 * répéter ici ne ferait qu'allonger le menu de doublons.
 */
export function AssignmentRowMenu({
  row,
  actions,
  editable,
  hasScript,
  variant = "full",
}: {
  row: AssignmentRow;
  actions: AssignmentRowActions;
  editable: boolean;
  hasScript: boolean;
  variant?: "full" | "row";
}) {
  const deletable = canDeleteAssignment(row.status as AssignmentStatus);
  const modelCount = row.modelVideos?.length ?? 0;
  const withBriefItems = variant === "full";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-slate-500"
            aria-label="Actions"
          >
            <MoreHorizontalIcon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={() => actions.onDetail(row._id)}>
          <PanelRightOpenIcon className="size-4" />
          Ouvrir le détail
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.onPostDate(row._id)}>
          <CalendarIcon className="size-4" />
          Date de publication
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {hasScript &&
          (editable ? (
            <>
              <DropdownMenuItem onClick={() => actions.onEditCombo(row._id)}>
                <PencilIcon className="size-4" />
                Modifier le combo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.onEditText(row._id)}>
                <TypeIcon className="size-4" />
                Éditer le texte
              </DropdownMenuItem>
            </>
          ) : (
            // Publié → verrouillé. On l'explicite au lieu de faire disparaître
            // les entrées : une absence muette se lit comme un bug.
            <DropdownMenuItem disabled>
              <LockIcon className="size-4" />
              Script publié — verrouillé
            </DropdownMenuItem>
          ))}
        {withBriefItems && (
          <>
            <DropdownMenuItem onClick={() => actions.onModelVideos(row._id)}>
              <ClapperboardIcon className="size-4" />
              Vidéos modèles{modelCount > 0 ? ` (${modelCount})` : ""}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onAssets(row._id)}>
              <ImagesIcon className="size-4" />
              Dossiers d&apos;assets
              {row.linkedFolderIds.length > 0 ? ` (${row.assetFolderCount})` : ""}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onOverlay(row._id)}>
              <TypeIcon className="size-4" />
              Texte overlay{row.overlayText ? " ·" : ""}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onInstructions(row._id)}>
              <ClipboardListIcon className="size-4" />
              Instructions{row.instructions ? " ·" : ""}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={!deletable}
          onClick={() => deletable && actions.onDelete(row._id)}
        >
          <Trash2Icon className="size-4" />
          {deletable ? "Supprimer" : "Suppression indisponible"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
