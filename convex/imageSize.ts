/**
 * Dimensions d'une image lues dans ses premiers octets — JPEG, PNG, WebP — sans
 * la décoder (aucune bibliothèque d'image dans le runtime Convex). Sert à poser
 * une photo récupérée par le MCP dans le bon cadre. `null` : format inconnu.
 */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const u16be = (o: number) => (b[o] << 8) | b[o + 1];
  const u16le = (o: number) => b[o] | (b[o + 1] << 8);
  const u24le = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
  const u32be = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

  // PNG : signature, puis le bloc IHDR (largeur, hauteur en big-endian).
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {
    return { w: u32be(16), h: u32be(20) };
  }
  // JPEG : on saute de segment en segment jusqu'à un SOF (hors DHT, JPG, DAC).
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1];
      if (marker === 0xff) {
        o++;
        continue;
      }
      const len = u16be(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: u16be(o + 7), h: u16be(o + 5) };
      }
      o += 2 + len;
    }
    return null;
  }
  // WebP : RIFF….WEBP puis VP8 (avec perte), VP8L (sans perte) ou VP8X (étendu).
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ") return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { w: u24le(24) + 1, h: u24le(27) + 1 };
  }
  return null;
}
