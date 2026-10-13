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
import {
  drawableConversations,
  isConversationEnabled,
} from "@/convex/scriptConversation";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * La CONVERSATION d'une vidéo dans le panneau de détail : laquelle elle a reçue,
 * et — tant que le post n'est pas publié — un menu pour en AJOUTER une (vidéo
 * assignée avant que la campagne ait les siennes) ou la CHANGER.
 *
 * Même règle de lecture que la notif : la campagne n'est lue qu'avec le bloc
 * `scripts.manage` (celui de la mutation) ; sans lui, rien n'est affiché plutôt
 * qu'une query refusée qui emporterait le panneau.
 */
export function AssignmentConversationPicker({
  assignmentId,
  campaignId,
  editable,
}: {
  assignmentId: Id<"assignments">;
  campaignId: Id<"scriptCampaigns">;
  /** Post pas encore publié (même verrou que « Éditer le texte »). */
  editable: boolean;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.assignments.AssignmentDetailSheet");
  const droits = usePermissions();
  const campaign = useProjectQuery(
    api.scripts.getCampaign,
    droits.skipUnless("scripts.manage", { id: campaignId }),
  );
  const assigned = useProjectQuery(api.assignments.getAssignmentConversation, {
    id: assignmentId,
  });
  // Une conversation reliée à un scénario n'est proposable que s'il est ACTIF.
  const scenarios = useProjectQuery(
    api.scenarios.listScenarios,
    droits.skipUnless("scripts.manage", {}),
  );
  const set = useProjectMutation(api.scripts.setAssignmentConversation);
  const [saving, setSaving] = useState(false);

  if (!campaign || !assigned) return null;
  const conversationBrickId = assigned.conversationBrickId ?? undefined;
  const actifs = new Set(
    (scenarios ?? []).filter((sc) => sc.statut === "actif").map((sc) => sc._id as string),
  );
  const conversations = drawableConversations(campaign.bricks, actifs);
  const current = campaign.bricks.find((b) => b._id === conversationBrickId);
  const canPick =
    editable &&
    conversations.length > 0 &&
    (isConversationEnabled(campaign) || conversationBrickId !== undefined);
  if (!current && !canPick) return null;

  async function change(id: Id<"scriptBricks">) {
    setSaving(true);
    try {
      await set({ id: assignmentId, brickId: id });
      toast.success(
        conversationBrickId ? tr("conversationChangee") : tr("conversationAjoutee"),
      );
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-3"
      data-testid="assignment-detail-conversation"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span aria-hidden>💬</span> {tr("conversation")}
      </p>
      {canPick ? (
        <Select
          value={conversationBrickId ?? null}
          items={Object.fromEntries(conversations.map((c) => [c._id, c.label]))}
          onValueChange={(v) => {
            if (v && v !== conversationBrickId) void change(v as Id<"scriptBricks">);
          }}
          disabled={saving}
        >
          <SelectTrigger
            className="h-auto min-h-9 w-full min-w-0 whitespace-normal py-1.5 text-left"
            aria-label={tr("conversation")}
            data-testid="assignment-detail-conversation-select"
          >
            <SelectValue>
              <span
                className={
                  current
                    ? "min-w-0 break-words text-sm text-slate-900"
                    : "min-w-0 text-sm text-slate-400"
                }
              >
                {current?.label ?? tr("conversationAucuneChoisir")}
              </span>
              {saving && <Loader2Icon className="size-3.5 animate-spin" />}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {conversations.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                <span className="min-w-0 break-words">{c.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="break-words text-sm text-slate-900">{current?.label}</p>
      )}
    </div>
  );
}
