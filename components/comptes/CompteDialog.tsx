"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { PersonneCombobox } from "@/components/comptes/PersonneCombobox";

// listComptes enrichit chaque compte avec `personne` (lookup serveur).
export type Compte = Doc<"comptes"> & {
  personne: { prenom: string; nom: string } | null;
};
// Batch 1 Shorts — YouTube ajouté pour les Shorts (cf lib/media-type.ts).
// Carrousels restent TikTok+Instagram only ; côté comptes la table accepte
// les 3 plateformes, et la cohérence format/plateforme est validée
// uniquement au moment de créer une publication (createPublication).
type Plateforme = "TikTok" | "Instagram" | "YouTube";

/**
 * Dialog création / édition d'un compte. Extrait de app/comptes/page.tsx pour
 * être réutilisé depuis le tableau /comptes ET le header de la vue détail
 * /comptes/[compteId]. Comportement inchangé : la plateforme n'est éditable
 * qu'à la création (mode "add").
 */
export default function CompteDialog({
  open,
  onOpenChange,
  mode,
  compte,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "add" | "edit";
  compte?: Compte;
}) {
  const isEdit = mode === "edit";
  const [handle, setHandle] = useState(compte?.handle ?? "");
  const [plateforme, setPlateforme] = useState<string>(
    compte?.plateforme ?? "TikTok",
  );
  const [notes, setNotes] = useState(compte?.notes ?? "");
  const [personneId, setPersonneId] = useState<Id<"personnes"> | null>(
    compte?.personneId ?? null,
  );
  const [submitting, setSubmitting] = useState(false);

  const createCompte = useMutation(api.comptes.createCompte);
  const updateCompte = useMutation(api.comptes.updateCompte);

  // Reset state when dialog opens (especially for edit mode targeting a different compte)
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHandle(compte?.handle ?? "");
      setPlateforme(compte?.plateforme ?? "TikTok");
      setNotes(compte?.notes ?? "");
      setPersonneId(compte?.personneId ?? null);
    }
  }, [open, compte]);

  const normalizeHandle = (h: string) => {
    const trimmed = h.trim();
    if (!trimmed) return "";
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  };

  async function submit() {
    const finalHandle = normalizeHandle(handle);
    if (!finalHandle || finalHandle === "@") {
      toast.error("Handle requis");
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit && compte) {
        await updateCompte({
          id: compte._id,
          handle: finalHandle,
          notes,
          personneId,
        });
        toast.success(`${finalHandle} mis à jour`);
      } else {
        await createCompte({
          handle: finalHandle,
          plateforme: plateforme as Plateforme,
          notes,
          personneId: personneId ?? undefined,
        });
        toast.success(`${finalHandle} ajouté sur ${plateforme}`);
      }
      onOpenChange(false);
      setHandle("");
      setNotes("");
      setPersonneId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Modifier le compte" : "Nouveau compte"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Modifie le handle ou les notes. La plateforme ne peut pas changer."
              : "Ajoute un compte TikTok ou Instagram à utiliser pour publier."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="compte-handle">Handle</Label>
            <Input
              id="compte-handle"
              placeholder="@compte_pro"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              Le @ est ajouté automatiquement si tu l&apos;oublies.
            </p>
          </div>
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Plateforme</Label>
              <Select
                value={plateforme}
                onValueChange={(v) => v !== null && setPlateforme(v)}
              >
                <SelectTrigger>
                  <SelectValue>{plateforme}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TikTok">TikTok</SelectItem>
                  <SelectItem value="Instagram">Instagram</SelectItem>
                  <SelectItem value="YouTube">YouTube</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="compte-notes">Notes</Label>
            <Textarea
              id="compte-notes"
              rows={3}
              placeholder="Optionnel"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Gestionnaire</Label>
            <PersonneCombobox value={personneId} onChange={setPersonneId} />
            <p className="text-xs text-slate-500">
              Optionnel — qui gère ce compte.
            </p>
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
            {isEdit ? "Enregistrer" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
