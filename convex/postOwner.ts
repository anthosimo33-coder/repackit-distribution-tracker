/**
 * À QUI EST CE POST ? — verdict sur l'auteur d'un post Instagram ou TikTok
 * relevé.
 *
 * ── Le défaut que ce module ferme ────────────────────────────────────────────
 * Au collage, rien ne vérifie que le post est au compte de la créatrice :
 *  - INSTAGRAM : l'URL d'un reel (`/reel/<code>/`) ne porte pas le handle de
 *    son auteur. Le 18/10/2026, Quentin (@quentin.snytch) a collé un reel de
 *    @princiaconfort ; le relevé rapide l'a lu à 359 638 puis 371 878 vues,
 *    affichées comme les siennes, et le relevé de nuit les aurait portées en
 *    paie (bonus par vidéo, paliers), en analytics et en alerte de hit (#415) ;
 *  - TIKTOK : l'URL porte bien un @ (`/@handle/video/<id>`), mais TikTok ne le
 *    LIT PAS — il sert la vidéo par son id. Vérifié le 18/10/2026 :
 *    `/@zzqq_nobody_x/video/7697209634930642209` sert la vidéo de
 *    @sarah_snytch. Le @ de l'URL n'est qu'un libellé. Cas réel en prod : la
 *    vidéo 7676941579743005984 de @sarahkl02 (Sarah) déclarée aussi par Marine
 *    sur @marine.bn07 (22/08), relevée 1 317 vues comme les siennes.
 * Seule la plateforme sait à qui est le post : `ownerUsername`/`ownerId` de
 * l'item Apify Instagram, `author.uniqueId`/`author.id` de la page publique
 * TikTok (ou `authorMeta` chez Apify en secours).
 *
 * ── Pourquoi pas « auteur ≠ handle ⇒ refus » ─────────────────────────────────
 * Mesuré sur la prod le 18/10/2026. INSTAGRAM (runs Apify du 17-18/10, 218
 * publications dont le propriétaire est connu) : 10 écarts, UN seul étranger.
 *  - Kelly publie sur ses DEUX comptes (@kelly.dgtl, @thekellychapters) et
 *    rattache parfois le post à l'autre (4 cas) ;
 *  - Cintia est enregistrée `@Cintia_secretacc` (son @ TikTok) quand son compte
 *    Instagram est `cintia.secretaa` (5 cas sur 5).
 * TIKTOK (page publique des 788 publications à lien, 18/10 ; 632 servies avec
 * leur auteur) : 38 auteurs ≠ @ du compte, mêmes familles.
 *  - 31 × @sarah_olv8 en base, mais le compte s'appelle @sarah_snytch (même
 *    id) : RENOMMÉ. Dix de ces liens portent encore @sarah_olv8 — le @ de
 *    l'URL ne prouve rien ;
 *  - 6 × Kelly, sur @kellyleydie et @thekellychapters_ ;
 *  - 1 × Marie (@marriyaaahsmile) : vidéo de @marie.rvlation, compte qui
 *    n'est déclaré nulle part — seul refus de la règle ci-dessous, levé en
 *    déclarant ce compte à son nom (il devient une sœur).
 * Un refus sur le seul handle en aurait fait 38 ; la règle, 1.
 *
 * ── La règle : refuser seulement le prouvé faux (cf #153) ────────────────────
 * Un compte a une IDENTITÉ CONFIRMÉE quand un de ses posts a été rendu avec,
 * pour auteur, le @ du compte lui-même : l'id de l'auteur (numérique, il
 * survit à un changement de @) est alors appris sur le compte
 * (`comptes.instagramOwnerIds` / `comptes.tiktokOwnerIds`). Ensuite :
 *  - auteur = le @ du compte, ou un id appris → À ELLE (« self ») ;
 *  - auteur = un autre compte DE LA MÊME PLATEFORME et de la même créatrice
 *    (son @ ou un id appris) → À ELLE (« sibling ») — c'est le cas Kelly ;
 *  - sinon, et SEULEMENT si le compte a une identité confirmée → ÉTRANGER :
 *    rien n'est écrit, la publication est marquée ;
 *  - sinon (compte jamais confirmé, auteur ou id absent) → INCONNU, on relève
 *    comme avant. C'est le cas Cintia, et celui de @sarah_olv8 : sans identité
 *    confirmée, aucun auteur n'est prouvé faux.
 *
 * « sibling » est À ELLE pour les vues, pas pour le PROFIL : le post d'un autre
 * compte porte les abonnés et la photo de cet autre compte. Le 17/10/2026, une
 * vidéo de @kellyleydie rattachée à @thekellychapters_ a fait passer ce compte
 * de 373 à 1 691 abonnés — ceux de @kellyleydie (cf `collectTikTokInternally`).
 *
 * Module PUR (testé dans `lib/post-owner.test.ts`) ; la lecture et l'écriture
 * des comptes vivent dans `convex/postOwnerGuard.ts`.
 */

