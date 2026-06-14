"use client";

import { useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";

/**
 * S2 — assigne une campagne de scripts à des créateurs (N créateurs × M vidéos).
 * Anti-coordination native côté serveur : chaque créateur reçoit des combos
 * distincts jamais déjà reçus. Le rateModel saisi ici est figé en rateSnapshot
 * sur chaque assignment.
 */

const TIER_ALL = "__all__";

function defaultDue(): string {
  const d = new Date(Date.now() + 7 * 86_400_000);
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD, heure locale
}

export function AssignScriptCampaignDialog({
  campaignId,
  campaignName,
  open,
  onOpenChange,
}: {
  campaignId: Id<"scriptCampaigns">;
  campaignName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const creators = useProjectQuery(
    api.assignments.listAssignableCreators,
    open ? {} : "skip",
  );
  const assign = useProjectMutation(api.scripts.assignScriptCampaign);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [videos, setVideos] = useState("5");
  const [due, setDue] = useState(defaultDue());
  const [tier, setTier] = useState<string>(TIER_ALL);
  const [basePerPost, setBasePerPost] = useState("");
  const [viewBonus, setViewBonus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset à l'ouverture.
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setSelected(new Set());
      setVideos("5");
      setDue(defaultDue());
      setTier(TIER_ALL);
      setBasePerPost("");
      setViewBonus("");
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (selected.size === 0) {
      toast.error("Sélectionne au moins un créateur.");
      return;
    }
    const videosPerCreator = Number(videos);
    if (!Number.isInteger(videosPerCreator) || videosPerCreator < 1) {
      toast.error("Nombre de vidéos invalide.");
      return;
    }
    const base = Number(basePerPost);
    if (!Number.isFinite(base) || base < 0) {
      toast.error("Tarif de base invalide.");
      return;
    }
    const dueMs = new Date(`${due}T23:59:59`).getTime();
    if (!Number.isFinite(dueMs)) {
      toast.error("Échéance invalide.");
      return;
    }
    const vb = viewBonus.trim() === "" ? undefined : Number(viewBonus);
    if (vb !== undefined && (!Number.isFinite(vb) || vb < 0)) {
      toast.error("Bonus aux vues invalide.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await assign({
        campaignId,
        creatorIds: [...selected] as Id<"creators">[],
        videosPerCreator,
        dueDate: dueMs,
        rateModel: { basePerPost: base, viewBonusPer1k: vb },
        tier: tier === TIER_ALL ? undefined : (tier as "S" | "A" | "B"),
      });
      toast.success(
        `${res.created} assignment${res.created > 1 ? "s" : ""} créé${res.created > 1 ? "s" : ""}.`,
      );
      if (res.shortages.length > 0) {
        toast.warning(
          `${res.shortages.length} créateur(s) à court de combos : ${res.shortages
            .map((s) => `${s.name} (${s.assigned}/${s.requested})`)
            .join(", ")}.`,
        );
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  const total = selected.size * (Number(videos) || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assigner « {campaignName} »</DialogTitle>
          <DialogDescription>
            {total > 0
              ? `${total} vidéo${total > 1 ? "s" : ""} au total — combos distincts par créateur (anti-coordination).`
              : "Chaque créateur reçoit des combos distincts (jamais le même deux fois)."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Créateurs */}
          <div className="space-y-1.5">
            <Label>Créateurs</Label>
            {creators === undefined ? (
              <Skeleton className="h-24 w-full" />
            ) : creators.length === 0 ? (
              <p className="text-sm text-slate-500">
                Aucun créateur assignable (onboardé + actif).
              </p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                {creators.map((c) => (
                  <li key={c._id} className="flex items-center gap-2">
                    <Checkbox
                      id={`scr-${c._id}`}
                      checked={selected.has(c._id)}
                      onCheckedChange={() => toggle(c._id)}
                    />
                    <label
                      htmlFor={`scr-${c._id}`}
                      className="text-sm text-slate-700"
                    >
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Vidéos par créateur + deadline */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="videos">Vidéos / créateur</Label>
              <Input
                id="videos"
                type="number"
                min={1}
                max={50}
                value={videos}
                onChange={(e) => setVideos(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due">Échéance</Label>
              <Input
                id="due"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
          </div>

          {/* Filtre tier + tarif */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tier">Tier de hook</Label>
              <Select value={tier} onValueChange={(v) => v && setTier(v)}>
                <SelectTrigger id="tier">
                  <SelectValue>
                    {tier === TIER_ALL ? "Tous les tiers" : `Tier ${tier}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TIER_ALL}>Tous les tiers</SelectItem>
                  <SelectItem value="S">Tier S</SelectItem>
                  <SelectItem value="A">Tier A</SelectItem>
                  <SelectItem value="B">Tier B</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="base">Tarif de base (€/vidéo)</Label>
              <Input
                id="base"
                type="number"
                min={0}
                step="0.01"
                value={basePerPost}
                onChange={(e) => setBasePerPost(e.target.value)}
                placeholder="Ex. 10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vb">Bonus aux vues (€ / 1 000 vues, optionnel)</Label>
            <Input
              id="vb"
              type="number"
              min={0}
              step="0.01"
              value={viewBonus}
              onChange={(e) => setViewBonus(e.target.value)}
              placeholder="Ex. 2"
            />
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
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Assigner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
