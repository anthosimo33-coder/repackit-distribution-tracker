/**
 * HASARD COMPATIBLE PYTHON — `random.Random(chaîne)` de CPython, à l'identique.
 *
 * Le moteur de scénarios (convex/scenarioEngine.ts) est le portage de
 * `docs/scenarios/reference/moteur.py`, le moteur testé sur askblush.com. Pour
 * que le portage soit VÉRIFIABLE, il tire exactement les mêmes nombres : même
 * bible + même prénom + même graine ⇒ le même export, octet pour octet, que le
 * Python. Un écart de logique dans le portage se voit alors sur le fichier, au
 * lieu de se cacher derrière des statistiques « à peu près pareilles ».
 *
 * Ce qui est reproduit (CPython 3.11+, `Lib/random.py` et `_randommodule.c`) :
 *  - la graine d'une chaîne (version 2) : octets UTF-8 + leur SHA-512, lus comme
 *    un entier big-endian, découpé en mots de 32 bits (poids faible d'abord),
 *    passés à `init_by_array` du Mersenne Twister MT19937 ;
 *  - `random()` sur 53 bits, `getrandbits`, `_randbelow` par rejet, `randint`,
 *    `choice`, `choices` avec poids (cumul + bisect_right), `uniform`, et
 *    `gauss` avec son second tirage mis de côté (`gauss_next`).
 *
 * Seule différence possible : `Math.exp/log/cos/sin` contre la libm du système,
 * au dernier bit près. Elle ne change une seconde affichée qu'avec une
 * probabilité de l'ordre du millionième par tirage.
 *
 * Module PUR (aucun import `_generated`) : serveur, navigateur et tests.
 * Garde : lib/py-random.test.ts (valeurs relevées sur CPython).
 */

// ─── SHA-512 (graine) ────────────────────────────────────────────────────────

const K512 = [
  "428a2f98d728ae22", "7137449123ef65cd", "b5c0fbcfec4d3b2f", "e9b5dba58189dbbc", "3956c25bf348b538",
  "59f111f1b605d019", "923f82a4af194f9b", "ab1c5ed5da6d8118", "d807aa98a3030242", "12835b0145706fbe",
  "243185be4ee4b28c", "550c7dc3d5ffb4e2", "72be5d74f27b896f", "80deb1fe3b1696b1", "9bdc06a725c71235",
  "c19bf174cf692694", "e49b69c19ef14ad2", "efbe4786384f25e3", "0fc19dc68b8cd5b5", "240ca1cc77ac9c65",
  "2de92c6f592b0275", "4a7484aa6ea6e483", "5cb0a9dcbd41fbd4", "76f988da831153b5", "983e5152ee66dfab",
  "a831c66d2db43210", "b00327c898fb213f", "bf597fc7beef0ee4", "c6e00bf33da88fc2", "d5a79147930aa725",
  "06ca6351e003826f", "142929670a0e6e70", "27b70a8546d22ffc", "2e1b21385c26c926", "4d2c6dfc5ac42aed",
  "53380d139d95b3df", "650a73548baf63de", "766a0abb3c77b2a8", "81c2c92e47edaee6", "92722c851482353b",
  "a2bfe8a14cf10364", "a81a664bbc423001", "c24b8b70d0f89791", "c76c51a30654be30", "d192e819d6ef5218",
  "d69906245565a910", "f40e35855771202a", "106aa07032bbd1b8", "19a4c116b8d2d0c8", "1e376c085141ab53",
  "2748774cdf8eeb99", "34b0bcb5e19b48a8", "391c0cb3c5c95a63", "4ed8aa4ae3418acb", "5b9cca4f7763e373",
  "682e6ff3d6b2b8a3", "748f82ee5defb2fc", "78a5636f43172f60", "84c87814a1f0ab72", "8cc702081a6439ec",
  "90befffa23631e28", "a4506cebde82bde9", "bef9a3f7b2c67915", "c67178f2e372532b", "ca273eceea26619c",
  "d186b8c721c0c207", "eada7dd6cde0eb1e", "f57d4f7fee6ed178", "06f067aa72176fba", "0a637dc5a2c898a6",
  "113f9804bef90dae", "1b710b35131c471b", "28db77f523047d84", "32caab7b40c72493", "3c9ebe0a15c9bebc",
  "431d67c49c100d4c", "4cc5d4becb3e42b6", "597f299cfc657e2a", "5fcb6fab3ad6faec", "6c44198c4a475817",
].map((h) => BigInt(`0x${h}`));

