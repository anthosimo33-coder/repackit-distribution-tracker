/**
 * Ordre d'affichage des missions d'un créateur — ALTERNANCE des formats (pur,
 * testé Vitest). Aucune dépendance Convex/React.
 *
 * PROBLÈME RÉSOLU. Les lots d'assignation sortaient GROUPÉS par format (7 vidéos
 * du format X, puis 5 du Y, puis 6 du Z). La 1ʳᵉ correction entrelaçait DANS une
 * même échéance seulement → dès que deux formats avaient des échéances
 * différentes, ils se re-séparaient en blocs par DATE (les 7 carrousels d'échéance
 * 31/07 ressortaient collés en fin de liste, non mélangés avec les POV/Pensée
 * d'échéance 30/07). Ce module fait maintenant PRIMER le mélange des formats sur
 * le regroupement par date.
 *
 * SOLUTION — l'ÉCHÉANCE ne groupe plus, l'URGENCE oui (grossièrement) :
 *
 *  1. RANG D'URGENCE = bucket EXTÉRIEUR (`tierOf`, 0 = le plus urgent : en
 *     retard → < 48 h → dans les temps → non actionnable). On n'entrelace QUE
 *     dans un rang, mais un rang couvre TOUTES les échéances de ce niveau de
 *     priorité → deux formats d'échéances DIFFÉRENTES mais de même urgence
 *     s'entrelacent (fini les blocs par date). Les rangs restent ordonnés →
 *     une échéance imminente n'est jamais noyée sous des missions lointaines.
 *  2. PEIGNE ÉQUITABLE. Dans un rang, chaque mission reçoit une POSITION
 *     fractionnaire i/taille_du_groupe (cf. assignmentGroupKey) puis on trie sur
 *     cette position → un format de 7 se répartit régulièrement, un de 3 aussi ;
 *     ils s'entrelacent au lieu de se suivre. Jamais d'empilement en fin de liste,
 *     même en quantités inégales (7/6/5). L'échéance ne sert plus qu'à un tri
 *     DOUX à l'intérieur du rang (base du peigne + repli si le rang n'a qu'un
 *     seul format, où il n'y a rien à entrelacer).
 *  3. VARIATION + FINITION. On essaie plusieurs rotations du peigne, chacune
 *     réparée (échanges locaux cassant les rares doublons adjacents), on garde
 *     les arrangements de plus courte série (`longestRun` minimal) et on en
 *     choisit un via la graine → l'ordre varie d'une créatrice/distribution à
 *     l'autre tout en gardant l'alternance OPTIMALE.
 *
 * VARIATION. La graine (creatorId) + les clés de groupe (campagne/format, neuves
 * à chaque distribution) pilotent : le départage du peigne, le choix de rotation
 * et le tirage final. Deux créatrices ne reçoivent donc pas les formats dans le
 * même ordre, et deux distributions successives non plus. L'ordre INTERNE d'un
 * groupe n'est pas préservé (rotation) — c'est VOULU (« randomiser l'ordre à
 * l'intérieur de chaque format ») et sans effet sur l'anti-coordination, qui vit
 * à la SÉLECTION des combos (write), pas à l'affichage.
 *
 * STABILITÉ. Tout est dérivé de données figées (clé de groupe, échéance, graine
 * = creatorId) + du rang d'urgence (fonction de `now`, mais constant entre deux
 * rechargements) : AUCUN `Math.random()`. Même entrée → même sortie, donc la
 * liste ne se réordonne pas à chaque rechargement.
 *
 * ⚠️ Règle A6 — convex/ ne peut pas importer lib/ : ce module est RÉPLIQUÉ dans
 * convex/assignments.ts (`assignmentGroupKeyServer` / `interleaveByGroupServer`).
 * Toute évolution ici doit l'être là-bas. Les tests vivent ici.
 */

