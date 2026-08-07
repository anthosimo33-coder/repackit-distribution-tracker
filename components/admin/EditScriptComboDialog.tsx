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

const NONE = "__none__";

/**
 * Corrige UNE brique du combo d'un assignment (hook | flux | cta), UNE SEULE
 * FOIS, avant publication. Choix du slot + de la nouvelle brique (briques actives
 * du même kind de la campagne, comme à l'assignation), aperçu du script re-figé
 * (rendu créateur, sans titres), puis confirmation → editScriptCombo.
 */
export function EditScriptComboDialog({
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
  const edit = useProjectMutation(api.scripts.editScriptCombo);
  const [slot, setSlot] = useState<ScriptComboSlot>("hook");
  const [newBrickId, setNewBrickId] = useState<string>(NONE);
  const [busy, setBusy] = useState(false);

  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setSlot("hook");
      setNewBrickId(NONE);
    }
  }

  const bricks = campaign?.bricks ?? [];
  const currentIdForSlot: Record<ScriptComboSlot, Id<"scriptBricks">> = {
    hook: combo.hookBrickId,
    flux: combo.fluxBrickId,
    cta: combo.ctaBrickId,
  };
  const contentOf = (id: Id<"scriptBricks">) =>
    bricks.find((b) => b._id === id)?.content ?? "";

  // Briques actives du kind choisi, hors brique actuellement utilisée.
  const options = bricks.filter(
    (b) => b.kind === slot && b.active && b._id !== currentIdForSlot[slot],
  );

  function changeSlot(s: ScriptComboSlot) {
    setSlot(s);
    setNewBrickId(NONE);
  }

  // Aperçu du script re-figé (rendu créateur, labels OFF) avec la brique choisie.
  const previewContents = {
    hook:
      slot === "hook" && newBrickId !== NONE
        ? contentOf(newBrickId as Id<"scriptBricks">)
        : contentOf(combo.hookBrickId),
    flux:
      slot === "flux" && newBrickId !== NONE
        ? contentOf(newBrickId as Id<"scriptBricks">)
        : contentOf(combo.fluxBrickId),
    cta:
      slot === "cta" && newBrickId !== NONE
        ? contentOf(newBrickId as Id<"scriptBricks">)
        : contentOf(combo.ctaBrickId),
  };
  const preview =
    newBrickId !== NONE
      ? assembleScript(previewContents, { labels: false })
      : "";

  async function onConfirm() {
    if (newBrickId === NONE) {
      toast.error("Choisis une brique de remplacement.");
      return;
    }
    setBusy(true);
    try {
      await edit({
        id: assignmentId,
        slot,
        newBrickId: newBrickId as Id<"scriptBricks">,
      });
      toast.success("Combo corrigé — script mis à jour.");
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
          <DialogTitle>Modifier le combo — {creatorName}</DialogTitle>
          <DialogDescription>
            Remplace UNE brique (hook, flux ou description). Une seule correction
            possible, avant publication. Le pricing n&apos;est pas impacté.
          </DialogDescription>
        </DialogHeader>

        {campaign === undefined ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="slot">Brique à remplacer</Label>
                <Select
                  value={slot}
                  onValueChange={(v) => v && changeSlot(v as ScriptComboSlot)}
                >
                  <SelectTrigger id="slot">
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
                <Label htmlFor="newBrick">Nouvelle brique</Label>
                <Select
                  value={newBrickId}
                  onValueChange={(v) => v && setNewBrickId(v)}
                >
                  <SelectTrigger id="newBrick" aria-label="Nouvelle brique">
                    <SelectValue>
                      {newBrickId === NONE
                        ? "Choisir…"
                        : (options.find((b) => b._id === newBrickId)?.label ??
                          "Brique")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((b) => (
                      <SelectItem key={b._id} value={b._id}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {options.length === 0 && (
              <p className="text-sm text-amber-600">
                Aucune autre brique « {KIND_LABELS[slot].toLowerCase()} » active
                dans la campagne.
              </p>
            )}

            {preview && (
              <div className="space-y-1.5">
                <Label>Aperçu du script corrigé</Label>
                <div
                  className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3"
                  data-testid="edit-combo-preview"
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
          <Button onClick={onConfirm} disabled={busy || newBrickId === NONE}>
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Corriger le combo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
