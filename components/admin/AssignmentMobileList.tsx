"use client";

import { useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import {
  BellIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
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

const formatDay = (ts: number) =>
  new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });

/**
 * Au-delà de ce nombre de livrables, les groupes s'ouvrent FERMÉS. En dessous,
 * tout est déplié — ouvrir trois accordéons pour voir neuf lignes serait une
 * cérémonie sans objet. Sur Snytch (478 livrables), le premier écran passe ainsi
 * de « une carte et demie » à la liste complète des créatrices.
 */
const COLLAPSE_ABOVE = 60;

/** Lignes affichées par groupe avant le bouton « voir les N restantes ». */
const PAGE_SIZE = 25;

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
 * Vue LISTE sur téléphone : des cartes GROUPÉES PAR CRÉATRICE, à la place du
 * tableau.
 *
 * Deux problèmes distincts, deux réponses :
 *
 *  1. Le tableau desktop ne rentre pas sous 768 px. Son `overflow-x-auto` le
 *     sauvait techniquement en laissant à l'écran les deux premières colonnes,
 *     pendant que l'échéance, le statut et TOUTES les actions vivaient hors
 *     champ — atteignables par un défilement horizontal qu'aucune affordance
 *     n'annonce. D'où la carte : ce qui décide (retard, statut, échéance) se lit
 *     sans geste, les gestes rares partent dans un menu.
 *
 *  2. Une carte lisible ne suffit pas à 478 exemplaires. À ~215 px pièce,
 *     c'était 100 000 px de défilement sans repère, et aucun moyen de retrouver
 *     UNE ligne. La carte est donc redescendue à deux lignes (~90 px), les
 *     cartes sont groupées par créatrice sous un en-tête COLLANT qui annonce
 *     l'effectif et les retards, chaque groupe s'ouvre et se ferme, et le
 *     champ de recherche de la barre d'outils (lib/assignment-search) filtre
 *     l'ensemble.
 *
 * L'ordre entrant est déjà contigu par créatrice (la page groupe puis entrelace
 * les formats, cf lib/assignment-order) : le regroupement ci-dessous ne
 * RÉORDONNE rien, il ne fait que poser les frontières là où elles sont déjà.
 */