/** Hash FNV-1a 32 bits (déterministe, sans dépendance) → entier non signé. */
export function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Axe « format » d'une mission — la dimension qui produit les blocs. Un
 * assignment de SCRIPT est identifié par sa campagne (une campagne = un format
 * de vidéo côté opérationnel) ; un assignment de FORMAT par son formatId. Les
 * combos (hook/flux/cta) NE sont PAS dans la clé : ils alternent déjà à la
 * sélection (cf lib/scriptCombos.pickCombosForCreator) — ici on entrelace les
 * FORMATS entre eux.
 */
export function assignmentGroupKey(a: {
  formatId?: string | null;
  scriptCombo?: { campaignId: string } | null;
}): string {
  if (a.scriptCombo) return `campaign:${a.scriptCombo.campaignId}`;
  if (a.formatId) return `format:${a.formatId}`;
  return "none";
}

/** Échelle de la position fractionnaire — garde les comparaisons en ENTIERS. */
const SCALE = 1_000_000;
/** Bornes de coût (listes réalistes ≤ quelques dizaines par échéance). */
const MAX_ROTATIONS = 64;
const MAX_REPAIR_PASSES = 6;

export interface InterleaveOptions<T> {
  /** Axe de groupement des formats (cf assignmentGroupKey). */
  keyOf: (item: T) => string;
  /**
   * Rang d'URGENCE (0 = le plus urgent) — bucket EXTÉRIEUR. On n'entrelace les
   * formats QUE dans un même rang, mais un rang couvre toutes les échéances de
   * ce niveau → les formats se mélangent quelles que soient leurs dates. Les
   * rangs restent ordonnés (une échéance imminente ne se noie pas). Cf.
   * lib/assignment-status.urgencyRank.
   */
  tierOf: (item: T) => number;
  /** Échéance — tri DOUX à l'intérieur d'un rang (base du peigne + repli quand
   *  le rang n'a qu'un seul format). Ne groupe RIEN entre échéances. */
  dueDateOf: (item: T) => number;
  /** Graine STABLE de la séquence (creatorId) → un cycle propre à chaque créatrice. */
  seed: string;
}

/**
 * Entrelace les formats d'une liste de missions PAR RANG D'URGENCE. Dans un
 * rang, les formats s'alternent quelles que soient leurs échéances ; les rangs
 * (en retard → < 48 h → dans les temps → non actionnable) restent ordonnés.
 * Liste de moins de 2 missions, ou un seul format dans le rang → rendue telle
 * quelle (au tri par échéance près). Ne perd ni ne duplique aucune mission.
 */
export function interleaveByGroup<T>(
  items: readonly T[],
  opts: InterleaveOptions<T>,
): T[] {
  if (items.length < 2) return [...items];

  // 1. Buckets par RANG D'URGENCE (croissant) — PAS par échéance exacte. Deux
  //    formats d'échéances différentes mais de même urgence tombent dans le même
  //    rang et s'entrelacent (fini les blocs par date).
  const buckets = new Map<number, T[]>();
  for (const item of items) {
    const t = opts.tierOf(item);
    const b = buckets.get(t);
    if (b) b.push(item);
    else buckets.set(t, [item]);
  }
  const tiers = [...buckets.keys()].sort((a, b) => a - b);

  const out: T[] = [];
  for (const t of tiers) {
    // Tri DOUX par échéance dans le rang : base déterministe du peigne, et ordre
    // final quand le rang n'a qu'un seul format (rien à entrelacer → échéance
    // croissante). Stable (Array.sort) → égalités = ordre d'arrivée.
    const bucket = buckets
      .get(t)!
      .slice()
      .sort((x, y) => opts.dueDateOf(x) - opts.dueDateOf(y));
    out.push(...spread(bucket, opts));
  }
  return out;
}

/** Longueur de la plus longue série de clés identiques consécutives. */
function longestRun(keys: string[]): number {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of keys) {
    run = k === prev ? run + 1 : 1;
    prev = k;
    best = Math.max(best, run);
  }
  return best;
}

