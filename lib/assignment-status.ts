/**
 * P7 — libellés + urgence des assignments (pur). Urgence calculée seulement
 * pour les statuts ACTIONNABLES (todo/in_progress/rejected).
 */
export type AssignmentStatus =
  | "todo"
  | "in_progress"
  | "submitted"
  | "validated"
  | "rejected"
  | "paid";

const DAY = 86_400_000;

export const ASSIGNMENT_STATUS: Record<
  AssignmentStatus,
  { label: string; className: string }
> = {
  todo: { label: "À faire", className: "border-slate-200 bg-slate-50 text-slate-600" },
  in_progress: { label: "En cours", className: "border-sky-200 bg-sky-50 text-sky-700" },
  submitted: { label: "Soumis", className: "border-amber-200 bg-amber-50 text-amber-700" },
  validated: { label: "Validé", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejeté", className: "border-rose-200 bg-rose-50 text-rose-700" },
  paid: { label: "Payé", className: "border-violet-200 bg-violet-50 text-violet-700" },
};

export function isActionable(status: AssignmentStatus): boolean {
  return status === "todo" || status === "in_progress" || status === "rejected";
}

export type Urgency = "overdue" | "soon" | "ok" | "none";

export function assignmentUrgency(
  dueDate: number,
  status: AssignmentStatus,
  now: number = Date.now(),
): Urgency {
  if (!isActionable(status)) return "none";
  if (dueDate < now) return "overdue";
  if (dueDate - now < 2 * DAY) return "soon";
  return "ok";
}

export const URGENCY_BADGE: Record<
  Exclude<Urgency, "none">,
  { label: string; className: string }
> = {
  overdue: { label: "En retard", className: "border-rose-300 bg-rose-100 text-rose-700" },
  soon: { label: "< 48 h", className: "border-amber-300 bg-amber-100 text-amber-700" },
  ok: { label: "Dans les temps", className: "border-slate-200 bg-slate-50 text-slate-500" },
};