export function AssignmentMobileList({
  rows,
  now,
  actions,
  /** Vrai quand une recherche est active : les groupes s'ouvrent tous. */
  expanded = false,
}: {
  rows: AssignmentRow[];
  now: number;
  actions: AssignmentRowActions;
  expanded?: boolean;
}) {
  const groups = useMemo(() => {
    const out: { creatorId: string; creatorName: string; rows: AssignmentRow[] }[] =
      [];
    for (const a of rows) {
      const last = out[out.length - 1];
      if (last && last.creatorId === a.creatorId) last.rows.push(a);
      else
        out.push({
          creatorId: a.creatorId,
          creatorName: a.creatorName,
          rows: [a],
        });
    }
    return out;
  }, [rows]);

  // Ouverture PAR EXCEPTION : on mémorise ce que l'utilisateur a basculé, pas
  // l'état de chaque groupe. Le défaut peut donc changer (recherche active,
  // volume) sans écraser un choix explicite.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Map<string, number>>(new Map());

  const openByDefault = expanded || rows.length <= COLLAPSE_ABOVE;

  return (
    <div className="space-y-2" data-testid="assignments-mobile-list">
      {groups.map((g) => {
        const isOpen = toggled.has(g.creatorId) ? !openByDefault : openByDefault;
        const late = g.rows.filter(
          (a) =>
            assignmentUrgency(a.dueDate, a.status as AssignmentStatus, now) ===
            "overdue",
        ).length;
        const limit = shown.get(g.creatorId) ?? PAGE_SIZE;
        const visible = g.rows.slice(0, limit);
        const rest = g.rows.length - visible.length;
        return (
          <section key={g.creatorId}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() =>
                setToggled((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.creatorId)) next.delete(g.creatorId);
                  else next.add(g.creatorId);
                  return next;
                })
              }
              // COLLANT, juste sous la barre d'outils (dont la hauteur est publiée
              // en variable CSS par la page) : sur un groupe de trente cartes, savoir
              // de qui on lit les livrables est ce qu'on perd en premier.
              className="sticky top-[var(--assignments-sticky-top,0px)] z-10 flex min-h-11 w-full items-center gap-2 rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-left backdrop-blur"
            >
              {isOpen ? (
                <ChevronDownIcon className="size-4 shrink-0 text-slate-400" />
              ) : (
                <ChevronRightIcon className="size-4 shrink-0 text-slate-400" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium text-slate-900">
                {g.creatorName}
              </span>
              {late > 0 && (
                <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                  {late} en retard
                </span>
              )}
              <span className="shrink-0 text-xs text-slate-500">
                {g.rows.length}
              </span>
            </button>

            {isOpen && (
              <ul className="mt-1 space-y-1">
                {visible.map((a) => (
                  <li key={a._id}>
                    <AssignmentCard row={a} now={now} actions={actions} />
                  </li>
                ))}
                {rest > 0 && (
                  <li>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 w-full"
                      onClick={() =>
                        setShown((prev) => {
                          const next = new Map(prev);
                          next.set(g.creatorId, limit + PAGE_SIZE);
                          return next;
                        })
                      }
                    >
                      Voir les {rest} restantes
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Une carte = DEUX lignes. Ligne 1, ce qu'on lit : la mission. Ligne 2, ce qui
 * décide : statut, échéance (rouge si dépassée), date de post, compte ciblé.
 * Le combo, le script et les pièces jointes ne sont plus sur la carte — ils
 * sont dans le panneau de détail, à un tap, et les répéter 478 fois coûtait
 * plus de la moitié de la hauteur de la liste.
 */
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
  const mission =
    row.origin === "script" ? row.scriptCampaignName : row.formatName;
  const modelCount = row.modelVideos?.length ?? 0;
  const target = row.targets[0];

  return (
    <div
      className={cn(
        "flex items-start gap-1 rounded-lg border bg-white px-3 py-2",
        // Le retard se voit au BORD, pas seulement dans le texte : en balayant
        // la liste au pouce, c'est la seule marque qui survit à la vitesse.
        overdue
          ? "border-slate-200 border-l-4 border-l-rose-500 bg-rose-50/30"
          : "border-slate-200",
      )}
    >
      <button
        type="button"
        onClick={() => actions.onDetail(row._id)}
        className="min-w-0 flex-1 space-y-1 text-left"
      >
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
            {mission ?? "—"}
          </span>
          {row.comboImposed && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-indigo-500"
              title="Combinaison imposée"
              aria-hidden
            />
          )}
          {modelCount > 0 && (
            <ClapperboardIcon className="size-3 shrink-0 text-slate-400" />
          )}
          {row.linkedFolderIds.length > 0 && (
            <ImagesIcon className="size-3 shrink-0 text-slate-400" />
          )}
          {row.instructions && (
            <ClipboardListIcon className="size-3 shrink-0 text-indigo-500" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0 text-[11px] font-semibold",
              st.className,
            )}
          >
            {tLabel(st.labelKey)}
          </span>
          <span
            className={cn(
              "shrink-0 tabular-nums",
              overdue ? "font-semibold text-rose-700" : "text-slate-500",
            )}
          >
            {formatDay(row.dueDate)}
            {overdue && " en retard"}
          </span>
          {row.postDate != null && (
            <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums text-slate-500">
              <CalendarIcon className="size-3" />
              {formatDay(row.postDate)}
            </span>
          )}
          {target && (
            <span className="inline-flex min-w-0 items-center gap-0.5 text-slate-500">
              {countryFlag(target.country) && (
                <span aria-hidden>{countryFlag(target.country)}</span>
              )}
              <span className="truncate font-mono">
                {target.accountHandle ?? target.platform}
              </span>
              {row.targets.length > 1 && (
                <span className="shrink-0">+{row.targets.length - 1}</span>
              )}
            </span>
          )}
        </div>
      </button>

      {canNudge && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-9 shrink-0 text-rose-600 hover:bg-rose-100"
          onClick={() => actions.onNudge(row._id, row.creatorName)}
          disabled={nudging}
          aria-label="Relancer"
          data-testid={`nudge-${row._id}`}
        >
          {nudging ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <BellIcon className="size-4" />
          )}
        </Button>
      )}

      <AssignmentRowMenu
        row={row}
        actions={actions}
        editable={editable}
        hasScript={hasScript}
      />
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
        {withBriefItems && hasScript && (
          <DropdownMenuItem onClick={() => actions.onScript(row._id)}>
            <FileTextIcon className="size-4" />
            Voir le script
          </DropdownMenuItem>
        )}
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
