"use client";

import { useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProject } from "@/components/project/ProjectProvider";
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
import { formatDate } from "@/lib/format";
import { currencySymbol } from "@/lib/currency";
import { PayCurrencyWarning } from "@/components/PayCurrencyWarning";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";

type Pricing = FunctionReturnType<typeof api.pricing.listPricings>[number];

type TierForm = {
  seuilVues: string;
  rewardType: "cash" | "nature";
  montant: string;
  libelle: string;
  /** NATURE — ce que l'objet nous coûte réellement (jamais son prix public). */
  coutReel: string;
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
  // Devise de la PAIE créatrices (dollars) — montants ET symboles des libellés
  // (fixe, CPM, cash) dérivés de projects.payCurrency, jamais codés en dur.
  const payCurrency = useProject().project.payCurrency;
  const pricings = useProjectQuery(api.pricing.listPricings, {
    includeArchived: true,
  });
  const create = useProjectMutation(api.pricing.createPricing);
  const update = useProjectMutation(api.pricing.updatePricing);
  const archive = useProjectMutation(api.pricing.archivePricing);
  const remove = useProjectMutation(api.pricing.deletePricing);
  // Assignations dont le barème FIGÉ ne correspond plus aux termes actuels du
  // pricing. Éditer un barème en place n'affecte que les futures attributions —
  // rien ne le montrait jusqu'ici, et l'écart restait invisible parce que le
  // pricingId, lui, ne change pas.
  const drift = useProjectQuery(api.pricing.listPricingSnapshotDrift, {});
  const [driftFor, setDriftFor] = useState<string | null>(null);
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
        coutReel: t.coutReel != null ? String(t.coutReel) : "",
      })),
    );
    setOpen(true);
  }

  function addTier() {
    setTiers((ts) => [
      ...ts,
      { seuilVues: "", rewardType: "cash", montant: "", libelle: "", coutReel: "" },
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
      // Coût réel : NATURE seulement, et seulement s'il est renseigné. Vide =>
      // undefined (absent), jamais 0 : « pas encore chiffré » n'est pas « gratuit ».
      coutReel:
        t.rewardType === "nature" && t.coutReel.trim() !== ""
          ? Number(t.coutReel)
          : undefined,
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
      <PayCurrencyWarning payCurrency={payCurrency} />
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
                  {/* Sans enfants, le déclencheur rend la valeur brute — ici
                      « none » ou un id Convex — au lieu du nom de la grille. */}
                  <SelectValue>
                    {defaultBonusId === "none"
                      ? "Aucune (grille par créatrice)"
                      : (pricings.find((p) => p._id === defaultBonusId)
                          ?.name ?? "Grille introuvable")}
                  </SelectValue>
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
                  Fixe {formatMoney(p.montantFixe, payCurrency)} pour{" "}
                  {p.nbVideosCible} vidéos{" · "}CPM{" "}
                  {formatMoney(p.tauxCPM, payCurrency)}/1000 vues
                  {(p.bonusTiers ?? []).length > 0 && (
                    <>
                      {" · "}
                      {(p.bonusTiers ?? [])
                        .map(
                          (t) =>
                            `${t.seuilVues.toLocaleString("fr-FR")} → ${
                              t.rewardType === "cash"
                                ? formatMoney(t.montant ?? 0, payCurrency)
                                : (t.libelle ?? "récompense")
                            }`,
                        )
                        .join(" · ")}
                    </>
                  )}
                </CardDescription>
                {(() => {
                  const d = drift?.find((x) => x.pricingId === p._id);
                  if (!d) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => setDriftFor(p._id)}
                      className="mt-1 w-fit rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-left text-xs text-amber-900 hover:bg-amber-100"
                    >
                      <span className="font-medium">
                        {d.driftCount} assignation{d.driftCount > 1 ? "s" : ""}
                      </span>{" "}
                      port{d.driftCount > 1 ? "ent" : "e"} un barème figé
                      différent de celui-ci — voir le détail
                    </button>
                  );
                })()}
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Détail de la dérive — les barèmes figés qui ne correspondent plus. */}
      <Dialog
        open={driftFor !== null}
        onOpenChange={(o) => !o && setDriftFor(null)}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          {(() => {
            const d = drift?.find((x) => x.pricingId === driftFor);
            if (!d) return null;
            const terms = (m: number, n: number, c: number) =>
              `${formatMoney(m, payCurrency)} / ${n} vidéos · CPM ${formatMoney(c, payCurrency)}`;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Barèmes figés — {d.pricingName}</DialogTitle>
                  <DialogDescription>
                    Le barème est figé à l&apos;attribution : ces assignations
                    gardent les termes en vigueur ce jour-là, et leur paie ne
                    changera pas si tu modifies le barème. Termes actuels :{" "}
                    {terms(
                      d.current.montantFixe,
                      d.current.nbVideosCible,
                      d.current.tauxCPM,
                    )}
                    .
                  </DialogDescription>
                </DialogHeader>
                {/* min-w-0 : DialogContent est une GRILLE — sans lui, l'enfant
                    prend sa largeur de contenu et le `truncate` plus bas ne
                    s'applique jamais (le dialogue déborde à l'horizontale). */}
                <div className="min-w-0 space-y-4">
                  {d.generations.map((g) => (
                    <div
                      key={`${g.montantFixe}-${g.nbVideosCible}-${g.tauxCPM}`}
                      className="space-y-1.5 rounded-md border border-slate-200 p-3"
                    >
                      <p className="text-sm font-medium text-slate-900">
                        {g.count} assignation{g.count > 1 ? "s" : ""} à{" "}
                        {terms(g.montantFixe, g.nbVideosCible, g.tauxCPM)}
                      </p>
                      <ul className="space-y-0.5 text-xs text-slate-500">
                        {g.sample.map((a) => (
                          <li key={a.assignmentId} className="flex min-w-0 gap-2">
                            <span className="w-20 shrink-0 tabular-nums">
                              {formatDate(a.createdAt)}
                            </span>
                            <span className="flex-1 truncate">{a.creatorName}</span>
                            <span className="shrink-0">{a.status}</span>
                          </li>
                        ))}
                        {g.count > g.sample.length && (
                          <li className="italic">
                            … et {g.count - g.sample.length} autre
                            {g.count - g.sample.length > 1 ? "s" : ""} (échantillon
                            borné)
                          </li>
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

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
              <Field
                label={`Montant fixe (${currencySymbol(payCurrency)})`}
                id="montantFixe"
              >
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
              <Field
                label={`CPM (${currencySymbol(payCurrency)}/1000 vues)`}
                id="tauxCPM"
              >
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
                  Aucun palier. Ajoute des paliers cash (
                  {currencySymbol(payCurrency)}) ou nature (iPhone…).
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
                          {t.rewardType === "cash"
                            ? `Cash ${currencySymbol(payCurrency)}`
                            : "Nature"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">
                          Cash {currencySymbol(payCurrency)}
                        </SelectItem>
                        <SelectItem value="nature">Nature</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-[8rem] flex-1 space-y-1">
                    {t.rewardType === "cash" ? (
                      <>
                        <Label className="text-xs">
                          Montant ({currencySymbol(payCurrency)})
                        </Label>
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
                  {/* Coût réel — NATURE seulement. Facultatif : sans lui la
                      récompense reste visible mais non chiffrée (tiret), elle
                      n'entre alors dans aucun total. Ce n'est PAS le prix public
                      et ce n'est jamais montré à la créatrice. */}
                  {t.rewardType === "nature" && (
                    <div className="min-w-[8rem] flex-1 space-y-1">
                      <Label className="text-xs">
                        Coût réel ({currencySymbol(payCurrency)})
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder="ce qu'il nous coûte"
                        value={t.coutReel}
                        onChange={(e) => updateTier(i, { coutReel: e.target.value })}
                      />
                    </div>
                  )}
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
