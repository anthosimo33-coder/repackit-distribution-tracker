/**
 * SÉRIE DE PUBLICATIONS À L'HEURE — « 6 d'affilée ».
 *
 * Module PUR. Le verdict « à l'heure / en retard / manqué » n'est PAS refait
 * ici : il vient de `calendarStatus`, la définition unique déjà lue par le
 * calendrier admin et les notifications de retard. Une série calculée sur une
 * autre définition dirait « à l'heure » là où le calendrier dit « en retard ».
 *
 * ── CE QUI COMPTE ───────────────────────────────────────────────────────────
 * Seuls les posts PASSÉS (à l'heure, en retard, manqués), dans l'ordre du jour
 * prévu. Un post à venir n'interrompt rien. Un retard OU un manqué remet la
 * série à zéro. Les comptes gérés par l'équipe et les missions annulées sont
 * hors série : la créatrice n'y publie rien.
 *
 * `current` = la série qui court encore (se termine sur le dernier post passé) ;
 * `best` = la plus longue jamais tenue.
 */
import {
  calendarStatus,
  representativePostedAt,
} from "../convex/calendarStatus";

export type StreakRow = {
  status: string;
  managedByAdmin?: boolean;
  postDate?: number | null;
  creatorTimezone?: string | null;
  publishedAt?: number | null;
  targets: { publishedAt?: number | null }[];
};

export function onTimeStreak(
  rows: readonly StreakRow[],
  now: number,
): { current: number; best: number } {
  const past = rows
    .filter((r) => !r.managedByAdmin && r.status !== "cancelled" && r.postDate != null)
    .map((r) => {
      const postedAt = representativePostedAt(r);
      return {
        postDate: r.postDate as number,
        postedAt,
        verdict: calendarStatus({
          postDate: r.postDate,
          postedAt,
          now,
          timeZone: r.creatorTimezone,
        }),
      };
    })
    .filter((x) => x.verdict === "on_time" || x.verdict === "late" || x.verdict === "missed")
    // Jour prévu, puis heure de publication : deux posts du même jour se
    // rangent dans l'ordre où ils sont sortis.
    .sort((a, b) => a.postDate - b.postDate || (a.postedAt ?? 0) - (b.postedAt ?? 0));

  let run = 0;
  let best = 0;
  for (const p of past) {
    run = p.verdict === "on_time" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current: run, best };
}
