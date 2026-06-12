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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageUploader } from "@/components/ImageUploader";
import { PlatformBadge } from "@/components/VerdictBadge";
import { FolderCombobox } from "./FolderCombobox";
import { TagsInput } from "./TagsInput";
import {
  InspirationStatsAccordion,
  type StatsValues,
} from "./InspirationStatsAccordion";
import {
  detectInspirationType,
  type InspirationType,
  type Plateforme,
} from "@/lib/inspiration-url";
import { ALL_PLATFORMS } from "@/lib/format-config";
import { Loader2Icon, StarIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

const TYPE_LABELS: Record<InspirationType, string> = {
  video: "Vidéo",
  account: "Compte",
};

const TYPES: InspirationType[] = ["video", "account"];

function parseStatsNumber(s: string): number | undefined {
  const trimmed = s.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function numToStr(n: number | undefined): string {
  return n === undefined ? "" : String(n);
}

type InspirationDoc = Doc<"inspirations"> & { thumbnailUrl: string | null };

/**
 * Batch F → G — Dialog single-step pour création OU édition d'inspiration.
 *
 * En mode "edit" : fetch via getInspirationById, affiche Skeleton pendant
 * le chargement, puis monte le form interne avec les initialData en seed
 * useState (pas useEffect-set-state). Le sous-composant InspirationDialogForm
 * est remonté via key={inspirationId} quand on bascule d'une inspiration à
 * une autre.
 *
 * Auto-détection plateforme + type au blur de l'input URL. Si KO ou
 * "Modifier", fallback en 2 Selects manuels.
 *
 * Reset state via key={dialogKey} géré par le parent (cf page.tsx). Évite
 * le code de reset manuel.
 */
export function InspirationDialog({
  open,
  onOpenChange,
  mode,
  inspirationId,
  tagSuggestions = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  inspirationId?: Id<"inspirations">;
  tagSuggestions?: string[];
}) {
  const inspiration = useProjectQuery(
    api.inspirations.getInspirationById,
    mode === "edit" && inspirationId !== undefined
      ? { id: inspirationId }
      : "skip",
  );

  const isLoadingEdit = mode === "edit" && inspiration === undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {isLoadingEdit ? (
          <DialogLoadingSkeleton />
        ) : mode === "edit" && inspiration === null ? (
          <DialogNotFound onClose={() => onOpenChange(false)} />
        ) : (
          <InspirationDialogForm
            key={inspiration?._id ?? "create"}
            mode={mode}
            initialData={mode === "edit" ? inspiration ?? null : null}
            onClose={() => onOpenChange(false)}
            tagSuggestions={tagSuggestions}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DialogLoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function DialogNotFound({ onClose }: { onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Inspiration introuvable</DialogTitle>
        <DialogDescription>
          Cette inspiration a été supprimée ou n&apos;existe plus.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button onClick={onClose}>Fermer</Button>
      </DialogFooter>
    </>
  );
}

function InspirationDialogForm({
  mode,
  initialData,
  onClose,
  tagSuggestions,
}: {
  mode: "create" | "edit";
  initialData: InspirationDoc | null;
  onClose: () => void;
  tagSuggestions: string[];
}) {
  const isEdit = mode === "edit";

  const [url, setUrl] = useState(initialData?.url ?? "");
  const [detected, setDetected] = useState<{
    plateforme: Plateforme;
    type: InspirationType;
  } | null>(
    initialData
      ? { plateforme: initialData.plateforme, type: initialData.type }
      : null,
  );
  // En edit, on commence en mode "override" pour préserver le couple
  // plateforme/type stocké (qui peut différer d'une nouvelle détection si
  // l'URL était originellement classée manuellement).
  const [manualOverride, setManualOverride] = useState(isEdit);
  const [manualPlateforme, setManualPlateforme] = useState<Plateforme>(
    initialData?.plateforme ?? "TikTok",
  );
  const [manualType, setManualType] = useState<InspirationType>(
    initialData?.type ?? "video",
  );

  const [titre, setTitre] = useState(initialData?.titre ?? "");
  const [notes, setNotes] = useState(initialData?.notes ?? "");
  const [thumbnail, setThumbnail] = useState<Id<"_storage"> | null>(
    initialData?.thumbnail ?? null,
  );
  const [folderId, setFolderId] = useState<Id<"folders"> | null>(
    initialData?.folderId ?? null,
  );
  const [tags, setTags] = useState<string[]>(initialData?.tags ?? []);
  const [isFavorite, setIsFavorite] = useState(
    initialData?.isFavorite ?? false,
  );

  const [statsViews, setStatsViews] = useState(
    numToStr(initialData?.stats?.views),
  );
  const [statsLikes, setStatsLikes] = useState(
    numToStr(initialData?.stats?.likes),
  );
  const [statsComments, setStatsComments] = useState(
    numToStr(initialData?.stats?.comments),
  );
  const [statsFollowers, setStatsFollowers] = useState(
    numToStr(initialData?.stats?.followers),
  );
  const [statsCapturedAt, setStatsCapturedAt] = useState<number | null>(
    initialData?.stats?.capturedAt ?? null,
  );

  const [submitting, setSubmitting] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Thumbnail URL : si on a initialData.thumbnailUrl c'est déjà résolu
  // (enrichi par getInspirationById). Si l'utilisateur upload une nouvelle
  // image (thumbnail change), on re-résolve via getPreviewUrl.
  const liveThumbnailUrl =
    useQuery(
      api.storage.getPreviewUrl,
      thumbnail && thumbnail !== initialData?.thumbnail
        ? { storageId: thumbnail }
        : "skip",
    ) ?? null;
  const thumbnailUrl =
    thumbnail === null
      ? null
      : thumbnail === initialData?.thumbnail
        ? initialData?.thumbnailUrl ?? null
        : liveThumbnailUrl;

  const createInspiration = useProjectMutation(api.inspirations.createInspiration);
  const updateInspiration = useProjectMutation(api.inspirations.updateInspiration);
  const deleteInspiration = useProjectMutation(api.inspirations.deleteInspiration);

  const effectivePlateforme: Plateforme | null = manualOverride
    ? manualPlateforme
    : detected?.plateforme ?? null;
  const effectiveType: InspirationType | null = manualOverride
    ? manualType
    : detected?.type ?? null;

  const canSubmit =
    url.trim().length > 0 &&
    effectivePlateforme !== null &&
    effectiveType !== null &&
    !submitting;

  function isDirty(): boolean {
    if (!isEdit) {
      return (
        url.length > 0 ||
        titre.length > 0 ||
        notes.length > 0 ||
        thumbnail !== null ||
        folderId !== null ||
        tags.length > 0 ||
        isFavorite ||
        statsViews.length > 0 ||
        statsLikes.length > 0 ||
        statsComments.length > 0 ||
        statsFollowers.length > 0
      );
    }
    // En edit : dirty = différence par rapport à initialData.
    if (!initialData) return false;
    const initialTags = initialData.tags ?? [];
    const tagsEqual =
      initialTags.length === tags.length &&
      initialTags.every((t, idx) => t === tags[idx]);
    return (
      url !== initialData.url ||
      titre !== (initialData.titre ?? "") ||
      notes !== (initialData.notes ?? "") ||
      thumbnail !== (initialData.thumbnail ?? null) ||
      folderId !== (initialData.folderId ?? null) ||
      !tagsEqual ||
      isFavorite !== (initialData.isFavorite ?? false) ||
      statsViews !== numToStr(initialData.stats?.views) ||
      statsLikes !== numToStr(initialData.stats?.likes) ||
      statsComments !== numToStr(initialData.stats?.comments) ||
      statsFollowers !== numToStr(initialData.stats?.followers) ||
      statsCapturedAt !== (initialData.stats?.capturedAt ?? null) ||
      effectivePlateforme !== initialData.plateforme ||
      effectiveType !== initialData.type
    );
  }

  function handleUrlBlur(e: React.FocusEvent<HTMLInputElement>) {
    const trimmed = e.target.value.trim();
    if (trimmed.length === 0) {
      setDetected(null);
      return;
    }
    const result = detectInspirationType(trimmed);
    setDetected(result);
    setManualOverride(false);
  }

  function handleClose() {
    if (isDirty()) {
      setConfirmCancelOpen(true);
      return;
    }
    onClose();
  }

  function handleConfirmCancel() {
    setConfirmCancelOpen(false);
    onClose();
  }

  type StatsPayload = {
    views?: number;
    likes?: number;
    comments?: number;
    followers?: number;
    capturedAt?: number;
  };
  function buildStats(): StatsPayload | undefined {
    const v = parseStatsNumber(statsViews);
    const l = parseStatsNumber(statsLikes);
    const c = parseStatsNumber(statsComments);
    const f = parseStatsNumber(statsFollowers);
    if (
      v === undefined &&
      l === undefined &&
      c === undefined &&
      f === undefined &&
      statsCapturedAt === null
    ) {
      return undefined;
    }
    return {
      views: v,
      likes: l,
      comments: c,
      followers: f,
      capturedAt: statsCapturedAt ?? undefined,
    };
  }

  async function handleSave() {
    if (!canSubmit || !effectivePlateforme || !effectiveType) return;
    setSubmitting(true);
    try {
      const stats = buildStats();

      if (isEdit && initialData) {
        await updateInspiration({
          id: initialData._id,
          url: url.trim(),
          type: effectiveType,
          plateforme: effectivePlateforme,
          thumbnail: thumbnail ?? null,
          titre: titre.trim(),
          notes,
          stats,
          folderId: folderId ?? null,
          isFavorite,
          tags,
        });
        toast.success("Inspiration modifiée");
      } else {
        await createInspiration({
          url: url.trim(),
          type: effectiveType,
          plateforme: effectivePlateforme,
          thumbnail: thumbnail ?? undefined,
          titre: titre.trim() || undefined,
          notes: notes.length > 0 ? notes : undefined,
          stats,
          folderId: folderId ?? undefined,
          isFavorite,
          tags,
        });
        toast.success("Inspiration créée");
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!initialData) return;
    setSubmitting(true);
    try {
      await deleteInspiration({ id: initialData._id });
      toast.success("Inspiration supprimée");
      setConfirmDeleteOpen(false);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      setSubmitting(false);
    }
  }

  const statsValues: StatsValues = {
    views: statsViews,
    likes: statsLikes,
    comments: statsComments,
    followers: statsFollowers,
    capturedAt: statsCapturedAt,
  };

  const statsAccordionDefaultOpen =
    isEdit && initialData?.stats !== undefined && initialData.stats !== null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Modifier l'inspiration" : "Nouvelle inspiration"}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Mets à jour les détails de cette inspiration."
            : "Capture une vidéo ou un compte qui t'inspire."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="insp-url">URL *</Label>
        <Input
          id="insp-url"
          type="url"
          autoFocus={!isEdit}
          placeholder="https://www.tiktok.com/@... ou https://www.instagram.com/..."
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (detected !== null && !isEdit) setDetected(null);
          }}
          onBlur={handleUrlBlur}
        />
        {url.trim().length > 0 && !manualOverride && detected !== null && (
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>Détection :</span>
            <PlatformBadge plateforme={detected.plateforme} />
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-600">
              {TYPE_LABELS[detected.type]}
            </span>
            <button
              type="button"
              className="text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
              onClick={() => {
                setManualOverride(true);
                setManualPlateforme(detected.plateforme);
                setManualType(detected.type);
              }}
            >
              Modifier
            </button>
          </div>
        )}
        {url.trim().length > 0 && (manualOverride || detected === null) && (
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/50 p-3">
            <p className="text-xs text-slate-600">
              {detected === null && !manualOverride
                ? "Plateforme non détectée — sélectionne manuellement."
                : "Override manuel."}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="insp-manual-plateforme">Plateforme</Label>
                <Select
                  value={manualPlateforme}
                  onValueChange={(v) => {
                    setManualPlateforme(v as Plateforme);
                    setManualOverride(true);
                  }}
                >
                  <SelectTrigger id="insp-manual-plateforme">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="insp-manual-type">Type</Label>
                <Select
                  value={manualType}
                  onValueChange={(v) => {
                    setManualType(v as InspirationType);
                    setManualOverride(true);
                  }}
                >
                  <SelectTrigger id="insp-manual-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="insp-titre">Titre</Label>
        <Input
          id="insp-titre"
          placeholder="Optionnel"
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="insp-notes">Notes</Label>
        <Textarea
          id="insp-notes"
          rows={6}
          placeholder="Ce qui t'a marqué, ce que tu retiens..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="font-mono text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Thumbnail</Label>
        <ImageUploader
          value={thumbnail}
          imageUrl={thumbnailUrl}
          onChange={(id) => setThumbnail(id)}
          disabled={submitting}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Dossier</Label>
          <FolderCombobox value={folderId} onChange={setFolderId} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="insp-tags-input">Tags</Label>
          <TagsInput
            value={tags}
            onChange={setTags}
            suggestions={tagSuggestions}
            disabled={submitting}
          />
          <p className="text-xs text-slate-500">
            Entrée, virgule ou Tab pour valider. Backspace pour retirer.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <StarIcon
            className={
              isFavorite
                ? "size-4 fill-amber-400 stroke-amber-500"
                : "size-4 text-slate-400"
            }
          />
          <Label htmlFor="insp-favorite" className="cursor-pointer">
            Favori
          </Label>
        </div>
        <Switch
          id="insp-favorite"
          checked={isFavorite}
          onCheckedChange={setIsFavorite}
        />
      </div>

      <InspirationStatsAccordion
        values={statsValues}
        handlers={{
          setViews: setStatsViews,
          setLikes: setStatsLikes,
          setComments: setStatsComments,
          setFollowers: setStatsFollowers,
          setCapturedAt: setStatsCapturedAt,
        }}
        defaultOpen={statsAccordionDefaultOpen}
      />

      <DialogFooter>
        {isEdit && (
          <Button
            variant="ghost"
            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:mr-auto"
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={submitting}
          >
            <Trash2Icon className="size-4" />
            Supprimer
          </Button>
        )}
        <Button
          variant="outline"
          onClick={handleClose}
          disabled={submitting}
        >
          Annuler
        </Button>
        <Button onClick={handleSave} disabled={!canSubmit}>
          {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          {isEdit ? "Sauvegarder" : "Enregistrer"}
        </Button>
      </DialogFooter>

      <AlertDialog
        open={confirmCancelOpen}
        onOpenChange={setConfirmCancelOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitter sans enregistrer ?</AlertDialogTitle>
            <AlertDialogDescription>
              Tes modifications ne seront pas sauvegardées.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuer l&apos;édition</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirmCancel}
            >
              Quitter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette inspiration ?</AlertDialogTitle>
            <AlertDialogDescription>
              Action irréversible. L&apos;inspiration sera définitivement
              supprimée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={submitting}
            >
              {submitting && (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              )}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