import { isAccountOnlyUrl } from "./postUrlShape";

/** Plateformes dont le relevé rend l'auteur du post. */
export type OwnerPlatform = "Instagram" | "TikTok";

export function isOwnerPlatform(plateforme: string): plateforme is OwnerPlatform {
  return plateforme === "Instagram" || plateforme === "TikTok";
}

/** Ce que la plateforme dit de l'auteur d'un post. */
export type PostOwner = {
  ownerUsername: string | null;
  ownerId: string | null;
};

/** Ce qu'il faut d'un compte (ligne `comptes`) pour juger. */
export type CompteIdentity = {
  _id: string;
  handle: string;
  plateforme: string;
  url?: string;
  creatorId?: string;
  instagramOwnerIds?: readonly string[];
  tiktokOwnerIds?: readonly string[];
};

export type OwnerVerdict =
  /**
   * Le post est à la créatrice. `account` : à CE compte (« self »), ou à un
   * autre de ses comptes (« sibling »). `learnOwnerId` : id à apprendre.
   */
  | { kind: "own"; account: "self" | "sibling"; learnOwnerId: string | null }
  /** Rien de prouvé — on relève comme avant. */
  | { kind: "unknown" }
  /** Prouvé à quelqu'un d'autre : ne rien écrire, marquer la publication. */
  | { kind: "foreign"; ownerUsername: string };

/** « @Sarah_snytch » → « sarah_snytch ». Vide → `null`. */
export function normalizeHandle(handle: string | null | undefined): string | null {
  if (typeof handle !== "string") return null;
  const h = handle.trim().replace(/^@+/, "").toLowerCase();
  return h === "" ? null : h;
}

/** Les ids d'auteur appris sur ce compte, pour SA plateforme. */
export function learnedOwnerIds(c: CompteIdentity): readonly string[] {
  if (c.plateforme === "TikTok") return c.tiktokOwnerIds ?? [];
  if (c.plateforme === "Instagram") return c.instagramOwnerIds ?? [];
  return [];
}

