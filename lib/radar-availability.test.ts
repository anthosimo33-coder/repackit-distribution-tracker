import { describe, expect, it } from "vitest";
import {
  CHECKS_PER_RUN,
  CHECK_WINDOW_MS,
  DARK_MIN_ACCOUNTS,
  RECHECK_UNAVAILABLE_MS,
  RECHECK_VISIBLE_MS,
  darkStep,
  isDue,
  isTikTokVideoId,
  outcomeOf,
  parisHourOf,
  pickDue,
  quietHour,
  reasonOf,
} from "../convex/radarAvailabilityMath";
import { parseTikTokPublicPage } from "../convex/tiktokPublicPage";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 10 novembre 2026, 19 h à Paris (18 h UTC).
const NOW = Date.UTC(2026, 10, 10, 18, 0);

/** Les messages que TikTok a servis le 10/11/2026 sur les 1 906 vidéos signalées (127 refus). */
describe("pourquoi une vidéo n'est plus visible", () => {
  it("le motif se lit dans le message : le même code 10204 sert pour tout", () => {
    // 101 vidéos : @gigi.girlytea et 21 autres comptes de FollowSpy et FollowOtter.
    expect(reasonOf(10222, "author_secret")).toBe("private");
    expect(reasonOf(10231, "cross_border_violation")).toBe("region");
    expect(reasonOf(10204, "status_deleted")).toBe("removed");
    expect(reasonOf(10204, "item doesn't exist")).toBe("removed");
    expect(reasonOf(10204, "content_classification,status_reviewing")).toBe("review");
    expect(reasonOf(10204, "content_classification,status_audit_not_pass")).toBe("review");
    expect(reasonOf(10204, "status_friend_see")).toBe("restricted");
    expect(reasonOf(10204, "item_privacy_authorization&status_self_see")).toBe("restricted");
    expect(reasonOf(10204, "")).toBe("other");
  });

  it("deux motifs joints : le compte privé l'emporte, il vaut pour toutes ses vidéos", () => {
    expect(reasonOf(10222, "author_secret,cross_border_violation")).toBe("private");
    expect(reasonOf(10222, "author_secret,content_classification")).toBe("private");
    expect(reasonOf(10231, "content_classification,cross_border_violation")).toBe("region");
  });

  it("sans message, le code : 10222 compte privé, 10231 hors région", () => {
    expect(reasonOf(10222, "")).toBe("private");
    expect(reasonOf(10231, "")).toBe("region");
  });

  it("de la page lue au constat : servie, refusée avec son motif, ou illisible (on ne conclut rien)", () => {
    const page = (detail: unknown) => `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.video-detail": detail } })}</script>`;
    const servie = parseTikTokPublicPage(page({ statusCode: 0, statusMsg: "", itemInfo: { itemStruct: { id: "7704754488321527053", stats: { playCount: 56798 } } } }), "7704754488321527053");
    expect(outcomeOf(servie)).toEqual({ kind: "visible" });
    // La page de la vidéo de la capture, le 10/11/2026.
    const privee = parseTikTokPublicPage(page({ statusCode: 10222, statusMsg: "author_secret" }), "7704754488321527053");
    expect(outcomeOf(privee)).toEqual({ kind: "unavailable", reason: "private" });
    // TikTok ne répond pas à cette IP, ou la page a changé : ni visible, ni invisible.
    expect(outcomeOf(parseTikTokPublicPage("<html>captcha</html>", "7704754488321527053"))).toEqual({ kind: "unknown" });
  });
});

