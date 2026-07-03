import { describe, it, expect } from "vitest";
import {
  videoTrackingStatus,
  aggregateVideoStats,
  publishedAgo,
  type TrackedVideoLike,
} from "./video-tracking";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 15); // 2026-07-15

describe("videoTrackingStatus", () => {
  it("métriques remontées → suivi actif", () => {
    expect(videoTrackingStatus(true)).toBe("active");
  });
  it("aucune métrique (vidéo fraîche) → en cours de calcul", () => {
    expect(videoTrackingStatus(false)).toBe("pending");
  });
});

describe("aggregateVideoStats — récap (période)", () => {
  const inJuly = (ts: number) =>
    new Date(ts).toISOString().slice(0, 7) === "2026-07";
  const videos: TrackedVideoLike[] = [
    { publishedAt: Date.UTC(2026, 6, 2), views: 1000, gain: 12.5 },
    { publishedAt: Date.UTC(2026, 6, 10), views: null, gain: 1.67 }, // fraîche
    { publishedAt: Date.UTC(2026, 5, 20), views: 9999, gain: 150 }, // mois précédent
  ];

  it("compte / somme vues / somme gains sur la période uniquement", () => {
    const s = aggregateVideoStats(videos, inJuly);
    expect(s.onlineCount).toBe(2); // exclut la vidéo de juin
    expect(s.totalViews).toBe(1000); // vues nulles comptées 0
    expect(s.totalGain).toBe(14.17); // 12,5 + 1,67
  });

  it("aucune vidéo dans la période → zéros", () => {
    expect(aggregateVideoStats(videos, () => false)).toEqual({
      onlineCount: 0,
      totalViews: 0,
      totalGain: 0,
    });
  });

  it("somme des gains arrondie au centime", () => {
    const s = aggregateVideoStats(
      [
        { publishedAt: NOW, views: 1, gain: 0.1 },
        { publishedAt: NOW, views: 1, gain: 0.2 },
      ],
      () => true,
    );
    expect(s.totalGain).toBe(0.3);
  });
});

describe("publishedAgo", () => {
  it("aujourd'hui / hier / jours / semaines / mois", () => {
    expect(publishedAgo(NOW, NOW)).toBe("aujourd'hui");
    expect(publishedAgo(NOW - DAY, NOW)).toBe("hier");
    expect(publishedAgo(NOW - 3 * DAY, NOW)).toBe("il y a 3 jours");
    expect(publishedAgo(NOW - 8 * DAY, NOW)).toBe("il y a 1 semaine");
    expect(publishedAgo(NOW - 20 * DAY, NOW)).toBe("il y a 2 semaines");
    expect(publishedAgo(NOW - 45 * DAY, NOW)).toBe("il y a 1 mois");
    expect(publishedAgo(NOW - 100 * DAY, NOW)).toBe("il y a 3 mois");
  });
  it("futur/clamp → aujourd'hui (jamais négatif)", () => {
    expect(publishedAgo(NOW + DAY, NOW)).toBe("aujourd'hui");
  });
});
