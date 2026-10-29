/**
 * PLAYBOOK — la FICHE d'un format qui a gagné, en règles pures.
 *
 * Module PUR (aucun import `_generated`) : importable depuis `convex/` et le
 * client, testé par `lib/playbook-fiche.test.ts`. Même arrangement que
 * `convex/graduation.ts`.
 *
 * ── Ce qu'est une fiche ──────────────────────────────────────────────────────
 * Un FORMAT (angle + structure + exécution), pas une brique ni une campagne :
 * « X ans de relation et je découvre ÇA » traverse deux campagnes et trois
 * langues. La fiche dit quoi refaire (recette), la preuve que ça marche (les
 * posts liés, relus EN DIRECT, plus le texte qui les commente), ce qui contredit
 * (contre-preuve : un hit ne prouve pas un hook), les règles et ce qui reste à
 * tester. Chaque modification laisse une ligne au journal, avec les valeurs
 * d'avant — de quoi la défaire plus tard.
 *
 * ── Les posts ────────────────────────────────────────────────────────────────
 * Un post se désigne par son LIEN, réduit à une clé de plateforme (id TikTok,
 * shortcode Instagram) : deux publications Jarvia peuvent porter la même vidéo
 * (deux comptes, deux campagnes — le 833 400 de Kelly est compté deux fois), la
 * clé les confond. La clé porte aussi la DATE de mise en ligne (les deux
 * plateformes l'encodent dans l'identifiant) : c'est elle qui borne la recherche
 * de la publication, au lieu de relire tout le projet.
 */

import {
  timestampFromInstagramShortcode,
  timestampFromTikTokVideoId,
  tiktokVideoIdFromUrl,
} from "./postUrlDate";

/** Dans l'ordre où l'écran les range : ce qui marche d'abord. */
export const STATUTS_FICHE = ["prouve", "en_test", "hypothese", "en_usure", "retire"] as const;
export type StatutFiche = (typeof STATUTS_FICHE)[number];

/** Une fiche neuve n'a encore rien prouvé. */
export const STATUT_INITIAL: StatutFiche = "hypothese";

/** Les champs de texte, dans l'ordre de l'écran et de l'outil MCP. */
export const CHAMPS_TEXTE = ["recette", "preuves", "contrePreuve", "regles", "aTester"] as const;
export type ChampTexte = (typeof CHAMPS_TEXTE)[number];

export type ChampFiche = "titre" | "statut" | ChampTexte;
export const CHAMPS_FICHE: readonly ChampFiche[] = ["titre", "statut", ...CHAMPS_TEXTE];

export const MAX_TITRE = 120;
/** Une recette de Sarah (6 temps) tient en ~1 200 caractères : large, sous la limite d'un document. */
export const MAX_TEXTE = 8_000;
export const MAX_MOTIF = 500;
export const MAX_POSTS = 20;

export type ContenuFiche = { titre: string; statut: StatutFiche } & Record<ChampTexte, string>;

export function estStatutFiche(x: unknown): x is StatutFiche {
  return typeof x === "string" && (STATUTS_FICHE as readonly string[]).includes(x);
}

/** Titre nettoyé (espaces de bord), ou null s'il est vide ou trop long. */
export function titreValide(titre: string): string | null {
  const t = titre.trim();
  return t === "" || t.length > MAX_TITRE ? null : t;
}

/** Texte nettoyé des espaces de bord ; null s'il dépasse la limite. Vide = champ effacé. */
export function texteValide(texte: string): string | null {
  const t = texte.trim();
  return t.length > MAX_TEXTE ? null : t;
}

/** Motif d'une modification : null s'il est vide, tronqué à la limite. */
export function motifValide(motif: string | undefined): string | null {
  const m = (motif ?? "").trim();
  return m === "" ? null : m.slice(0, MAX_MOTIF);
}

export type DiffFiche = {
  /** Les champs qui changent VRAIMENT, dans l'ordre de `CHAMPS_FICHE`. */
  champs: ChampFiche[];
  /** Leurs valeurs d'avant — ce que le journal garde. */
  avant: Partial<ContenuFiche>;
  /** Leurs valeurs d'après — ce qui s'écrit. */
  apres: Partial<ContenuFiche>;
};

/**
 * Ce qu'une saisie change dans une fiche. Un champ absent de la saisie, ou
 * identique une fois nettoyé, ne change pas : enregistrer sans rien toucher
 * n'écrit rien et ne laisse aucune ligne au journal. La saisie doit avoir été
 * validée avant (titre et textes nettoyés).
 */
export function diffFiche(avant: ContenuFiche, saisie: Partial<ContenuFiche>): DiffFiche {
  const out: DiffFiche = { champs: [], avant: {}, apres: {} };
  for (const champ of CHAMPS_FICHE) {
    const nouveau = saisie[champ];
    if (nouveau === undefined || nouveau === avant[champ]) continue;
    out.champs.push(champ);
    Object.assign(out.avant, { [champ]: avant[champ] });
    Object.assign(out.apres, { [champ]: nouveau });
  }
  return out;
}

// ─── Posts ───────────────────────────────────────────────────────────────────

const INSTAGRAM_CODE_RE = /^https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i;

/**
 * Clé d'un post (« tiktok:768… », « instagram:DeXS… ») tirée de son lien, ou
 * null : lien court (vm.tiktok.com, que seule la plateforme sait résoudre),
 * profil, autre plateforme.
 */
export function clePost(url: string): string | null {
  const u = url.trim();
  const tiktok = tiktokVideoIdFromUrl(u);
  if (tiktok) return `tiktok:${tiktok}`;
  const ig = INSTAGRAM_CODE_RE.exec(u);
  return ig ? `instagram:${ig[1]}` : null;
}

/** Date de mise en ligne encodée dans la clé (ms), ou null. */
export function dateDeCle(cle: string): number | null {
  const [plateforme, id] = cle.split(":");
  if (!id) return null;
  if (plateforme === "tiktok") return timestampFromTikTokVideoId(id);
  if (plateforme === "instagram") return timestampFromInstagramShortcode(id);
  return null;
}

const JOUR = 86_400_000;

/**
 * Où chercher la publication d'un post mis en ligne à `date` : `datePubli` est
 * celle de la CONFIRMATION (TD-020), qui suit la mise en ligne de quelques
 * minutes à quelques jours. Un jour avant couvre l'arrondi, dix après une
 * confirmation tardive.
 */
export function fenetreDePublication(date: number): { du: number; au: number } {
  return { du: date - JOUR, au: date + 10 * JOUR };
}

/**
 * Un post par clé : quand deux publications portent la même vidéo, on garde
 * celle qui a le plus de vues. Les publications sans clé (lien absent ou
 * illisible) restent, chacune pour elle.
 */
export function dedoublonnerPosts<T extends { cle: string | null; vues: number | null }>(posts: T[]): T[] {
  const parCle = new Map<string, T>();
  const sansCle: T[] = [];
  for (const p of posts) {
    if (p.cle === null) {
      sansCle.push(p);
      continue;
    }
    const deja = parCle.get(p.cle);
    if (!deja || (p.vues ?? -1) > (deja.vues ?? -1)) parCle.set(p.cle, p);
  }
  return [...parCle.values(), ...sansCle].sort((a, b) => (b.vues ?? -1) - (a.vues ?? -1));
}
