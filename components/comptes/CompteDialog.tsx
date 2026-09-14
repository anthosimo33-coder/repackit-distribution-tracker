"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
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
import { Switch } from "@/components/ui/switch";
import { type CountryCode } from "@/lib/countries";
import { CountryPicker, COUNTRY_NONE } from "@/components/comptes/CountryPicker";
import { useTranslations } from "next-intl";
import { useLabel } from "@/lib/use-label";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { dateFnsLocale } from "@/lib/date-fns-locale";
import { useConvexError } from "@/lib/use-convex-error";

// listComptes enrichit chaque compte avec `personne`, `creator` (propriétaire)
// et `perf` (agrégat publications). Lookups/agrégation serveur (P5).
export type Compte = Doc<"comptes"> & {
  personne: { prenom: string; nom: string } | null;
  creator: { name: string } | null;
  perf: { vuesCumulees: number; nbPublies: number; dernierPost: number | null };
  // Chantier D — `true` si le compte est référencé (assignment/publication/…).
  // Fourni par listComptes ; absent ailleurs (page détail) → plateforme reste
  // non modifiable par prudence.
  inUse?: boolean;
  /**
   * Durée de warmup RÉSOLUE PAR LE SERVEUR (barème du projet + surcharge du
   * compte) et warmup terminé. Servis par `listComptes` : les écrans les
   * LISENT, ils ne les recalculent pas — un calcul client redeviendrait une
   * seconde source de vérité, divergente au premier changement de barème.
   */
  targetDays: number;
  warmupDone: boolean;
  /**
   * Fuseau (IANA) de la créatrice PROPRIÉTAIRE du compte, résolu par le serveur
   * — `null` quand il est encore à définir.
   *
   * Servi pour la même raison que `targetDays` : tout écran qui compte des
   * JOURS (jours manqués, « déjà coché aujourd'hui », « en retard ») doit le
   * faire dans l'horloge de la créatrice. Le recalculer côté navigateur le
   * ferait dans celle de l'équipe — c'est exactement le défaut corrigé par le
   * chantier fuseaux (cf docs/diagnostic-fuseaux.md).
   */
  creatorTimezone: string | null;
};

