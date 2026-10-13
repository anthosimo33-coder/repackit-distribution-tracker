"use client";

import { useMemo, useState } from "react";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useConvexError } from "@/lib/use-convex-error";

/** Valeur du select « aucune conversation » (Select n'accepte pas ""). */
const AUCUNE = "__aucune__";

/**
 * La CONVERSATION d'une vidéo dans le panneau de détail : le scénario qu'elle a
 * reçu, et — tant que le post n'est pas publié — un menu pour en DONNER un
 * (vidéo assignée avant que la campagne ait la conversation), le CHANGER ou le
 * RETIRER. Les scénarios sont rangés par thème, comme l'écran Scénarios ; les
 * archivés n'y sont pas (sauf celui déjà reçu).
 *
 * Même règle de lecture que la notif : les scénarios ne sont lus qu'avec le
 * bloc `scripts.manage` (celui de la mutation) ; sans lui, rien n'est affiché
 * plutôt qu'une query refusée qui emporterait le panneau.
 */
export function AssignmentConversationPicker({
  assignmentId,
  editable,
}: {
  assignmentId: Id<"assignments">;
  /** Post pas encore publié (même verrou que « Éditer le texte »). */
  editable: boolean;
}) {
  const showError = useConvexError();
  const tr = useTranslations("admin.assignments.AssignmentDetailSheet");
  const tStatut = useTranslations("admin.scripts.scenarioStatut");
  const droits = usePermissions();
  const scenarios = useProjectQuery(
    api.scenarios.listScenarios,
    droits.skipUnless("scripts.manage", {}),
  );
  const assigned = useProjectQuery(api.assignments.getAssignmentScenario, {
    id: assignmentId,
  });
  const set = useProjectMutation(api.scripts.setAssignmentScenario);
  const [saving, setSaving] = useState(false);

  const courantId = assigned?.scenarioId ?? undefined;
  const groupes = useMemo(() => {
    const parTheme = new Map<string, NonNullable<typeof scenarios>>();
    for (const sc of scenarios ?? []) {
      if (sc.statut === "archive" && sc._id !== courantId) continue;
      const k = sc.theme.trim();
      parTheme.set(k, [...(parTheme.get(k) ?? []), sc]);
    }
    return [...parTheme.entries()].sort(([a], [b]) =>
      a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "fr"),
    );
  }, [scenarios, courantId]);

  if (!scenarios || !assigned) return null;
  const courant = scenarios.find((sc) => sc._id === courantId);
  const canPick = editable && groupes.length > 0;
  if (!courant && !canPick) return null;

  const libelle = (sc: (typeof scenarios)[number]) =>
    sc.statut === "archive"
      ? `${sc.code} · ${sc.titre} (${tStatut("archive")})`
      : `${sc.code} · ${sc.titre}`;
  const items: Record<string, string> = { [AUCUNE]: tr("conversationAucune") };
  for (const sc of scenarios) items[sc._id] = libelle(sc);

  async function change(id: Id<"scenarios"> | null) {
    setSaving(true);
    try {
      await set({ id: assignmentId, scenarioId: id });
      toast.success(
        id === null
          ? tr("conversationRetiree")
          : courantId
            ? tr("conversationChangee")
            : tr("conversationAjoutee"),
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
          value={courantId ?? AUCUNE}
          items={items}
          onValueChange={(v) => {
            if (!v || v === (courantId ?? AUCUNE)) return;
            void change(v === AUCUNE ? null : (v as Id<"scenarios">));
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
                  courant
                    ? "min-w-0 break-words text-sm text-slate-900"
                    : "min-w-0 text-sm text-slate-400"
                }
              >
                {courant ? libelle(courant) : tr("conversationAucuneChoisir")}
              </span>
              {saving && <Loader2Icon className="size-3.5 animate-spin" />}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value={AUCUNE}>{tr("conversationAucune")}</SelectItem>
            {groupes.map(([theme, liste]) => (
              <SelectGroup key={theme || "—"}>
                <SelectLabel>{theme || tr("conversationSansTheme")}</SelectLabel>
                {liste.map((sc) => (
                  <SelectItem key={sc._id} value={sc._id}>
                    <span className="min-w-0 break-words">{libelle(sc)}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="break-words text-sm text-slate-900">{courant && libelle(courant)}</p>
      )}
    </div>
  );
}