/** Parse tolérant d'une URL saisie (schéma absent compris). */
function parseUrl(url: string | null | undefined): URL | null {
  if (typeof url !== "string" || url.trim() === "") return null;
  const raw = url.trim();
  try {
    return new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

function hostIs(u: URL, domain: string): boolean {
  const host = u.hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * @ d'une URL de PROFIL Instagram (`instagram.com/<user>?igsh=…`), sinon `null`.
 *
 * Le @ saisi en base est un libellé ; l'URL collée à la déclaration désigne
 * parfois le compte mieux que lui (cf `lib/compte-profile-url.ts`). Un lien de
 * post, d'une autre plateforme ou illisible n'apporte rien : `null`.
 */
export function instagramProfileHandle(url: string | null | undefined): string | null {
  const u = parseUrl(url);
  if (u === null || !hostIs(u, "instagram.com")) return null;
  if (!isAccountOnlyUrl(u.toString(), "Instagram")) return null;
  return normalizeHandle(u.pathname.split("/").filter(Boolean)[0]);
}

/**
 * @ d'une URL de PROFIL TikTok (`tiktok.com/@<user>?_r=1&_t=…`), sinon `null`.
 * `tiktok.com/<user>` sans @ n'est pas une adresse de profil TikTok (forme vue
 * en base : `www.tiktok.com/julie.kl31`) : `null`, comme un lien de vidéo.
 */
export function tiktokProfileHandle(url: string | null | undefined): string | null {
  const u = parseUrl(url);
  if (u === null || !hostIs(u, "tiktok.com")) return null;
  if (!isAccountOnlyUrl(u.toString(), "TikTok")) return null;
  return normalizeHandle(u.pathname.split("/").filter(Boolean)[0]);
}

/** Les @ qui désignent ce compte : le libellé en base et celui de son URL. */
function handlesOf(c: CompteIdentity): string[] {
  const fromUrl =
    c.plateforme === "TikTok" ? tiktokProfileHandle(c.url) : instagramProfileHandle(c.url);
  return [normalizeHandle(c.handle), fromUrl].filter((h): h is string => h !== null);
}

/**
 * Le compte d'une publication et ses comptes « sœurs » (même propriétaire).
 *
 * SUR LA PLATEFORME DE LA PUBLICATION SEULEMENT : sept @ de la prod existent à
 * la fois en TikTok et en Instagram, le @ seul ne désigne pas un compte (cf
 * `recordAccountProfile`). Égalité exacte d'abord (le @ de la publication est
 * recopié du compte), puis à la casse près.
 *
 * Sœurs = les autres comptes de la même plateforme et de la même créatrice ;
 * pour un compte de l'équipe (sans créatrice), les autres comptes de l'équipe.
 */
export function identityOf<T extends CompteIdentity>(
  comptes: readonly T[],
  pubHandle: string,
  plateforme: OwnerPlatform,
): { compte: T | null; siblings: T[] } {
  const same = comptes.filter((c) => c.plateforme === plateforme);
  const wanted = normalizeHandle(pubHandle);
  const compte =
    same.find((c) => c.handle === pubHandle) ??
    (wanted === null ? undefined : same.find((c) => normalizeHandle(c.handle) === wanted)) ??
    null;
  if (compte === null) return { compte: null, siblings: [] };
  const siblings = same.filter(
    (c) => c._id !== compte._id && c.creatorId === compte.creatorId,
  );
  return { compte, siblings };
}

/**
 * L'auteur rendu est-il le @ de la publication ? Sert à ORDONNER les écritures
 * d'un passage : un post qui confirme l'identité du compte est jugé avant ses
 * voisins, pour que le premier passage après mise en service sache déjà à qui
 * est le compte (les lots de nuit regroupent les posts par compte, cf
 * `planLots`).
 */
export function ownerIsPubHandle(ownerUsername: string | null, pubHandle: string): boolean {
  const o = normalizeHandle(ownerUsername);
  return o !== null && o === normalizeHandle(pubHandle);
}

/** Le verdict. Cf l'en-tête pour la règle et les cas mesurés. */
export function judgePostOwner(input: {
  owner: PostOwner;
  pubHandle: string;
  compte: CompteIdentity | null;
  siblings: readonly CompteIdentity[];
  /** `publications.foreignOwner` déjà posé sur CE lien (cf plus bas). */
  flaggedOwner?: string | null;
}): OwnerVerdict {
  const v = judgeOwnerOnce(input);
  // Le drapeau est une PREUVE ATTACHÉE AU LIEN : un post ne change pas
  // d'auteur, et `retrackPublication` l'efface quand le lien change. Un relevé
  // qui ne prouve rien (auteur absent) ne doit pas le lever — sans quoi une
  // nuit où la source omet le champ suffirait à faire entrer le post en paie.
  // Seule une preuve contraire (le post est à elle) le fait tomber.
  if (v.kind === "unknown" && input.flaggedOwner) {
    return { kind: "foreign", ownerUsername: input.flaggedOwner };
  }
  return v;
}

function judgeOwnerOnce(input: {
  owner: PostOwner;
  pubHandle: string;
  compte: CompteIdentity | null;
  siblings: readonly CompteIdentity[];
}): OwnerVerdict {
  const { owner, pubHandle, compte, siblings } = input;
  const username = normalizeHandle(owner.ownerUsername);
  const id = owner.ownerId;
  if (username === null && id === null) return { kind: "unknown" };

  const learned = compte ? learnedOwnerIds(compte) : [];
  const selfHandles = new Set(
    [normalizeHandle(pubHandle), ...(compte ? handlesOf(compte) : [])].filter(
      (h): h is string => h !== null,
    ),
  );
  if (username !== null && selfHandles.has(username)) {
    // Seul ce cas APPREND : le post confirme l'identité du compte lui-même.
    const learn = compte !== null && id !== null && !learned.includes(id) ? id : null;
    return { kind: "own", account: "self", learnOwnerId: learn };
  }
  // Même id, autre @ : le compte a été renommé.
  if (id !== null && learned.includes(id)) {
    return { kind: "own", account: "self", learnOwnerId: null };
  }

  // Un autre compte de la même créatrice — par son @ ou par un id appris.
  for (const s of siblings) {
    if (username !== null && handlesOf(s).includes(username)) {
      return { kind: "own", account: "sibling", learnOwnerId: null };
    }
    if (id !== null && learnedOwnerIds(s).includes(id)) {
      return { kind: "own", account: "sibling", learnOwnerId: null };
    }
  }

  // PROUVÉ étranger : le compte a une identité confirmée, et ce n'est pas elle.
  // Il faut l'id pour exclure un renommage, et le @ pour le dire à l'admin.
  if (learned.length > 0 && id !== null && username !== null) {
    return { kind: "foreign", ownerUsername: username };
  }
  return { kind: "unknown" };
}
