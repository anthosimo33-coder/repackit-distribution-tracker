/**
 * Lecture des champs d'un item TikTok renvoyé par `clockworks/tiktok-scraper` —
 * SOURCE UNIQUE, partagée par le relevé des créatrices (convex/apifyApi.ts) et
 * par la veille RADAR (convex/radarApi.ts).
 *
 * Module PUR (aucun import Convex) : importable des deux côtés et testable en
 * vitest via `lib/apify-item.test.ts`. Même arrangement que
 * `convex/dateFr.ts`.
 *
 * ── Pourquoi ce module existe ────────────────────────────────────────────────
 * L'acteur renvoie DÉJÀ, sur chaque item vidéo, deux informations que le relevé
 * des créatrices jetait :
 *   - `collectCount` — les SAVES du post ;
 *   - `authorMeta` — les compteurs du COMPTE (abonnés, abonnements, likes
 *     cumulés), servis gratuitement avec chaque vidéo.
 * RADAR les lisait déjà de son côté. Plutôt que d'en écrire une seconde
 * extraction, la lecture vit ici et les deux appelants s'en servent.
 *
 * ⚠️ TOUT est optionnel et rendu `null` si absent. La forme exacte de l'item
 * dépend de l'INPUT de l'acteur (`profiles` pour RADAR, `postURLs` pour le
 * relevé) : `authorMeta` est prouvé présent sur l'input profil, PAS encore sur
 * l'input URL. Lire défensivement coûte une ligne et évite de faire dépendre le
 * relevé d'une hypothèse — si le champ manque, on stocke `null` et on le voit.
 */

/**
 * "123" → 123 ; nombre fini POSITIF OU NUL → lui-même ; tout le reste → null.
 *
 * UN NÉGATIF EST UN CODE D'ABSENCE, PAS UN COMPTEUR. L'actor Instagram renvoie
 * `likesCount: -1` quand le compte masque ses likes ; stocké tel quel, il
 * s'affichait « -1 like », faussait les sommes et rendait le taux d'engagement
 * NÉGATIF. Aucun compteur qui passe par ici n'admet de négatif légitime (vues,
 * likes, commentaires, saves, abonnés/abonnements/likes cumulés). Le seul
 * compteur du domaine qui en admettrait un — `subsGained`, une perte d'abonnés
 * — est une saisie manuelle et ne passe PAS par cette fonction.
 *
 * `null` veut dire « non collecté », comme pour une valeur absente : c'est
 * l'appelant qui décide quoi en faire, et il le décide déjà (cf `parseSaves`).
 */
export function toCount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * SAVES d'un post TikTok (`collectCount`).
 *
 * `null` = NON COLLECTÉ, ce qui n'est pas 0. La distinction porte les règles du
 * playbook : un save rate absent ne vaut pas un save rate nul, et ne doit donc
 * jamais satisfaire un seuil (cf convex/graduation.ts).
 *
 * Instagram et YouTube n'exposent AUCUNE métrique de saves — ce n'est pas une
 * limite de l'acteur mais de la plateforme. Sur ces deux-là, `null` est la
 * réponse définitive, pas un défaut de collecte à corriger.
 */
export function parseSaves(item: unknown): number | null {
  return toCount(asRecord(item).collectCount);
}

/** Compteurs d'un COMPTE, tels que l'item vidéo les porte. */
export type AuthorProfile = {
  /** Handle sans « @ » (`authorMeta.name`), null si absent. */
  handle: string | null;
  /** Abonnés (`authorMeta.fans`). */
  followers: number | null;
  /** Abonnements (`authorMeta.following`). */
  following: number | null;
  /** Likes CUMULÉS du compte (`authorMeta.heart`). */
  totalLikes: number | null;
  /**
   * PHOTO DE PROFIL du compte (`authorMeta.avatar`), URL du CDN TikTok.
   *
   * ⚠️ CETTE URL EXPIRE. Le CDN TikTok signe ses liens (`x-expires`) : gardée
   * telle quelle, elle affiche une image cassée quelques jours plus tard. Elle
   * ne sert donc qu'à DEUX choses côté serveur — savoir que la photo a changé,
   * et savoir où aller la chercher — jamais à alimenter un `<img>`. Le blob est
   * recopié dans le storage (cf. convex/compteAvatar.ts).
   */
  avatarUrl: string | null;
};

/**
 * Compteurs de compte portés par un item vidéo.
 *
 * `fans` est PROUVÉ présent (fixture RADAR issue d'une sortie réelle) ;
 * `following` et `heart` sont plausibles mais non prouvés — d'où la lecture
 * défensive. Un profil dont tous les champs sont `null` ne vaut pas la peine
 * d'être enregistré : `hasAnyCount` permet à l'appelant de l'écarter.
 */
export function parseAuthorProfile(item: unknown): AuthorProfile {
  const author = asRecord(asRecord(item).authorMeta);
  const rawHandle = author.name;
  return {
    handle:
      typeof rawHandle === "string" && rawHandle.trim() !== ""
        ? rawHandle.trim().replace(/^@/, "")
        : null,
    followers: toCount(author.fans),
    following: toCount(author.following),
    totalLikes: toCount(author.heart),
    avatarUrl: parseAvatarUrl(author),
  };
}

/**
 * `authorMeta.avatar`, sinon `authorMeta.originalAvatarUrl`. L'acteur expose les
 * deux ; `avatar` est la version passée par le cache d'Apify et se révèle la
 * plus servable, l'autre est le lien TikTok brut — on prend le premier des deux
 * qui existe plutôt que d'en exiger un.
 *
 * Filtré sur http(s) : un champ présent mais vide, ou une valeur qui n'est pas
 * une URL, vaut `null` — mieux vaut l'initiale que le téléchargement d'un
 * n'importe quoi.
 */
function parseAvatarUrl(author: Record<string, unknown>): string | null {
  for (const candidate of [author.avatar, author.originalAvatarUrl]) {
    if (typeof candidate !== "string") continue;
    const url = candidate.trim();
    if (url.startsWith("https://") || url.startsWith("http://")) return url;
  }
  return null;
}

/** Ce profil porte-t-il au moins un compteur exploitable ? */
export function hasAnyCount(p: AuthorProfile): boolean {
  return (
    p.followers !== null || p.following !== null || p.totalLikes !== null
  );
}

/**
 * Compteurs d'un PROFIL Instagram (`apify/instagram-scraper`, resultsType
 * "details"). Contrairement à TikTok, l'item de POST ne porte pas les compteurs
 * du compte : il faut un run dédié, d'où le coût (+1 run par nuit).
 *
 * `heart` n'a pas d'équivalent — Instagram n'expose pas de total de likes du
 * compte. `null`, comme toujours, veut dire « pas de donnée », pas « zéro ».
 */
export function parseInstagramProfile(item: unknown): AuthorProfile {
  const rec = asRecord(item);
  const rawHandle = rec.username;
  return {
    handle:
      typeof rawHandle === "string" && rawHandle.trim() !== ""
        ? rawHandle.trim().replace(/^@/, "")
        : null,
    followers: toCount(rec.followersCount),
    following: toCount(rec.followsCount),
    totalLikes: null,
    // Le miroir de photo de profil n'est câblé que sur TikTok (c'est la seule
    // plateforme dont l'item de post porte l'avatar sans run supplémentaire).
    avatarUrl: null,
  };
}
