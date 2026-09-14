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
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * P5 — section admin « Protocole de warmup » d'une fiche compte : keywords
 * (tags, UNIQUES par compte côté serveur), instructions (markdown), targetDays
 * (surcharge la durée plateforme) + compliance (checks récents, jours manqués,
 * dernière activité) + « Passer en actif ».
 */
export function WarmupProtocolSection({ compte }: { compte: Compte }) {
  const showError = useConvexError();
  const tr = useTranslations("admin.accounts.WarmupProtocolSection");
  const updateProtocol = useProjectMutation(api.comptes.updateWarmupProtocol);
  const updateCompte = useProjectMutation(api.comptes.updateCompte);

  const protocol = compte.warmupProtocol;
  const [keywords, setKeywords] = useState<string[]>(protocol?.keywords ?? []);
  const [keywordInput, setKeywordInput] = useState("");
  const [instructions, setInstructions] = useState(
    protocol?.instructions ?? "",
  );
  // Durée SERVIE par le serveur (barème du projet + surcharge du compte).
  // Aucun recalcul côté écran : ce serait une seconde source de vérité.
  const targetDefault = compte.targetDays;
  const [targetDays, setTargetDays] = useState(String(targetDefault));
  const [saving, setSaving] = useState(false);
  // Instant figé au montage (convention du dépôt, cf ActionDashboard) : `Date.now()`
  // en plein rendu est impur, et une valeur qui bouge à chaque rendu ferait
  // clignoter le compteur de jours manqués.
  const [now] = useState(() => Date.now());
  const [activating, setActivating] = useState(false);

  const dailyChecks = protocol?.dailyChecks ?? [];
  const target = Number(targetDays) || targetDefault;
  const progress =
    compte.warmupStartedAt !== undefined
      ? warmupProgress(dailyChecks.length, target)
      : null;
  const missed =
    compte.warmupStartedAt !== undefined
      ? missedDays(
          compte.warmupStartedAt,
          dailyChecks,
          target,
          now,
        )
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
      toast.error(tr("laDureeCibleDoitEtre"));
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
      toast.success(tr("protocoleEnregistre"));
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
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
      toast.success(tr("passeEnActif", { handle: compte.handle }));
    } catch (e) {
      toast.error(showError(e, tr("uneErreurEstSurvenue")));
    } finally {
      setActivating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>{tr("protocoleDeWarmup")}</CardTitle>
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
          {tr("passerEnActif")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Compliance */}
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label={tr("progression")}
            value={progress ? tr("jour", { day: progress.day, targetDays: progress.targetDays }) : "—"}
          />
          <Stat
            label={tr("joursManques")}
            value={String(missed)}
            tone={missed > 0 ? "warn" : "ok"}
          />
          <Stat label={tr("dernierCheck")} value={last ?? "Aucun"} />
        </div>

        {/* Keywords */}
        <div className="space-y-2">
          <Label>{tr("motsCles")}</Label>
          <div className="flex flex-wrap gap-1.5">
            {keywords.length === 0 && (
              <span className="text-sm text-slate-400">{tr("aucunMotCle")}</span>
            )}
            {keywords.map((k) => (
              <Badge key={k} variant="secondary" className="gap-1 font-normal">
                {k}
                <button
                  type="button"
                  onClick={() => removeKeyword(k)}
                  aria-label={tr("retirer", { k: k })}
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
              placeholder={tr("ajouterUnMotClePuis")}
              aria-label={tr("ajouterUnMotCle")}
            />
            <Button type="button" variant="outline" onClick={addKeyword}>
              {tr("ajouter")}
            </Button>
          </div>
        </div>

        {/* Instructions */}
        <div className="space-y-1.5">
          <Label htmlFor="warmup-instructions">{tr("instructionsMarkdown")}</Label>
          <Textarea
            id="warmup-instructions"
            rows={6}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={tr("routineQuotidienneComptesASuivre")}
            className="font-mono text-xs"
          />
        </div>

        {/* targetDays */}
        <div className="space-y-1.5">
          <Label htmlFor="warmup-target">{tr("dureeCibleJours")}</Label>
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
            {tr("preRempliDepuisLaPlateforme")}
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {tr("enregistrerLeProtocole")}
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
