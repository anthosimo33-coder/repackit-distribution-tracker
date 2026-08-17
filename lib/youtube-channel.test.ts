/**
 * Compteurs de chaîne YouTube (`convex/youtubeChannel.ts`).
 *
 * Les réponses de test ont la forme réelle de `channels.list` : compteurs en
 * CHAÎNES, et `subscriberCount` ABSENT quand la chaîne les masque.
 */
import { describe, it, expect } from "vitest";
import { parseChannelStats, youtubeHandleFrom } from "../convex/youtubeChannel";

const reponse = (statistics: Record<string, string>) => ({
  kind: "youtube#channelListResponse",
  items: [{ kind: "youtube#channel", id: "UCabc123", statistics }],
});

describe("parseChannelStats", () => {
  it("lit des compteurs rendus en chaînes", () => {
    expect(
      parseChannelStats(
        "@thekellychapters",
        reponse({ subscriberCount: "18430", viewCount: "1204900", videoCount: "87" }),
      ),
    ).toEqual({
      handle: "@thekellychapters",
      subscribers: 18_430,
      totalViews: 1_204_900,
    });
  });

  it("abonnés MASQUÉS → null, jamais 0", () => {
    // hiddenSubscriberCount: true fait DISPARAÎTRE le champ. Afficher « 0 »
    // pour une chaîne qui masque ses abonnés serait un mensonge, et le delta
    // suivant lirait une chute de 18 430 à 0.
    const r = parseChannelStats("@masquee", reponse({ viewCount: "500000" }));
    expect(r).toEqual({
      handle: "@masquee",
      subscribers: null,
      totalViews: 500_000,
    });
  });

  it("chaîne introuvable → null (distinct de compteurs masqués)", () => {
    expect(parseChannelStats("@fantome", { items: [] })).toBeNull();
    expect(parseChannelStats("@fantome", {})).toBeNull();
    expect(parseChannelStats("@fantome", null)).toBeNull();
  });

  it("un zéro MESURÉ reste zéro", () => {
    const r = parseChannelStats("@neuve", reponse({ subscriberCount: "0", viewCount: "0" }));
    expect(r?.subscribers).toBe(0);
    expect(r?.totalViews).toBe(0);
  });
});

describe("youtubeHandleFrom", () => {
  it("accepte « @nom », « nom » et une URL de chaîne", () => {
    expect(youtubeHandleFrom("@kelly")).toBe("@kelly");
    expect(youtubeHandleFrom("kelly")).toBe("@kelly");
    expect(youtubeHandleFrom("https://www.youtube.com/@kelly")).toBe("@kelly");
    expect(youtubeHandleFrom("  youtube.com/@kelly/videos  ")).toBe("@kelly");
  });

  it("rejette ce qui n'est pas un handle", () => {
    expect(youtubeHandleFrom("")).toBeNull();
    expect(youtubeHandleFrom("   ")).toBeNull();
    expect(youtubeHandleFrom(null)).toBeNull();
    expect(youtubeHandleFrom(undefined)).toBeNull();
    // Une URL de VIDÉO n'est pas une chaîne.
    expect(youtubeHandleFrom("https://youtube.com/watch?v=abc")).toBeNull();
  });
});
