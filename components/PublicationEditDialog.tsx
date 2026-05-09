"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { VerdictBadge } from "@/components/VerdictBadge";
import {
  calculateSaveRate,
  calculateVerdict,
  formatPercent,
} from "@/lib/verdict";
import { getMediaType } from "@/lib/media-type";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

function parseNumOrNull(s: string): number | null {
  if (s === "") return null;
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
  // Batch 2 Modif 4c — coercion mediaType pour brancher l'affichage
  // métriques. Saves est carousel-only ; likes + subsGained sont
  // short-only. Le mediaType d'une publication ne change pas après
  // création (cf décision 8) → calculé une fois au mount.
  const mediaType = getMediaType(publication);
  const isShort = mediaType === "short";

  const [vuesJ1, setVuesJ1] = useState(toStr(publication.vuesJ1));
  const [vuesJ3, setVuesJ3] = useState(toStr(publication.vuesJ3));
  const [vuesJ7, setVuesJ7] = useState(toStr(publication.vuesJ7));
  const [saves, setSaves] = useState(toStr(publication.saves));
  const [likes, setLikes] = useState(toStr(publication.likes));
  const [subsGained, setSubsGained] = useState(toStr(publication.subsGained));
  const [commentsTotal, setCommentsTotal] = useState(
    toStr(publication.commentsTotal),
  );
  const [commentsAudit, setCommentsAudit] = useState(
    toStr(publication.commentsAudit),
  );
  const [profileVisits, setProfileVisits] = useState(
    toStr(publication.profileVisits),
  );
  const [notes, setNotes] = useState(publication.notes ?? "");
  const [postUrl, setPostUrl] = useState(publication.postUrl ?? "");
  const [submitting, setSubmitting] = useState(false);

  const updateMetrics = useMutation(api.publications.updateMetrics);

  // Batch 2 Modif 4c — inversion isTikTok → isInstagram. La logique
  // antérieure « TikTok masque commentsAudit » excluait les Reels Instagram
  // par défaut MAIS exposait commentsAudit pour YouTube qui n'a pas ce
  // concept. La nouvelle condition positive « Instagram seul l'expose »
  // couvre correctement les 3 plateformes.
  const isInstagram = publication.plateforme === "Instagram";
  // Save rate preview : non applicable aux Shorts (saves n'existe pas).
  const previewSaveRate = isShort
    ? null
    : calculateSaveRate(parseNumOrNull(saves), parseNumOrNull(vuesJ7));
  const previewVerdict = calculateVerdict(previewSaveRate);

  async function handleSave() {
    setSubmitting(true);
    try {
      // Batch 2 Modif 4c — payload conditionnel selon mediaType :
      //   - Carousel : saves saisi, likes/subsGained à null
      //   - Short    : likes/subsGained saisis, saves à null
      // commentsAudit : Instagram-only (cf isInstagram inversion). TikTok
      // ET YouTube → null (n/a).
      await updateMetrics({
        id: publication._id,
        vuesJ1: parseNumOrNull(vuesJ1),
        vuesJ3: parseNumOrNull(vuesJ3),
        vuesJ7: parseNumOrNull(vuesJ7),
        saves: isShort ? null : parseNumOrNull(saves),
        likes: isShort ? parseNumOrNull(likes) : null,
        subsGained: isShort ? parseNumOrNull(subsGained) : null,
        commentsTotal: parseNumOrNull(commentsTotal),
        commentsAudit: isInstagram ? parseNumOrNull(commentsAudit) : null,
        profileVisits: parseNumOrNull(profileVisits),
        notes,
        postUrl: postUrl.trim(),
      });
      toast.success("Métriques mises à jour");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la mise à jour");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Mettre à jour — {publication.carouselId} ({publication.plateforme})
          </DialogTitle>
          <DialogDescription className="italic">
            {publication.hookText}
          </DialogDescription>
        </DialogHeader>

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
            Renseigner le lien fait passer la publication en statut « publié ».
            Vide = « à venir ».
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="vues-j1">Vues J+1</Label>
            <Input
              id="vues-j1"
              type="number"
              inputMode="numeric"
              placeholder="—"
              value={vuesJ1}
              onChange={(e) => setVuesJ1(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vues-j3">Vues J+3</Label>
            <Input
              id="vues-j3"
              type="number"
              inputMode="numeric"
              placeholder="—"
              value={vuesJ3}
              onChange={(e) => setVuesJ3(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vues-j7">Vues J+7</Label>
            <Input
              id="vues-j7"
              type="number"
              inputMode="numeric"
              placeholder="—"
              value={vuesJ7}
              onChange={(e) => setVuesJ7(e.target.value)}
            />
          </div>
          {/*
            Batch 2 Modif 4c — Saves (Carousel) vs Likes + SubsGained (Short).
            Mutuellement exclusif selon mediaType.
          */}
          {isShort ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="likes">Likes</Label>
                <Input
                  id="likes"
                  type="number"
                  inputMode="numeric"
                  placeholder="—"
                  value={likes}
                  onChange={(e) => setLikes(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subs-gained">Subs gagnés</Label>
                <Input
                  id="subs-gained"
                  type="number"
                  inputMode="numeric"
                  placeholder="—"
                  value={subsGained}
                  onChange={(e) => setSubsGained(e.target.value)}
                />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="saves">Saves</Label>
              <Input
                id="saves"
                type="number"
                inputMode="numeric"
                placeholder="—"
                value={saves}
                onChange={(e) => setSaves(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="comments-total">Comments total</Label>
            <Input
              id="comments-total"
              type="number"
              inputMode="numeric"
              placeholder="—"
              value={commentsTotal}
              onChange={(e) => setCommentsTotal(e.target.value)}
            />
          </div>
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

        {/*
          Batch 2 Modif 4c — preview Save rate + Verdict masqués en mode
          Short (saveRate non applicable, donc previewSaveRate=null +
          previewVerdict=null donneraient un affichage vide trompeur).
        */}
        {!isShort && (
          <div className="flex items-center justify-between gap-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <div className="text-slate-600">
              Save rate (sur Vues J+7) :{" "}
              <span className="font-semibold text-slate-900">
                {formatPercent(previewSaveRate)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              Verdict : <VerdictBadge verdict={previewVerdict} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
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
