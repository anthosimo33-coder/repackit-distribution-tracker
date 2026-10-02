/**
 * STATISTIQUE DES EXPÉRIENCES DE HOOKS — module PUR, testé par Vitest
 * (lib/experience-stats.test.ts).
 *
 * Le plan : chaque créatrice tourne TOUTES les variantes (un « bloc » par
 * créatrice), à des jours décalés en carré latin. On compare donc chaque
 * variante à elle-même chez la même créatrice : l'effet « cette créatrice fait
 * plus de vues » s'annule, et il reste l'effet du hook.
 *
 * Les vues se comparent en LOGARITHME (log1p) : une vidéo virale à 400 000 vues
 * ne doit pas décider seule d'un test entre des vidéos à 3 000.
 *
 * Le test : permutation DANS chaque bloc (on mélange les étiquettes de variantes
 * chez une même créatrice). Exact quand c'est énumérable, sinon Monte-Carlo à
 * graine fixe — même données, même p, à chaque lecture.
 */

export interface Bloc {
  /** La créatrice. */
  cle: string;
  /** Vues mesurées à J+7, par variante (null = pas encore mesurée). */
  vues: (number | null)[];
}

export interface ResultatExperience {
  variantes: { index: number; mesurees: number; medianeVues: number | null; moyenneLog: number | null }[];
  blocsComplets: number;
  /** p de la permutation, ou null s'il y a trop peu de blocs complets. */
  p: number | null;
  meilleure: number | null;
  /** Rapport de la meilleure à la deuxième (moyenne géométrique), en %. */
  ecartPct: number | null;
  verdict: "trop_tot" | "gagnante" | "pas_de_difference";
}

/** Blocs complets requis pour calculer un p. */
export const BLOCS_MIN = 3;
/** Seuil de décision. */
export const SEUIL_P = 0.05;
const TIRAGES = 20_000;

const mediane = (xs: number[]) => {
  if (xs.length === 0) return null;
  const t = [...xs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
};

/** Générateur à graine fixe (mulberry32) : le p d'une même expérience ne bouge pas d'une lecture à l'autre. */
export function aleatoire(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Écart des moyennes de variantes : la statistique du test (0 si toutes égales). */
function statistique(blocs: number[][], k: number): number {
  const moyennes = Array.from({ length: k }, (_, j) => blocs.reduce((s, b) => s + b[j], 0) / blocs.length);
  const m = moyennes.reduce((s, x) => s + x, 0) / k;
  return moyennes.reduce((s, x) => s + (x - m) ** 2, 0);
}

function permutations(k: number): number[][] {
  if (k === 1) return [[0]];
  const out: number[][] = [];
  for (const p of permutations(k - 1)) {
    for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), k - 1, ...p.slice(i)]);
  }
  return out;
}

/** p de la permutation intra-bloc (exact si ≤ 50 000 arrangements, sinon Monte-Carlo à graine fixe). */
export function pPermutation(blocs: number[][], k: number, graine = 20261002): number {
  const observe = statistique(blocs, k);
  const perms = permutations(k);
  const total = perms.length ** blocs.length;
  const epsilon = 1e-12;
  if (total <= 50_000) {
    let auMoins = 0;
    const indices = new Array(blocs.length).fill(0);
    for (let n = 0; n < total; n++) {
      let reste = n;
      for (let b = 0; b < blocs.length; b++) {
        indices[b] = reste % perms.length;
        reste = Math.floor(reste / perms.length);
      }
      const melange = blocs.map((bloc, b) => perms[indices[b]].map((j) => bloc[j]));
      if (statistique(melange, k) >= observe - epsilon) auMoins++;
    }
    return auMoins / total;
  }
  const hasard = aleatoire(graine);
  let auMoins = 1; // l'observé compte (estimateur sans p = 0)
  for (let n = 0; n < TIRAGES; n++) {
    const melange = blocs.map((bloc) => perms[Math.floor(hasard() * perms.length)].map((j) => bloc[j]));
    if (statistique(melange, k) >= observe - epsilon) auMoins++;
  }
  return auMoins / (TIRAGES + 1);
}

export function analyserExperience(blocs: readonly Bloc[], k: number): ResultatExperience {
  const variantes = Array.from({ length: k }, (_, j) => {
    const vues = blocs.map((b) => b.vues[j]).filter((x): x is number => x !== null && x !== undefined);
    return {
      index: j,
      mesurees: vues.length,
      medianeVues: mediane(vues),
      moyenneLog: vues.length ? vues.reduce((s, x) => s + Math.log1p(x), 0) / vues.length : null,
    };
  });
  const complets = blocs
    .filter((b) => b.vues.length === k && b.vues.every((x) => x !== null && x !== undefined))
    .map((b) => (b.vues as number[]).map((x) => Math.log1p(x)));
  if (complets.length < BLOCS_MIN) {
    return { variantes, blocsComplets: complets.length, p: null, meilleure: null, ecartPct: null, verdict: "trop_tot" };
  }
  // Sur les blocs COMPLETS seulement : la comparaison reste appariée.
  const moyennes = Array.from({ length: k }, (_, j) => complets.reduce((s, b) => s + b[j], 0) / complets.length);
  const ordre = moyennes.map((m, j) => ({ m, j })).sort((a, b) => b.m - a.m);
  const p = pPermutation(complets, k);
  const ecartPct = Math.round((Math.exp(ordre[0].m - ordre[1].m) - 1) * 1000) / 10;
  return {
    variantes,
    blocsComplets: complets.length,
    p: Math.round(p * 10000) / 10000,
    meilleure: ordre[0].j,
    ecartPct,
    verdict: p < SEUIL_P ? "gagnante" : "pas_de_difference",
  };
}

/** Le plan en carré latin : la créatrice `i`, au jour `j`, tourne la variante (i + j) mod k. */
export function varianteDe(i: number, j: number, k: number): number {
  return (i + j) % k;
}
