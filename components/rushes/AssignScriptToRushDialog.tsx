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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import { ConvexError } from "convex/values";

/**
 * Monter un script sur une prise — modale d'assignation.
 *
 * VOLONTAIREMENT TRIVIALE (arbitrage B4). Un clip sort systématiquement sur les
 * deux plateformes du clippeur : ses comptes disponibles sont donc COCHÉS PAR
 * DÉFAUT, et le choix reste possible sans être un écran de sélection. Le tirage
 * du script est automatique (anti-coordination least-used) ; la garde D7 filtre
 * en amont les briques à dire, et le serveur renvoie le nom de la brique fautive
 * quand il n'y a plus rien de montable.
 *
 * `assignments.targets` est FIGÉ à la création (modèle partagé avec les
 * partenaires) : ce qui est coché ici ne se change plus après.
 */

const JOUR = 86_400_000;

/** Échéance par défaut : dans 3 jours, au format d'un <input type="date">. */
function defaultDueDate(): string {
  return new Date(Date.now() + 3 * JOUR).toISOString().slice(0, 10);
}

/**
 * Avertissement de phase d'un compte de clippeur, ou `null`.
 *
 * INFORMATIF : le compte reste cochable. Un compte en chauffe est `available`
 * (statut actif) mais son quota du jour est 0 — sans cette mention, l'assignation
 * passe et c'est la publication qui refusera, sans que rien ne l'ait annoncé.
 * `null` pour un partenaire : le modèle de phase ne le concerne pas.
 */
function phaseHint(c: {
  phase: string | null;
  postsPerDay: number | null;
  sortieDeChauffeAt: number | null;
}): string | null {
  if (c.phase === null || c.postsPerDay === null || c.postsPerDay > 0) return null;
  return c.sortieDeChauffeAt !== null
    ? `En chauffe jusqu'au ${formatDate(c.sortieDeChauffeAt)} — la publication sera refusée.`
    : "Aucune publication possible dans cette phase.";
}

export function AssignScriptToRushDialog({
  rushId,
  talentName,
  clipperId,
  clipperName,
  open,
  onOpenChange,
}: {
  rushId: Id<"rushes">;
  talentName: string;
  clipperId: Id<"creators">;
  clipperName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const campaigns = useProjectQuery(api.scripts.listCampaigns, {});
  const comptes = useProjectQuery(
    api.comptes.listCreatorAvailableComptes,
    open ? { creatorId: clipperId } : "skip",
  );
  const assign = useProjectMutation(api.scripts.assignScriptToRush);

  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);

  const actives = useMemo(
    () => (campaigns ?? []).filter((c) => c.status !== "archived"),
    [campaigns],
  );
  const available = useMemo(
    () => (comptes ?? []).filter((c) => c.available),
    [comptes],
  );

  // Les deux valeurs par défaut sont DÉRIVÉES, pas synchronisées par un effet :
  // on ne mémorise que l'écart explicite de l'admin (la campagne qu'il a
  // choisie, les comptes qu'il a DÉcochés). Un effet qui poserait l'état par
  // défaut se rejouerait à chaque arrivée de données et écraserait sa saisie.
  const [campaignChoice, setCampaignChoice] = useState("");
  const campaignId = campaignChoice || actives[0]?._id || "";

  // Comptes cochés par DÉFAUT (B4 : un clip sort sur les deux plateformes,
  // décocher est l'exception) → on stocke les décochés.
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const isChecked = (id: string) => !unchecked.has(id);
  const toggle = (id: string, next: boolean) =>
    setUnchecked((prev) => {
      const out = new Set(prev);
      if (next) out.delete(id);
      else out.add(id);
      return out;
    });

  const targets = available
    .filter((c) => isChecked(c._id))
    .map((c) => ({ platform: c.plateforme, accountId: c._id }));

  async function submit() {
    if (!campaignId || targets.length === 0) return;
    setBusy(true);
    try {
      await assign({
        rushId,
        campaignId: campaignId as Id<"scriptCampaigns">,
        targets,
        dueDate: new Date(`${dueDate}T12:00:00Z`).getTime(),
        instructions: instructions.trim() || undefined,
      });
      toast.success(`Script monté — clip assigné à ${clipperName}.`);
      onOpenChange(false);
    } catch (e) {
      // Le serveur nomme la brique fautive quand D7 bloque : on affiche son
      // message tel quel plutôt qu'un « échec » générique.
      toast.error(
        e instanceof ConvexError && typeof e.data === "string"
          ? e.data
          : "Assignation impossible.",
        { duration: 10_000 },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Monter un script sur cette prise</DialogTitle>
          <DialogDescription>
            Prise de {talentName} — le clip sera assigné à {clipperName}.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="rush-campaign">Campagne de scripts</Label>
            {campaigns === undefined ? (
              <Skeleton className="h-9 w-full" />
            ) : actives.length === 0 ? (
              <p className="text-sm text-slate-500">
                Aucune campagne active dans ce projet.
              </p>
            ) : (
              <Select
                value={campaignId}
                onValueChange={(v) => v !== null && setCampaignChoice(v)}
              >
                <SelectTrigger id="rush-campaign">
                  <SelectValue placeholder="Choisir une campagne" />
                </SelectTrigger>
                <SelectContent>
                  {actives.map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="min-w-0 space-y-2">
            <Label>Comptes de publication</Label>
            {comptes === undefined ? (
              <Skeleton className="h-16 w-full" />
            ) : available.length === 0 ? (
              <p className="text-sm text-slate-500">
                {clipperName} n&apos;a aucun compte disponible : ses comptes sont
                en chauffe, archivés, ou pas encore validés.
              </p>
            ) : (
              <div className="space-y-2">
                {available.map((c) => (
                  <label
                    key={c._id}
                    className="flex items-start gap-2 text-sm text-slate-700"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={isChecked(c._id)}
                      onCheckedChange={(v) => toggle(c._id, v === true)}
                    />
                    {/* L'avertissement est SOUS le pseudo, hors du `truncate` :
                        dans la largeur d'une modale il serait le premier coupé,
                        alors que c'est précisément lui le message. */}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {c.handle}{" "}
                        <span className="text-slate-400">({c.plateforme})</span>
                      </span>
                      {phaseHint(c) !== null && (
                        <span className="block text-xs text-amber-700">
                          {phaseHint(c)}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-2">
            <Label htmlFor="rush-due">Échéance</Label>
            <Input
              id="rush-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="min-w-0 space-y-2">
            <Label htmlFor="rush-instructions">
              Consigne de montage (optionnelle)
            </Label>
            <Textarea
              id="rush-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              placeholder="Ex. : garde les 3 premières secondes, coupe le silence à la fin."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !campaignId || targets.length === 0}
          >
            Monter le script
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
