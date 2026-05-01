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
  const [vuesJ1, setVuesJ1] = useState(toStr(publication.vuesJ1));
  const [vuesJ3, setVuesJ3] = useState(toStr(publication.vuesJ3));
  const [vuesJ7, setVuesJ7] = useState(toStr(publication.vuesJ7));
  const [saves, setSaves] = useState(toStr(publication.saves));
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
  const [submitting, setSubmitting] = useState(false);

  const updateMetrics = useMutation(api.publications.updateMetrics);

  const isTikTok = publication.plateforme === "TikTok";
  const previewSaveRate = calculateSaveRate(
    parseNumOrNull(saves),
    parseNumOrNull(vuesJ7),
  );
  const previewVerdict = calculateVerdict(previewSaveRate);

  async function handleSave() {
    setSubmitting(true);
    try {
      await updateMetrics({
        id: publication._id,
        vuesJ1: parseNumOrNull(vuesJ1),
        vuesJ3: parseNumOrNull(vuesJ3),
        vuesJ7: parseNumOrNull(vuesJ7),
        saves: parseNumOrNull(saves),
        commentsTotal: parseNumOrNull(commentsTotal),
        commentsAudit: isTikTok ? null : parseNumOrNull(commentsAudit),
        profileVisits: parseNumOrNull(profileVisits),
        notes,
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
              placeholder={isTikTok ? "TikTok n/a" : "—"}
              disabled={isTikTok}
              value={isTikTok ? "" : commentsAudit}
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
