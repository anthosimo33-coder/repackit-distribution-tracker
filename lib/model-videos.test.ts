import { describe, it, expect } from "vitest";
import {
  normalizeModelVideoUrl,
  removeModelVideoById,
  type ModelVideo,
} from "./model-videos";

describe("normalizeModelVideoUrl", () => {
  it("trim et accepte une URL http(s) valide", () => {
    expect(normalizeModelVideoUrl("  https://tiktok.com/@x/video/1  ")).toBe(
      "https://tiktok.com/@x/video/1",
    );
    expect(normalizeModelVideoUrl("http://youtu.be/abc")).toBe(
      "http://youtu.be/abc",
    );
  });

  it("rejette le vide / whitespace", () => {
    expect(normalizeModelVideoUrl("")).toBeNull();
    expect(normalizeModelVideoUrl("   ")).toBeNull();
  });

  it("rejette ce qui n'est pas http(s)://", () => {
    expect(normalizeModelVideoUrl("tiktok.com/@x")).toBeNull();
    expect(normalizeModelVideoUrl("ftp://x")).toBeNull();
    expect(normalizeModelVideoUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeModelVideoUrl("https://")).toBeNull(); // pas de contenu après
  });
});

describe("removeModelVideoById", () => {
  const list: ModelVideo[] = [
    { id: "a", url: "https://x/1", addedAt: 1 },
    { id: "b", url: "https://x/2", addedAt: 2 },
    { id: "c", url: "https://x/3", addedAt: 3 },
  ];

  it("retire l'item ciblé sans muter la source", () => {
    const out = removeModelVideoById(list, "b");
    expect(out.map((v) => v.id)).toEqual(["a", "c"]);
    expect(list).toHaveLength(3); // immuable
  });

  it("no-op si l'id est absent", () => {
    expect(removeModelVideoById(list, "zzz")).toHaveLength(3);
  });
});
