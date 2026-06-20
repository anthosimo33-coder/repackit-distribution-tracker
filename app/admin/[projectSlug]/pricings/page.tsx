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
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { formatEuros } from "@/lib/format-rate";
import type { FunctionReturnType } from "convex/server";

type Pricing = FunctionReturnType<typeof api.pricing.listPricings>[number];

const EMPTY = {
  name: "",
  montantFixe: "",
  nbVideosCible: "",
  tauxCPM: "",
  seuilBonusVues: "",
  montantBonus: "",
};

/**
 * Admin — barèmes de paie (pricings) du projet. CRUD : créer / modifier /
 * archiver / supprimer (si non utilisé). Modèle : fixe mensuel par vidéo unique
 * + CPM (€/1000 vues) + bonus au seuil (cf lib/pricing-engine).
 */
export default function PricingsPage() {
  const pricings = useProjectQuery(api.pricing.listPricings, {
    includeArchived: true,
  });
  const create = useProjectMutation(api.pricing.createPricing);
  const update = useProjectMutation(api.pricing.updatePricing);
  const archive = useProjectMutation(api.pricing.archivePricing);
  const remove = useProjectMutation(api.pricing.deletePricing);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Pricing | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY });
    setOpen(true);
  }
  function openEdit(p: Pricing) {
    setEditing(p);
    setForm({
      name: p.name,
      montantFixe: String(p.montantFixe),
      nbVideosCible: String(p.nbVideosCible),
      tauxCPM: String(p.tauxCPM),
      seuilBonusVues: String(p.seuilBonusVues),
      montantBonus: String(p.montantBonus),
    });
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const args = {
      name: form.name.trim(),
      montantFixe: Number(form.montantFixe),
      nbVideosCible: Number(form.nbVideosCible),
      tauxCPM: Number(form.tauxCPM),
      seuilBonusVues: Number(form.seuilBonusVues),
      montantBonus: Number(form.montantBonus),
    };
    setBusy(true);
    try {
      if (editing) await update({ id: editing._id, ...args });
      else await create(args);
      toast.success(editing ? "Pricing mis à jour" : "Pricing créé");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(p: Pricing) {
    try {
      await archive({ id: p._id, archived: p.status === "active" });
      toast.success(p.status === "active" ? "Pricing archivé" : "Pricing réactivé");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function handleDelete(p: Pricing) {
    try {
      await remove({ id: p._id });
      toast.success("Pricing supprimé");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
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
                  Fixe {formatEuros(p.montantFixe)} pour {p.nbVideosCible} vidéos
                  {" · "}CPM {formatEuros(p.tauxCPM)}/1000 vues{" · "}Bonus{" "}
                  {formatEuros(p.montantBonus)} au-delà de{" "}
                  {p.seuilBonusVues.toLocaleString("fr-FR")} vues
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
              <Field label="Seuil bonus (vues)" id="seuilBonusVues">
                <Input
                  id="seuilBonusVues"
                  type="number"
                  min={0}
                  value={form.seuilBonusVues}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, seuilBonusVues: e.target.value }))
                  }
                  required
                />
              </Field>
              <Field label="Montant bonus (€)" id="montantBonus">
                <Input
                  id="montantBonus"
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.montantBonus}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, montantBonus: e.target.value }))
                  }
                  required
                />
              </Field>
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
