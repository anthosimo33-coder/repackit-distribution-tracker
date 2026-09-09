/**
 * REGROUPEMENT DE L'ÉCRAN COMPTES — pur, testé (Vitest), client seul.
 *
 * L'écran listait 33 comptes à plat, triés par handle : il ouvrait donc sur
 * `@ang_creates` et ses 2 764 vues, pendant que Kelly — 83 % des vues du projet,
 * éclatée sur trois comptes — se trouvait quelque part plus bas. Cinq créateurs
 * sur dix-sept font 94 % des vues, et rien ne le disait.
 *
 * Ce module range et compte ; il ne décide d'aucun montant. Aucune réplique
 * serveur : rien ici n'entre dans une paie.
 */

export type ComptePerfLike = {
  vuesCumulees: number;
  nbPublies: number;
  dernierPost: number | null;
};

export type CompteLike = {
  handle: string;
  plateforme: string;
  creator?: { name: string } | null;
  perf: ComptePerfLike;
};

/** Axe de regroupement des lignes. `none` = liste à plat, comme avant. */
export type GroupAxis = "creator" | "plateforme" | "none";
export type SortKey = "handle" | "vues" | "posts" | "dernierPost";
export type SortDir = "asc" | "desc";

/** Comptes sans propriétaire : un groupe de plein droit, jamais un trou. */
export const INTERNE_LABEL = "Interne";

export type CompteGroup<T> = {
  clef: string;
  /** `null` sur l'axe `none` : la liste n'a pas de titre de groupe. */
  titre: string | null;
  lignes: T[];
  vues: number;
  posts: number;
  /** Date du post le plus récent du groupe (`null` si aucun). */
  dernierPost: number | null;
  /**
   * Part des vues DU PROJET, entre 0 et 1 — pas des vues affichées.
   *
   * La distinction n'est pas cosmétique : filtrée sur Instagram, la part de
   * Kelly doit rester ce qu'elle pèse dans le projet, pas se renormaliser sur
   * un sous-ensemble choisi par un filtre. Sinon un compte modeste bondit à
   * 80 % dès qu'on isole sa plateforme, et l'infobulle « % des vues du projet »
   * devient un mensonge.
   *
   * Conséquence assumée : sous filtre, les parts ne somment PLUS à 100 %. C'est
   * l'aveu correct qu'on ne regarde qu'une partie du parc.
   *
   * `0` quand le projet n'a aucune vue — jamais NaN : une division par zéro
   * traversait l'écran jusqu'au `width:%`.
   */
  part: number;
};

function compare<T extends CompteLike>(
  a: T,
  b: T,
  key: SortKey,
  dir: SortDir,
): number {
  const parHandle = a.handle.localeCompare(b.handle, "fr", {
    sensitivity: "base",
  });
  if (key === "handle") return parHandle * (dir === "asc" ? 1 : -1);
  const cmp =
    key === "vues"
      ? a.perf.vuesCumulees - b.perf.vuesCumulees
      : key === "posts"
        ? a.perf.nbPublies - b.perf.nbPublies
        : (a.perf.dernierPost ?? 0) - (b.perf.dernierPost ?? 0);
  // Départage stable par handle quand la métrique est à égalité — et TOUJOURS
  // ascendant, pour que deux comptes à zéro ne s'inversent pas d'un tri à
  // l'autre.
  if (cmp === 0) return parHandle;
  return cmp * (dir === "asc" ? 1 : -1);
}

function titreDe<T extends CompteLike>(ligne: T, axe: GroupAxis): string {
  if (axe === "plateforme") return ligne.plateforme;
  return ligne.creator?.name ?? INTERNE_LABEL;
}

/**
 * Range les comptes en groupes, triés à l'intérieur ET entre eux.
 *
 * L'ordre DES GROUPES suit le même axe que le tri des lignes : trié par vues,
 * le créateur qui pèse le plus vient en tête ; trié par handle, l'ordre est
 * alphabétique. Un écran d'exploitation doit ouvrir sur ce qui pèse, mais un
 * admin qui cherche un pseudo précis doit retrouver son alphabet — c'est le même
 * réglage qui commande les deux, sans second bouton à comprendre.
 */
