import { describe, it, expect } from "vitest";
import {
  extractYouTubeId,
  youTubeEmbedUrl,
  tiktokOembedUrl,
  tiktokPlayerEmbedUrl,
  tiktokCanonicalVideoUrl,
} from "./embed";

describe("extractYouTubeId", () => {
  it("watch?v=", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(
      extractYouTubeId("https://youtube.com/watch?v=abc123XYZ&t=10s"),
    ).toBe("abc123XYZ");
  });
  it("youtu.be / shorts / embed", () => {
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(
      extractYouTubeId("https://www.youtube.com/shorts/AbCdEf12345"),
    ).toBe("AbCdEf12345");
    expect(
      extractYouTubeId("https://www.youtube.com/embed/AbCdEf12345"),
    ).toBe("AbCdEf12345");
  });
  it("non reconnu → null", () => {
    expect(extractYouTubeId("https://tiktok.com/@x/video/1")).toBeNull();
    expect(extractYouTubeId("")).toBeNull();
  });
});

describe("youTubeEmbedUrl", () => {
  it("construit l'URL nocookie", () => {
    expect(youTubeEmbedUrl("abc")).toBe(
      "https://www.youtube-nocookie.com/embed/abc",
    );
  });
});

describe("tiktokOembedUrl", () => {
  it("encode l'URL source", () => {
    expect(tiktokOembedUrl("https://www.tiktok.com/@u/video/123")).toBe(
      "https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40u%2Fvideo%2F123",
    );
  });
});

describe("tiktokPlayerEmbedUrl", () => {
  it("construit l'URL du lecteur officiel depuis l'id", () => {
    expect(tiktokPlayerEmbedUrl("7655457745159720205")).toBe(
      "https://www.tiktok.com/player/v1/7655457745159720205?rel=0&description=0",
    );
  });
});

describe("tiktokCanonicalVideoUrl", () => {
  it("reconstruit l'URL canonique depuis handle + id", () => {
    expect(tiktokCanonicalVideoUrl("khaby.lame", "123")).toBe(
      "https://www.tiktok.com/@khaby.lame/video/123",
    );
  });
  it("tolère un @ en préfixe du handle", () => {
    expect(tiktokCanonicalVideoUrl("@charlidamelio", "456")).toBe(
      "https://www.tiktok.com/@charlidamelio/video/456",
    );
  });
});
