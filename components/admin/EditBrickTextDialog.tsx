"use client";

import { useState } from "react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { convexErrorMessage } from "@/lib/convex-error";
import { assembleScript, KIND_LABELS } from "@/lib/scriptAssembly";
import {
  SCRIPT_COMBO_SLOTS,
  type ScriptComboSlot,
} from "@/lib/script-combo-edit";

/**
 * Édite le TEXTE d'UNE brique (hook | flux | cta) d'un assignment → FORKE une
 * nouvelle variante en bibliothèque (même kind + tier) et l'applique au combo.
 * UNE SEULE FOIS, avant publication (verrou partagé avec « Modifier le combo »).
 * Textarea pré-rempli avec le texte ACTUEL ; aperçu du script re-figé.
 */
export function EditBrickTextDialog({
  open,
  onOpenChange,
  assignmentId,
  campaignId,
  combo,
  creatorName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assignmentId: Id<"assignments">;
  campaignId: Id<"scriptCampaigns">;
  combo: {
    hookBrickId: Id<"scriptBricks">;
    fluxBrickId: Id<"scriptBricks">;
    ctaBrickId: Id<"scriptBricks">;
  };
  creatorName: string;
}) {
  const campaign = useProjectQuery(
    api.scripts.getCampaign,
    open ? { id: campaignId } : "skip",
  );
  const edit = useProjectMutation(api.scripts.editScriptBrickText);
  const [slot, setSlot] = useState<ScriptComboSlot>("hook");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [seedKey, setSeedKey] = useState<string | null>(null);

  const bricks = campaign?.bricks ?? [];
  const currentIdForSlot: Record<ScriptComboSlot, Id<"scriptBricks">> = {
    hook: combo.hookBrickId,
    flux: combo.fluxBrickId,
    cta: combo.ctaBrickId,
  };
  const contentOf = (id: Id<"scriptBricks">) =>
    bricks.find((b) => b._id === id)?.content ?? "";

  // Reset à l'ouverture.
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setSlot("hook");
      setSeedKey(null);
    }
  }
  // Pré-remplit le textarea avec le texte ACTUEL du slot (quand la campagne est
  // chargée, et à chaque changement de slot). Pattern de sync en rendu.
  const wantSeedKey = `${open}:${slot}`;
  if (open && campaign !== undefined && seedKey !== wantSeedKey) {
    setSeedKey(wantSeedKey);
    setText(contentOf(currentIdForSlot[slot]));
  }

  // Aperçu du script re-figé (rendu créateur, labels OFF) avec le texte édité.
  const previewContents = {
    hook: slot === "hook" ? text : contentOf(combo.hookBrickId),
    flux: slot === "flux" ? text : contentOf(combo.fluxBrickId),
    cta: slot === "cta" ? text : contentOf(combo.ctaBrickId),
  };
  const preview = text.trim()
    ? assembleScript(previewContents, { labels: false })
    : "";

  async function onConfirm() {
    if (text.trim().length === 0) {
      toast.error("Le texte est requis.");
      return;
    }
    setBusy(true);
    try {
      await edit({ id: assignmentId, slot, newText: text });
      toast.success("Texte édité — nouvelle variante créée, script mis à jour.");
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Éditer le texte — {creatorName}</DialogTitle>
          <DialogDescription>
            Modifie le texte d&apos;une brique. Cela crée une NOUVELLE variante
            dans la bibliothèque (même type + tier) et l&apos;applique à cet
            assignment. Une seule édition possible, avant publication. Le pricing
            n&apos;est pas impacté.
          </DialogDescription>
        </DialogHeader>

        {campaign === undefined ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="brick-slot">Brique à éditer</Label>
              <Select
                value={slot}
                onValueChange={(v) => v && setSlot(v as ScriptComboSlot)}
              >
                <SelectTrigger id="brick-slot" className="w-40">
                  <SelectValue>{KIND_LABELS[slot]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SCRIPT_COMBO_SLOTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {KIND_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="brick-text">Texte</Label>
              <Textarea
                id="brick-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
              />
            </div>

            {preview && (
              <div className="space-y-1.5">
                <Label>Aperçu du script modifié</Label>
                <div
                  className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3"
                  data-testid="edit-text-preview"
                >
                  <SimpleMarkdown content={preview} />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Annuler
          </Button>
          <Button onClick={onConfirm} disabled={busy || text.trim().length === 0}>
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Créer la variante
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
