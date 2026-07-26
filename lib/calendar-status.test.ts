import { describe, it, expect } from "vitest";
import {
  calendarStatus,
  isPastPost,
  CALENDAR_STATUS_LABEL,
  type CalendarStatus,
} from "./calendar-status";

/** ms LOCAL d'un instant (mois 1-12) — postDate/postedAt/now dans le même
 *  référentiel local, donc le test est indépendant de la TZ du runner. */
function at(y: number, mon: number, day: number, h = 12): number {
  return new Date(y, mon - 1, day, h, 0, 0, 0).getTime();
}

describe("calendarStatus — 4 cas + bords (aucune tolérance)", () => {
  it("none : pas de date de post planifiée", () => {
    expect(
      calendarStatus({ postDate: null, postedAt: null, now: at(2026, 7, 15) }),
    ).toBe("none");
    expect(
      calendarStatus({
        postDate: undefined,
        postedAt: at(2026, 7, 15),
        now: at(2026, 7, 15),
      }),
    ).toBe("none");
  });

  it("à l'heure : publié le jour EXACT (même jour calendaire)", () => {
    // Heures différentes, même jour → à l'heure.
    expect(
      calendarStatus({
        postDate: at(2026, 7, 15, 0),
        postedAt: at(2026, 7, 15, 23),
        now: at(2026, 7, 15),
      }),
    ).toBe("on_time");
  });

  it("à l'heure : indépendant de `now` (post passé jugé à l'heure)", () => {
    expect(
      calendarStatus({
        postDate: at(2026, 7, 10),
        postedAt: at(2026, 7, 10, 9),
        now: at(2026, 7, 30),
      }),
    ).toBe("on_time");
  });

  it("en retard : publié un jour POSTÉRIEUR (J+1)", () => {
    expect(
      calendarStatus({
        postDate: at(2026, 7, 15),
        postedAt: at(2026, 7, 16),
        now: at(2026, 7, 16),
      }),
    ).toBe("late");
  });

  it("en retard : publié un AUTRE jour même antérieur (0 tolérance)", () => {
    expect(
      calendarStatus({
        postDate: at(2026, 7, 15),
        postedAt: at(2026, 7, 14),
        now: at(2026, 7, 15),
      }),
    ).toBe("late");
  });

  it("en retard : franchit le mois (30/06 prévu → 01/07 publié)", () => {
    expect(
      calendarStatus({
        postDate: at(2026, 6, 30),
        postedAt: at(2026, 7, 1),
        now: at(2026, 7, 1),
      }),
    ).toBe("late");
  });

  it("manqué : jour prévu ENTIÈREMENT passé, aucune publication", () => {
    expect(
      calendarStatus({
        postDate: at(2026, 7, 15),
        postedAt: null,
        now: at(2026, 7, 16, 0),
      }),
    ).toBe("missed");
  });

  it("prévu : jour prévu dans le futur, pas de publication", () => {
    expect(
      calendarStatus({
        postDate: at(2026, 7, 20),
        postedAt: null,
        now: at(2026, 7, 15),
      }),
    ).toBe("scheduled");
  });

  it("bord : jour MÊME non encore publié = prévu (journée pas finie)", () => {
    // now = le jour prévu, tard, mais pas encore publié → prévu, PAS manqué.
    expect(
      calendarStatus({
        postDate: at(2026, 7, 15),
        postedAt: null,
        now: at(2026, 7, 15, 23),
      }),
    ).toBe("scheduled");
  });
});

describe("helpers", () => {
  it("isPastPost : postés/manqués sont passés, prévu/none non", () => {
    const past: CalendarStatus[] = ["on_time", "late", "missed"];
    const notPast: CalendarStatus[] = ["scheduled", "none"];
    past.forEach((s) => expect(isPastPost(s)).toBe(true));
    notPast.forEach((s) => expect(isPastPost(s)).toBe(false));
  });

  it("labels : une étiquette FR par statut", () => {
    (
      ["on_time", "late", "missed", "scheduled", "none"] as CalendarStatus[]
    ).forEach((s) => expect(CALENDAR_STATUS_LABEL[s]).toBeTruthy());
  });
});
