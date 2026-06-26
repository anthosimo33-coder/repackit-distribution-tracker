"use client";

import { useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

/**
 * Ajout d'un compte favori au Radar. Accepte un @, un handle nu, ou une URL de
 * profil tiktok.com/@x (normalisé serveur). Déclenche un 1er sync immédiat. Si la
 * limite douce est atteinte, on ajoute quand même et on affiche un avertissement.
 */
export function AddRadarAccountDialog() {
  const addAccount = useProjectMutation(api.radar.addRadarAccount);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd() {
    const value = input.trim();
    if (value === "") return;
    setSubmitting(true);
    try {
      const { warning } = await addAccount({
        input: value,
        note: note.trim() || undefined,
      });
      toast.success("Compte ajouté — synchronisation lancée");
      if (warning) toast.warning(warning);
      setInput("");
      setNote("");
      setOpen(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Ajout impossible."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon className="size-4" />
        Ajouter un compte
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Suivre un compte TikTok</DialogTitle>
          <DialogDescription>
            Colle un @, un handle, ou une URL de profil (tiktok.com/@compte). Ses
            dernières vidéos seront récupérées automatiquement.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="radar-handle">Compte</Label>
            <Input
              id="radar-handle"
              autoFocus
              placeholder="@khaby.lame"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !submitting) {
                  e.preventDefault();
                  void handleAdd();
                }
              }}
            />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="radar-note">Note / tag (optionnel)</Label>
            <Input
              id="radar-note"
              placeholder="Ex : concurrent, inspi humour…"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button onClick={handleAdd} disabled={submitting || input.trim() === ""}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            Ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
