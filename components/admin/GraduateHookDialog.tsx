"use client";

import { useState } from "react";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatNumber, formatPercent } from "@/lib/format";
import { Loader2Icon, GraduationCapIcon } from "lucide-react";
import { rateOf } from "@/convex/graduation";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * Écran de CONFIRMATION d'une graduation : le texte du hook, ses scores, et vers
 * quelle campagne il part.
 *
 * Les chiffres sont relus en base par `getGraduationPreview`, jamais portés par
 * le clic : l'écran qui justifie le geste doit montrer l'état réel au moment du
 * geste, pas celui du dernier rendu de la liste.
 *
 * Le bouton reste ACTIF même si le hook ne franchit pas les seuils — graduer est
 * une décision humaine, la règle ne fait que la proposer. L'écart est simplement
 * dit, il n'est pas bloqué.
 */
export function GraduateHookDialog({
  brickId,
  open,
  onOpenChange,
}: {
  brickId: Id<"scriptBricks"> | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const showError = useConvexError();
  const loc = useIntlLocale();
  const tr = useTranslations("admin.common.GraduateHookDialog");
  const preview = useProjectQuery(
    api.scripts.getGraduationPreview,
    brickId && open ? { brickId } : "skip",
  );
  const graduate = useProjectMutation(api.scripts.graduateHook);
  const [busy, setBusy] = useState(false);

  async function onConfirm() {
    if (!brickId) return;
    setBusy(true);
    try {
      const res = await graduate({ brickId });
      if (res.outcome === "already-graduated") {
        toast.info(
          tr("ceHookEtaitDejaDans", { targetCampaignName: res.targetCampaignName }),
        );
      } else {
        toast.success(tr("hookGradueVers", { targetCampaignName: res.targetCampaignName }));
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(showError(e, tr("graduationImpossible")));
    } finally {
      setBusy(false);
    }
  }

  const best = preview?.best ?? null;
  const likeRate = best ? rateOf(best.likes, best.vues) : null;
  const saveRate = best ? rateOf(best.saves, best.vues) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("graduerCeHook")}</DialogTitle>
          <DialogDescription>
            {tr("leHookPartDansLes")}
          </DialogDescription>
        </DialogHeader>

        {preview === undefined ? (
          <Skeleton className="h-40" />
        ) : preview === null ? (
          <p className="text-sm text-slate-500">{tr("hookIntrouvable")}</p>
        ) : (
          <div className="space-y-4">
            <blockquote className="rounded-md border-l-2 border-primary/40 bg-slate-50 px-3 py-2 text-sm text-slate-800">
              {preview.content}
            </blockquote>

            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              <Score label={tr("vues")} value={best ? formatNumber(best.vues, loc) : "—"} />
              <Score
                label={tr("likeRate")}
                value={likeRate === null ? "—" : formatPercent(likeRate, undefined, loc)}
              />
              <Score
                label={tr("saveRate")}
                // « — » ici veut dire NON COLLECTÉ, pas zéro : le relevé auto ne
                // remonte pas encore les saves sur tous les posts.
                value={saveRate === null ? "—" : formatPercent(saveRate, undefined, loc)}
              />
              <Score label={tr("runs")} value={String(preview.runs)} />
            </div>

            {!preview.qualifies && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {tr("ceHookNeFranchitPas")}
              </p>
            )}
            {preview.alreadyPresent && (
              <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800">
                {tr("ceTexteEstDejaPresent")}
              </p>
            )}
            {preview.targetCampaignName === null ? (
              <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {tr("aucuneCampagneDOuverturesProuvees")}
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                {tr("destination")}{" "}
                <span className="font-medium text-slate-700">
                  {preview.targetCampaignName}
                </span>
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tr("annuler")}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={
              busy ||
              preview === undefined ||
              preview === null ||
              preview.targetCampaignName === null
            }
          >
            {busy ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <GraduationCapIcon className="size-4" />
            )}
            {tr("graduer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Score({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 px-2 py-1.5">
      <div className="text-sm font-semibold tabular-nums text-slate-900">
        {value}
      </div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}
