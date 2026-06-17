"use client";

import { useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { Compte } from "@/components/comptes/CompteDialog";
import {
  getEffectiveWarmupDuration,
  type Plateforme,
} from "@/lib/compte-status";
import { warmupProgress, missedDays, lastCheck } from "@/lib/warmup";

/**
 * P5 — section admin « Protocole de warmup » d'une fiche compte : keywords
 * (tags, UNIQUES par compte côté serveur), instructions (markdown), targetDays
 * (surcharge la durée plateforme) + compliance (checks récents, jours manqués,
 * dernière activité) + « Passer en actif ».
 */
export function WarmupProtocolSection({ compte }: { compte: Compte }) {
  const updateProtocol = useProjectMutation(api.comptes.updateWarmupProtocol);
  const updateCompte = useProjectMutation(api.comptes.updateCompte);

  const protocol = compte.warmupProtocol;
  const [keywords, setKeywords] = useState<string[]>(protocol?.keywords ?? []);
  const [keywordInput, setKeywordInput] = useState("");
  const [instructions, setInstructions] = useState(
    protocol?.instructions ?? "",
  );
  const targetDefault = getEffectiveWarmupDuration({
    plateforme: compte.plateforme as Plateforme,
    warmupProtocol: protocol,
  });
  const [targetDays, setTargetDays] = useState(String(targetDefault));
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);

  const dailyChecks = protocol?.dailyChecks ?? [];
  const target = Number(targetDays) || targetDefault;
  const progress =
    compte.warmupStartedAt !== undefined
      ? warmupProgress(dailyChecks.length, target)
      : null;
  const missed =
    compte.warmupStartedAt !== undefined
      ? missedDays(compte.warmupStartedAt, dailyChecks, target)
      : 0;
  const last = lastCheck(dailyChecks);

  function addKeyword() {
    const k = keywordInput.trim();
    if (!k) return;
    if (keywords.some((x) => x.toLowerCase() === k.toLowerCase())) {
      setKeywordInput("");
      return;
    }
    setKeywords([...keywords, k]);
    setKeywordInput("");
  }

  function removeKeyword(k: string) {
    setKeywords(keywords.filter((x) => x !== k));
  }

  async function handleSave() {
    const td = Number(targetDays);
    if (!Number.isInteger(td) || td < 1 || td > 60) {
      toast.error("La durée cible doit être un entier entre 1 et 60.");
      return;
    }
    setSaving(true);
    try {
      await updateProtocol({
        id: compte._id,
        keywords,
        instructions,
        targetDays: td,
      });
      toast.success("Protocole enregistré");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function passerEnActif() {
    setActivating(true);
    try {
      await updateCompte({
        id: compte._id,
        status: "actif",
        warmupStartedAt: null,
      });
      toast.success(`${compte.handle} passé en actif`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setActivating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Protocole de warmup</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={passerEnActif}
          disabled={activating}
        >
          {activating ? (
            <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
          ) : (
            <CheckIcon className="mr-1.5 size-3.5" />
          )}
          Passer en actif
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Compliance */}
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="Progression"
            value={progress ? `Jour ${progress.day}/${progress.targetDays}` : "—"}
          />
          <Stat
            label="Jours manqués"
            value={String(missed)}
            tone={missed > 0 ? "warn" : "ok"}
          />
          <Stat label="Dernier check" value={last ?? "Aucun"} />
        </div>

        {/* Keywords */}
        <div className="space-y-2">
          <Label>Mots-clés (uniques par compte)</Label>
          <div className="flex flex-wrap gap-1.5">
            {keywords.length === 0 && (
              <span className="text-sm text-slate-400">Aucun mot-clé.</span>
            )}
            {keywords.map((k) => (
              <Badge key={k} variant="secondary" className="gap-1 font-normal">
                {k}
                <button
                  type="button"
                  onClick={() => removeKeyword(k)}
                  aria-label={`Retirer ${k}`}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              placeholder="Ajouter un mot-clé puis Entrée"
              aria-label="Ajouter un mot-clé"
            />
            <Button type="button" variant="outline" onClick={addKeyword}>
              Ajouter
            </Button>
          </div>
        </div>

        {/* Instructions */}
        <div className="space-y-1.5">
          <Label htmlFor="warmup-instructions">Instructions (markdown)</Label>
          <Textarea
            id="warmup-instructions"
            rows={6}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Routine quotidienne, comptes à suivre, durée de visionnage…"
            className="font-mono text-xs"
          />
        </div>

        {/* targetDays */}
        <div className="space-y-1.5">
          <Label htmlFor="warmup-target">Durée cible (jours)</Label>
          <Input
            id="warmup-target"
            type="number"
            min={1}
            max={60}
            value={targetDays}
            onChange={(e) => setTargetDays(e.target.value)}
            className="w-28"
          />
          <p className="text-xs text-slate-500">
            Pré-rempli depuis la plateforme — surchargeable.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            Enregistrer le protocole
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "warn";
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p
        className={
          tone === "warn"
            ? "mt-1 text-lg font-semibold text-amber-600"
            : tone === "ok"
              ? "mt-1 text-lg font-semibold text-emerald-600"
              : "mt-1 text-lg font-semibold text-slate-900"
        }
      >
        {value}
      </p>
    </div>
  );
}
