"use client";

import { useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { formatMoney } from "@/lib/format-rate";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";

type Pricing = FunctionReturnType<typeof api.pricing.listPricings>[number];

type TierForm = {
  seuilVues: string;
  rewardType: "cash" | "nature";
  montant: string;
  libelle: string;
};

const EMPTY = {
  name: "",
  montantFixe: "",
  nbVideosCible: "",
  tauxCPM: "",
};

/**
 * Admin — barèmes de paie (pricings) du projet. CRUD : créer / modifier /
 * archiver / supprimer (si non utilisé). Modèle : fixe mensuel par vidéo unique
 * + CPM ($/1000 vues) + bonus au seuil (cf lib/pricing-engine).
 */
export default function PricingsPage() {
  const pricings = useProjectQuery(api.pricing.listPricings, {
    includeArchived: true,
  });
  const create = useProjectMutation(api.pricing.createPricing);
  const update = useProjectMutation(api.pricing.updatePricing);
  const archive = useProjectMutation(api.pricing.archivePricing);
  const remove = useProjectMutation(api.pricing.deletePricing);
  const defaultBonusId = useProjectQuery(
    api.pricing.getDefaultBonusPricingId,
    {},
  );
  const setDefaultBonus = useProjectMutation(api.pricing.setDefaultBonusPricing);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Pricing | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [tiers, setTiers] = useState<TierForm[]>([]);
  const [busy, setBusy] = useState(false);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY });
    setTiers([]);
    setOpen(true);
  }
  function openEdit(p: Pricing) {
    setEditing(p);
    setForm({
      name: p.name,
      montantFixe: String(p.montantFixe),
      nbVideosCible: String(p.nbVideosCible),
      tauxCPM: String(p.tauxCPM),
    });
    setTiers(
      (p.bonusTiers ?? []).map((t) => ({
        seuilVues: String(t.seuilVues),
        rewardType: t.rewardType,
        montant: t.montant != null ? String(t.montant) : "",
        libelle: t.libelle ?? "",
      })),
    );
    setOpen(true);
  }

  function addTier() {
    setTiers((ts) => [
      ...ts,
      { seuilVues: "", rewardType: "cash", montant: "", libelle: "" },
    ]);
  }
  function updateTier(i: number, patch: Partial<TierForm>) {
    setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }
  function removeTier(i: number) {
    setTiers((ts) => ts.filter((_, j) => j !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const bonusTiers = tiers.map((t) => ({
      seuilVues: Number(t.seuilVues),
      rewardType: t.rewardType,
      montant: t.rewardType === "cash" ? Number(t.montant) : undefined,
      libelle: t.rewardType === "nature" ? t.libelle.trim() : undefined,
    }));
    const args = {
      name: form.name.trim(),
      montantFixe: Number(form.montantFixe),
      nbVideosCible: Number(form.nbVideosCible),
      tauxCPM: Number(form.tauxCPM),
      bonusTiers,
    };
    setBusy(true);
    try {
      if (editing) await update({ id: editing._id, ...args });
      else await create(args);
      toast.success(editing ? "Pricing mis à jour" : "Pricing créé");
      setOpen(false);
    } catch (err) {
      toast.error(convexErrorMessage(err, "Une erreur est survenue."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(p: Pricing) {
    try {
      await archive({ id: p._id, archived: p.status === "active" });
      toast.success(p.status === "active" ? "Pricing archivé" : "Pricing réactivé");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }

  async function handleDelete(p: Pricing) {
    try {
      await remove({ id: p._id });
      toast.success("Pricing supprimé");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }

  async function handleSetDefaultBonus(value: string | null) {
    const none = value === null || value === "none";
    try {
      const res = await setDefaultBonus({
        pricingId: none ? null : (value as Id<"pricings">),
      });
      toast.success(
        none
          ? "Grille de bonus par défaut retirée"
          : `Grille par défaut appliquée${
              res.synced > 0
                ? ` · ${res.synced} créatrice${res.synced > 1 ? "s" : ""} concernée${res.synced > 1 ? "s" : ""}`
                : ""
            }`,
      );
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Pricings
          </h1>
          <p className="text-sm text-slate-500">
            Barèmes de paie : fixe mensuel par vidéo + CPM aux vues + bonus seuil.
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon className="mr-2 size-4" />
          Nouveau pricing
        </Button>
      </header>

      {/* Grille de bonus par défaut du projet — héritée par les créatrices sans
          grille perso (échelle de progression + déblocage des bonus). */}
      {pricings &&
        pricings.some(
          (p) => p.status === "active" && (p.bonusTiers?.length ?? 0) > 0,
        ) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Grille de bonus par défaut du projet
              </CardTitle>
              <CardDescription>
                Les créatrices sans grille perso en héritent (échelle de
                progression + déblocage des bonus). Ajouter un palier ici
                s&apos;applique à toutes, sans réassignation. Une grille perso de
                créatrice prime sur ce défaut.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={defaultBonusId ?? "none"}
                onValueChange={handleSetDefaultBonus}
              >
                <SelectTrigger
                  className="w-full sm:w-96"
                  aria-label="Grille de bonus par défaut du projet"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    Aucune (grille par créatrice)
                  </SelectItem>
                  {pricings
                    .filter(
                      (p) =>
                        p.status === "active" &&
                        (p.bonusTiers?.length ?? 0) > 0,
                    )
                    .map((p) => (
                      <SelectItem key={p._id} value={p._id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}

      {pricings === undefined ? (
        <Skeleton className="h-40 w-full" />
      ) : pricings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            Aucun pricing. Crée ton premier barème de paie.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {pricings.map((p) => (
            <Card key={p._id} className={p.status === "archived" ? "opacity-60" : ""}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    {p.name}
                    {p.status === "archived" && (
                      <span className="ml-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
                        Archivé
                      </span>
                    )}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                      Modifier
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => toggleArchive(p)}>
                      {p.status === "active" ? "Archiver" : "Réactiver"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(p)}>
                      Supprimer
                    </Button>
                  </div>
                </div>
                <CardDescription>
                  Fixe {formatMoney(p.montantFixe)} pour {p.nbVideosCible} vidéos
                  {" · "}CPM {formatMoney(p.tauxCPM)}/1000 vues
                  {(p.bonusTiers ?? []).length > 0 && (
                    <>
                      {" · "}
                      {(p.bonusTiers ?? [])
                        .map(
                          (t) =>
                            `${t.seuilVues.toLocaleString("fr-FR")} → ${
                              t.rewardType === "cash"
                                ? formatMoney(t.montant ?? 0)
                                : (t.libelle ?? "récompense")
                            }`,
                        )
                        .join(" · ")}
                    </>
                  )}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Modifier le pricing" : "Nouveau pricing"}
            </DialogTitle>
            <DialogDescription>
              Modifier un pricing n&apos;affecte que les FUTURES attributions (les
              vidéos déjà attribuées gardent leur barème figé).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Nom" id="name">
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Montant fixe (€)" id="montantFixe">
                <Input
                  id="montantFixe"
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.montantFixe}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, montantFixe: e.target.value }))
                  }
                  required
                />
              </Field>
              <Field label="Nb vidéos cible" id="nbVideosCible">
                <Input
                  id="nbVideosCible"
                  type="number"
                  min={1}
                  value={form.nbVideosCible}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nbVideosCible: e.target.value }))
                  }
                  required
                />
              </Field>
              <Field label="CPM (€/1000 vues)" id="tauxCPM">
                <Input
                  id="tauxCPM"
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.tauxCPM}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, tauxCPM: e.target.value }))
                  }
                  required
                />
              </Field>
            </div>

            {/* Paliers de bonus (cumul de vues À VIE du créateur) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Paliers de bonus (cumul de vues)</Label>
                <Button type="button" variant="outline" size="sm" onClick={addTier}>
                  + Palier
                </Button>
              </div>
              {tiers.length === 0 && (
                <p className="text-xs text-slate-400">
                  Aucun palier. Ajoute des paliers cash (€) ou nature (iPhone…).
                </p>
              )}
              {tiers.map((t, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-2">
                  <div className="min-w-[7rem] flex-1 space-y-1">
                    <Label className="text-xs">Seuil de vues</Label>
                    <Input
                      type="number"
                      min={0}
                      value={t.seuilVues}
                      onChange={(e) => updateTier(i, { seuilVues: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={t.rewardType}
                      onValueChange={(v) =>
                        v && updateTier(i, { rewardType: v as "cash" | "nature" })
                      }
                    >
                      <SelectTrigger aria-label="Type de récompense" className="w-28">
                        <SelectValue>
                          {t.rewardType === "cash" ? "Cash €" : "Nature"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash €</SelectItem>
                        <SelectItem value="nature">Nature</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-[8rem] flex-1 space-y-1">
                    {t.rewardType === "cash" ? (
                      <>
                        <Label className="text-xs">Montant ($)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          value={t.montant}
                          onChange={(e) => updateTier(i, { montant: e.target.value })}
                          required
                        />
                      </>
                    ) : (
                      <>
                        <Label className="text-xs">Libellé</Label>
                        <Input
                          placeholder="iPhone 15"
                          value={t.libelle}
                          onChange={(e) => updateTier(i, { libelle: e.target.value })}
                          required
                        />
                      </>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeTier(i)}
                  >
                    Retirer
                  </Button>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                {editing ? "Enregistrer" : "Créer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
