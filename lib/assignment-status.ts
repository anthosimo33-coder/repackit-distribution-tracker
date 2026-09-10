/**
 * Libellés + urgence des assignments (pur). Machine à états MP4 :
 *   todo → in_progress → video_submitted → [reject] video_rejected →
 *   video_submitted → [approve] to_publish → published → paid.
 * Urgence calculée seulement pour les statuts ACTIONNABLES par le créateur
 * (todo/in_progress/video_rejected/to_publish). Les littéraux LEGACY
 * (submitted/validated/rejected) restent typés/affichables le temps de la
 * migration (ne devraient plus apparaître ensuite).
 */
export type AssignmentStatus =
  | "todo"
  | "in_progress"
  | "video_submitted"
  | "video_rejected"
  | "to_publish"
  | "published"
  | "paid"
  // ABANDON — l'assignation ne sera jamais publiée. Terminal, distinct de
  // video_rejected (là, la vidéo est refusée mais la mission continue).
  // Un abandon LIBÈRE le comboKey : contenu jamais vu = rien à protéger.
  | "cancelled"
  // LEGACY (migrés) :
  | "submitted"
  | "validated"
  | "rejected";

const DAY = 86_400_000;

/**
 * Table de CLÉS i18n, pas de libellés. La table est PARTAGÉE entre le portail
 * créateur et le pilotage admin : chaque audience résout la clé dans SA langue,
 * là où un libellé figé aurait imposé le français à tout le monde.
 */
export const ASSIGNMENT_STATUS: Record<
  AssignmentStatus,
  { labelKey: string; className: string }
> = {
  todo: { labelKey: "status.assignment.todo", className: "border-slate-200 bg-slate-50 text-slate-600" },
  // in_progress = accent RepackIt (orange #FF5200) — suit projects.accentColor
  // via le token --primary (cf globals.css + injection P10).
  in_progress: { labelKey: "status.assignment.in_progress", className: "border-primary/30 bg-primary/10 text-primary" },
  video_submitted: { labelKey: "status.assignment.video_submitted", className: "border-amber-200 bg-amber-50 text-amber-700" },
  video_rejected: { labelKey: "status.assignment.video_rejected", className: "border-rose-200 bg-rose-50 text-rose-700" },
  to_publish: { labelKey: "status.assignment.to_publish", className: "border-primary/30 bg-primary/10 text-primary" },
  published: { labelKey: "status.assignment.published", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  paid: { labelKey: "status.assignment.paid", className: "border-violet-200 bg-violet-50 text-violet-700" },
  cancelled: { labelKey: "status.assignment.cancelled", className: "border-slate-200 bg-slate-100 text-slate-500" },
  // LEGACY :
  submitted: { labelKey: "status.assignment.submitted", className: "border-amber-200 bg-amber-50 text-amber-700" },
  validated: { labelKey: "status.assignment.validated", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { labelKey: "status.assignment.rejected", className: "border-rose-200 bg-rose-50 text-rose-700" },
};

/** Statuts où LE CRÉATEUR doit agir (≠ en attente d'admin, ≠ terminé). */
export function isActionable(status: AssignmentStatus): boolean {
  return (
    status === "todo" ||
    status === "in_progress" ||
    status === "video_rejected" ||
    status === "to_publish" ||
    status === "rejected" // legacy
  );
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

/**
 * Rang d'urgence pour l'ORDRE d'affichage (0 = le plus urgent). Sert de bucket
 * EXTÉRIEUR à l'entrelacement des formats (lib/assignment-order) : on alterne
 * les formats DANS un rang, quelles que soient leurs échéances, mais les rangs
 * restent ordonnés — en retard, puis < 48 h, puis dans les temps, puis les
 * missions non actionnables (en revue / publiées / payées). Cohérent avec les
 * badges (`assignmentUrgency`) : ce qui est badgé « En retard » remonte en tête.
 */
export function urgencyRank(u: Urgency): number {
  switch (u) {
    case "overdue":
      return 0;
    case "soon":
      return 1;
    case "ok":
      return 2;
    case "none":
      return 3;
  }
}

export const URGENCY_BADGE: Record<
  Exclude<Urgency, "none">,
  { labelKey: string; className: string }
> = {
  overdue: { labelKey: "status.urgency.overdue", className: "border-rose-300 bg-rose-100 text-rose-700" },
  soon: { labelKey: "status.urgency.soon", className: "border-amber-300 bg-amber-100 text-amber-700" },
  ok: { labelKey: "status.urgency.ok", className: "border-slate-200 bg-slate-50 text-slate-500" },
};
