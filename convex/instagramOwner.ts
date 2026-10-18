/**
 * À QUI EST CE REEL ? — verdict sur le propriétaire d'un post Instagram relevé.
 *
 * ── Le défaut que ce module ferme ────────────────────────────────────────────
 * Une URL de reel (`/reel/<code>/`) ne porte pas le handle de son auteur : au
 * collage, la garde de lien (`convex/postUrlShape.ts`) ne peut pas distinguer
 * le reel de la créatrice de celui de quelqu'un d'autre. Le 18/10/2026, Quentin
 * (@quentin.snytch) a collé un reel de @princiaconfort ; le relevé rapide l'a
 * lu à 359 638 puis 371 878 vues, affichées comme les siennes, et le relevé de
 * nuit les aurait portées en paie (bonus par vidéo, paliers), en analytics et
 * en alerte de hit. Seul l'item Apify sait à qui est le post (`ownerUsername`,
 * `ownerId`, cf `lib/apifyPosts.parseOwner`).
 *
 * ── Pourquoi pas « propriétaire ≠ handle ⇒ refus » ───────────────────────────
 * Mesuré sur la prod le 18/10/2026 (runs Apify du 17-18/10, 218 publications
 * dont le propriétaire est connu) : 10 écarts entre `ownerUsername` et le @ de
 * la publication, dont UN seul est un reel étranger. Les neuf autres sont à la
 * créatrice :
 *  - Kelly publie sur ses DEUX comptes (@kelly.dgtl, @thekellychapters) et
 *    rattache parfois le post à l'autre (4 cas) ;
 *  - Cintia est enregistrée `@Cintia_secretacc` (son @ TikTok) quand son compte
 *    Instagram est `cintia.secretaa` (5 cas sur 5 — le @ en base n'a jamais été
 *    le bon).
 * Et un compte RENOMMÉ (déjà vu sur TikTok : @sarah_snytch → @sarah_olv8)
 * ferait diverger tous ses posts d'un coup. Un refus sur le seul handle aurait
 * gelé la paie de neuf vidéos légitimes pour en arrêter une.
 *
 * ── La règle : refuser seulement le prouvé faux (cf #153) ────────────────────
 * Un compte a une IDENTITÉ CONFIRMÉE quand un de ses posts a été rendu par
 * Apify avec, pour propriétaire, le @ du compte lui-même : l'`ownerId` de ce
 * post (identifiant numérique, qui survit à un changement de @) est alors
 * appris sur le compte (`comptes.instagramOwnerIds`). Ensuite :
 *  - propriétaire = le @ du compte, ou un id appris → À ELLE ;
 *  - propriétaire = un autre compte Instagram de la même créatrice (son @ ou
 *    un id appris) → À ELLE — c'est le cas Kelly ;
 *  - sinon, et SEULEMENT si le compte a une identité confirmée → ÉTRANGER :
 *    rien n'est écrit, la publication est marquée ;
 *  - sinon (compte jamais confirmé, propriétaire ou id absent) → INCONNU, on
 *    relève comme avant. C'est le cas Cintia : sans identité confirmée, aucun
 *    propriétaire n'est prouvé faux.
 *
 * Module PUR (testé dans `lib/instagram-owner.test.ts`) ; la lecture et
 * l'écriture des comptes vivent dans `convex/instagramOwnerGuard.ts`.
 */

import { isAccountOnlyUrl } from "./postUrlShape";

/** Ce qu'Apify dit du propriétaire d'un post. */
export type InstagramOwner = {
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
};

export type OwnerVerdict =
  /** Le post est au compte (ou à la créatrice). `learnOwnerId` : à apprendre. */
  | { kind: "own"; learnOwnerId: string | null }
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

/**
 * @ d'une URL de PROFIL Instagram (`instagram.com/<user>?igsh=…`), sinon `null`.
 *
 * Le @ saisi en base est un libellé ; l'URL collée à la déclaration désigne
 * parfois le compte mieux que lui (cf `lib/compte-profile-url.ts`). Un lien de
 * post, d'une autre plateforme ou illisible n'apporte rien : `null`.
 */
export function instagramProfileHandle(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.trim() === "") return null;
  const raw = url.trim();
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return null;
  if (!isAccountOnlyUrl(u.toString(), "Instagram")) return null;
  return normalizeHandle(u.pathname.split("/").filter(Boolean)[0]);
}

/** Les @ qui désignent ce compte : le libellé en base et celui de son URL. */
function handlesOf(c: CompteIdentity): string[] {
  return [normalizeHandle(c.handle), instagramProfileHandle(c.url)].filter(
    (h): h is string => h !== null,
  );
}

