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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { formatNumber, formatPercent } from "@/lib/format";
import { Loader2Icon, GraduationCapIcon } from "lucide-react";
import { rateOf } from "@/convex/graduation";

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
          `Ce hook était déjà dans « ${res.targetCampaignName} » — rien dupliqué, l'original du LAB est désactivé.`,
        );
      } else {
        toast.success(`Hook gradué vers « ${res.targetCampaignName} ».`);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Graduation impossible"));
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
          <DialogTitle>Graduer ce hook</DialogTitle>
          <DialogDescription>
            Le hook part dans les ouvertures prouvées et son original est
            désactivé dans le LAB — les deux d&apos;un coup, jamais l&apos;un
            sans l&apos;autre.
          </DialogDescription>
        </DialogHeader>

        {preview === undefined ? (
          <Skeleton className="h-40" />
        ) : preview === null ? (
          <p className="text-sm text-slate-500">Hook introuvable.</p>
        ) : (
          <div className="space-y-4">
            <blockquote className="rounded-md border-l-2 border-primary/40 bg-slate-50 px-3 py-2 text-sm text-slate-800">
              {preview.content}
            </blockquote>

            {preview.angleFamily && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                Famille d&apos;angle
                <Badge variant="outline">{preview.angleFamily}</Badge>
              </div>
            )}

            <div className="grid grid-cols-4 gap-2 text-center">
              <Score label="Vues" value={best ? formatNumber(best.vues) : "—"} />
              <Score
                label="Like rate"
                value={likeRate === null ? "—" : formatPercent(likeRate)}
              />
              <Score
                label="Save rate"
                // « — » ici veut dire NON COLLECTÉ, pas zéro : le relevé auto ne
                // remonte pas encore les saves sur tous les posts.
                value={saveRate === null ? "—" : formatPercent(saveRate)}
              />
              <Score label="Runs" value={String(preview.runs)} />
            </div>

            {!preview.qualifies && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Ce hook ne franchit pas les seuils de graduation. Tu peux le
                graduer quand même — la règle propose, elle ne décide pas.
              </p>
            )}
            {preview.alreadyPresent && (
              <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800">
                Ce texte est déjà présent dans la campagne cible. Rien ne sera
                dupliqué ; l&apos;original du LAB sera simplement désactivé.
              </p>
            )}
            {preview.targetCampaignName === null ? (
              <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                Aucune campagne d&apos;ouvertures prouvées sur ce projet — à
                créer avant de pouvoir graduer.
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Destination :{" "}
                <span className="font-medium text-slate-700">
                  {preview.targetCampaignName}
                </span>
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
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
            Graduer
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
