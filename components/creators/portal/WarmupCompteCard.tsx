"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlatformBadge } from "@/components/VerdictBadge";
import { SimpleMarkdown } from "@/components/ui/SimpleMarkdown";
import { CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getEffectiveStatus,
  getStatusBadge,
  getEffectiveWarmupDuration,
  type Plateforme,
} from "@/lib/compte-status";
import { warmupProgress, checkedToday } from "@/lib/warmup";

/**
 * P5 — carte d'un compte côté portail créateur. En warmup : mots-clés,
 * instructions (markdown), progression « Jour X / N » et bouton du check
 * quotidien (désactivé si déjà coché aujourd'hui ; la mutation refuse de toute
 * façon un 2e check). Sinon : carte simple.
 */
export function WarmupCompteCard({
  compte,
  projectId,
}: {
  compte: Doc<"comptes">;
  projectId: Id<"projects">;
}) {
  const markCheck = useMutation(api.comptes.markWarmupCheck);
  const [submitting, setSubmitting] = useState(false);

  const status = getEffectiveStatus(compte);
  const badge = getStatusBadge(compte);
  const isWarmup = status === "warmup";
  const protocol = compte.warmupProtocol;
  const dailyChecks = protocol?.dailyChecks ?? [];
  const targetDays = getEffectiveWarmupDuration({
    plateforme: compte.plateforme as Plateforme,
    warmupProtocol: protocol,
  });
  const progress =
    isWarmup && compte.warmupStartedAt !== undefined
      ? warmupProgress(compte.warmupStartedAt, targetDays)
      : null;
  const doneToday = checkedToday(dailyChecks);

  async function handleCheck() {
    setSubmitting(true);
    try {
      await markCheck({ projectId, id: compte._id });
      toast.success("Check du jour validé ✓");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2">
          <PlatformBadge plateforme={compte.plateforme} />
          <span className="font-mono font-medium text-slate-900">
            {compte.handle}
          </span>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-semibold",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </CardHeader>

      {isWarmup ? (
        <CardContent className="space-y-4">
          {progress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700">
                  Jour {progress.day} / {progress.targetDays}
                </span>
                {progress.complete && (
                  <span className="text-xs font-medium text-blue-600">
                    Warmup terminé — en attente de validation admin
                  </span>
                )}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-amber-400"
                  style={{
                    width: `${Math.round(
                      (progress.day / progress.targetDays) * 100,
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Mots-clés à rechercher
            </p>
            {protocol && protocol.keywords.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {protocol.keywords.map((k) => (
                  <Badge key={k} variant="secondary" className="font-normal">
                    {k}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                En attente des mots-clés définis par l&apos;admin.
              </p>
            )}
          </div>

          {protocol && protocol.instructions.trim().length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Instructions
              </p>
              <SimpleMarkdown content={protocol.instructions} />
            </div>
          )}

          <Button
            onClick={handleCheck}
            disabled={submitting || doneToday}
            className="w-full"
          >
            {submitting ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <CheckCircle2Icon className="mr-2 size-4" />
            )}
            {doneToday ? "Warmup du jour fait ✓" : "Warmup du jour fait"}
          </Button>
        </CardContent>
      ) : (
        <CardContent>
          <p className="text-sm text-slate-500">
            Compte {badge.label.toLowerCase()}. Rien à faire aujourd&apos;hui.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
