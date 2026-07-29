"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  BellIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ClapperboardIcon,
  FileTextIcon,
  ImagesIcon,
  ListIcon,
  Loader2Icon,
  PencilIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import type { Id } from "@/convex/_generated/dataModel";
import { AssignmentModelVideosDialog } from "@/components/admin/AssignmentModelVideosDialog";
import { AssignmentScriptDialog } from "@/components/admin/AssignmentScriptDialog";
import { EditScriptComboDialog } from "@/components/admin/EditScriptComboDialog";
import { EditBrickTextDialog } from "@/components/admin/EditBrickTextDialog";
import { LinkAssetFolderDialog } from "@/components/admin/LinkAssetFolderDialog";
import { AssignmentOverlayDialog } from "@/components/admin/AssignmentOverlayDialog";
import { AssignmentPostDateDialog } from "@/components/admin/AssignmentPostDateDialog";
import {
  AssignmentsCalendar,
  type CalendarStatusFilter,
} from "@/components/admin/AssignmentsCalendar";
import { AssignmentAttachments } from "@/components/admin/AssignmentAttachments";
import { AssignmentDetailSheet } from "@/components/admin/AssignmentDetailSheet";
import { ImposedComboBadge } from "@/components/admin/ImposedComboBadge";
import { FilterMultiSelect } from "@/components/filters/FilterMultiSelect";
import { canEditScriptCombo } from "@/lib/script-combo-edit";
import { canDeleteAssignment } from "@/lib/assignment-delete";
import {
  assignmentGroupKey,
  interleaveByGroup,
} from "@/lib/assignment-order";
import {
  ASSIGNMENT_STATUS,
  assignmentUrgency,
  urgencyRank,
  type AssignmentStatus,
} from "@/lib/assignment-status";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "Tous statuts" },
  { value: "todo", label: "À faire" },
  { value: "in_progress", label: "En cours" },
  { value: "submitted", label: "Soumis" },
  { value: "validated", label: "Validé" },
  { value: "rejected", label: "Rejeté" },
  { value: "paid", label: "Payé" },
];

/** Options du filtre de STATUT CALENDRIER (vue calendrier). Même axe que la
 *  pastille : à l'heure / en retard / manqué / prévu (≠ statut de PRODUCTION). */
const CAL_STATUS_OPTIONS: { value: CalendarStatusFilter; label: string }[] = [
  { value: "all", label: "Tous statuts" },
  { value: "on_time", label: "À l'heure" },
  { value: "late", label: "En retard" },
  { value: "missed", label: "Manqué" },
  { value: "scheduled", label: "Prévu" },
];

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("fr-FR");
}

/** Clé de mémorisation du dernier mode d'affichage (défaut = calendrier). */
const VIEW_MODE_KEY = "repackit.assignments.viewMode";

