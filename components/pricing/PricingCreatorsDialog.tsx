"use client";

import { useMemo, useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

/**
 * QUI EST SUR CETTE GRILLE — la modale qui pose le barème d'un LOT de créatrices
 * depuis l'écran Barèmes.
 *
 * Le geste existait déjà, mais fiche par fiche (onglet Rémunération) : mettre
 * huit créatrices sur la même grille demandait huit allers-retours. Ici la
 * grille est le point de départ, et la liste des créatrices l'objet du choix.
 *
 * La case cochée = « sa fiche porte CE barème ». Décocher renvoie la fiche sur
 * la grille par défaut du projet — dit en toutes lettres sous la liste, parce
 * que ce n'est pas « rien » : c'est un autre barème.
 *
 * Les créatrices qui HÉRITENT du défaut apparaissent décochées avec la mention
 * « par défaut ». Les cocher ÉPINGLE le barème sur leur fiche : même barème
 * aujourd'hui, mais il ne suivra plus un changement de défaut du projet.
 */
export function PricingCreatorsDialog({
  pricingId,
  pricingName,
  open,
  onOpenChange,
}: {
  pricingId: Id<"pricings">;
  pricingName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const creators = useProjectQuery(
    api.pricing.listCreatorPricingGrids,
    open ? {} : "skip",
  );
  const save = useProjectMutation(api.pricing.setPricingCreators);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Tant que rien n'a été coché, l'état affiché est celui du SERVEUR — dérivé, pas
  // recopié : les cases apparaissent dès que la query arrive, sans effet de
  // synchronisation, et une revalidation ne peut pas effacer un choix en cours.
  const [touched, setTouched] = useState(false);

  const initial = useMemo(
    () =>
      new Set(
        (creators ?? [])
          .filter((c) => c.pricingId === pricingId)
          .map((c) => c._id as string),
      ),
    [creators, pricingId],
  );
  const coched = touched ? selected : initial;

  // Reset à l'ouverture (pattern du dépôt : au rendu, pas dans un effet).
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    setTouched(false);
    setSelected(new Set());
    setQuery("");
  }

  const visible = (creators ?? []).filter((c) =>
    query.trim() === ""
      ? true
      : c.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const ajoutees = [...coched].filter((id) => !initial.has(id)).length;
  const retirees = [...initial].filter((id) => !coched.has(id)).length;
  const dirty = ajoutees > 0 || retirees > 0;

  function toggle(id: string) {
    const next = new Set(coched);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTouched(true);
    setSelected(next);
  }

  async function handleSave() {
    setSubmitting(true);
    try {
      const res = await save({
        pricingId,
        creatorIds: [...coched] as Id<"creators">[],
      });
      toast.success(
        `${res.added} ajoutée${res.added > 1 ? "s" : ""}, ${res.removed} retirée${
          res.removed > 1 ? "s" : ""
        }.`,
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Créatrices sur « {pricingName} »</DialogTitle>
          <DialogDescription>
            Ce barème devient le leur : il est pré-sélectionné à chaque
            assignation de script, et c&apos;est lui qui paie leurs paliers.
          </DialogDescription>
        </DialogHeader>

        {/* min-w-0 : DialogContent est une GRILLE — sans ça, un nom de barème
            long pousse la colonne au-delà de la modale au lieu d'être tronqué. */}
        <div className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pricing-creators-search" className="sr-only">
              Rechercher une créatrice
            </Label>
            <Input
              id="pricing-creators-search"
              placeholder="Rechercher une créatrice…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {creators === undefined ? (
              <div className="space-y-2 p-1">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : visible.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">
                {(creators ?? []).length === 0
                  ? "Aucune créatrice partenaire dans ce projet."
                  : "Aucune créatrice ne correspond."}
              </p>
            ) : (
              visible.map((c) => {
                const surCeBareme = coched.has(c._id);
                return (
                  <label
                    key={c._id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"
                  >
                    <Checkbox
                      checked={surCeBareme}
                      onCheckedChange={() => toggle(c._id)}
                      disabled={submitting}
                      aria-label={c.name}
                    />
                    <span className="min-w-0 flex-1 truncate text-slate-800">
                      {c.name}
                    </span>
                    {/* Sa grille ACTUELLE, dite à côté de la case : sans elle,
                        cocher revient à écraser un barème qu'on ne voit pas. */}
                    <span className="max-w-[45%] truncate text-xs text-slate-500">
                      {c.effectivePricingName === null
                        ? "aucune grille"
                        : c.inherited
                          ? `${c.effectivePricingName} (par défaut)`
                          : c.effectivePricingName}
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <p className="text-xs text-slate-500">
            Décocher une créatrice n&apos;efface pas sa rémunération : sa fiche
            repasse sur la grille par défaut du projet. Les vidéos déjà assignées
            gardent le barème figé le jour de leur attribution.
          </p>
        </div>

        <DialogFooter>
          <span className="mr-auto text-xs text-slate-500">
            {dirty
              ? `${ajoutees} à ajouter, ${retirees} à retirer`
              : "Aucun changement"}
          </span>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={submitting || !dirty}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
