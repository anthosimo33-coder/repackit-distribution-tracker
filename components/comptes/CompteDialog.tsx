"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { fr } from "date-fns/locale";
import { CalendarIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getEffectiveStatus,
  getWarmupDuration,
  isWarmupCompleteForCompte,
  type CompteStatus,
  type Plateforme,
} from "@/lib/compte-status";
import { PersonneCombobox } from "@/components/comptes/PersonneCombobox";

// listComptes enrichit chaque compte avec `personne`, `creator` (propriétaire)
// et `perf` (agrégat publications). Lookups/agrégation serveur (P5).
export type Compte = Doc<"comptes"> & {
  personne: { prenom: string; nom: string } | null;
  creator: { name: string } | null;
  perf: { vuesCumulees: number; nbPublies: number; dernierPost: number | null };
};

const STATUS_OPTIONS: { value: CompteStatus; label: string; dot: string }[] = [
  { value: "warmup", label: "Warmup", dot: "bg-amber-500" },
  { value: "actif", label: "Actif", dot: "bg-emerald-500" },
  { value: "shadowban", label: "Shadowban", dot: "bg-rose-500" },
  { value: "archived", label: "Archivé", dot: "bg-slate-400" },
];

function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Dialog création / édition d'un compte. Statut opérationnel via Select (4
 * états) ; si "warmup", un date picker conditionnel saisit warmupStartedAt et
 * un info-badge rappelle la durée de warmup de la plateforme. En édition, un
 * compte warmup arrivé à terme expose un bouton "Passer en actif" (raccourci).
 * La plateforme n'est éditable qu'à la création (mode "add").
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
  const [status, setStatus] = useState<CompteStatus>(
    compte ? getEffectiveStatus(compte) : "actif",
  );
  const [warmupStartedAt, setWarmupStartedAt] = useState<number | null>(
    compte?.warmupStartedAt ?? null,
  );
  const [dateError, setDateError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const createCompte = useProjectMutation(api.comptes.createCompte);
  const updateCompte = useProjectMutation(api.comptes.updateCompte);

  // Reset state when dialog opens (especially for edit mode targeting a different compte)
  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setHandle(compte?.handle ?? "");
      setPlateforme(compte?.plateforme ?? "TikTok");
      setNotes(compte?.notes ?? "");
      setPersonneId(compte?.personneId ?? null);
      setStatus(compte ? getEffectiveStatus(compte) : "actif");
      setWarmupStartedAt(compte?.warmupStartedAt ?? null);
      setDateError(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open, compte]);

  const normalizeHandle = (h: string) => {
    const trimmed = h.trim();
    if (!trimmed) return "";
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  };

  function changeStatus(next: CompteStatus) {
    setStatus(next);
    setDateError(false);
    // Bascule vers warmup sans date → défaut aujourd'hui.
    if (next === "warmup" && warmupStartedAt == null) {
      setWarmupStartedAt(todayStart());
    }
  }

  const selectedStatus = STATUS_OPTIONS.find((o) => o.value === status);

  // Bouton "Passer en actif" : basé sur l'état PERSISTÉ (pas le select courant).
  const canPasserEnActif =
    isEdit &&
    compte !== undefined &&
    getEffectiveStatus(compte) === "warmup" &&
    compte.warmupStartedAt != null &&
    isWarmupCompleteForCompte(compte);

  async function passerEnActif() {
    if (!compte) return;
    setSubmitting(true);
    try {
      await updateCompte({
        id: compte._id,
        status: "actif",
        warmupStartedAt: null,
      });
      toast.success(`${compte.handle} passé en actif`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  async function submit() {
    const finalHandle = normalizeHandle(handle);
    if (!finalHandle || finalHandle === "@") {
      toast.error("Handle requis");
      return;
    }
    if (status === "warmup" && warmupStartedAt == null) {
      setDateError(true);
      toast.error("Date de début warmup requise.");
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
          status,
          warmupStartedAt: status === "warmup" ? warmupStartedAt : null,
        });
        toast.success(`${finalHandle} mis à jour`);
      } else {
        await createCompte({
          handle: finalHandle,
          plateforme: plateforme as Plateforme,
          notes,
          personneId: personneId ?? undefined,
          status,
          warmupStartedAt:
            status === "warmup" ? (warmupStartedAt ?? undefined) : undefined,
        });
        toast.success(`${finalHandle} ajouté sur ${plateforme}`);
      }
      onOpenChange(false);
      setHandle("");
      setNotes("");
      setPersonneId(null);
      setStatus("actif");
      setWarmupStartedAt(null);
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
              ? "Modifie le handle, le statut ou les notes. La plateforme ne peut pas changer."
              : "Ajoute un compte TikTok, Instagram ou YouTube à utiliser pour publier."}
          </DialogDescription>
        </DialogHeader>

        {canPasserEnActif && (
          <Button onClick={passerEnActif} disabled={submitting}>
            <CheckIcon className="mr-2 size-4" />
            Passer en actif
          </Button>
        )}

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
            <Label>Statut</Label>
            <Select
              value={status}
              onValueChange={(v) => v !== null && changeStatus(v as CompteStatus)}
            >
              <SelectTrigger aria-label="Statut">
                <SelectValue>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        selectedStatus?.dot,
                      )}
                    />
                    {selectedStatus?.label}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="flex items-center gap-2">
                      <span className={cn("size-2 rounded-full", o.dot)} />
                      {o.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {status === "warmup" && (
            <div className="space-y-1.5">
              <Label>Date de début du warmup</Label>
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        dateError && "border-rose-400",
                      )}
                    >
                      <CalendarIcon className="mr-2 size-4" />
                      {warmupStartedAt != null
                        ? new Date(warmupStartedAt).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "long",
                            year: "numeric",
                          })
                        : "Choisir une date"}
                    </Button>
                  }
                />
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={
                      warmupStartedAt != null
                        ? new Date(warmupStartedAt)
                        : undefined
                    }
                    onSelect={(d) => {
                      if (d) {
                        setWarmupStartedAt(d.getTime());
                        setDateError(false);
                      }
                    }}
                    locale={fr}
                    weekStartsOn={1}
                  />
                </PopoverContent>
              </Popover>
              {dateError ? (
                <p className="text-xs font-medium text-rose-600">
                  Date de début warmup requise.
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  Durée warmup pour {plateforme} :{" "}
                  {getWarmupDuration(plateforme as Plateforme)} jours
                </p>
              )}
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
