"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { fr } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getMediaType } from "@/lib/media-type";
import { IcpCombobox } from "@/components/icps/IcpCombobox";
import { SourceIdCombobox } from "@/components/shorts/SourceIdCombobox";
import { formatDate, formatNumber } from "@/lib/format";
import {
  CalendarIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

const DAY_MS = 24 * 60 * 60 * 1000;

const SNAPSHOT_PRESETS: { label: string; days: number | "today" }[] = [
  { label: "J+1", days: 1 },
  { label: "J+3", days: 3 },
  { label: "J+7", days: 7 },
  { label: "J+14", days: 14 },
  { label: "J+30", days: 30 },
  { label: "J+60", days: 60 },
  { label: "J+90", days: 90 },
  { label: "Aujourd'hui", days: "today" },
];

function parseNumOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toStr(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n);
}

export function PublicationEditDialog({
  publication,
  open,
  onOpenChange,
}: {
  publication: Doc<"publications">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mediaType = getMediaType(publication);
  const isShort = mediaType === "short";
  const isScreenRecorder = mediaType === "screenrecorder";
  const isVideoFormat = isShort || isScreenRecorder;
  const isInstagram = publication.plateforme === "Instagram";

  const snapshots = useProjectQuery(api.metricSnapshots.listSnapshotsByPublication, {
    publicationId: publication._id,
  });

  // Champs publication-level (hors modèle snapshot) — postUrl, commentsAudit
  // (Instagram), profileVisits, ICP (Short), notes. Sauvés via updateMetrics.
  const [postUrl, setPostUrl] = useState(publication.postUrl ?? "");
  const [commentsAudit, setCommentsAudit] = useState(
    toStr(publication.commentsAudit),
  );
  const [profileVisits, setProfileVisits] = useState(
    toStr(publication.profileVisits),
  );
  const [notes, setNotes] = useState(publication.notes ?? "");
  const [icpId, setIcpId] = useState<Id<"icps"> | null>(
    publication.icpId ?? null,
  );
  // Anti-shadowban — sourceId éditable a posteriori (backfill S007/S008).
  const [sourceId, setSourceId] = useState(publication.sourceId ?? "");
  const [savingInfos, setSavingInfos] = useState(false);

  const updateMetrics = useProjectMutation(api.publications.updateMetrics);
  const deleteSnapshot = useProjectMutation(api.metricSnapshots.deleteSnapshot);

  const [formOpen, setFormOpen] = useState(false);
  const [editingSnapshot, setEditingSnapshot] =
    useState<Doc<"metricSnapshots"> | null>(null);
  const [deletingSnapshot, setDeletingSnapshot] =
    useState<Doc<"metricSnapshots"> | null>(null);

  async function handleSaveInfos() {
    if (isShort && icpId === null) {
      toast.error("ICP requis pour le Short.");
      return;
    }
    if (isShort && !sourceId.trim()) {
      toast.error("Source requise pour le Short.");
      return;
    }
    setSavingInfos(true);
    try {
      await updateMetrics({
        id: publication._id,
        commentsAudit: isInstagram ? parseNumOrNull(commentsAudit) : null,
        profileVisits: parseNumOrNull(profileVisits),
        notes,
        icpId: isShort ? icpId : undefined,
        sourceId: isShort ? sourceId.trim() : undefined,
        postUrl: postUrl.trim(),
      });
      toast.success("Infos publication mises à jour");
      onOpenChange(false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Erreur lors de la mise à jour",
      );
    } finally {
      setSavingInfos(false);
    }
  }

  async function confirmDeleteSnapshot() {
    if (!deletingSnapshot) return;
    try {
      await deleteSnapshot({ id: deletingSnapshot._id });
      toast.success("Snapshot supprimé");
      setDeletingSnapshot(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la suppression");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Mettre à jour — {publication.carouselId} ({publication.plateforme})
          </DialogTitle>
          <DialogDescription className="italic">
            {publication.hookText}
          </DialogDescription>
        </DialogHeader>

        {/* ─── Snapshots de métriques ─── */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Snapshots de métriques
            </h3>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                setEditingSnapshot(null);
                setFormOpen(true);
              }}
            >
              <PlusIcon className="size-4" />
              Ajouter un snapshot
            </Button>
          </div>

          {snapshots === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : snapshots.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">
              Aucun snapshot. Ajoute la première mesure (vues, likes…) avec un
              bouton rapide J+1 / J+7 / J+30.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {snapshots.map((s) => (
                <li
                  key={s._id}
                  className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <Badge variant="outline" className="shrink-0 font-mono">
                    J+{s.daysSincePublication}
                  </Badge>
                  <span className="shrink-0 text-xs text-slate-500">
                    {formatDate(s.capturedAt)}
                  </span>
                  <span className="flex-1 truncate text-xs text-slate-600">
                    {formatNumber(s.vues)} vues · {formatNumber(s.likes)} likes
                    {s.saves != null && ` · ${formatNumber(s.saves)} saves`}
                    {s.subsGained != null &&
                      ` · ${formatNumber(s.subsGained)} subs`}
                    {s.comments != null &&
                      ` · ${formatNumber(s.comments)} comm.`}
                  </span>
                  <button
                    type="button"
                    aria-label="Éditer le snapshot"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => {
                      setEditingSnapshot(s);
                      setFormOpen(true);
                    }}
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Supprimer le snapshot"
                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    onClick={() => setDeletingSnapshot(s)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="border-t border-slate-200" />

        {/* ─── Infos publication (hors snapshots) ─── */}
        <section className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="post-url">Lien de publication</Label>
            <Input
              id="post-url"
              type="url"
              placeholder="https://www.tiktok.com/@... ou https://www.instagram.com/..."
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              Vider le lien repasse la publication en « à venir ».
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="comments-audit">Comments AUDIT</Label>
              <Input
                id="comments-audit"
                type="number"
                inputMode="numeric"
                placeholder={isInstagram ? "—" : "n/a"}
                disabled={!isInstagram}
                value={isInstagram ? commentsAudit : ""}
                onChange={(e) => setCommentsAudit(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-visits">Profile visits</Label>
              <Input
                id="profile-visits"
                type="number"
                inputMode="numeric"
                placeholder="—"
                value={profileVisits}
                onChange={(e) => setProfileVisits(e.target.value)}
              />
            </div>
          </div>

          {isShort && (
            <div className="space-y-1.5">
              <Label>Source (nom de fichier Drive)</Label>
              <SourceIdCombobox
                value={sourceId}
                onChange={setSourceId}
                required
              />
            </div>
          )}

          {isShort && (
            <div className="space-y-1.5">
              <Label>ICP ciblé</Label>
              <IcpCombobox value={icpId} onChange={setIcpId} required />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea
              id="edit-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optionnel..."
            />
          </div>
        </section>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={savingInfos}
          >
            Fermer
          </Button>
          <Button onClick={handleSaveInfos} disabled={savingInfos}>
            {savingInfos && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Enregistrer les infos
          </Button>
        </DialogFooter>

        {formOpen && (
          <SnapshotFormDialog
            key={editingSnapshot?._id ?? "new"}
            publication={publication}
            editing={editingSnapshot}
            isCarousel={!isVideoFormat}
            isVideo={isVideoFormat}
            onClose={() => {
              setFormOpen(false);
              setEditingSnapshot(null);
            }}
          />
        )}

        <AlertDialog
          open={!!deletingSnapshot}
          onOpenChange={(o) => !o && setDeletingSnapshot(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer ce snapshot ?</AlertDialogTitle>
              <AlertDialogDescription>
                {deletingSnapshot
                  ? `Snapshot J+${deletingSnapshot.daysSincePublication} du ${formatDate(deletingSnapshot.capturedAt)}. Cette action est irréversible.`
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={confirmDeleteSnapshot}
              >
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function SnapshotFormDialog({
  publication,
  editing,
  isCarousel,
  isVideo,
  onClose,
}: {
  publication: Doc<"publications">;
  editing: Doc<"metricSnapshots"> | null;
  isCarousel: boolean;
  isVideo: boolean;
  onClose: () => void;
}) {
  const createSnapshot = useProjectMutation(api.metricSnapshots.createSnapshot);
  const updateSnapshot = useProjectMutation(api.metricSnapshots.updateSnapshot);

  const [capturedAt, setCapturedAt] = useState<Date>(
    editing ? new Date(editing.capturedAt) : new Date(),
  );
  const [vues, setVues] = useState(editing ? toStr(editing.vues) : "");
  const [likes, setLikes] = useState(editing ? toStr(editing.likes) : "");
  const [saves, setSaves] = useState(editing ? toStr(editing.saves) : "");
  const [subsGained, setSubsGained] = useState(
    editing ? toStr(editing.subsGained) : "",
  );
  const [comments, setComments] = useState(
    editing ? toStr(editing.comments) : "",
  );
  const [submitting, setSubmitting] = useState(false);

  const daysSince = Math.floor(
    (capturedAt.getTime() - publication.datePubli) / DAY_MS,
  );

  function applyPreset(days: number | "today") {
    if (days === "today") setCapturedAt(new Date());
    else setCapturedAt(new Date(publication.datePubli + days * DAY_MS));
  }

  async function handleSave() {
    const v = parseNumOrNull(vues);
    if (v === null || v < 0) {
      toast.error("Vues requises (≥ 0).");
      return;
    }
    if (capturedAt.getTime() < publication.datePubli) {
      toast.error("Date de capture antérieure à la date de publication.");
      return;
    }
    const payload = {
      vues: v,
      likes: parseNumOrNull(likes) ?? 0,
      saves: isCarousel ? parseNumOrNull(saves) ?? undefined : undefined,
      subsGained: isVideo ? parseNumOrNull(subsGained) ?? undefined : undefined,
      comments: parseNumOrNull(comments) ?? undefined,
    };
    setSubmitting(true);
    try {
      if (editing) {
        await updateSnapshot({
          id: editing._id,
          capturedAt: capturedAt.getTime(),
          ...payload,
        });
        toast.success("Snapshot modifié");
      } else {
        await createSnapshot({
          publicationId: publication._id,
          capturedAt: capturedAt.getTime(),
          source: "manual",
          ...payload,
        });
        toast.success("Snapshot ajouté");
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'enregistrement");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Modifier le snapshot" : "Nouveau snapshot"}
          </DialogTitle>
          <DialogDescription>
            {publication.carouselId} ({publication.plateforme}) — capture à
            J+{Math.max(0, daysSince)}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Date de capture rapide</Label>
          <div className="flex flex-wrap gap-1.5">
            {SNAPSHOT_PRESETS.map((p) => (
              <Button
                key={p.label}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => applyPreset(p.days)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Date de capture</Label>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="w-full justify-start text-left font-normal"
                >
                  <CalendarIcon className="mr-2 size-4" />
                  {capturedAt.toLocaleDateString("fr-FR", {
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
                selected={capturedAt}
                onSelect={(d) => d && setCapturedAt(d)}
                locale={fr}
                weekStartsOn={1}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="snap-vues">Vues</Label>
            <Input
              id="snap-vues"
              type="number"
              inputMode="numeric"
              placeholder="—"
              value={vues}
              onChange={(e) => setVues(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="snap-likes">Likes</Label>
            <Input
              id="snap-likes"
              type="number"
              inputMode="numeric"
              placeholder="—"
              value={likes}
              onChange={(e) => setLikes(e.target.value)}
            />
          </div>
          {isCarousel && (
            <div className="space-y-1.5">
              <Label htmlFor="snap-saves">Saves</Label>
              <Input
                id="snap-saves"
                type="number"
                inputMode="numeric"
                placeholder="—"
                value={saves}
                onChange={(e) => setSaves(e.target.value)}
              />
            </div>
          )}
          {isVideo && (
            <div className="space-y-1.5">
              <Label htmlFor="snap-subs">Subs gagnés</Label>
              <Input
                id="snap-subs"
                type="number"
                inputMode="numeric"
                placeholder="—"
                value={subsGained}
                onChange={(e) => setSubsGained(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="snap-comments">Comments</Label>
            <Input
              id="snap-comments"
              type="number"
              inputMode="numeric"
              placeholder="—"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