export default function AssignmentsPage() {
  const assignments = useProjectQuery(api.assignments.listAssignments, {});
  // Ancre temporelle stable au montage (rang d'urgence de l'ordre + filtre
  // « en retard »). Impure au render sinon (cf react-hooks/purity, comme le
  // dashboard créateur) → l'ordre ne se réordonne pas à chaque re-render.
  const [nowMs] = useState(() => Date.now());
  // Filtre créateur MULTI (Set vide = tous) — partagé par la liste ET le
  // calendrier. Étendu depuis un mono-select : le calendrier a besoin du multi.
  const [creatorIds, setCreatorIds] = useState<Set<string>>(new Set());
  // Vue Liste (table) / Calendrier (pilotage) — mêmes filtres partagés. Le
  // CALENDRIER est la vue par DÉFAUT ; le dernier choix est mémorisé.
  const [viewMode, setViewMode] = useState<"list" | "calendar">("calendar");
  // Restaure le dernier choix APRÈS montage (aucun écart d'hydratation SSR ; le
  // défaut reste calendrier si rien de mémorisé ou localStorage indisponible).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY);
      // Hydratation post-mount depuis localStorage (même pattern best-effort que
      // SidebarLayout) → pas de mismatch SSR ; setState post-mount assumé.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "list" || saved === "calendar") setViewMode(saved);
    } catch {
      // localStorage indisponible (mode privé strict) → on garde le défaut.
    }
  }, []);
  function changeViewMode(next: "list" | "calendar") {
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      // idem : on tolère l'absence de persistance.
    }
  }
  const [formatFilter, setFormatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // Filtre de STATUT CALENDRIER (vue calendrier uniquement) — MÊME emplacement
  // que le filtre de statut de production, mais axe distinct (dérivé). On ne crée
  // pas un second contrôle : le Select s'adapte à la vue.
  const [calStatusFilter, setCalStatusFilter] =
    useState<CalendarStatusFilter>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  // Vidéos modèles : gestion à chaud d'un assignment (dialog). On dérive la row
  // LIVE depuis `assignments` (réactif) → la liste se rafraîchit après ajout/retrait.
  const [manageId, setManageId] = useState<Id<"assignments"> | null>(null);
  const manageRow = manageId
    ? ((assignments ?? []).find((a) => a._id === manageId) ?? null)
    : null;
  // Voir le script monté (lecture seule) — assembledScript FIGÉ, non re-dérivé.
  const [scriptId, setScriptId] = useState<Id<"assignments"> | null>(null);
  const scriptRow = scriptId
    ? ((assignments ?? []).find((a) => a._id === scriptId) ?? null)
    : null;
  // Modifier le combo (1 brique, 1 fois, avant publication) — row dérivée live.
  const [editId, setEditId] = useState<Id<"assignments"> | null>(null);
  const editRow = editId
    ? ((assignments ?? []).find((a) => a._id === editId) ?? null)
    : null;
  // Éditer le texte d'une brique (fork) — MÊME verrou que "Modifier le combo".
  const [textEditId, setTextEditId] = useState<Id<"assignments"> | null>(null);
  const textEditRow = textEditId
    ? ((assignments ?? []).find((a) => a._id === textEditId) ?? null)
    : null;
  // Lier un dossier d'assets (images à télécharger) — row dérivée live.
  const [assetLinkId, setAssetLinkId] = useState<Id<"assignments"> | null>(null);
  const assetLinkRow = assetLinkId
    ? ((assignments ?? []).find((a) => a._id === assetLinkId) ?? null)
    : null;
  // Texte overlay à incruster (consigne admin) — row dérivée live.
  const [overlayId, setOverlayId] = useState<Id<"assignments"> | null>(null);
  const overlayRow = overlayId
    ? ((assignments ?? []).find((a) => a._id === overlayId) ?? null)
    : null;
  // Date de publication planifiée — édition après coup (row dérivée live).
  // Hoistée au niveau page → réutilisable depuis la future vue calendrier (C).
  const [postDateId, setPostDateId] = useState<Id<"assignments"> | null>(null);
  const postDateRow = postDateId
    ? ((assignments ?? []).find((a) => a._id === postDateId) ?? null)
    : null;
  // Détail d'une assignation — panneau ouvert au clic sur un post du CALENDRIER
  // (script + publication + date éditable). Row dérivée LIVE → statut/pub à jour.
  const [detailId, setDetailId] = useState<Id<"assignments"> | null>(null);
  const detailRow = detailId
    ? ((assignments ?? []).find((a) => a._id === detailId) ?? null)
    : null;
  // Suppression (hard-delete) — confirmation obligatoire, libère le combo.
  const deleteAssignment = useProjectMutation(api.assignments.deleteAssignment);
  // Relance créateur (email du chantier B). La colonne « en retard » était
  // purement passive : on voyait le problème sans pouvoir le traiter.
  const nudge = useProjectMutation(api.assignments.nudgeAssignment);
  const [nudgingId, setNudgingId] = useState<Id<"assignments"> | null>(null);

  async function handleNudge(id: Id<"assignments">, creatorName: string) {
    setNudgingId(id);
    try {
      const res = await nudge({ assignmentId: id });
      if (res.sent) {
        toast.success(`${creatorName} relancé par email.`);
      } else {
        toast.info(`${creatorName} a déjà été relancé il y a moins de 24 h.`);
      }
    } catch (e) {
      toast.error(convexErrorMessage(e, "Relance impossible"));
    } finally {
      setNudgingId(null);
    }
  }
  const [deleteId, setDeleteId] = useState<Id<"assignments"> | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteAssignment({ id: deleteId });
      toast.success("Assignment supprimé — le combo est de nouveau disponible.");
      setDeleteId(null);
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setDeleting(false);
    }
  }

  const creators = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assignments ?? []) m.set(a.creatorId, a.creatorName);
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1], "fr"));
  }, [assignments]);
  const formats = useMemo(() => {
    const m = new Map<string, string>();
    // S2 — seuls les assignments FORMAT alimentent le filtre format (les
    // assignments script n'ont pas de formatId).
    for (const a of assignments ?? []) {
      if (a.formatId && a.formatName) m.set(a.formatId, a.formatName);
    }
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1], "fr"));
  }, [assignments]);

  const rows = useMemo(() => {
    const now = nowMs;
    const filtered = (assignments ?? []).filter((a) => {
      if (creatorIds.size > 0 && !creatorIds.has(a.creatorId)) return false;
      if (formatFilter !== "all" && a.formatId !== formatFilter) return false;
      // Statut de PRODUCTION : filtre la LISTE. En vue calendrier, c'est le statut
      // CALENDRIER (calStatusFilter, appliqué dans AssignmentsCalendar) qui filtre.
      if (
        viewMode === "list" &&
        statusFilter !== "all" &&
        a.status !== statusFilter
      )
        return false;
      if (
        overdueOnly &&
        assignmentUrgency(a.dueDate, a.status as AssignmentStatus, now) !==
          "overdue"
      )
        return false;
      return true;
    });
    // Les FORMATS d'une créatrice ALTERNENT quelle que soit leur ÉCHÉANCE (fini
    // les blocs « 7 carrousels d'échéance 31/07 collés à la fin »). On groupe par
    // créatrice — dans l'ordre où elles apparaissent (listAssignments = createdAt
    // décroissant → activité la plus récente en tête) — puis on entrelace SES
    // missions PAR RANG D'URGENCE (en retard → < 48 h → dans les temps → non
    // actionnable ; formats alternés dans chaque rang). MÊME moteur que l'espace
    // créatrice (lib/assignment-order), seed = creatorId → ordre stable.
    const byCreator = new Map<string, typeof filtered>();
    for (const a of filtered) {
      const g = byCreator.get(a.creatorId);
      if (g) g.push(a);
      else byCreator.set(a.creatorId, [a]);
    }
    return [...byCreator.entries()].flatMap(([creatorId, group]) =>
      interleaveByGroup(group, {
        keyOf: (a) => assignmentGroupKey(a),
        tierOf: (a) =>
          urgencyRank(assignmentUrgency(a.dueDate, a.status as AssignmentStatus, now)),
        dueDateOf: (a) => a.dueDate,
        seed: creatorId,
      }),
    );
  }, [
    assignments,
    creatorIds,
    formatFilter,
    statusFilter,
    overdueOnly,
    nowMs,
    viewMode,
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Assignments
        </h1>
        <p className="text-sm text-slate-500">
          {assignments === undefined
            ? "Chargement…"
            : `${rows.length} / ${assignments.length} livrable${assignments.length > 1 ? "s" : ""}`}
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        {/* Créateur MULTI (Set vide = tous) — partagé liste + calendrier. */}
        <FilterMultiSelect
          label="Créateur"
          selectedValues={creatorIds}
          onChange={setCreatorIds}
          options={creators.map(([id, name]) => ({ value: id, label: name }))}
          allLabel="Tous créateurs"
          width="w-44"
        />

        <Select value={formatFilter} onValueChange={(v) => v && setFormatFilter(v)}>
          <SelectTrigger className="w-44" aria-label="Filtrer par format">
            <SelectValue>
              {formatFilter === "all"
                ? "Tous formats"
                : (formats.find((f) => f[0] === formatFilter)?.[1] ?? "Format")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous formats</SelectItem>
            {formats.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Filtre STATUT — MÊME emplacement, axe selon la vue : production en
            liste, calendrier (à l'heure/en retard/manqué/prévu) en calendrier. */}
        {viewMode === "calendar" ? (
          <Select
            value={calStatusFilter}
            onValueChange={(v) => v && setCalStatusFilter(v as CalendarStatusFilter)}
          >
            <SelectTrigger
              className="w-40"
              aria-label="Filtrer par statut calendrier"
            >
              <SelectValue>
                {CAL_STATUS_OPTIONS.find((o) => o.value === calStatusFilter)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CAL_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
            <SelectTrigger className="w-40" aria-label="Filtrer par statut">
              <SelectValue>
                {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <Checkbox
            checked={overdueOnly}
            onCheckedChange={(c) => setOverdueOnly(c === true)}
          />
          En retard seulement
        </label>

        {/* Bascule Liste / Calendrier (mêmes filtres partagés). */}
        <div
          role="radiogroup"
          aria-label="Mode d'affichage"
          className="ml-auto inline-flex rounded-md border border-slate-200 bg-white p-0.5"
        >
          {(
            [
              { value: "list", label: "Liste", Icon: ListIcon },
              { value: "calendar", label: "Calendrier", Icon: CalendarDaysIcon },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={viewMode === opt.value}
              onClick={() => changeViewMode(opt.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors",
                viewMode === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              <opt.Icon className="size-3.5" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {assignments === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : viewMode === "calendar" ? (
        <AssignmentsCalendar
          rows={rows}
          now={nowMs}
          onOpen={(id) => setDetailId(id)}
          statusFilter={calStatusFilter}
        />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            Aucun assignment{assignments.length > 0 ? " pour ce filtre" : ""}.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Créateur</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Compte</TableHead>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Post</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Soumis</TableHead>
                  <TableHead>Modèles</TableHead>
                  <TableHead>Assets</TableHead>
                  <TableHead>Overlay</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => {
                  const overdue =
                    assignmentUrgency(a.dueDate, a.status as AssignmentStatus) ===
                    "overdue";
                  const st = ASSIGNMENT_STATUS[a.status as AssignmentStatus];
                  return (
                    <TableRow
                      key={a._id}
                      className={cn(overdue && "bg-rose-50/60")}
                    >
                      <TableCell className="font-medium text-slate-900">
                        {a.creatorName}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        <div className="space-y-1.5">
                          {a.origin === "script" ? (
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">
                              {a.scriptCampaignName}
                            </div>
                            {a.comboImposed && (
                              <ImposedComboBadge />
                            )}
                            <div className="text-xs text-slate-500">
                              {a.comboSummary}
                            </div>
                            {a.scriptCombo?.assembledScript && (
                              <div className="flex flex-wrap gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 gap-1.5 px-2 text-xs text-primary"
                                  onClick={() => setScriptId(a._id)}
                                >
                                  <FileTextIcon className="size-3.5" />
                                  Voir le script
                                </Button>
                                {a.scriptCombo &&
                                  canEditScriptCombo({
                                    status: a.status,
                                    editedOnce:
                                      a.scriptCombo.editedOnce ?? false,
                                  }) && (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 gap-1.5 px-2 text-xs text-slate-600"
                                        onClick={() => setEditId(a._id)}
                                      >
                                        <PencilIcon className="size-3.5" />
                                        Modifier le combo
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 gap-1.5 px-2 text-xs text-slate-600"
                                        onClick={() => setTextEditId(a._id)}
                                      >
                                        <TypeIcon className="size-3.5" />
                                        Éditer le texte
                                      </Button>
                                    </>
                                  )}
                              </div>
                            )}
                          </div>
                          ) : (
                            <div>{a.formatName}</div>
                          )}
                          {/* Assets + vidéos modèles rattachés — compact, visible
                              seulement s'il y en a (mêmes données que le brief). */}
                          <AssignmentAttachments
                            variant="list"
                            assetFolderNames={a.assetFolderNames}
                            assetFolderCount={a.assetFolderCount}
                            modelVideos={a.modelVideos ?? []}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {a.targets.length === 0 ? (
                          "—"
                        ) : (
                          <div className="space-y-0.5">
                            {a.targets.map((t) => (
                              <div
                                key={t.platform}
                                className="flex items-center gap-1.5"
                              >
                                <span className="text-xs text-slate-400">
                                  {t.platform}
                                </span>
                                <span className="font-mono text-slate-600">
                                  {t.accountHandle ?? "—"}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className={cn(overdue && "font-semibold text-rose-700")}>
                          {formatDate(a.dueDate)}
                        </span>
                        {overdue && (
                          <span className="ml-1 text-xs font-semibold text-rose-600">
                            (retard)
                          </span>
                        )}
                        {/* Relance inline. Uniquement sur les statuts où la
                            balle est au créateur (cf nudgeAssignment côté
                            serveur) : to_publish géré par l'équipe est exclu. */}
                        {overdue &&
                          (a.status === "todo" ||
                            a.status === "in_progress" ||
                            a.status === "video_rejected") && (
                            <Button
                              variant="ghost"
                              size="xs"
                              className="ml-2 h-6 gap-1 px-1.5 text-rose-700 hover:bg-rose-100 hover:text-rose-800"
                              onClick={() => handleNudge(a._id, a.creatorName)}
                              disabled={nudgingId === a._id}
                              data-testid={`nudge-${a._id}`}
                            >
                              {nudgingId === a._id ? (
                                <Loader2Icon className="size-3 animate-spin" />
                              ) : (
                                <BellIcon className="size-3" />
                              )}
                              Relancer
                            </Button>
                          )}
                      </TableCell>
                      <TableCell className="text-sm">
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-8 gap-1.5 px-2",
                            a.postDate ? "text-slate-700" : "text-slate-500",
                          )}
                          onClick={() => setPostDateId(a._id)}
                          aria-label="Modifier la date de publication"
                        >
                          <CalendarIcon className="size-4" />
                          {a.postDate ? formatDate(a.postDate) : "—"}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            st.className,
                          )}
                        >
                          {st.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {a.submittedAt ? formatDate(a.submittedAt) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 px-2 text-slate-600"
                          onClick={() => setManageId(a._id)}
                          aria-label="Gérer les vidéos modèles"
                        >
                          <ClapperboardIcon className="size-4" />
                          {a.modelVideos && a.modelVideos.length > 0
                            ? a.modelVideos.length
                            : "+"}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 px-2 text-slate-600"
                          onClick={() => setAssetLinkId(a._id)}
                          aria-label="Lier des dossiers d'assets"
                        >
                          <ImagesIcon className="size-4" />
                          {a.linkedFolderIds.length > 0
                            ? a.assetFolderCount
                            : "+"}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-8 gap-1.5 px-2",
                            a.overlayText
                              ? "text-amber-700"
                              : "text-slate-600",
                          )}
                          onClick={() => setOverlayId(a._id)}
                          aria-label="Texte à incruster en haut de la vidéo"
                          title={a.overlayText ?? "Ajouter un texte overlay"}
                        >
                          <TypeIcon className="size-4" />
                          {a.overlayText ? "•" : "+"}
                        </Button>
                      </TableCell>
                      <TableCell className="text-right">
                        {canDeleteAssignment(a.status as AssignmentStatus) ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-8 p-0 text-slate-400 hover:text-rose-600"
                            onClick={() => setDeleteId(a._id)}
                            aria-label="Supprimer cet assignment"
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-8 p-0 text-slate-300"
                            disabled
                            aria-label="Suppression indisponible (assignment publié ou payé)"
                            title="Un assignment publié ou payé ne peut pas être supprimé."
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {manageRow && (
        <AssignmentModelVideosDialog
          open
          onOpenChange={(o) => !o && setManageId(null)}
          assignmentId={manageRow._id}
          creatorName={manageRow.creatorName}
          modelVideos={manageRow.modelVideos ?? []}
        />
      )}

      {scriptRow?.scriptCombo?.assembledScript && (
        <AssignmentScriptDialog
          open
          onOpenChange={(o) => !o && setScriptId(null)}
          script={scriptRow.scriptCombo.assembledScript}
          comboSummary={scriptRow.comboSummary}
          creatorName={scriptRow.creatorName}
          platforms={scriptRow.targets.map((t) => t.platform)}
        />
      )}

      {editRow?.scriptCombo && (
        <EditScriptComboDialog
          open
          onOpenChange={(o) => !o && setEditId(null)}
          assignmentId={editRow._id}
          campaignId={editRow.scriptCombo.campaignId}
          combo={{
            hookBrickId: editRow.scriptCombo.hookBrickId,
            fluxBrickId: editRow.scriptCombo.fluxBrickId,
            ctaBrickId: editRow.scriptCombo.ctaBrickId,
          }}
          creatorName={editRow.creatorName}
        />
      )}

      {textEditRow?.scriptCombo && (
        <EditBrickTextDialog
          open
          onOpenChange={(o) => !o && setTextEditId(null)}
          assignmentId={textEditRow._id}
          campaignId={textEditRow.scriptCombo.campaignId}
          combo={{
            hookBrickId: textEditRow.scriptCombo.hookBrickId,
            fluxBrickId: textEditRow.scriptCombo.fluxBrickId,
            ctaBrickId: textEditRow.scriptCombo.ctaBrickId,
          }}
          creatorName={textEditRow.creatorName}
        />
      )}

      {assetLinkRow && (
        <LinkAssetFolderDialog
          open
          onOpenChange={(o) => !o && setAssetLinkId(null)}
          assignmentId={assetLinkRow._id}
          currentFolderIds={assetLinkRow.linkedFolderIds}
          creatorName={assetLinkRow.creatorName}
        />
      )}

      {overlayRow && (
        <AssignmentOverlayDialog
          key={overlayRow._id}
          open
          onOpenChange={(o) => !o && setOverlayId(null)}
          assignmentId={overlayRow._id}
          creatorName={overlayRow.creatorName}
          currentOverlayText={overlayRow.overlayText}
        />
      )}

      {postDateRow && (
        <AssignmentPostDateDialog
          key={postDateRow._id}
          open
          onOpenChange={(o) => !o && setPostDateId(null)}
          assignmentId={postDateRow._id}
          creatorName={postDateRow.creatorName}
          currentPostDate={postDateRow.postDate}
        />
      )}

      {detailRow && (
        <AssignmentDetailSheet
          key={detailRow._id}
          open
          onOpenChange={(o) => !o && setDetailId(null)}
          row={detailRow}
          now={nowMs}
        />
      )}

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(o) => {
          if (!o && !deleting) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet assignment ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le combo sera libéré et pourra être réassigné au créateur sur la
              même plateforme. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                // On gère la fermeture nous-mêmes (succès) pour afficher l'état
                // de chargement ; empêche la fermeture auto de l'AlertDialog.
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
            >
              {deleting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
