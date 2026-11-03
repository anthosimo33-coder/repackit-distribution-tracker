import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { dureeVideoMp4, estVideoMp4, type LireOctets } from "../convex/videoDuration";

/**
 * DURÉE D'UNE VIDÉO lue dans l'en-tête (convex/videoDuration) — sur de VRAIS
 * fichiers sortis de ffmpeg (7,4 s), dans les trois rangements qu'on rencontre :
 * `moov` après les données (le défaut, et celui d'un export WhatsApp), `moov` en
 * tête (faststart), et QuickTime (.mov d'un iPhone). Le lecteur note chaque
 * plage lue : la durée doit sortir SANS lire les données de la vidéo.
 */
const fixture = (nom: string) => new Uint8Array(readFileSync(join(process.cwd(), "e2e/fixtures", nom)));

function lecteur(octets: Uint8Array) {
  const lectures: [number, number][] = [];
  const lire: LireOctets = async (debut, fin) => {
    lectures.push([debut, fin]);
    return octets.slice(debut, Math.min(fin, octets.length));
  };
  return { lire, lectures };
}

describe("dureeVideoMp4 — fichiers réels", () => {
  for (const nom of ["video-7s4.mp4", "video-7s4-faststart.mp4", "video-7s4.mov"]) {
    it(`${nom} : 7,4 s, sans lire les données`, async () => {
      const octets = fixture(nom);
      const { lire, lectures } = lecteur(octets);
      const d = await dureeVideoMp4(lire, octets.length);
      expect(d).not.toBeNull();
      expect(d!).toBeCloseTo(7.4, 2);
      // Des en-têtes de 16 octets, et UNE lecture longue : la boîte moov.
      expect(lectures.filter(([a, b]) => b - a > 16)).toHaveLength(1);
      const lus = lectures.reduce((s, [a, b]) => s + (b - a), 0);
      expect(lus).toBeLessThan(octets.length / 2);
    });
  }

  it("film fragmenté sans durée déclarée : non lue (null), jamais 0", async () => {
    const octets = fixture("video-7s4-frag.mp4");
    const { lire } = lecteur(octets);
    expect(await dureeVideoMp4(lire, octets.length)).toBeNull();
  });

  it("fichier tronqué avant moov : null", async () => {
    const octets = fixture("video-7s4.mp4").slice(0, 15_000);
    const { lire } = lecteur(octets);
    expect(await dureeVideoMp4(lire, octets.length)).toBeNull();
  });
});

// ─── Boîtes construites à la main : les formes que ffmpeg n'écrit pas ici ───

const boite = (type: string, contenu: Uint8Array, taille?: number) => {
  const b = new Uint8Array(8 + contenu.length);
  new DataView(b.buffer).setUint32(0, taille ?? b.length);
  b.set([...type].map((c) => c.charCodeAt(0)), 4);
  b.set(contenu, 8);
  return b;
};
const concat = (...xs: Uint8Array[]) => {
  const out = new Uint8Array(xs.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of xs) {
    out.set(x, p);
    p += x.length;
  }
  return out;
};
/** mvhd version 0 : échelle et durée sur 32 bits. */
const mvhd0 = (echelle: number, duree: number) => {
  const c = new Uint8Array(100);
  const dv = new DataView(c.buffer);
  dv.setUint32(12, echelle);
  dv.setUint32(16, duree);
  return boite("mvhd", c);
};
/** mvhd version 1 : dates et durée sur 64 bits. */
const mvhd1 = (echelle: number, duree: number) => {
  const c = new Uint8Array(112);
  const dv = new DataView(c.buffer);
  c[0] = 1;
  dv.setUint32(20, echelle);
  dv.setUint32(24, Math.floor(duree / 2 ** 32));
  dv.setUint32(28, duree % 2 ** 32);
  return boite("mvhd", c);
};

describe("dureeVideoMp4 — formes rares", () => {
  it("mvhd version 1, après un mdat à taille 64 bits", async () => {
    // mdat « largesize » : taille 1 puis la vraie taille sur 8 octets.
    const donnees = new Uint8Array(5000);
    const mdat = new Uint8Array(16 + donnees.length);
    const dv = new DataView(mdat.buffer);
    dv.setUint32(0, 1);
    mdat.set([..."mdat"].map((c) => c.charCodeAt(0)), 4);
    dv.setUint32(12, mdat.length);
    const fichier = concat(boite("ftyp", new Uint8Array(16)), mdat, boite("moov", mvhd1(90_000, 1_234_567)));
    const { lire, lectures } = lecteur(fichier);
    expect(await dureeVideoMp4(lire, fichier.length)).toBeCloseTo(1_234_567 / 90_000, 6);
    expect(lectures.some(([a]) => a > 40 && a < 16 + 24 + donnees.length)).toBe(false);
  });

  it("durée « inconnue » (0xFFFFFFFF) : null", async () => {
    const fichier = concat(boite("ftyp", new Uint8Array(8)), boite("moov", mvhd0(600, 0xffffffff)));
    const { lire } = lecteur(fichier);
    expect(await dureeVideoMp4(lire, fichier.length)).toBeNull();
  });

  it("échelle nulle : null (pas de division par zéro)", async () => {
    const fichier = concat(boite("ftyp", new Uint8Array(8)), boite("moov", mvhd0(0, 600)));
    const { lire } = lecteur(fichier);
    expect(await dureeVideoMp4(lire, fichier.length)).toBeNull();
  });

  it("film fragmenté AVEC mehd : la durée de mehd", async () => {
    const mehd = new Uint8Array(8);
    new DataView(mehd.buffer).setUint32(4, 4500);
    const fichier = concat(
      boite("ftyp", new Uint8Array(8)),
      boite("moov", concat(mvhd0(1000, 0), boite("mvex", boite("mehd", mehd)))),
    );
    const { lire } = lecteur(fichier);
    expect(await dureeVideoMp4(lire, fichier.length)).toBe(4.5);
  });

  it("boîte de taille impossible : null, sans boucler", async () => {
    const fichier = concat(boite("ftyp", new Uint8Array(8)), boite("free", new Uint8Array(8), 3));
    const { lire, lectures } = lecteur(fichier);
    expect(await dureeVideoMp4(lire, fichier.length)).toBeNull();
    expect(lectures.length).toBeLessThan(5);
  });

  it("seuls MP4 et MOV sont lus (WebM : un autre format)", () => {
    expect(estVideoMp4("video/mp4")).toBe(true);
    expect(estVideoMp4("video/quicktime")).toBe(true);
    expect(estVideoMp4("video/webm")).toBe(false);
    expect(estVideoMp4("image/jpeg")).toBe(false);
  });
});