const H512 = [
  "6a09e667f3bcc908", "bb67ae8584caa73b", "3c6ef372fe94f82b", "a54ff53a5f1d36f1",
  "510e527fade682d1", "9b05688c2b3e6c1f", "1f83d9abfb41bd6b", "5be0cd19137e2179",
].map((h) => BigInt(`0x${h}`));

const MASK64 = (BigInt(1) << BigInt(64)) - BigInt(1);
const rotr64 = (x: bigint, n: number) =>
  ((x >> BigInt(n)) | (x << BigInt(64 - n))) & MASK64;

/** SHA-512 d'octets (graine seulement : quelques dizaines d'octets, BigInt suffit). */
export function sha512(bytes: Uint8Array): Uint8Array {
  const bitLen = BigInt(bytes.length) * BigInt(8);
  const padLen = ((bytes.length + 17 + 127) >> 7) << 7;
  const msg = new Uint8Array(padLen);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  for (let i = 0; i < 16; i++) {
    msg[padLen - 1 - i] = Number((bitLen >> BigInt(8 * i)) & BigInt(0xff));
  }
  const h = [...H512];
  const w = new Array<bigint>(80);
  for (let off = 0; off < padLen; off += 128) {
    for (let t = 0; t < 16; t++) {
      let v = BigInt(0);
      for (let b = 0; b < 8; b++) v = (v << BigInt(8)) | BigInt(msg[off + t * 8 + b]!);
      w[t] = v;
    }
    for (let t = 16; t < 80; t++) {
      const s0 = rotr64(w[t - 15]!, 1) ^ rotr64(w[t - 15]!, 8) ^ (w[t - 15]! >> BigInt(7));
      const s1 = rotr64(w[t - 2]!, 19) ^ rotr64(w[t - 2]!, 61) ^ (w[t - 2]! >> BigInt(6));
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) & MASK64;
    }
    let [a, b, c, d, e, f, g, hh] = h as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
    for (let t = 0; t < 80; t++) {
      const S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
      const ch = (e & f) ^ (~e & MASK64 & g);
      const t1 = (hh + S1 + ch + K512[t]! + w[t]!) & MASK64;
      const S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & MASK64;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) & MASK64;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) & MASK64;
    }
    const sums = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + sums[i]!) & MASK64;
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number((h[i]! >> BigInt(56 - 8 * b)) & BigInt(0xff));
    }
  }
  return out;
}

// ─── Mersenne Twister MT19937 ────────────────────────────────────────────────

const N = 624;
const M = 397;

/** Les mots de 32 bits de la graine, comme `random_seed` de CPython les passe à `init_by_array`. */
export function seedKey(seed: string): number[] {
  const text = new TextEncoder().encode(seed);
  const bytes = new Uint8Array(text.length + 64);
  bytes.set(text);
  bytes.set(sha512(text), text.length);
  // L'entier big-endian, sans ses octets nuls de tête.
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) start++;
  const sig = bytes.subarray(start);
  if (sig.length === 0) return [0];
  const bits = (sig.length - 1) * 8 + (32 - Math.clz32(sig[0]!));
  const keyUsed = Math.floor((bits - 1) / 32) + 1;
  const key: number[] = [];
  for (let k = 0; k < keyUsed; k++) {
    let word = 0;
    for (let b = 3; b >= 0; b--) {
      const idx = sig.length - 1 - (4 * k + b);
      word = (word << 8) | (idx >= 0 ? sig[idx]! : 0);
    }
    key.push(word >>> 0);
  }
  return key;
}

export class PyRandom {
  private mt = new Uint32Array(N);
  private mti = N + 1;
  private gaussNext: number | null = null;

  constructor(seed: string) {
    this.initByArray(seedKey(seed));
  }

