"use client";

import { useEffect, useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import type { Plateforme } from "@/lib/compte-status";

/**
 * Compte GÉRÉ PAR L'ÉQUIPE — l'admin déclare un compte social pour une créatrice
 * qu'il tient PHYSIQUEMENT (il cochera le warmup, publiera, mettra le lien). Le
 * compte est rattaché à la créatrice (creatorId) — elle voit scripts + posts +
 * perfs — mais elle ne publie/dépose rien (managedByAdmin=true). Créé en warmup :
 * l'admin coche puis active depuis la fiche compte. Mobile-first.
 */
export function ManagedCompteDialog({
  open,
  onOpenChange,
  creatorId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  creatorId: Id<"creators">;
}) {
  const declareManaged = useProjectMutation(api.comptes.declareManagedCompte);
  const [plateforme, setPlateforme] = useState<Plateforme>("TikTok");
  const [handle, setHandle] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setPlateforme("TikTok");
      setHandle("");
      setUrl("");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open]);

  async function submit() {
    const trimmed = handle.trim();
    if (!trimmed || trimmed === "@") {
      toast.error("Handle requis.");
      return;
    }
    setSubmitting(true);
    try {
      await declareManaged({
        creatorId,
        plateforme,
        handle: trimmed,
        url: url.trim() || undefined,
      });
      toast.success(`Compte géré ${trimmed} créé sur ${plateforme}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Créer un compte géré par l&apos;équipe</DialogTitle>
          <DialogDescription>
            Compte tenu par l&apos;équipe (warmup, publication, lien) et rattaché
            à cette créatrice : elle voit les scripts, les posts publiés et leurs
            performances, sans rien publier elle-même.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Plateforme</Label>
            <Select
              value={plateforme}
              onValueChange={(v) => v !== null && setPlateforme(v as Plateforme)}
            >
              <SelectTrigger aria-label="Plateforme">
                <SelectValue>{plateforme}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TikTok">TikTok</SelectItem>
                <SelectItem value="Instagram">Instagram</SelectItem>
                <SelectItem value="YouTube">YouTube</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="managed-handle">Handle</Label>
            <Input
              id="managed-handle"
              placeholder="@compte_pro"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              Le @ est ajouté automatiquement si tu l&apos;oublies.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="managed-url">URL du compte (optionnel)</Label>
            <Input
              id="managed-url"
              placeholder="https://www.tiktok.com/@compte_pro"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
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
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Créer le compte géré
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
