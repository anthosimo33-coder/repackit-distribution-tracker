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
import { formatViews, rewardLabel, type ChallengeReward } from "./challenge-format";

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
  const cancel = useProjectMutation(api.challengeSync.cancelChallengeWin);
  const [target, setTarget] = useState<Win | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCancel() {
    if (!target || reason.trim().length === 0) return;
    setBusy(true);
    try {
      await cancel({ winId: target._id, reason: reason.trim() });
      toast.success("Victoire annulée — la place est de nouveau ouverte");
      setTarget(null);
      setReason("");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="challenge-wins">
      <CardHeader>
        <CardTitle className="text-base">Victoires ({wins.length})</CardTitle>
        <CardDescription>
          Actées au relevé de 23h30. Une victoire ne se reprend jamais toute
          seule — même si le score retombe ou qu&apos;une autre passe devant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {wins.length === 0 && (
          <p className="text-sm text-slate-500">
            Aucune victoire pour l&apos;instant.
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
                {formatViews(w.scoreAtWin)} vues au relevé du{" "}
                {formatDateFr(w.wonAt)} · {rewardLabel(w.reward, undefined, currency)}
              </p>
              {w.cancelledAt !== null && (
                <p className="mt-1 text-xs text-rose-600">
                  Annulée le {formatDateFr(w.cancelledAt)} — {w.cancelReason}
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
                Annuler
              </Button>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={target !== null} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Annuler la victoire de {target?.creatorName}</DialogTitle>
            <DialogDescription>
              La place redevient ouverte : la prochaine évaluation peut
              l&apos;attribuer à quelqu&apos;un d&apos;autre — ou à la même
              personne si elle est toujours en tête.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-w-0 gap-1.5">
            <Label htmlFor="cancel-reason">Motif (obligatoire)</Label>
            <Textarea
              id="cancel-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Pourquoi cette victoire est annulée."
            />
            <p className="text-xs text-slate-400">
              Le motif reste dans l&apos;historique du défi.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Retour
            </Button>
            <Button
              onClick={handleCancel}
              disabled={busy || reason.trim().length === 0}
            >
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Annuler la victoire
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
