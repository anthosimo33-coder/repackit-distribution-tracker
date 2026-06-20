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
 * Chantier C — assigne une campagne de scripts à UN créateur, sur 1 à 3 CIBLES
 * (1 compte par plateforme, parmi ses comptes DISPONIBLES). Anti-coordination
 * native serveur (combos distincts jamais déjà reçus). Le rateModel saisi est
 * figé en rateSnapshot sur chaque assignment (appliqué PAR post).
 */

const TIER_ALL = "__all__";
const NONE = "__none__";
const PLATFORMS = ["TikTok", "YouTube", "Instagram"] as const;
type Platform = (typeof PLATFORMS)[number];

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
  const [creatorId, setCreatorId] = useState<string>(NONE);
  const available = useProjectQuery(
    api.comptes.listCreatorAvailableComptes,
    open && creatorId !== NONE
      ? { creatorId: creatorId as Id<"creators"> }
      : "skip",
  );
  const assign = useProjectMutation(api.scripts.assignScriptCampaign);
  const pricings = useProjectQuery(api.pricing.listPricings, open ? {} : "skip");

  const [picks, setPicks] = useState<Record<Platform, string>>({
    TikTok: NONE,
    YouTube: NONE,
    Instagram: NONE,
  });
  const [videos, setVideos] = useState("5");
  const [due, setDue] = useState(defaultDue());
  const [tier, setTier] = useState<string>(TIER_ALL);
  const [basePerPost, setBasePerPost] = useState("");
  const [viewBonus, setViewBonus] = useState("");
  const [pricingId, setPricingId] = useState<string>(NONE);
  const [submitting, setSubmitting] = useState(false);

  // Reset à l'ouverture.
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setCreatorId(NONE);
      setPicks({ TikTok: NONE, YouTube: NONE, Instagram: NONE });
      setVideos("5");
      setDue(defaultDue());
      setTier(TIER_ALL);
      setBasePerPost("");
      setViewBonus("");
      setPricingId(NONE);
    }
  }

  function changeCreator(v: string) {
    setCreatorId(v);
    setPicks({ TikTok: NONE, YouTube: NONE, Instagram: NONE });
  }

  const optionsByPlatform = (p: Platform) =>
    (available ?? []).filter((c) => c.plateforme === p && c.available);

  const targets = PLATFORMS.filter((p) => picks[p] !== NONE).map((p) => ({
    platform: p,
    accountId: picks[p] as Id<"comptes">,
  }));

  async function handleSubmit() {
    if (creatorId === NONE) {
      toast.error("Choisis un créateur.");
      return;
    }
    if (targets.length === 0) {
      toast.error("Choisis au moins un compte cible (1 plateforme).");
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
        creatorId: creatorId as Id<"creators">,
        targets,
        videosPerCreator,
        dueDate: dueMs,
        rateModel: { basePerPost: base, viewBonusPer1k: vb },
        tier: tier === TIER_ALL ? undefined : (tier as "S" | "A" | "B"),
        pricingId:
          pricingId === NONE ? undefined : (pricingId as Id<"pricings">),
      });
      toast.success(
        `${res.created} vidéo${res.created > 1 ? "s" : ""} × ${targets.length} post${targets.length > 1 ? "s" : ""} assignée${res.created > 1 ? "s" : ""}.`,
      );
      if (res.shortages.length > 0) {
        toast.warning(
          `À court de combos : ${res.shortages
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

  const total = (Number(videos) || 0) * targets.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assigner « {campaignName} »</DialogTitle>
          <DialogDescription>
            {total > 0
              ? `${Number(videos) || 0} vidéo(s) → ${total} post(s) — combos distincts (anti-coordination).`
              : "1 vidéo → N posts. Choisis le créateur puis 1 compte par plateforme."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Créateur (un seul) */}
          <div className="space-y-1.5">
            <Label>Créateur</Label>
            {creators === undefined ? (
              <Skeleton className="h-9 w-full" />
            ) : creators.length === 0 ? (
              <p className="text-sm text-slate-500">
                Aucun créateur assignable (onboardé + actif).
              </p>
            ) : (
              <Select
                value={creatorId}
                onValueChange={(v) => v && changeCreator(v)}
              >
                <SelectTrigger aria-label="Créateur">
                  <SelectValue>
                    {creatorId === NONE
                      ? "Choisir un créateur…"
                      : (creators.find((c) => c._id === creatorId)?.name ??
                        "Créateur")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {creators.map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Cibles : 1 compte par plateforme (disponibles uniquement) */}
          {creatorId !== NONE && (
            <div className="space-y-2">
              <Label>Cibles (1 compte par plateforme)</Label>
              {available === undefined ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                PLATFORMS.map((p) => {
                  const opts = optionsByPlatform(p);
                  return (
                    <div key={p} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-sm font-medium text-slate-600">
                        {p}
                      </span>
                      {opts.length === 0 ? (
                        <span className="text-xs text-slate-400">
                          aucun compte disponible — en warmup
                        </span>
                      ) : (
                        <Select
                          value={picks[p]}
                          onValueChange={(v) =>
                            v && setPicks((prev) => ({ ...prev, [p]: v }))
                          }
                        >
                          <SelectTrigger
                            className="flex-1"
                            aria-label={`Compte ${p}`}
                          >
                            <SelectValue>
                              {picks[p] === NONE
                                ? "— ne pas publier —"
                                : (opts.find((o) => o._id === picks[p])
                                    ?.handle ?? "Compte")}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>
                              — ne pas publier —
                            </SelectItem>
                            {opts.map((o) => (
                              <SelectItem key={o._id} value={o._id}>
                                {o.handle}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Vidéos par créateur + deadline */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="videos">Vidéos à produire</Label>
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
              <Label htmlFor="base">Tarif de base (€/post)</Label>
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

        <div className="space-y-1.5">
          <Label>Pricing (barème de paie)</Label>
          <Select value={pricingId} onValueChange={(v) => v && setPricingId(v)}>
            <SelectTrigger aria-label="Pricing">
              <SelectValue>
                {pricingId === NONE
                  ? "Aucun (ancien modèle)"
                  : ((pricings ?? []).find((p) => p._id === pricingId)?.name ??
                    "Pricing")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Aucun (ancien modèle)</SelectItem>
              {(pricings ?? []).map((p) => (
                <SelectItem key={p._id} value={p._id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
