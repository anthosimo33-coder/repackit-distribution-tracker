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
import { SCRIPT_TIERS, tierLabel } from "@/lib/script-tier";

/**
 * Chantier C — assigne une campagne de scripts à UN créateur, sur 1 à 3 CIBLES
 * (1 compte par plateforme, parmi ses comptes DISPONIBLES). Anti-coordination
 * native serveur (combos distincts jamais déjà reçus). Le barème de paie vient
 * EXCLUSIVEMENT du pricing OBLIGATOIRE (fixe/CPM/paliers), figé en
 * pricingSnapshot ; les anciens champs tarif de base / bonus aux vues sont retirés.
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

  // Combos UNIQUES encore attribuables à ce créateur sur les plateformes
  // choisies (unicité comboKey × créateur × plateforme). Sert à prévenir AVANT
  // d'assigner s'il en manque pour le nombre de vidéos demandé.
  const combosInfo = useProjectQuery(
    api.scripts.availableCombosForAssignment,
    open && creatorId !== NONE && targets.length > 0
      ? {
          campaignId,
          creatorId: creatorId as Id<"creators">,
          platforms: targets.map((t) => t.platform),
          tier: tier === TIER_ALL ? undefined : (tier as "S" | "A"),
        }
      : "skip",
  );

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
    const dueMs = new Date(`${due}T23:59:59`).getTime();
    if (!Number.isFinite(dueMs)) {
      toast.error("Échéance invalide.");
      return;
    }
    if (pricingId === NONE) {
      toast.error("Le barème de paie est requis.");
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
        tier: tier === TIER_ALL ? undefined : (tier as "S" | "A"),
        pricingId: pricingId as Id<"pricings">,
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
  const need = Number(videos) || 0;
  const platformsLabel = targets.map((t) => t.platform).join(", ");
  const lacksCombos = combosInfo !== undefined && need > combosInfo.available;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Assigner « {campaignName} »</DialogTitle>
          <DialogDescription>
            {total > 0
              ? `${Number(videos) || 0} vidéo(s) → ${total} post(s) — combos distincts (anti-coordination).`
              : "1 vidéo → N posts. Choisis le créateur puis 1 compte par plateforme."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
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
          <div className="grid grid-cols-2 gap-4">
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

          {/* Combos uniques disponibles (unicité comboKey × créateur × plateforme) */}
          {creatorId !== NONE &&
            targets.length > 0 &&
            combosInfo !== undefined && (
              <p
                className={`text-xs ${lacksCombos ? "text-amber-600" : "text-slate-500"}`}
                data-testid="combo-availability"
              >
                {lacksCombos
                  ? `Plus assez de combos uniques pour ce créateur sur ${platformsLabel} — ${combosInfo.available} restant${combosInfo.available > 1 ? "s" : ""} pour ${need} demandée${need > 1 ? "s" : ""}. Seuls les combos uniques seront assignés (pas de doublon).`
                  : `${combosInfo.available} combo${combosInfo.available > 1 ? "s" : ""} unique${combosInfo.available > 1 ? "s" : ""} disponible${combosInfo.available > 1 ? "s" : ""} pour ce créateur sur ${platformsLabel}.`}
              </p>
            )}

          {/* Filtre tier de hook + barème de paie (pricing OBLIGATOIRE) */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="tier">Tier de hook</Label>
              <Select value={tier} onValueChange={(v) => v && setTier(v)}>
                <SelectTrigger id="tier">
                  <SelectValue>
                    {tier === TIER_ALL ? "Tous" : tierLabel(tier)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TIER_ALL}>Tous</SelectItem>
                  {SCRIPT_TIERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {tierLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pricing">Pricing (barème de paie)</Label>
              <Select
                value={pricingId}
                onValueChange={(v) => v && setPricingId(v)}
              >
                <SelectTrigger id="pricing" aria-label="Pricing">
                  <SelectValue>
                    {pricingId === NONE
                      ? "Choisis un barème"
                      : ((pricings ?? []).find((p) => p._id === pricingId)
                          ?.name ?? "Pricing")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(pricings ?? []).map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pricings !== undefined && pricings.length === 0 ? (
                <p className="text-xs text-amber-600">
                  Aucun barème de paie — crées-en un dans Pricing d&apos;abord.
                </p>
              ) : (
                pricingId === NONE && (
                  <p className="text-xs text-amber-600">
                    Le barème de paie est requis.
                  </p>
                )
              )}
            </div>
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
          <Button
            onClick={handleSubmit}
            disabled={submitting || pricingId === NONE}
          >
            {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Assigner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