export function groupComptes<T extends CompteLike>(
  comptes: readonly T[],
  axe: GroupAxis,
  sortKey: SortKey,
  sortDir: SortDir,
  /**
   * Dénominateur des parts : le total du PROJET, filtres non appliqués. Absent,
   * on retombe sur le total des comptes reçus — ce qui n'est juste que si
   * l'appelant n'a rien filtré.
   */
  totalProjet?: number,
): CompteGroup<T>[] {
  const totalVues = comptes.reduce((s, c) => s + c.perf.vuesCumulees, 0);
  const denominateur = totalProjet ?? totalVues;
  const triees = [...comptes].sort((a, b) => compare(a, b, sortKey, sortDir));

  if (axe === "none") {
    return [
      {
        clef: "all",
        titre: null,
        lignes: triees,
        vues: totalVues,
        posts: triees.reduce((s, c) => s + c.perf.nbPublies, 0),
        dernierPost: dernierPostDe(triees),
        part: denominateur > 0 ? totalVues / denominateur : 0,
      },
    ];
  }

  // Map d'insertion : les groupes naissent dans l'ordre des lignes déjà triées,
  // donc l'ordre des groupes découle du tri au lieu d'être reconstruit à côté.
  const parClef = new Map<string, T[]>();
  for (const l of triees) {
    const k = titreDe(l, axe);
    const liste = parClef.get(k);
    if (liste) liste.push(l);
    else parClef.set(k, [l]);
  }

  const groupes = [...parClef.entries()].map(([titre, lignes]) => {
    const vues = lignes.reduce((s, c) => s + c.perf.vuesCumulees, 0);
    return {
      clef: titre,
      titre,
      lignes,
      vues,
      posts: lignes.reduce((s, c) => s + c.perf.nbPublies, 0),
      dernierPost: dernierPostDe(lignes),
      part: denominateur > 0 ? vues / denominateur : 0,
    };
  });

  // Sur un tri par métrique, un groupe vaut la SOMME de ses lignes — pas sa
  // meilleure ligne. Un créateur à trois comptes moyens passe devant un créateur
  // à un seul gros compte s'il pèse plus au total, et c'est ce qu'on veut lire.
  if (sortKey !== "handle") {
    groupes.sort((a, b) => {
      const cmp =
        sortKey === "posts"
          ? a.posts - b.posts
          : sortKey === "dernierPost"
            ? (a.dernierPost ?? 0) - (b.dernierPost ?? 0)
            : a.vues - b.vues;
      if (cmp !== 0) return cmp * (sortDir === "asc" ? 1 : -1);
      return a.titre.localeCompare(b.titre, "fr");
    });
  }
  return groupes;
}

function dernierPostDe(lignes: readonly CompteLike[]): number | null {
  let max: number | null = null;
  for (const l of lignes) {
    const d = l.perf.dernierPost;
    if (d !== null && (max === null || d > max)) max = d;
  }
  return max;
}

/**
 * COLLISIONS DE MESURE — deux comptes d'une même plateforme dont les handles ne
 * diffèrent que par la casse.
 *
 * Depuis la PR #196, la perf est agrégée sur `(plateforme, handle en
 * minuscules)`. Deux comptes qui tombent sur cette même clé lisent donc le MÊME
 * total, et l'écran l'afficherait deux fois — le défaut que #196 vient de
 * supprimer, revenu par une autre porte.
 *
 * Aucune paire de ce genre n'existe aujourd'hui en production (vérifié sur
 * l'export du 2026-09-09). Ce détecteur est là pour que la première ne passe pas
 * inaperçue : on la SIGNALE, on ne la répare pas — fusionner deux comptes
 * réécrirait des publications, et ce n'est pas à un écran de liste d'en décider.
 *
 * Rend les groupes de handles en collision, chacun trié, jamais un handle seul.
 */
export function collisionsDeMesure<T extends CompteLike>(
  comptes: readonly T[],
): { plateforme: string; handles: string[] }[] {
  // On compte les COMPTES qui tombent sur la clé, pas les graphies distinctes :
  // deux comptes au handle rigoureusement identique lisent eux aussi le même
  // total, et ne montreraient qu'une seule graphie.
  const parClef = new Map<
    string,
    { plateforme: string; handles: Set<string>; comptes: number }
  >();
  for (const c of comptes) {
    const clef = `${c.plateforme}::${c.handle.toLowerCase()}`;
    const e = parClef.get(clef);
    if (e) {
      e.handles.add(c.handle);
      e.comptes += 1;
    } else {
      parClef.set(clef, {
        plateforme: c.plateforme,
        handles: new Set([c.handle]),
        comptes: 1,
      });
    }
  }
  return [...parClef.values()]
    .filter((e) => e.comptes > 1)
    .map((e) => ({
      plateforme: e.plateforme,
      handles: [...e.handles].sort((a, b) => a.localeCompare(b, "fr")),
    }));
}
