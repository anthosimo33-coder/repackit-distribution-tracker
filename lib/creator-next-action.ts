/**
 * LA PROCHAINE ACTION DE LA CRÉATRICE — la grande carte en tête d'« Aujourd'hui ».
 *
 * Module PUR. L'accueil empilait jusqu'à six blocs (rattrapage, post du jour,
 * à produire, à publier, à refaire, warmup) : tout était là, et rien ne disait
 * par quoi commencer. Ici on tranche UNE action ; le reste va dans « Ensuite ».
 *
 * ── L'ORDRE ─────────────────────────────────────────────────────────────────
 *   1. à rattraper    — une publication dont le jour est passé (le plus ancien) ;
 *   2. à publier aujourd'hui ;
 *   3. à refaire      — une vidéo refusée bloque sa mission ;
 *   4. onboarding     — tant que le compte n'est pas activé ;
 *   5. warmup du jour ;
 *   6. à publier      — validée, jour pas encore venu ;
 *   7. à tourner ;
 *   8. en validation  — rien à faire, mais pas « tout est à jour » ;
 *   9. tout est à jour.
 *
 * Le rattrapage passe AVANT la tâche du jour, pour la raison déjà écrite dans
 * `lib/creator-schedule` : un retard découvert sous la tâche du jour reste un
 * retard. Le prédicat est le MÊME (`isToCatchUp`) — deux définitions du retard
 * mettraient une mission en tête de l'accueil et pas dans la liste.
 *
 * Comptes GÉRÉS par l'équipe : jamais une action. La créatrice ne publie rien
 * dessus, lui demander de le faire serait absurde.
 */
import {
  isPlannedToday,
  representativePostedAt,
} from "../convex/calendarStatus";
import { isToCatchUp, sortBySchedule } from "./creator-schedule";
import type { DayPart } from "./day-part";

export type NextActionRow = {
  _id: string;
  status: string;
  managedByAdmin?: boolean;
  dueDate: number;
  postDate?: number | null;
  postWindow?: { startMin: number; endMin: number } | null;
  creatorTimezone?: string | null;
  publishedAt?: number | null;
  targets: { platform: string; publishedAt?: number | null }[];
};

export type NextAction<T extends NextActionRow> =
  | { kind: "catchup"; row: T; others: number }
  | { kind: "publishToday"; row: T; others: number }
  | { kind: "redo"; row: T; others: number }
  | { kind: "onboarding" }
  | { kind: "warmup"; count: number }
  | { kind: "publish"; row: T; others: number }
  | { kind: "produce"; row: T; others: number }
  | { kind: "waiting"; count: number }
  | { kind: "allClear" };

const ACTIONABLE = new Set(["todo", "in_progress", "video_rejected", "rejected", "to_publish"]);
const REDO = new Set(["video_rejected", "rejected"]);
const PRODUCE = new Set(["todo", "in_progress"]);
const WAITING = new Set(["video_submitted", "submitted"]);

/** Premier élément par chronologie de publication, puis par échéance. */
function first<T extends NextActionRow>(rows: T[], now: number): T {
  const withSchedule = rows.map((r) => ({
    ...r,
    publishedAt: representativePostedAt(r),
  }));
  const sorted = sortBySchedule(withSchedule, now);
  // Sans date de publication, sortBySchedule les laisse à égalité : l'échéance
  // de production départage, la plus proche d'abord.
  const head = sorted[0];
  const pool = sorted.filter(
    (r) => (r.postDate ?? null) === (head.postDate ?? null),
  );
  const pick = pool.sort((a, b) => a.dueDate - b.dueDate)[0];
  return rows.find((r) => r._id === pick._id)!;
}

export function nextCreatorAction<T extends NextActionRow>(input: {
  rows: readonly T[];
  now: number;
  warmupDue: number;
  /** Onboarding applicable et pas terminé (cf lib/onboarding). */
  onboardingPending: boolean;
  /** Moment de la journée CHEZ ELLE (cf lib/day-part). Absent = après-midi. */
  dayPart?: DayPart;
}): NextAction<T> {
  const { now, warmupDue, onboardingPending } = input;
  const mine = input.rows.filter((r) => !r.managedByAdmin);
  const actionable = mine.filter((r) => ACTIONABLE.has(r.status));

  const pick = (
    kind: "catchup" | "publishToday" | "redo" | "publish" | "produce",
    rows: T[],
  ): NextAction<T> | null =>
    rows.length === 0 ? null : { kind, row: first(rows, now), others: rows.length - 1 };

  const catchup = actionable.filter((r) =>
    isToCatchUp(
      { postDate: r.postDate, postWindow: r.postWindow, publishedAt: representativePostedAt(r) },
      now,
    ),
  );
  const toPublish = actionable.filter((r) => r.status === "to_publish");
  const today = toPublish.filter(
    (r) =>
      r.postDate != null &&
      representativePostedAt(r) === null &&
      isPlannedToday(r.postDate, now, r.creatorTimezone) &&
      !catchup.includes(r),
  );

  // Le TRAVAIL COURANT change d'ordre avec le moment de la journée. Le matin on
  // tourne (la lumière, le temps devant soi) ; ensuite on coche la chauffe et on
  // publie. Ce qui est URGENT ou BLOQUANT (rattrapage, publication du jour,
  // vidéo à refaire, onboarding) ne bouge jamais : l'heure ne rend pas un retard
  // moins en retard.
  const produce = pick("produce", actionable.filter((r) => PRODUCE.has(r.status)));
  const warmup: NextAction<T> | null =
    warmupDue > 0 ? { kind: "warmup", count: warmupDue } : null;
  const publish = pick("publish", toPublish);
  const routine =
    input.dayPart === "morning"
      ? (produce ?? warmup ?? publish)
      : (warmup ?? publish ?? produce);

  return (
    pick("catchup", catchup) ??
    pick("publishToday", today) ??
    pick("redo", actionable.filter((r) => REDO.has(r.status))) ??
    (onboardingPending ? { kind: "onboarding" } : null) ??
    routine ??
    (() => {
      const waiting = mine.filter((r) => WAITING.has(r.status)).length;
      return waiting > 0 ? { kind: "waiting" as const, count: waiting } : null;
    })() ?? { kind: "allClear" }
  );
}