// Libellés : les clés du portail (`status.compte.*`), les mêmes que la créatrice lit.
const STATUS_OPTIONS: { value: CompteStatus; labelKey: string; dot: string }[] = [
  { value: "warmup", labelKey: "status.compte.warmup", dot: "bg-amber-500" },
  { value: "actif", labelKey: "status.compte.actif", dot: "bg-emerald-500" },
  { value: "shadowban", labelKey: "status.compte.shadowban", dot: "bg-rose-500" },
  { value: "archived", labelKey: "status.compte.archive", dot: "bg-slate-400" },
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
  const showError = useConvexError();
  const loc = useIntlLocale();
  const tr = useTranslations("admin.common.CompteDialog");
  const tLabel = useLabel();
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
  // Mode « géré par l'équipe » — modifiable uniquement en édition d'un compte
  // rattaché à une créatrice (managed ⇒ creatorId requis, imposé serveur).
  const [managedByAdmin, setManagedByAdmin] = useState<boolean>(
    compte?.managedByAdmin ?? false,
  );
  // Pays ciblé (label informatif) — code de la liste fermée ou sentinelle NONE.
  const [targetCountry, setTargetCountry] = useState<string>(
    compte?.targetCountry ?? COUNTRY_NONE,
  );
  const [dateError, setDateError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Pays DÉJÀ POSÉS sur les autres comptes du projet — remontés en tête du
  // sélecteur. La query est celle de la page Comptes d'où le dialog s'ouvre :
  // Convex la sert depuis son cache, sans aller-retour. Absente (dialog ouvert
  // depuis une fiche créatrice), le sélecteur rend simplement la liste entière.
  const comptes = useProjectQuery(api.comptes.listComptes, {});
  const paysDejaUtilises = useMemo(
    () => [
      ...new Set(
        (comptes ?? []).flatMap((c) =>
          c.targetCountry ? [c.targetCountry as string] : [],
        ),
      ),
    ],
    [comptes],
  );

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
      setManagedByAdmin(compte?.managedByAdmin ?? false);
      setTargetCountry(compte?.targetCountry ?? COUNTRY_NONE);
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

  // Chantier D — plateforme éditable à la création (add) OU en édition SI le
  // compte est VIERGE (inUse === false). Sinon read-only (changer la plateforme
  // d'un compte utilisé fausserait le tracking ; le serveur le refuse aussi).
  const plateformeEditable = !isEdit || compte?.inUse === false;

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
      toast.success(tr("passeEnActif", { handle: compte.handle }));
      onOpenChange(false);
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setSubmitting(false);
    }
  }

  async function submit() {
    const finalHandle = normalizeHandle(handle);
    if (!finalHandle || finalHandle === "@") {
      toast.error(tr("handleRequis"));
      return;
    }
    if (status === "warmup" && warmupStartedAt == null) {
      setDateError(true);
      toast.error(tr("dateDeDebutWarmupRequise"));
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
          // Chantier D — plateforme transmise seulement si éditable (compte
          // vierge) et réellement changée ; le serveur re-vérifie.
          ...(plateformeEditable && plateforme !== compte.plateforme
            ? { plateforme: plateforme as Plateforme }
            : {}),
          // Mode géré : transmis seulement pour un compte rattaché à une
          // créatrice (le toggle n'est montré que dans ce cas).
          ...(compte.creatorId ? { managedByAdmin } : {}),
          // Pays ciblé (label) : code, ou null pour « non défini » (unset).
          targetCountry:
            targetCountry === COUNTRY_NONE
              ? null
              : (targetCountry as CountryCode),
        });
        toast.success(tr("misAJour", { finalHandle: finalHandle }));
      } else {
        await createCompte({
          handle: finalHandle,
          plateforme: plateforme as Plateforme,
          notes,
          personneId: personneId ?? undefined,
          status,
          warmupStartedAt:
            status === "warmup" ? (warmupStartedAt ?? undefined) : undefined,
          targetCountry:
            targetCountry === COUNTRY_NONE
              ? undefined
              : (targetCountry as CountryCode),
        });
        toast.success(tr("ajouteSur", { finalHandle: finalHandle, plateforme: plateforme }));
      }
      onOpenChange(false);
      setHandle("");
      setNotes("");
      setPersonneId(null);
      setStatus("actif");
      setWarmupStartedAt(null);
      setTargetCountry(COUNTRY_NONE);
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? tr("modifierLeCompte") : tr("nouveauCompte")}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? tr("modifieLeHandleLeStatut")
              : tr("ajouteUnCompteTiktokInstagram")}
          </DialogDescription>
        </DialogHeader>

        {canPasserEnActif && (
          <Button onClick={passerEnActif} disabled={submitting}>
            <CheckIcon className="mr-2 size-4" />
            {tr("passerEnActif")}
          </Button>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="compte-handle">{tr("handle")}</Label>
            <Input
              id="compte-handle"
              placeholder={tr("handlePlaceholder")}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <p className="text-xs text-slate-500">
              {tr("leEstAjouteAutomatiquementSi")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>{tr("plateforme")}</Label>
            {plateformeEditable ? (
              <Select
                value={plateforme}
                onValueChange={(v) => v !== null && setPlateforme(v)}
              >
                <SelectTrigger aria-label={tr("plateforme")}>
                  <SelectValue>{plateforme}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {/* i18n-exempt: le texte EST la valeur d'enum envoyée au serveur (plateforme, v.literal côté Convex) — et une marque ne se traduit pas. */}
                  <SelectItem value="TikTok">TikTok</SelectItem>
                  {/* i18n-exempt: le texte EST la valeur d'enum envoyée au serveur (plateforme, v.literal côté Convex) — et une marque ne se traduit pas. */}
                  <SelectItem value="Instagram">Instagram</SelectItem>
                  {/* i18n-exempt: le texte EST la valeur d'enum envoyée au serveur (plateforme, v.literal côté Convex) — et une marque ne se traduit pas. */}
                  <SelectItem value="YouTube">YouTube</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <>
                <Input value={plateforme} disabled aria-label={tr("plateforme")} />
                <p className="text-xs text-slate-500">
                  {tr("plateformeNonModifiableCeCompte")}
                </p>
              </>
            )}
            {isEdit && plateformeEditable && (
              <p className="text-xs text-slate-500">
                {tr("changerLaPlateformeReinitialiseLe")}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>{tr("statut")}</Label>
            <Select
              value={status}
              onValueChange={(v) => v !== null && changeStatus(v as CompteStatus)}
            >
              <SelectTrigger aria-label={tr("statut")}>
                <SelectValue>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        selectedStatus?.dot,
                      )}
                    />
                    {selectedStatus ? tLabel(selectedStatus.labelKey) : null}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className="flex items-center gap-2">
                      <span className={cn("size-2 rounded-full", o.dot)} />
                      {tLabel(o.labelKey)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {status === "warmup" && (
            <div className="space-y-1.5">
              <Label>{tr("dateDeDebutDuWarmup")}</Label>
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
                        ? new Date(warmupStartedAt).toLocaleDateString(loc, {
                            day: "2-digit",
                            month: "long",
                            year: "numeric",
                          })
                        : tr("choisirUneDate")}
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
                    locale={dateFnsLocale(loc)}
                    weekStartsOn={1}
                  />
                </PopoverContent>
              </Popover>
              {dateError ? (
                <p className="text-xs font-medium text-rose-600">
                  {tr("dateDeDebutWarmupRequise")}
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  {tr("dureeWarmupPourJours", { plateforme: plateforme, value: getWarmupDuration(plateforme as Plateforme) })}
                </p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="compte-notes">{tr("notes")}</Label>
            <Textarea
              id="compte-notes"
              rows={3}
              placeholder={tr("optionnel")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{tr("gestionnaire")}</Label>
            <PersonneCombobox value={personneId} onChange={setPersonneId} />
            <p className="text-xs text-slate-500">
              {tr("optionnelQuiGereCeCompte")}
            </p>
          </div>
          {/* Pays ciblé — label INFORMATIF interne. Ne pilote rien (scraping et
              filtres inchangés), invisible côté créatrice. « Non défini » =
              unset. La liste est passée à 250 pays : c'est une RECHERCHE, plus
              une liste déroulante (cf CountryPicker). */}
          <div className="space-y-1.5">
            <Label>{tr("paysCible")}</Label>
            <CountryPicker
              value={targetCountry}
              onChange={setTargetCountry}
              suggestions={paysDejaUtilises}
            />
            <p className="text-xs text-slate-500">
              {tr("labelInterneInformatifNAffecte")}
            </p>
          </div>
          {/* Mode « géré par l'équipe » — uniquement en édition d'un compte
              rattaché à une créatrice. Le flag est dénormalisé à la création des
              assignments : le changer n'affecte que les FUTURS assignments. */}
          {isEdit && compte?.creatorId && (
            <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2">
              <Switch
                id="compte-managed"
                checked={managedByAdmin}
                onCheckedChange={setManagedByAdmin}
              />
              <div className="space-y-0.5">
                <Label htmlFor="compte-managed" className="cursor-pointer">
                  {tr("gereParLEquipe")}
                </Label>
                <p className="text-xs text-slate-500">
                  {tr("lEquipeTientLeCompte")}
                </p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {tr("annuler")}
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {isEdit ? tr("enregistrer") : tr("ajouter")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