/** 2. + 3. — peigne équitable, rotations réparées, meilleure série, tirage seedé. */
// i18n-exempt: générique TypeScript (`>(items: T[], opts: InterleaveOptions<`), pas du texte
function spread<T>(items: T[], opts: InterleaveOptions<T>): T[] {
  if (items.length < 2) return items;

  // Groupes dans l'ordre d'arrivée.
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = opts.keyOf(item);
    const g = groups.get(k);
    if (g) g.push(item);
    else groups.set(k, [item]);
  }
  if (groups.size < 2) return items;

  // PEIGNE : position fractionnaire i/taille en ENTIERS (num/den). Départage :
  // GROUPE LE PLUS GROS d'abord (son peigne régulier reste intact, les plus
  // petits se glissent dans ses trous), puis rang seedé, puis ordre d'arrivée.
  type Placed = {
    item: T;
    key: string;
    num: number;
    den: number;
    size: number;
    rank: number;
    seq: number;
  };
  const placed: Placed[] = [];
  let seq = 0;
  for (const [key, group] of groups) {
    const rank = stableHash(`${opts.seed}:${key}`);
    const den = group.length * SCALE;
    group.forEach((item, i) => {
      placed.push({ item, key, num: i * SCALE, den, size: group.length, rank, seq: seq++ });
    });
  }
  placed.sort((a, b) => {
    const cross = a.num * b.den - b.num * a.den;
    if (cross !== 0) return cross;
    if (a.size !== b.size) return b.size - a.size;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.seq - b.seq;
  });
  const comb = placed.map((p) => p.item);
  const n = comb.length;

  // ROTATIONS candidates (échantillonnées si la liste est longue), chacune
  // RÉPARÉE. On garde le plus petit `longestRun` atteint, et parmi les
  // arrangements distincts qui l'atteignent, la graine en tire un.
  const stride = n <= MAX_ROTATIONS ? 1 : Math.ceil(n / MAX_ROTATIONS);
  let minRun = Infinity;
  const distinct = new Map<string, T[]>();
  for (let o = 0; o < n; o += stride) {
    const rotated =
      o === 0 ? comb : [...comb.slice(o), ...comb.slice(0, o)];
    const rep = repair(rotated, opts.keyOf);
    const sig = rep.map(opts.keyOf).join(" ");
    const run = longestRun(rep.map(opts.keyOf));
    if (run < minRun) {
      minRun = run;
      distinct.clear();
      distinct.set(sig, rep);
    } else if (run === minRun && !distinct.has(sig)) {
      distinct.set(sig, rep);
    }
    if (minRun === 1 && stride === 1 && distinct.size >= n) break;
  }
  const cands = [...distinct.values()];
  return cands[stableHash(`${opts.seed}:pick`) % cands.length];
}

/**
 * Casse les répétitions adjacentes par échanges locaux : la mission fautive est
 * échangée avec la mission d'un AUTRE format la plus proche dont l'échange ne
 * recrée pas de collision. On n'échange QUE des formats différents. Aucun
 * échange possible (quantités trop déséquilibrées) → on laisse tel quel.
 * Converge en quelques passes (borne dure MAX_REPAIR_PASSES).
 */
function repair<T>(seq: T[], keyOf: (item: T) => string): T[] {
  const out = [...seq];
  const keyAt = (i: number) => (i >= 0 && i < out.length ? keyOf(out[i]) : null);
  const swappable = (i: number, j: number): boolean => {
    const ki = keyAt(i);
    const kj = keyAt(j);
    if (ki === kj) return false;
    if (j !== i - 1 && kj === keyAt(i - 1)) return false;
    if (j !== i + 1 && kj === keyAt(i + 1)) return false;
    if (i !== j - 1 && ki === keyAt(j - 1)) return false;
    if (i !== j + 1 && ki === keyAt(j + 1)) return false;
    return true;
  };
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    let changed = false;
    for (let i = 1; i < out.length; i++) {
      if (keyAt(i) !== keyAt(i - 1)) continue;
      let partner = -1;
      for (let d = 1; d < out.length && partner === -1; d++) {
        if (i + d < out.length && swappable(i, i + d)) partner = i + d;
        else if (i - d >= 0 && swappable(i, i - d)) partner = i - d;
      }
      if (partner === -1) continue;
      const tmp = out[i];
      out[i] = out[partner];
      out[partner] = tmp;
      changed = true;
    }
    if (!changed) break;
  }
  return out;
}
