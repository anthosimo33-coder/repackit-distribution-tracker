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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

const MAX_NAME_LENGTH = 80;

/**
 * Dialog single-step création/édition de personne (gestionnaire). Adapté de
 * FolderEditDialog : wrapper qui fetch en mode edit (single-shot via
 * listPersonnes) + form interne keyed par id pour initialiser useState sans
 * useEffect-set-state.
 *
 * `onCreated` permet au PersonneCombobox de sélectionner automatiquement la
 * personne fraîchement créée (sub-dialog inline). `initialPrenom` /
 * `initialNom` préremplissent en mode create (cas du query single-word du
 * combobox → prénom prérempli, nom à compléter).
 */
export function PersonneEditDialog({
  open,
  onOpenChange,
  mode,
  personneId,
  onCreated,
  initialPrenom,
  initialNom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  personneId?: Id<"personnes">;
  onCreated?: (id: Id<"personnes">) => void;
  initialPrenom?: string;
  initialNom?: string;
}) {
  const personnes = useQuery(api.personnes.listPersonnes, {});
  const personne =
    mode === "edit" && personneId !== undefined
      ? personnes?.find((p) => p._id === personneId)
      : null;

  const isLoadingEdit = mode === "edit" && personnes === undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        {isLoadingEdit ? (
          <div className="space-y-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <PersonneEditDialogForm
            key={personne?._id ?? "create"}
            mode={mode}
            initialPersonne={personne ?? null}
            initialPrenom={initialPrenom}
            initialNom={initialNom}
            onCreated={onCreated}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PersonneEditDialogForm({
  mode,
  initialPersonne,
  initialPrenom,
  initialNom,
  onCreated,
  onClose,
}: {
  mode: "create" | "edit";
  initialPersonne: {
    _id: Id<"personnes">;
    prenom: string;
    nom: string;
  } | null;
  initialPrenom?: string;
  initialNom?: string;
  onCreated?: (id: Id<"personnes">) => void;
  onClose: () => void;
}) {
  const isEdit = mode === "edit";
  const [prenom, setPrenom] = useState(
    initialPersonne?.prenom ?? initialPrenom ?? "",
  );
  const [nom, setNom] = useState(initialPersonne?.nom ?? initialNom ?? "");
  const [submitting, setSubmitting] = useState(false);

  const createPersonne = useMutation(api.personnes.createPersonne);
  const updatePersonne = useMutation(api.personnes.updatePersonne);

  const trimmedPrenom = prenom.trim();
  const trimmedNom = nom.trim();
  const canSubmit =
    trimmedPrenom.length > 0 &&
    trimmedNom.length > 0 &&
    trimmedPrenom.length <= MAX_NAME_LENGTH &&
    trimmedNom.length <= MAX_NAME_LENGTH &&
    !submitting;

  async function handleSave() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (isEdit && initialPersonne) {
        await updatePersonne({
          id: initialPersonne._id,
          prenom: trimmedPrenom,
          nom: trimmedNom,
        });
        toast.success("Personne modifiée");
      } else {
        const newId = await createPersonne({
          prenom: trimmedPrenom,
          nom: trimmedNom,
        });
        toast.success(`${trimmedPrenom} ${trimmedNom} ajouté·e`);
        onCreated?.(newId);
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Modifier la personne" : "Nouvelle personne"}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Mets à jour le prénom ou le nom."
            : "Ajoute une personne pour l'assigner comme gestionnaire de comptes."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="personne-prenom">Prénom *</Label>
        <Input
          id="personne-prenom"
          autoFocus
          maxLength={MAX_NAME_LENGTH}
          placeholder="Ex: Antoine"
          value={prenom}
          onChange={(e) => setPrenom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) handleSave();
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="personne-nom">Nom *</Label>
        <Input
          id="personne-nom"
          maxLength={MAX_NAME_LENGTH}
          placeholder="Ex: Durand"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) handleSave();
          }}
        />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={handleSave} disabled={!canSubmit}>
          {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          Enregistrer
        </Button>
      </DialogFooter>
    </>
  );
}
