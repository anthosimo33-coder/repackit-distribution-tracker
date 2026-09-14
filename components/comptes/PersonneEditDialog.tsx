"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
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
import { convexErrorMessage } from "@/lib/convex-error";
import { useTranslations } from "next-intl";

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
  const personnes = useProjectQuery(api.personnes.listPersonnes, {});
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
  const tr = useTranslations("admin.common.PersonneEditDialogForm");
  const isEdit = mode === "edit";
  const [prenom, setPrenom] = useState(
    initialPersonne?.prenom ?? initialPrenom ?? "",
  );
  const [nom, setNom] = useState(initialPersonne?.nom ?? initialNom ?? "");
  const [submitting, setSubmitting] = useState(false);

  const createPersonne = useProjectMutation(api.personnes.createPersonne);
  const updatePersonne = useProjectMutation(api.personnes.updatePersonne);

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
        toast.success(tr("personneModifiee"));
      } else {
        const newId = await createPersonne({
          prenom: trimmedPrenom,
          nom: trimmedNom,
        });
        toast.success(tr("ajouteE", { trimmedPrenom: trimmedPrenom, trimmedNom: trimmedNom }));
        onCreated?.(newId);
      }
      onClose();
    } catch (e) {
      toast.error(convexErrorMessage(e, tr("uneErreurEstSurvenue")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? tr("modifierLaPersonne") : tr("nouvellePersonne")}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? tr("metsAJourLePrenom")
            : tr("ajouteUnePersonnePourL")}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="personne-prenom">{tr("prenom")}</Label>
        <Input
          id="personne-prenom"
          autoFocus
          maxLength={MAX_NAME_LENGTH}
          placeholder={tr("exAntoine")}
          value={prenom}
          onChange={(e) => setPrenom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) handleSave();
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="personne-nom">{tr("nom")}</Label>
        <Input
          id="personne-nom"
          maxLength={MAX_NAME_LENGTH}
          placeholder={tr("exDurand")}
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) handleSave();
          }}
        />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          {tr("annuler")}
        </Button>
        <Button onClick={handleSave} disabled={!canSubmit}>
          {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          {tr("enregistrer")}
        </Button>
      </DialogFooter>
    </>
  );
}
