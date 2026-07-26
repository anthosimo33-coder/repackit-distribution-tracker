"use client";

import { useState } from "react";
import { fr } from "date-fns/locale";
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
  const setPostDate = useProjectMutation(api.assignments.setAssignmentPostDate);
  const [busy, setBusy] = useState(false);
  const selected = currentPostDate ? new Date(currentPostDate) : undefined;

  async function save(next: number | undefined) {
    setBusy(true);
    try {
      await setPostDate({ id: assignmentId, postDate: next });
      toast.success(
        next
          ? "Date de publication mise à jour."
          : "Date de publication retirée.",
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
            Date de publication — {creatorName}
          </DialogTitle>
          <DialogDescription>
            Le jour où cette vidéo doit être postée. Distincte de l&apos;échéance
            de production.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => d && void save(dayStartMs(d))}
            locale={fr}
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
            Retirer la date
          </Button>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
