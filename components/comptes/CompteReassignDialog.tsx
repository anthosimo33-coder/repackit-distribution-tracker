"use client";

import { useEffect, useState } from "react";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  Loader2Icon,
  TriangleAlertIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PersonneCombobox } from "@/components/comptes/PersonneCombobox";
import type { Compte } from "@/components/comptes/CompteDialog";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatNumber } from "@/lib/format";
import { useConvexError } from "@/lib/use-convex-error";


/** Sous-ensemble de listCreators utile au sélecteur de propriétaire. */
interface CreatorOption {
  _id: Id<"creators">;
  name: string;
  status: string;
}

/**
 * Combobox de sélection de la créatrice PROPRIÉTAIRE d'un compte (adapté de
 * PersonneCombobox, sans création inline : une créatrice se crée/s'invite depuis
 * /creators). `null` = compte INTERNE (tenu par l'équipe, sans propriétaire).
 */
function CreatorCombobox({
  value,
  onChange,
  creators,
}: {
  value: Id<"creators"> | null;
  onChange: (creatorId: Id<"creators"> | null) => void;
  /** Créateurs du projet (chargés par le dialog parent), undefined = en cours. */
  creators: CreatorOption[] | undefined;
}) {
  const tr = useTranslations("admin.common.CreatorCombobox");
  const [open, setOpen] = useState(false);
  const sorted = [...(creators ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, "fr"),
  );
  const selected = sorted.find((c) => c._id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={tr("creatriceProprietaire")}
            className="w-full justify-between text-left font-normal"
          >
            <span className="flex items-center gap-2 truncate">
              {selected ? (
                <>
                  <UserIcon className="size-4 shrink-0 text-slate-500" />
                  <span className="truncate">{selected.name}</span>
                </>
              ) : (
                <>
                  <UsersIcon className="size-4 shrink-0 text-slate-300" />
                  <span className="text-slate-500">{tr("interneEquipe")}</span>
                </>
              )}
            </span>
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent
        className="w-[var(--anchor-width,360px)] min-w-[260px] max-w-[400px] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={tr("chercheUneCreatrice")} />
          <CommandList>
            {creators === undefined ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <>
                <CommandEmpty>{tr("aucuneCreatriceTrouvee")}</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="__none__"
                    onSelect={() => {
                      onChange(null);
                      setOpen(false);
                    }}
                  >
                    <UsersIcon className="size-4 text-slate-400" />
                    <span className="text-slate-600">{tr("interneEquipe")}</span>
                    {value === null && (
                      <CheckIcon className="ml-auto size-4 opacity-100" />
                    )}
                  </CommandItem>
                  {sorted.map((c) => (
                    <CommandItem
                      key={c._id}
                      value={c.name}
                      onSelect={() => {
                        onChange(c._id);
                        setOpen(false);
                      }}
                    >
                      <UserIcon className="size-4 text-slate-500" />
                      <span className="truncate">{c.name}</span>
                      {c.status === "invited" && (
                        <span className="text-xs text-slate-400">{tr("invitee")}</span>
                      )}
                      {value === c._id && (
                        <CheckIcon className="ml-auto size-4 opacity-100" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * RÉASSIGNATION d'un compte (admin) — les deux axes de rattachement en un seul
 * écrit : propriétaire (creatorId, ou « interne »), gestionnaire (personneId) et
 * mode géré par l'équipe (managedByAdmin). Une seule mutation : updateCompte,
 * qui re-vérifie côté serveur (créatrice du projet, « géré ⇒ créatrice »).
 *
 * L'HISTORIQUE NE BOUGE PAS : les publications passées sont rapprochées par
 * HANDLE (publications.compte, string) et l'attribution créatrice vit sur
 * l'assignment (creatorId + rateSnapshot FIGÉS) — réassigner est purement
 * prospectif. Le récap l'affiche noir sur blanc, et signale les missions encore
 * en cours qui ciblent le compte (elles restent à l'ancienne propriétaire).
 */
export function CompteReassignDialog({
  compte,
  open,
  onOpenChange,
}: {
  compte: Compte;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.common.CompteReassignDialog");
  const loc = useIntlLocale();
  const updateCompte = useProjectMutation(api.comptes.updateCompte);
  // Queries gatées sur `open` : ce dialog est monté par CHAQUE ligne de la table
  // /comptes — rien ne doit être chargé tant qu'il est fermé.
  const usage = useProjectQuery(
    api.comptes.getCompteUsage,
    open ? { id: compte._id } : "skip",
  );
  const creators = useProjectQuery(
    api.creators.listCreators,
    open ? {} : "skip",
  );
  const [creatorId, setCreatorId] = useState<Id<"creators"> | null>(
    compte.creatorId ?? null,
  );
  const [personneId, setPersonneId] = useState<Id<"personnes"> | null>(
    compte.personneId ?? null,
  );
  const [managedByAdmin, setManagedByAdmin] = useState(
    compte.managedByAdmin ?? false,
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setCreatorId(compte.creatorId ?? null);
      setPersonneId(compte.personneId ?? null);
      setManagedByAdmin(compte.managedByAdmin ?? false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open, compte]);

  const nextCreatorName =
    creatorId === null
      ? null
      : ((creators ?? []).find((c) => c._id === creatorId)?.name ?? "…");
  const currentCreatorName = compte.creator?.name ?? null;
  const creatorChanged = (compte.creatorId ?? null) !== creatorId;
  const dirty =
    creatorChanged ||
    (compte.personneId ?? null) !== personneId ||
    (compte.managedByAdmin ?? false) !== managedByAdmin;

  async function submit() {
    setSubmitting(true);
    try {
      await updateCompte({
        id: compte._id,
        creatorId,
        personneId,
        // Un compte sans propriétaire ne peut pas être « géré » (garde serveur) :
        // détacher force le mode à false.
        managedByAdmin: creatorId === null ? false : managedByAdmin,
      });
      toast.success(
        creatorChanged
          ? `${compte.handle} → ${nextCreatorName ?? tr("interneEquipe2")}`
          : tr("misAJour", { handle: compte.handle }),
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent data-testid="compte-reassign-dialog">
        <DialogHeader>
          <DialogTitle>{tr("reassigner", { handle: compte.handle })}</DialogTitle>
          <DialogDescription>
            {tr("changeLaProprietaireLeGestionnaire")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="space-y-1.5">
            <Label>{tr("creatriceProprietaire")}</Label>
            <CreatorCombobox
              value={creatorId}
              onChange={setCreatorId}
              creators={creators}
            />
            <p className="text-xs text-slate-500">
              {tr("determineQuiVoitLeCompte")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>{tr("gestionnaire")}</Label>
            <PersonneCombobox value={personneId} onChange={setPersonneId} />
            <p className="text-xs text-slate-500">
              {tr("interneQuiSuitCeCompte")}
            </p>
          </div>

          {creatorId !== null && (
            <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2">
              <Switch
                id="reassign-managed"
                checked={managedByAdmin}
                onCheckedChange={setManagedByAdmin}
              />
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="reassign-managed" className="cursor-pointer">
                  {tr("gereParLEquipe")}
                </Label>
                <p className="text-xs text-slate-500">
                  {tr("lEquipeTientLeCompte")}
                </p>
              </div>
            </div>
          )}

          {/* Récap d'impact — ce qui bouge et surtout ce qui NE bouge PAS. */}
          {usage === undefined ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {creatorChanged && (
                <p className="font-medium text-slate-800">
                  {currentCreatorName ?? tr("interneEquipe")} →{" "}
                  {nextCreatorName ?? tr("interneEquipe")}
                </p>
              )}
              <p>
                {usage.publications > 0 ? (
                  <>
                    {tr("les")}{" "}<strong>{usage.publications}</strong>{" "}{tr("publicationDejaFaitesSurVues", { publications: usage.publications, handle: compte.handle, value: formatNumber(usage.views, loc) })}{" "}{currentCreatorName ?? tr("lEquipe")}{" "}{tr("laPaieDesCyclesDeja")}
                  </>
                ) : (
                  <>{tr("aucunePublicationSurCeCompte")}</>
                )}
              </p>
              {usage.openAssignments > 0 && (
                <p className="flex items-start gap-1.5 font-medium text-amber-700">
                  <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {tr("openAssignmentsStay", {
                      count: usage.openAssignments,
                      owner: currentCreatorName ?? tr("lEquipe"),
                    })}
                  </span>
                </p>
              )}
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
          <Button onClick={submit} disabled={submitting || !dirty}>
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {tr("reassigner2")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
