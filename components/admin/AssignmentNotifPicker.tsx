"use client";

import { useState } from "react";
import {
  useProjectMutation,
  useProjectQuery,
} from "@/components/project/use-project-convex";
import { usePermissions } from "@/components/project/use-permissions";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { drawableNotifs, isNotifEnabled } from "@/convex/scriptNotif";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * La NOTIF d'une vidéo dans le panneau de détail : son texte figé, et — tant
 * que le post n'est pas publié — un menu pour en AJOUTER une (vidéo assignée
 * avant que la campagne ait ses notifs) ou la CHANGER.
 *
 * Passe par `editScriptCombo` (slot "notif") : la notif est hors combo, donc ni
 * le texte monté, ni le comboKey, ni la paie ne bougent.
 *
 * La campagne n'est lue qu'avec le bloc `scripts.manage` (celui de la
 * mutation) : sans lui, le panneau reste lisible, en lecture seule — une query
 * refusée emporterait le panneau entier.
 */
export function AssignmentNotifPicker({
  assignmentId,
  campaignId,
  notifBrickId,
  notifText,
  editable,
}: {
  assignmentId: Id<"assignments">;
  campaignId: Id<"scriptCampaigns">;
  notifBrickId?: Id<"scriptBricks">;
  notifText?: string;
  /** Post pas encore publié (même verrou que « Éditer le texte »). */
  editable: boolean;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.assignments.AssignmentDetailSheet");
  const droits = usePermissions();
  const campaign = useProjectQuery(
    api.scripts.getCampaign,
    editable ? droits.skipUnless("scripts.manage", { id: campaignId }) : "skip",
  );
  const edit = useProjectMutation(api.scripts.editScriptCombo);
  const [saving, setSaving] = useState(false);

  const notifs = campaign ? drawableNotifs(campaign.bricks) : [];
  // AJOUTER suppose la notif allumée sur la campagne ; CHANGER une notif
  // existante reste possible tant qu'il y a de quoi choisir.
  const canPick =
    editable &&
    campaign != null &&
    notifs.length > 0 &&
    (isNotifEnabled(campaign) || notifBrickId !== undefined);

  if (!notifText && !canPick) return null;

  async function change(id: Id<"scriptBricks">) {
    setSaving(true);
    try {
      await edit({ id: assignmentId, slot: "notif", newBrickId: id });
      toast.success(notifBrickId ? tr("notifChangee") : tr("notifAjoutee"));
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-3"
      data-testid="assignment-detail-notif"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span aria-hidden>🔔</span> {tr("notifAAfficher")}
      </p>
      {canPick ? (
        <Select
          value={notifBrickId ?? null}
          items={Object.fromEntries(notifs.map((n) => [n._id, n.content.trim()]))}
          onValueChange={(v) => {
            if (v && v !== notifBrickId) void change(v as Id<"scriptBricks">);
          }}
          disabled={saving}
        >
          <SelectTrigger
            className="h-auto min-h-9 w-full min-w-0 whitespace-normal py-1.5 text-left"
            aria-label={tr("notifAAfficher")}
            data-testid="assignment-detail-notif-select"
          >
            <SelectValue>
              <span
                className={
                  notifText
                    ? "min-w-0 break-words text-sm text-slate-900"
                    : "min-w-0 text-sm text-slate-400"
                }
              >
                {notifText ?? tr("notifAucuneChoisir")}
              </span>
              {saving && <Loader2Icon className="size-3.5 animate-spin" />}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {notifs.map((n) => (
              <SelectItem key={n._id} value={n._id}>
                <span className="min-w-0 break-words">{n.content.trim()}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-slate-900">
          {notifText}
        </p>
      )}
    </div>
  );
}
