"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
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

type Plateforme = "TikTok" | "Instagram" | "YouTube";

/**
 * P5 — déclaration d'un compte par le créateur. Hors ProjectProvider (portail
 * /app) : projectId passé explicitement à la creatorMutation. Le compte naît en
 * warmup (warmupStartedAt = now, targetDays au défaut plateforme, côté serveur).
 */
export function DeclareCompteDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: Id<"projects">;
}) {
  const declareCompte = useMutation(api.comptes.declareCompte);
  const [plateforme, setPlateforme] = useState<Plateforme>("TikTok");
  const [handle, setHandle] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setPlateforme("TikTok");
    setHandle("");
    setUrl("");
    setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await declareCompte({
        projectId,
        plateforme,
        handle: handle.trim(),
        url: url.trim() || undefined,
      });
      toast.success("Compte déclaré — warmup démarré");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Déclarer un compte</DialogTitle>
          <DialogDescription>
            Le warmup démarre dès la déclaration.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Plateforme</Label>
            <Select
              value={plateforme}
              onValueChange={(v) => v && setPlateforme(v as Plateforme)}
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
            <Label htmlFor="declare-handle">Handle *</Label>
            <Input
              id="declare-handle"
              placeholder="@mon_compte"
              required
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="declare-url">URL du compte</Label>
            <Input
              id="declare-url"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Déclarer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
