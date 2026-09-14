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
import { useTranslations } from "next-intl";

/**
 * Ajout d'un compte favori au Radar. Accepte un @, un handle nu, ou une URL de
 * profil tiktok.com/@x (normalisé serveur). Déclenche un 1er sync immédiat. Si la
 * limite douce est atteinte, on ajoute quand même et on affiche un avertissement.
 */
export function AddRadarAccountDialog() {
  const tr = useTranslations("admin.ops.AddRadarAccountDialog");
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
      toast.success(tr("compteAjouteSynchronisationLancee"));
      if (warning) toast.warning(warning);
      setInput("");
      setNote("");
      setOpen(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, tr("ajoutImpossible")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon className="size-4" />
        {tr("ajouterUnCompte")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("suivreUnCompteTiktok")}</DialogTitle>
          <DialogDescription>
            {tr("colleUnUnHandleOu")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="radar-handle">{tr("compte")}</Label>
            <Input
              id="radar-handle"
              autoFocus
              // i18n-exempt: exemple de handle TikTok, pas du texte
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
            <Label htmlFor="radar-note">{tr("noteTagOptionnel")}</Label>
            <Input
              id="radar-note"
              placeholder={tr("exConcurrentInspiHumour")}
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
            {tr("annuler")}
          </Button>
          <Button onClick={handleAdd} disabled={submitting || input.trim() === ""}>
            {submitting && <Loader2Icon className="size-4 animate-spin" />}
            {tr("ajouter")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
