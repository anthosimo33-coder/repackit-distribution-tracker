"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { ImageUploader } from "@/components/ImageUploader";
import { PlatformBadge } from "@/components/VerdictBadge";
import { FolderCombobox } from "./FolderCombobox";
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
import { Loader2Icon, StarIcon } from "lucide-react";
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

/**
 * Batch F — Dialog single-step pour création d'inspiration. Mode édition
 * sera ajouté en Batch G (le composant accepte déjà la prop pattern open
 * + onOpenChange contrôlé pour rester stateless).
 *
 * Auto-détection plateforme + type au blur de l'input URL. Si KO ou si
 * l'utilisateur clique "Modifier", fallback en 2 Selects manuels.
 *
 * Reset state via key={isOpen ? "open" : "closed"} géré par le parent —
 * cf NouveauModal:166. Évite le code de reset manuel.
 */
export function InspirationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [detected, setDetected] =
    useState<{ plateforme: Plateforme; type: InspirationType } | null>(null);
  const [manualOverride, setManualOverride] = useState(false);
  const [manualPlateforme, setManualPlateforme] = useState<Plateforme>("TikTok");
  const [manualType, setManualType] = useState<InspirationType>("video");

  const [titre, setTitre] = useState("");
  const [notes, setNotes] = useState("");
  const [thumbnail, setThumbnail] = useState<Id<"_storage"> | null>(null);
  const [folderId, setFolderId] = useState<Id<"folders"> | null>(null);
  const [tagsInput, setTagsInput] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);

  const [statsViews, setStatsViews] = useState("");
  const [statsLikes, setStatsLikes] = useState("");
  const [statsComments, setStatsComments] = useState("");
  const [statsFollowers, setStatsFollowers] = useState("");
  const [statsCapturedAt, setStatsCapturedAt] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const thumbnailUrl =
    useQuery(
      api.storage.getPreviewUrl,
      thumbnail ? { storageId: thumbnail } : "skip",
    ) ?? null;

  const createInspiration = useMutation(api.inspirations.createInspiration);

  const effectivePlateforme: Plateforme | null = manualOverride
    ? manualPlateforme
    : detected?.plateforme ?? null;
  const effectiveType: InspirationType | null = manualOverride
    ? manualType
    : detected?.type ?? null;

  const canSubmit =
    url.trim().length > 0 && effectivePlateforme !== null && effectiveType !== null && !submitting;

  function isDirty(): boolean {
    return (
      url.length > 0 ||
      titre.length > 0 ||
      notes.length > 0 ||
      thumbnail !== null ||
      folderId !== null ||
      tagsInput.length > 0 ||
      isFavorite ||
      statsViews.length > 0 ||
      statsLikes.length > 0 ||
      statsComments.length > 0 ||
      statsFollowers.length > 0
    );
  }

  function handleUrlBlur(e: React.FocusEvent<HTMLInputElement>) {
    // Lire depuis e.target.value plutôt que la state `url` : si onChange a
    // queue un setUrl juste avant le blur (input rapide → Tab), la closure
    // capturée par handleUrlBlur peut encore voir l'ancienne valeur de url
    // au moment où on l'évalue. e.target.value est la source de vérité DOM.
    const trimmed = e.target.value.trim();
    if (trimmed.length === 0) {
      setDetected(null);
      return;
    }
    const result = detectInspirationType(trimmed);
    setDetected(result);
    setManualOverride(false);
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (isDirty()) {
      setConfirmCancelOpen(true);
      return;
    }
    onOpenChange(false);
  }

  function handleConfirmCancel() {
    setConfirmCancelOpen(false);
    onOpenChange(false);
  }

  async function handleSave() {
    if (!canSubmit || !effectivePlateforme || !effectiveType) return;
    setSubmitting(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const v = parseStatsNumber(statsViews);
      const l = parseStatsNumber(statsLikes);
      const c = parseStatsNumber(statsComments);
      const f = parseStatsNumber(statsFollowers);
      const stats =
        v === undefined &&
        l === undefined &&
        c === undefined &&
        f === undefined &&
        statsCapturedAt === null
          ? undefined
          : {
              views: v,
              likes: l,
              comments: c,
              followers: f,
              capturedAt: statsCapturedAt ?? undefined,
            };

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
      toast.success("Inspiration enregistrée");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
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

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nouvelle inspiration</DialogTitle>
            <DialogDescription>
              Capture une vidéo ou un compte qui t&apos;inspire.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="insp-url">URL *</Label>
            <Input
              id="insp-url"
              type="url"
              autoFocus
              placeholder="https://www.tiktok.com/@... ou https://www.instagram.com/..."
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (detected !== null) setDetected(null);
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
              <Label htmlFor="insp-tags">Tags</Label>
              <Input
                id="insp-tags"
                placeholder="growth, b2b, hook"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
              <p className="text-xs text-slate-500">
                Séparés par des virgules.
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
          />

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleDialogOpenChange(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={!canSubmit}>
              {submitting && (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              )}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </>
  );
}
