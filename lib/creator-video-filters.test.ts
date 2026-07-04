import { describe, it, expect } from "vitest";
import {
  matchesCreatorVideoFilter,
  countCreatorVideosByFilter,
  type CreatorVideoStatus,
} from "./creator-video-filters";

describe("matchesCreatorVideoFilter", () => {
  it("'all' accepte tout le périmètre", () => {
    const statuses: CreatorVideoStatus[] = [
      "video_submitted",
      "video_rejected",
      "to_publish",
      "published",
      "paid",
    ];
    for (const s of statuses) {
      expect(matchesCreatorVideoFilter(s, "all")).toBe(true);
    }
  });

  it("'pending' = video_submitted uniquement", () => {
    expect(matchesCreatorVideoFilter("video_submitted", "pending")).toBe(true);
    expect(matchesCreatorVideoFilter("video_rejected", "pending")).toBe(false);
    expect(matchesCreatorVideoFilter("to_publish", "pending")).toBe(false);
  });

  it("'online' GROUPE to_publish + published + paid", () => {
    expect(matchesCreatorVideoFilter("to_publish", "online")).toBe(true);
    expect(matchesCreatorVideoFilter("published", "online")).toBe(true);
    expect(matchesCreatorVideoFilter("paid", "online")).toBe(true);
    expect(matchesCreatorVideoFilter("video_submitted", "online")).toBe(false);
    expect(matchesCreatorVideoFilter("video_rejected", "online")).toBe(false);
  });

  it("'rejected' = video_rejected uniquement", () => {
    expect(matchesCreatorVideoFilter("video_rejected", "rejected")).toBe(true);
    expect(matchesCreatorVideoFilter("published", "rejected")).toBe(false);
  });
});

describe("countCreatorVideosByFilter", () => {
  it("compte chaque filtre (all = total ; online groupe 3 statuts)", () => {
    const videos: { status: CreatorVideoStatus }[] = [
      { status: "video_submitted" },
      { status: "video_submitted" },
      { status: "video_rejected" },
      { status: "to_publish" },
      { status: "published" },
      { status: "paid" },
    ];
    expect(countCreatorVideosByFilter(videos)).toEqual({
      all: 6,
      pending: 2,
      online: 3,
      rejected: 1,
    });
  });

  it("liste vide → tous à 0", () => {
    expect(countCreatorVideosByFilter([])).toEqual({
      all: 0,
      pending: 0,
      online: 0,
      rejected: 0,
    });
  });
});
