import { describe, it, expect } from "vitest";
import { extractYouTubeId, youTubeEmbedUrl, tiktokOembedUrl } from "./embed";

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
