/**
 * DURÉE D'UNE VIDÉO lue dans son EN-TÊTE, sans télécharger le fichier.
 *
 * MP4 et MOV (QuickTime) partagent la structure en boîtes d'ISO/IEC 14496-12 :
 * la durée du film est dans `moov › mvhd` (unités + échelle de temps). La boîte
 * `moov` est en tête d'un fichier « faststart », mais souvent APRÈS les données
 * (`mdat`, presque tout le poids) : on saute donc de boîte en boîte par leur
 * taille, en ne lisant que leurs 16 premiers octets, puis `moov` seule.
 *
 * `null` = durée non lue (fichier tronqué, boîte atypique, film fragmenté sans
 * durée déclarée) — jamais 0 : « non mesuré » et « nul » sont deux états.
 *
 * Module PUR (aucun accès réseau) : la lecture des octets est passée en
 * argument — une requête HTTP par plage côté serveur, un tableau en test.
 */

/** Lit les octets [debut, fin[ du fichier (moins si le fichier finit avant). */
export type LireOctets = (debut: number, fin: number) => Promise<Uint8Array>;

/** Une boîte `moov` au-delà de cette taille n'est pas lue (un film de plusieurs heures). */
export const MOOV_MAX_OCTETS = 16 * 1024 * 1024;
/** Boîtes de premier niveau parcourues au plus avant de renoncer. */
const BOITES_MAX = 64;

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const type4 = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Les boîtes filles d'un contenu déjà lu : [type, début du contenu, fin]. */
function* boites(b: Uint8Array): Generator<[string, number, number]> {
  let pos = 0;
  while (pos + 8 <= b.length) {
    let taille = u32(b, pos);
    let entete = 8;
    if (taille === 1) {
      if (pos + 16 > b.length) return;
      taille = u64(b, pos + 8);
      entete = 16;
    } else if (taille === 0) {
      taille = b.length - pos;
    }
    if (taille < entete || pos + taille > b.length) return;
    yield [type4(b, pos + 4), pos + entete, pos + taille];
    pos += taille;
  }
}

/** La durée déclarée par une boîte `mvhd` (ou `mehd`), en secondes ; null si absente. */
function dureeDuMoov(moov: Uint8Array): number | null {
  let echelle: number | null = null;
  let unites: number | null = null;
  let fragmentee: number | null = null;
  for (const [type, debut, fin] of boites(moov)) {
    const b = moov.subarray(debut, fin);
    if (type === "mvhd" && b.length >= 20) {
      // version 0 : création, modification (4 + 4), échelle (4), durée (4) ;
      // version 1 : création, modification (8 + 8), échelle (4), durée (8).
      if (b[0] === 1 && b.length >= 32) {
        echelle = u32(b, 20);
        unites = u64(b, 24);
      } else if (b[0] === 0) {
        echelle = u32(b, 12);
        unites = u32(b, 16) === 0xffffffff ? null : u32(b, 16);
      }
    } else if (type === "mvex") {
      // Film FRAGMENTÉ : `mvhd` peut dire 0, la durée est alors dans `mehd`.
      for (const [t, d, f] of boites(b)) {
        const m = b.subarray(d, f);
        if (t === "mehd" && m.length >= 8) fragmentee = m[0] === 1 && m.length >= 12 ? u64(m, 4) : u32(m, 4);
      }
    }
  }
  if (!echelle) return null;
  const total = unites ? unites : fragmentee;
  return total ? total / echelle : null;
}

/** Durée d'une vidéo MP4/MOV de `taille` octets, en secondes ; null si non lue. */
export async function dureeVideoMp4(lire: LireOctets, taille: number): Promise<number | null> {
  let pos = 0;
  for (let n = 0; n < BOITES_MAX && pos + 8 <= taille; n++) {
    const h = await lire(pos, Math.min(pos + 16, taille));
    if (h.length < 8) return null;
    let longueur = u32(h, 0);
    let entete = 8;
    if (longueur === 1) {
      if (h.length < 16) return null;
      longueur = u64(h, 8);
      entete = 16;
    } else if (longueur === 0) {
      longueur = taille - pos;
    }
    if (longueur < entete) return null;
    if (type4(h, 4) === "moov") {
      if (longueur > MOOV_MAX_OCTETS) return null;
      return dureeDuMoov(await lire(pos + entete, Math.min(pos + longueur, taille)));
    }
    pos += longueur;
  }
  return null;
}

/** Les types de vidéo dont la durée se lit ici (WebM : un autre format, non lu). */
export const estVideoMp4 = (contentType: string) => contentType === "video/mp4" || contentType === "video/quicktime";
