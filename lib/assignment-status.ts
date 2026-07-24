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
  // LEGACY (migrés) :
  | "submitted"
  | "validated"
  | "rejected";

const DAY = 86_400_000;

export const ASSIGNMENT_STATUS: Record<
  AssignmentStatus,
  { label: string; className: string }
> = {
  todo: { label: "À faire", className: "border-slate-200 bg-slate-50 text-slate-600" },
  // in_progress = accent RepackIt (orange #FF5200) — suit projects.accentColor
  // via le token --primary (cf globals.css + injection P10).
  in_progress: { label: "En cours", className: "border-primary/30 bg-primary/10 text-primary" },
  video_submitted: { label: "Vidéo en revue", className: "border-amber-200 bg-amber-50 text-amber-700" },
  video_rejected: { label: "Vidéo à refaire", className: "border-rose-200 bg-rose-50 text-rose-700" },
  to_publish: { label: "À publier", className: "border-primary/30 bg-primary/10 text-primary" },
  published: { label: "Publié", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  paid: { label: "Payé", className: "border-violet-200 bg-violet-50 text-violet-700" },
  // LEGACY :
  submitted: { label: "Soumis", className: "border-amber-200 bg-amber-50 text-amber-700" },
  validated: { label: "Validé", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejeté", className: "border-rose-200 bg-rose-50 text-rose-700" },
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
  { label: string; className: string }
> = {
  overdue: { label: "En retard", className: "border-rose-300 bg-rose-100 text-rose-700" },
  soon: { label: "< 48 h", className: "border-amber-300 bg-amber-100 text-amber-700" },
  ok: { label: "Dans les temps", className: "border-slate-200 bg-slate-50 text-slate-500" },
};
