"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { dayStartMs } from "@/components/admin/AssignmentPlanningCalendar";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { dateFnsLocale } from "@/lib/date-fns-locale";

/**
 * Édite la DATE DE PUBLICATION planifiée d'un assignment EXISTANT depuis la page
 * Assignments (replanification après coup). Un jour choisi → setAssignmentPostDate
 * (minuit local, cohérent avec le stockage du modal). « Retirer » efface la date.
 * Distincte de l'échéance de PRODUCTION (dueDate) : les deux coexistent.
 */
export function AssignmentPostDateDialog({
  open,
  onOpenChange,
  assignmentId,
  creatorName,
  currentPostDate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  assignmentId: Id<"assignments">;
  creatorName: string;
  currentPostDate?: number;
}) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.assignments.AssignmentPostDateDialog");
  const setPostDate = useProjectMutation(api.assignments.setAssignmentPostDate);
  const [busy, setBusy] = useState(false);
  const selected = currentPostDate ? new Date(currentPostDate) : undefined;

  async function save(next: number | undefined) {
    setBusy(true);
    try {
      await setPostDate({ id: assignmentId, postDate: next });
      toast.success(
        next
          ? tr("dateDePublicationMiseA")
          : tr("dateDePublicationRetiree"),
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-fit">
        <DialogHeader className="min-w-0">
          <DialogTitle className="break-words">
            {tr("dateDePublication", { creatorName: creatorName })}
          </DialogTitle>
          <DialogDescription>
            {tr("leJourOuCetteVideo")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => d && void save(dayStartMs(d))}
            locale={dateFnsLocale(loc)}
            weekStartsOn={1}
            defaultMonth={selected}
          />
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => void save(undefined)}
            disabled={busy || currentPostDate === undefined}
            className="text-slate-500"
          >
            {busy && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {tr("retirerLaDate")}
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {tr("fermer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
