"use client";

import { useState } from "react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";
import { Loader2Icon, TrophyIcon } from "lucide-react";
import { formatDateFr } from "@/convex/dateFr";
import type { Id } from "@/convex/_generated/dataModel";
import { formatViews, type ChallengeReward } from "./challenge-format";
import { useChallengeLabels } from "./use-challenge-labels";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";

type Win = {
  _id: Id<"challengeWins">;
  creatorName: string;
  wonAt: number;
  scoreAtWin: number;
  position: number;
  reward: ChallengeReward;
  cancelledAt: number | null;
  cancelReason: string | null;
};

/**
 * VICTOIRES actées d'un défi, et le seul geste qui peut en reprendre une.
 *
 * ⚠️ Une victoire ne se dé-acquiert JAMAIS toute seule — ni parce que le score
 * retombe, ni parce qu'une autre passe devant. C'est ce qui rend l'annonce
 * automatique sûre côté créatrice. L'annulation est donc un geste délibéré, avec
 * MOTIF obligatoire, et elle est refusée une fois la prime versée (même verrou
 * que `setPublicationWarmup` : annuler après coup ferait diverger l'écran de ce
 * qui a réellement été payé).
 *
 * Annuler LIBÈRE la place : la prochaine évaluation peut la réattribuer, y
 * compris à la même personne. C'est dit à l'écran, pour que ce ne soit pas une
 * surprise.
 */
export function ChallengeWinsCard({
  wins,
  currency,
}: {
  wins: Win[];
  currency?: string | null;
}) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.challenges.ChallengeWinsCard");
  const L = useChallengeLabels();
  const cancel = useProjectMutation(api.challengeSync.cancelChallengeWin);
  const [target, setTarget] = useState<Win | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCancel() {
    if (!target || reason.trim().length === 0) return;
    setBusy(true);
    try {
      await cancel({ winId: target._id, reason: reason.trim() });
      toast.success(tr("victoireAnnuleeLaPlaceEst"));
      setTarget(null);
      setReason("");
    } catch (e) {
      toast.error(convexErrorMessage(e, tr("uneErreurEstSurvenue")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="challenge-wins">
      <CardHeader>
        <CardTitle className="text-base">{tr("victoires", { count: wins.length })}</CardTitle>
        <CardDescription>
          {tr("acteesAuReleveDe23h30")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {wins.length === 0 && (
          <p className="text-sm text-slate-500">
            {tr("aucuneVictoirePourLInstant")}
          </p>
        )}
        {wins.map((w) => (
          <div
            key={w._id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <TrophyIcon
                  className={
                    w.cancelledAt !== null
                      ? "size-4 text-slate-300"
                      : "size-4 text-amber-500"
                  }
                />
                <span
                  className={
                    w.cancelledAt !== null
                      ? "font-medium text-slate-400 line-through"
                      : "font-medium text-slate-900"
                  }
                >
                  {w.position}. {w.creatorName}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {tr("vuesAuReleveDu", { count: formatViews(w.scoreAtWin, loc), date: formatDateFr(w.wonAt, loc), value: L.reward(w.reward, undefined, currency) })}
              </p>
              {w.cancelledAt !== null && (
                <p className="mt-1 text-xs text-rose-600">
                  {tr("annuleeLe", { date: formatDateFr(w.cancelledAt, loc), cancelReason: w.cancelReason ?? "" })}
                </p>
              )}
            </div>
            {w.cancelledAt === null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTarget(w);
                  setReason("");
                }}
              >
                {tr("annuler")}
              </Button>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={target !== null} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("annulerLaVictoireDe", { creatorName: target?.creatorName ?? "" })}</DialogTitle>
            <DialogDescription>
              {tr("laPlaceRedevientOuverteLa")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="cancel-reason">{tr("motifObligatoire")}</Label>
            <Textarea
              id="cancel-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={tr("pourquoiCetteVictoireEstAnnulee")}
            />
            <p className="text-xs text-slate-400">
              {tr("leMotifResteDansL")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              {tr("retour")}
            </Button>
            <Button
              onClick={handleCancel}
              disabled={busy || reason.trim().length === 0}
            >
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {tr("annulerLaVictoire")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