/**
 * Le compte d'une publication et ses comptes « sœurs » (même propriétaire).
 *
 * INSTAGRAM SEULEMENT : sept @ de la prod existent à la fois en TikTok et en
 * Instagram, le @ seul ne désigne pas un compte (cf `recordAccountProfile`).
 * Égalité exacte d'abord (le @ de la publication est recopié du compte), puis
 * à la casse près.
 *
 * Sœurs = les autres comptes Instagram de la même créatrice ; pour un compte de
 * l'équipe (sans créatrice), les autres comptes de l'équipe.
 */
export function identityOf<T extends CompteIdentity>(
  comptes: readonly T[],
  pubHandle: string,
): { compte: T | null; siblings: T[] } {
  const ig = comptes.filter((c) => c.plateforme === "Instagram");
  const wanted = normalizeHandle(pubHandle);
  const compte =
    ig.find((c) => c.handle === pubHandle) ??
    (wanted === null ? undefined : ig.find((c) => normalizeHandle(c.handle) === wanted)) ??
    null;
  if (compte === null) return { compte: null, siblings: [] };
  const siblings = ig.filter(
    (c) => c._id !== compte._id && c.creatorId === compte.creatorId,
  );
  return { compte, siblings };
}

/**
 * Le propriétaire rendu est-il le @ de la publication ? Sert à ORDONNER les
 * écritures d'un passage : un post qui confirme l'identité du compte est jugé
 * avant ses voisins, pour que le premier passage après mise en service sache
 * déjà à qui est le compte (les lots de nuit regroupent les posts par compte,
 * cf `planLots`).
 */
export function ownerIsPubHandle(ownerUsername: string | null, pubHandle: string): boolean {
  const o = normalizeHandle(ownerUsername);
  return o !== null && o === normalizeHandle(pubHandle);
}

/** Le verdict. Cf l'en-tête pour la règle et les cas mesurés. */
export function judgeInstagramOwner(input: {
  owner: InstagramOwner;
  pubHandle: string;
  compte: CompteIdentity | null;
  siblings: readonly CompteIdentity[];
  /** `publications.foreignOwner` déjà posé sur CE lien (cf plus bas). */
  flaggedOwner?: string | null;
}): OwnerVerdict {
  const v = judgeOwnerOnce(input);
  // Le drapeau est une PREUVE ATTACHÉE AU LIEN : un reel ne change pas de
  // propriétaire, et `retrackPublication` l'efface quand le lien change. Un run
  // qui ne prouve rien (propriétaire absent) ne doit pas le lever — sans quoi
  // une nuit où l'actor omet le champ suffirait à faire entrer le reel en paie.
  // Seule une preuve contraire (le post est à elle) le fait tomber.
  if (v.kind === "unknown" && input.flaggedOwner) {
    return { kind: "foreign", ownerUsername: input.flaggedOwner };
  }
  return v;
}

function judgeOwnerOnce(input: {
  owner: InstagramOwner;
  pubHandle: string;
  compte: CompteIdentity | null;
  siblings: readonly CompteIdentity[];
}): OwnerVerdict {
  const { owner, pubHandle, compte, siblings } = input;
  const username = normalizeHandle(owner.ownerUsername);
  const id = owner.ownerId;
  if (username === null && id === null) return { kind: "unknown" };

  const learned = compte?.instagramOwnerIds ?? [];
  const selfHandles = new Set(
    [normalizeHandle(pubHandle), ...(compte ? handlesOf(compte) : [])].filter(
      (h): h is string => h !== null,
    ),
  );
  if (username !== null && selfHandles.has(username)) {
    // Seul ce cas APPREND : le post confirme l'identité du compte lui-même.
    const learn = compte !== null && id !== null && !learned.includes(id) ? id : null;
    return { kind: "own", learnOwnerId: learn };
  }
  // Même id, autre @ : le compte a été renommé.
  if (id !== null && learned.includes(id)) return { kind: "own", learnOwnerId: null };

  // Un autre compte de la même créatrice — par son @ ou par un id appris.
  for (const s of siblings) {
    if (username !== null && handlesOf(s).includes(username)) {
      return { kind: "own", learnOwnerId: null };
    }
    if (id !== null && (s.instagramOwnerIds ?? []).includes(id)) {
      return { kind: "own", learnOwnerId: null };
    }
  }

  // PROUVÉ étranger : le compte a une identité confirmée, et ce n'est pas elle.
  // Il faut l'id pour exclure un renommage, et le @ pour le dire à l'admin.
  if (learned.length > 0 && id !== null && username !== null) {
    return { kind: "foreign", ownerUsername: username };
  }
  return { kind: "unknown" };
}