describe("quelles vidéos contrôler", () => {
  const v = (o: Partial<{ platform: string; publishedAt: number; checkedAt: number | null; unavailable: { reason: "private" } | null }> = {}) => ({ platform: "tiktok", publishedAt: NOW - 2 * DAY, ...o });

  it("TikTok seulement, publiée depuis 8 jours au plus", () => {
    expect(isDue(v(), NOW)).toBe(true);
    expect(isDue(v({ platform: "instagram" }), NOW)).toBe(false);
    expect(isDue(v({ publishedAt: NOW - CHECK_WINDOW_MS - HOUR }), NOW)).toBe(false);
    expect(isDue(v({ publishedAt: NOW - CHECK_WINDOW_MS + HOUR }), NOW)).toBe(true);
  });

  it("seul un vrai identifiant TikTok est lu : jamais une vidéo semée par un test", () => {
    expect(isTikTokVideoId("7704754488321527053")).toBe(true);
    expect(isTikTokVideoId("e2einv17943276050312")).toBe(false);
    expect(isTikTokVideoId("ig:DQx1abc")).toBe(false);
    expect(isTikTokVideoId("12345")).toBe(false);
    expect(isTikTokVideoId("")).toBe(false);
  });

  it("visible : recontrôlée au bout de 2 jours ; invisible : chaque jour, le compte peut redevenir public", () => {
    expect(isDue(v({ checkedAt: NOW - RECHECK_VISIBLE_MS + HOUR }), NOW)).toBe(false);
    expect(isDue(v({ checkedAt: NOW - RECHECK_VISIBLE_MS }), NOW)).toBe(true);
    expect(isDue(v({ checkedAt: NOW - RECHECK_UNAVAILABLE_MS + HOUR, unavailable: { reason: "private" } }), NOW)).toBe(false);
    expect(isDue(v({ checkedAt: NOW - RECHECK_UNAVAILABLE_MS, unavailable: { reason: "private" } }), NOW)).toBe(true);
  });

  it("un passage : jamais contrôlées d'abord (les plus fortes), puis les contrôles les plus anciens", () => {
    const rows = [
      { id: "vieux-controle", handle: "a", score: 500, checkedAt: NOW - 5 * DAY, ...v() },
      { id: "jamais-faible", handle: "b", score: 4, ...v() },
      { id: "jamais-forte", handle: "c", score: 286, ...v() },
      { id: "controle-recent", handle: "d", score: 900, checkedAt: NOW - HOUR, ...v() },
      { id: "controle-ancien", handle: "e", score: 2, checkedAt: NOW - 3 * DAY, ...v() },
    ];
    expect(pickDue(rows, NOW, 10).map((r) => r.id)).toEqual(["jamais-forte", "jamais-faible", "vieux-controle", "controle-ancien"]);
    expect(pickDue(rows, NOW, 2).map((r) => r.id)).toEqual(["jamais-forte", "jamais-faible"]);
  });

  it("une seule vidéo par compte et par passage : un compte privé vaut pour toutes ses vidéos", () => {
    // @lily.girltea : 16 vidéos signalées, toutes invisibles pour la même raison.
    const rows = Array.from({ length: 16 }, (_, i) => ({ id: `lily-${i}`, handle: "Lily.GirlTea", score: 16 - i, ...v() }));
    rows.push({ id: "autre", handle: "court.girlcode", score: 1, ...v() });
    expect(pickDue(rows, NOW, CHECKS_PER_RUN).map((r) => r.id)).toEqual(["lily-0", "autre"]);
  });

  it("pas de contrôle à 23 h ni à minuit, heure de Paris : le relevé de vues de la paie lit les mêmes pages", () => {
    // 22 h 50 UTC en novembre = 23 h 50 à Paris ; en juillet (heure d'été), 21 h 50 UTC.
    expect(parisHourOf(Date.UTC(2026, 10, 10, 22, 50))).toBe(23);
    expect(parisHourOf(Date.UTC(2026, 6, 10, 21, 50))).toBe(23);
    expect(parisHourOf(Date.UTC(2026, 10, 10, 23, 50))).toBe(0);
    expect(quietHour(23)).toBe(true);
    expect(quietHour(0)).toBe(true);
    expect(quietHour(22)).toBe(false);
    expect(quietHour(1)).toBe(false);
  });
});

describe("le réseau d'une concurrente passe en privé", () => {
  it("on prévient à partir de 5 comptes, une fois, quand le nombre ne bouge plus", () => {
    expect(DARK_MIN_ACCOUNTS).toBe(5);
    // Le contrôle découvre la vague de FollowSpy compte par compte : 4, 9, 22, 22.
    expect(darkStep(4, undefined, undefined)).toEqual({ alert: false, seen: 4, alerted: undefined });
    expect(darkStep(9, 4, undefined)).toEqual({ alert: false, seen: 9, alerted: undefined });
    expect(darkStep(22, 9, undefined)).toEqual({ alert: false, seen: 22, alerted: undefined });
    // Stable d'un passage à l'autre : une alerte, avec le vrai nombre.
    expect(darkStep(22, 22, undefined)).toEqual({ alert: true, seen: 22, alerted: 22 });
    // Les passages suivants ne préviennent plus.
    expect(darkStep(22, 22, 22)).toEqual({ alert: false, seen: 22, alerted: 22 });
    expect(darkStep(30, 22, 22)).toEqual({ alert: false, seen: 30, alerted: 22 });
    expect(darkStep(30, 30, 22)).toEqual({ alert: false, seen: 30, alerted: 22 });
  });

  it("de nouveau si la vague double ; et une prochaine vague prévient après un retour sous le seuil", () => {
    expect(darkStep(44, 30, 22)).toEqual({ alert: false, seen: 44, alerted: 22 });
    expect(darkStep(44, 44, 22)).toEqual({ alert: true, seen: 44, alerted: 44 });
    // Les comptes sont redevenus publics : on oublie l'alerte.
    expect(darkStep(2, 22, 22)).toEqual({ alert: false, seen: 2, alerted: undefined });
    expect(darkStep(0, 2, undefined)).toEqual({ alert: false, seen: undefined, alerted: undefined });
    // Une nouvelle vague, comptée : elle prévient.
    expect(darkStep(6, 6, undefined).alert).toBe(true);
  });
});
