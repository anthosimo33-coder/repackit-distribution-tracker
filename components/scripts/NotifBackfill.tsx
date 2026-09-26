"use client";

import { useState } from "react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { cn } from "@/lib/utils";
import { ASSIGNMENT_STATUS, type AssignmentStatus } from "@/lib/assignment-status";
import { formatPlannedDay } from "@/lib/calendar-status";
import { useLabel } from "@/lib/use-label";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * RATTRAPAGE DES NOTIFS — donne une notif aux vidéos assignées AVANT que la
 * campagne ait les siennes (cf convex/scripts.backfillNotifs).
 *
 * La fenêtre LISTE les vidéos concernées (accroche, créatrice, comptes, date,
 * statut) et l'admin DÉCOCHE celles à laisser sans notif : un geste de masse
 * dont on ne voit pas la cible, on finit par ne plus oser le faire. Tout est
 * coché par défaut — on retient les DÉCOCHÉES, si bien qu'une vidéo apparue
 * pendant que la fenêtre est ouverte arrive cochée, comme les autres.
 *
 * Rien à rattraper = rien à l'écran.
 */
export function NotifBackfill({ campaignId }: { campaignId: Id<"scriptCampaigns"> }) {
  const showError = useConvexError();
  const tr = useTranslations("admin.scripts.ScriptCampaignDetailPage");
  const tLabel = useLabel();
  const loc = useIntlLocale();
  const candidates = useProjectQuery(api.scripts.notifBackfillCandidates, {
    campaignId,
  });
  const backfill = useProjectMutation(api.scripts.backfillNotifs);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  if (!candidates || candidates.length === 0) return null;
  const selected = candidates.filter((c) => !unchecked.has(c.assignmentId));

  function openDialog() {
    setUnchecked(new Set());
    setOpen(true);
  }

  function toggle(id: string, on: boolean) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run() {
    setBusy(true);
    try {
      const { added } = await backfill({
        campaignId,
        assignmentIds: selected.map((c) => c.assignmentId),
      });
      toast.success(tr("notifRattrapageFait", { count: added }));
      setOpen(false);
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="xs"
        variant="outline"
        className="mt-1"
        onClick={openDialog}
        data-testid="notif-backfill"
      >
        {tr("notifRattrapage", { count: candidates.length })}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tr("notifRattrapage", { count: candidates.length })}</DialogTitle>
            <DialogDescription>{tr("notifRattrapageExplication")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500" data-testid="notif-backfill-selected">
              {tr("notifRattrapageCochees", {
                selected: selected.length,
                total: candidates.length,
              })}
            </p>
            <div className="flex gap-1">
              <Button size="xs" variant="ghost" onClick={() => setUnchecked(new Set())}>
                {tr("notifRattrapageToutCocher")}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setUnchecked(new Set(candidates.map((c) => c.assignmentId)))
                }
              >
                {tr("notifRattrapageToutDecocher")}
              </Button>
            </div>
          </div>

          <div className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {candidates.map((c) => {
              const st = ASSIGNMENT_STATUS[c.status as AssignmentStatus];
              const checked = !unchecked.has(c.assignmentId);
              return (
                <label
                  key={c.assignmentId}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-slate-50",
                    !checked && "opacity-60",
                  )}
                  data-testid="notif-backfill-row"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => toggle(c.assignmentId, v === true)}
                    aria-label={tr("notifRattrapageInclure")}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="line-clamp-2 text-sm font-medium text-slate-900">
                      {c.hook || "—"}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span className="font-medium text-slate-700">{c.creatorName}</span>
                      {c.accounts.map((a, i) => (
                        <span key={i} className="font-mono break-all">
                          {a.platform} {a.handle ?? "—"}
                        </span>
                      ))}
                      <span>
                        {c.postDate !== null
                          ? formatPlannedDay(c.postDate, loc, {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })
                          : tr("notifRattrapageSansDate")}
                      </span>
                      {st && (
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 font-semibold",
                            st.className,
                          )}
                        >
                          {tLabel(st.labelKey)}
                        </span>
                      )}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {tr("notifRattrapageAnnuler")}
            </Button>
            <Button
              onClick={run}
              disabled={busy || selected.length === 0}
              data-testid="notif-backfill-confirm"
            >
              {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              {tr("notifRattrapageConfirmer", { count: selected.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