  private initGenrand(s: number) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = N;
  }

  private initByArray(key: number[]) {
    this.initGenrand(19650218);
    const mt = this.mt;
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = ((mt[i]! ^ Math.imul(prev, 1664525)) + key[j]! + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1]! ^ (mt[i - 1]! >>> 30);
      mt[i] = ((mt[i]! ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  private genrandUint32(): number {
    const mt = this.mt;
    if (this.mti >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff);
        mt[kk] = mt[kk + M]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      for (; kk < N - 1; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff);
        mt[kk] = mt[kk + (M - N)]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      const y = (mt[N - 1]! & 0x80000000) | (mt[0]! & 0x7fffffff);
      mt[N - 1] = mt[M - 1]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      this.mti = 0;
    }
    let y = mt[this.mti++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** `random()` : flottant sur 53 bits dans [0, 1). */
  random(): number {
    const a = this.genrandUint32() >>> 5;
    const b = this.genrandUint32() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  }

  /** `getrandbits(k)`, 0 ≤ k ≤ 32 (seul usage du moteur). */
  getrandbits(k: number): number {
    if (k === 0) return 0;
    return this.genrandUint32() >>> (32 - k);
  }

  private randbelow(n: number): number {
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** `randint(a, b)`, bornes incluses. */
  randint(a: number, b: number): number {
    return a + this.randbelow(b - a + 1);
  }

  choice<T>(seq: readonly T[]): T {
    if (seq.length === 0) throw new Error("choice: séquence vide"); // i18n-exempt: erreur interne de programmation
    return seq[this.randbelow(seq.length)]!;
  }

  /** `choices(population, weights)[0]` : un tirage pondéré (cumul + bisect_right). */
  weightedChoice<T>(population: readonly T[], weights: readonly number[]): T {
    const cum: number[] = [];
    let acc = 0;
    for (const w of weights) {
      acc += w;
      cum.push(acc);
    }
    const total = cum[cum.length - 1]! + 0.0;
    const x = this.random() * total;
    let lo = 0;
    let hi = population.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (x < cum[mid]!) hi = mid;
      else lo = mid + 1;
    }
    return population[lo]!;
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  gauss(mu: number, sigma: number): number {
    let z = this.gaussNext;
    this.gaussNext = null;
    if (z === null) {
      const x2pi = this.random() * (2 * Math.PI);
      const g2rad = Math.sqrt(-2.0 * Math.log(1.0 - this.random()));
      z = Math.cos(x2pi) * g2rad;
      this.gaussNext = Math.sin(x2pi) * g2rad;
    }
    return mu + z * sigma;
  }
}

// ─── timedelta de Python, en microsecondes ───────────────────────────────────

const US_PER_SECOND = 1_000_000;
const US_PER_MINUTE = 60_000_000;

/** `accum` de `delta_new` (CPython) : partie entière exacte, reste fractionnaire mis de côté. */
function accum(sofar: number, num: number, factor: number, leftover: { us: number }): number {
  const intpart = Math.trunc(num);
  const fracpart = num - intpart;
  let sum = sofar + intpart * factor;
  if (fracpart === 0) return sum;
  const scaled = factor * fracpart;
  const scaledInt = Math.trunc(scaled);
  sum += scaledInt;
  leftover.us += scaled - scaledInt;
  return sum;
}

/** `round` de la libm C : au plus proche, un demi s'éloigne de zéro (≠ `Math.round` sur les négatifs). */
function cRound(x: number): number {
  const a = Math.abs(x);
  let r = Math.floor(a);
  if (a - r >= 0.5) r += 1;
  return x < 0 ? -r : r;
}

/**
 * `timedelta(minutes=…, seconds=…)` en microsecondes ENTIÈRES, comme CPython :
 * les secondes sont accumulées avant les minutes (ordre de `delta_new`, quel que
 * soit l'ordre des arguments), puis les fractions de microseconde arrondies au
 * pair le plus proche du total.
 */
export function timedeltaUs(parts: { minutes?: number; seconds?: number }): number {
  const leftover = { us: 0 };
  let x = 0;
  if (parts.seconds !== undefined && parts.seconds !== 0) x = accum(x, parts.seconds, US_PER_SECOND, leftover);
  if (parts.minutes !== undefined && parts.minutes !== 0) x = accum(x, parts.minutes, US_PER_MINUTE, leftover);
  if (leftover.us !== 0) {
    let whole = cRound(leftover.us);
    if (Math.abs(whole - leftover.us) === 0.5) {
      const xIsOdd = Math.abs(x % 2) === 1 ? 1 : 0;
      whole = 2.0 * cRound((leftover.us + xIsOdd) * 0.5) - xIsOdd;
    }
    x += Math.trunc(whole);
  }
  return x;
}
