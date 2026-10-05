"use client";

import { useState } from "react";
import { HistoryIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ASSIGNMENT_STATUS, type AssignmentStatus } from "@/lib/assignment-status";
import { useLabel } from "@/lib/use-label";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";

/** La mission à abandonner — ce que la confirmation en dit. */
export type AbandonTarget = {
  _id: Id<"assignments">;
  creatorName: string;
  label: string;
  postDate?: number | null;
  status: string;
  /** Une vidéo est envoyée (cf lib/assignment-video) : la confirmation le dit. */
  hasVideo: boolean;
};

/**
 * CONFIRMATION D'ABANDON — fiche d'une mission et liste Missions.
 *
 * Le même cœur que l'outil `annuler_mission` (assignments.cancelAssignment) :
 *  - vidéo envoyée → la confirmation le DIT, son bouton aussi, et c'est elle
 *    qui envoie `force` ; la vidéo est conservée. Si une vidéo arrive pendant
 *    que la fenêtre est ouverte, le serveur refuse et le message s'affiche ;
 *  - « Prévenir la créatrice par email », coché par défaut : la mission
 *    disparaît de son espace, elle doit le savoir (incident Juliette, 05/10).
 */
export function AbandonMissionDialog({
  target,
  onClose,
  onDone,
}: {
  target: AbandonTarget | null;
  onClose: () => void;
  /** Après un abandon réussi (ex. fermer le panneau). */
  onDone?: () => void;
}) {
  const tr = useTranslations("admin.assignments.AbandonMissionDialog");
  const tLabel = useLabel();
  const loc = useIntlLocale();
  const showError = useConvexError();
  const cancel = useProjectMutation(api.assignments.cancelAssignment);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  // Chaque fermeture remet la case cochée : la prochaine ouverture repart du
  // défaut sûr.
  function fermer() {
    setNotify(true);
    onClose();
  }

  async function confirm() {
    if (!target) return;
    setBusy(true);
    try {
      await cancel({ id: target._id, force: target.hasVideo, notify });
      toast.success(notify ? tr("abandonneeEtPrevenue", { creatorName: target.creatorName }) : tr("abandonnee"));
      fermer();
      onDone?.();
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setBusy(false);
    }
  }

  const statut = target
    ? tLabel((ASSIGNMENT_STATUS[target.status as AssignmentStatus] ?? ASSIGNMENT_STATUS.todo).labelKey)
    : "";

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o && !busy) fermer();
      }}
    >
      <AlertDialogContent data-testid="abandon-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{tr("titre")}</AlertDialogTitle>
          <AlertDialogDescription>
            {target ? (
              <>
                <span className="font-medium text-slate-700">{target.creatorName}</span> — {target.label}
                {target.postDate ? ` ${tr("postPrevuLe", { date: new Date(target.postDate).toLocaleDateString(loc) })}` : ""}
                . {tr("resteDansLaListe")}
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {target?.hasVideo ? (
          <p
            className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
            data-testid="abandon-video-warning"
          >
            {tr("videoEnvoyeeConservee", { statut })}
          </p>
        ) : null}
        <label className="flex min-h-11 items-start gap-3 text-sm text-slate-700 sm:min-h-0">
          <Checkbox
            checked={notify}
            onCheckedChange={(c) => setNotify(c === true)}
            disabled={busy}
            className="mt-0.5"
          />
          <span>
            {tr("prevenirParEmail")}
            <span className="block text-xs text-slate-500">{tr("prevenirParEmailAide")}</span>
          </span>
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{tr("annuler")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
            disabled={busy}
            data-testid="abandon-confirm"
          >
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {target?.hasVideo ? tr("abandonnerMalgreLaVideo") : tr("abandonner")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * « Rétablir » — remet le statut d'avant le dernier abandon (cf
 * convex/missionAbandon.statutARetablir). Le toast dit le statut remis, et
 * quand il a été DÉDUIT (abandon d'avant la trace).
 */
export function useRestoreAssignment() {
  const tr = useTranslations("admin.assignments.AbandonMissionDialog");
  const tLabel = useLabel();
  const showError = useConvexError();
  const restore = useProjectMutation(api.assignments.restoreAssignment);
  const [restoringId, setRestoringId] = useState<Id<"assignments"> | null>(null);

  async function run(id: Id<"assignments">) {
    setRestoringId(id);
    try {
      const r = await restore({ id });
      const statut = tLabel(ASSIGNMENT_STATUS[r.status as AssignmentStatus].labelKey);
      toast.success(r.exact ? tr("retablie", { statut }) : tr("retablieDeduite", { statut }));
    } catch (e) {
      toast.error(showError(e));
    } finally {
      setRestoringId(null);
    }
  }

  return { restore: run, restoringId };
}

/**
 * La TRACE de la fiche : qui a abandonné ou rétabli la mission, et quand. Rien
 * n'est rendu tant qu'il n'y a pas d'événement.
 */
export function AssignmentStatusHistory({ assignmentId }: { assignmentId: Id<"assignments"> }) {
  const tr = useTranslations("admin.assignments.AbandonMissionDialog");
  const tLabel = useLabel();
  const loc = useIntlLocale();
  const events = useProjectQuery(api.assignments.getAssignmentStatusEvents, { id: assignmentId });
  if (!events || events.length === 0) return null;
  const quand = (at: number) =>
    new Date(at).toLocaleString(loc, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const statut = (s: string) => tLabel((ASSIGNMENT_STATUS[s as AssignmentStatus] ?? ASSIGNMENT_STATUS.todo).labelKey);
  return (
    <section className="space-y-2" data-testid="assignment-status-history">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <HistoryIcon className="size-4 text-slate-400" />
        {tr("historique")}
      </h3>
      <ul className="space-y-1.5 text-sm text-slate-600">
        {events.map((e) => {
          const qui = e.byName ?? tr("quelquUn");
          const par = e.viaClaude ? tr("parViaClaude", { qui }) : tr("par", { qui });
          return (
            <li key={e._id} className="break-words">
              {e.action === "cancelled"
                ? tr("evenementAbandon", { quand: quand(e.at), par, statut: statut(e.from) })
                : tr("evenementRetablie", { quand: quand(e.at), par, statut: statut(e.to) })}
              {e.action === "cancelled" ? (
                <span className="text-slate-400"> · {e.emailed ? tr("createatricePrevenue") : tr("createatriceNonPrevenue")}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
