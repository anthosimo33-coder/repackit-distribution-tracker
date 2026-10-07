import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { imageSize } from "../convex/imageSize";

/** Dimensions lues dans les octets : de vraies images, encodées par sharp dans chaque variante. */
describe("imageSize", () => {
  const image = (alpha = 1) => sharp({ create: { width: 321, height: 654, channels: 4, background: { r: 18, g: 52, b: 86, alpha } } });
  const cas: Array<[string, () => Promise<Buffer>]> = [
    ["PNG", () => image().png().toBuffer()],
    ["JPEG", () => image().jpeg().toBuffer()],
    ["JPEG progressif", () => image().jpeg({ progressive: true }).toBuffer()],
    ["WebP avec perte (VP8)", () => image().removeAlpha().webp().toBuffer()],
    ["WebP sans perte (VP8L)", () => image().webp({ lossless: true }).toBuffer()],
    // Une transparence réelle force le conteneur étendu (vérifié : octets 12-15 = « VP8X »).
    ["WebP étendu (VP8X, transparence)", () => image(0.5).webp().toBuffer()],
  ];
  it.each(cas)("%s", async (_, encoder) => {
    expect(imageSize(new Uint8Array(await encoder()))).toEqual({ w: 321, h: 654 });
  });

  it("format inconnu ou tronqué : null", () => {
    expect(imageSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]))).toBeNull();
  });
});
