"use client";

import { useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Compte } from "@/components/comptes/CompteDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2Icon, Loader2Icon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import {
  getEffectiveStatus,
  getEffectiveWarmupDuration,
  isWarmupCompleteForCompte,
  type Plateforme,
} from "@/lib/compte-status";
import { warmupProgress, checkedToday } from "@/lib/warmup";

/**
 * Panneau ADMIN d'un compte GÉRÉ par l'équipe (fiche compte). L'équipe tient le
 * compte : elle coche le warmup ELLE-MÊME (markWarmupCheckAsAdmin), puis active
 * le compte (updateCompte status:"actif") — le gate strict #98 reste le vrai
 * passage warmup → disponible. Une fois actif, le compte est ciblable par un
 * assignment (qui partira DIRECT en to_publish, publié via la file « Comptes
 * gérés » de la page Validation).
 */
export function ManagedAccountAdminPanel({ compte }: { compte: Compte }) {
  const markCheckAsAdmin = useProjectMutation(
    api.comptes.markWarmupCheckAsAdmin,
  );
  const updateCompte = useProjectMutation(api.comptes.updateCompte);
  const [busy, setBusy] = useState(false);

  const status = getEffectiveStatus(compte);
  const isWarmup = status === "warmup";
  const dailyChecks = compte.warmupProtocol?.dailyChecks ?? [];
  // Durée SERVIE par le serveur (barème du projet + surcharge du compte).
  // Aucun recalcul côté écran : ce serait une seconde source de vérité.
  const targetDays = compte.targetDays;
  const progress = isWarmup ? warmupProgress(dailyChecks.length, targetDays) : null;
  const doneToday = checkedToday(dailyChecks);
  const warmupDone = isWarmupCompleteForCompte(compte);

  async function handleCheck() {
    setBusy(true);
    try {
      await markCheckAsAdmin({ id: compte._id });
      toast.success("Check du jour validé ✓ (équipe)");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate() {
    setBusy(true);
    try {
      await updateCompte({
        id: compte._id,
        status: "actif",
        warmupStartedAt: null,
      });
      toast.success(`${compte.handle} passé en actif`);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-slate-300 bg-slate-50/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersIcon className="size-4 text-slate-500" />
          Compte géré par l&apos;équipe
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          L&apos;équipe tient ce compte : coche le warmup ici, puis active-le. La
          créatrice le suit en lecture (scripts + posts + perfs) sans jamais
          publier.
        </p>

        {isWarmup ? (
          <div className="space-y-3">
            {progress && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-slate-700">
                    Jour {progress.day} / {progress.targetDays}
                  </span>
                  {warmupDone ? (
                    <span className="text-xs font-medium text-blue-600">
                      Warmup terminé — active le compte
                    </span>
                  ) : doneToday ? (
                    <span className="text-xs font-medium text-emerald-600">
                      Fait aujourd&apos;hui ✓
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-amber-600">
                      À cocher aujourd&apos;hui
                    </span>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-amber-400"
                    style={{
                      width: `${Math.round(
                        (Math.min(dailyChecks.length, progress.targetDays) /
                          progress.targetDays) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              {!warmupDone && (
                <Button
                  onClick={handleCheck}
                  disabled={busy || doneToday}
                  className="w-full sm:w-auto"
                  data-testid="admin-warmup-check"
                >
                  {busy ? (
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <CheckCircle2Icon className="mr-2 size-4" />
                  )}
                  {doneToday ? "Warmup du jour fait ✓" : "Cocher le warmup du jour"}
                </Button>
              )}
              {warmupDone && (
                <Button
                  onClick={handleActivate}
                  disabled={busy}
                  className="w-full sm:w-auto"
                  data-testid="admin-activate-managed"
                >
                  {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                  Activer le compte
                </Button>
              )}
            </div>
          </div>
        ) : status === "actif" ? (
          <p className="text-sm font-medium text-emerald-700">
            Compte actif — prêt à recevoir des assignments (ils partiront direct
            « à publier »).
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            Compte {status}. Aucun warmup à cocher.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
