/**
 * DATE DE PUBLICATION LUE DANS L'URL D'UN POST — lecture pure, sans réseau.
 *
 * Module PUR (aucun import `_generated`) → importable côté serveur, côté client
 * ET depuis `lib/` pour les tests, en UNE seule définition. Même patron que
 * `convex/accountPhase.ts` et `convex/roles.ts`.
 *
 * POURQUOI. Le clippeur déclare sa publication en collant le lien, parfois le
 * lendemain matin d'un post de 22 h. Le quota se compte sur la date RÉELLE de
 * publication (TD-020) : si le formulaire pré-remplit « aujourd'hui », le
 * clippeur valide sans y penser et le compteur du mauvais jour est incrémenté —
 * en silence, pendant des semaines. Lire la date DANS le lien dissout le défaut
 * au lieu de le rendre lisible.
 *
 * ⚠️ DÉCODER, PAS INGÉRER. Ce module ne fait qu'une lecture d'URL. Le
 * remboursement complet de TD-020 — récupérer le vrai horodatage plateforme dans
 * `apifyApi`/`youtubeApi` et le poser sur les publications — est un chemin
 * PARTAGÉ avec les créatrices partenaires, et n'a rien à faire dans une PR
 * d'espace clippeur. Le jour où cette dette sera remboursée, l'ingestion
 * réutilisera ce décodeur : c'est le seul endroit du dépôt qui sait lire cette
 * date.
 *
 * ⚠️ JAMAIS UN `null` NU. Quand la date n'est pas lisible, la RAISON sort avec —
 * même discipline que `accountUrlCheck` : un silence se lirait « pas de date à
 * lire » alors que la vérité est « je n'ai pas su la lire », et l'écran doit dire
 * laquelle des deux.
 */

/** Plateformes d'un lien de post (miroir de `UrlPlateforme`). */
export type PostDatePlatform = "TikTok" | "Instagram" | "YouTube";

/**
 * Shortlink TikTok — `vm.`/`vt.tiktok.com/<code>` et `tiktok.com/t/<code>`.
 * Aucun identifiant de vidéo dedans : ni handle, ni horodatage. Le résoudre
 * demande un aller-retour réseau (`convex/postUrlResolution.ts`), hors de portée
 * d'un formulaire synchrone.
 *
 * DÉFINITION UNIQUE du dépôt : `convex/modelVideoEmbeds.ts` et
 * `lib/model-video-embed.ts` la ré-exportent (A6 interdit `convex/ → lib/`, pas
 * l'inverse ; ce module est pur donc importable des deux côtés). Les tests
 * vérifient l'IDENTITÉ DE RÉFÉRENCE, pas l'égalité de comportement : deux
 * répliques surveillées par un test de parité peuvent diverger le temps d'un
 * commit, une seule fonction non.
 *
 * ⚠️ `lib/post-url-account.ts` porte une QUATRIÈME variante, volontairement
 * laissée en place : elle ne connaît PAS la forme `tiktok.com/t/`. L'unifier
 * changerait ce que l'admin voit sur ce lien (« Lien raccourci » au lieu de
 * « Compte non présent dans l'URL ») — un changement de chemin partenaire, hors
 * périmètre d'une PR d'espace clippeur.
 */
export function isTikTokShortlink(url: string): boolean {
  return /^https?:\/\/(?:(?:vm|vt)\.tiktok\.com\/|(?:www\.)?tiktok\.com\/t\/)[A-Za-z0-9]+/i.test(
    url.trim(),
  );
}

/**
 * Résultat d'une lecture de date. `at` non nul ⇒ `source` dit d'où elle vient
 * (l'écran doit pouvoir l'annoncer : un pré-remplissage invisible reproduit le
 * défaut qu'on corrige).
 */
export type PostDateRead =
  | { at: number; source: "tiktok-id" }
  | {
      at: null;
      reason:
        /** `vm.`/`vt.`/`t/` — l'identifiant n'est pas dans l'URL. */
        | "shortlink"
        /** Plateforme sans horodatage dans l'URL (Instagram, YouTube). */
        | "platform"
        /** URL de la bonne plateforme mais sans identifiant de vidéo (profil…). */
        | "no-id"
        /** Décodé, mais hors de toute plage plausible → id tronqué/bricolé. */
        | "out-of-range";
    };

/**
 * Plancher de plausibilité : les identifiants de vidéo TikTok au format actuel
 * datent de la fusion musical.ly (2016). Un id tronqué décoderait en 1970.
 */
const FLOOR_MS = Date.UTC(2016, 0, 1);

/**
 * Tolérance vers le futur. Une vidéo publiée il y a quelques secondes peut
 * décoder très légèrement après l'horloge locale (dérive client/serveur). Sans
 * tolérance on jetterait une lecture parfaitement valide ; avec 5 minutes on
 * garde le bon JOUR, seule granularité qui compte pour le quota.
 */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * Identifiant de vidéo dans une URL TikTok : `/video/<id>` (nominal),
 * `/photo/<id>` (carrousel photo, même espace d'ids) et `/v/<id>` (forme
 * mobile héritée).
 */
const TIKTOK_ID_RE = /\/(?:video|photo|v)\/(\d{6,25})/;

/**
 * Horodatage encodé dans un identifiant de vidéo TikTok : les 32 bits de poids
 * fort sont les SECONDES Unix de la mise en ligne.
 *
 * Vérifié sur des données réelles (5 publications de prod, 2026-08-11/12) : le
 * décodage tombe systématiquement AVANT la date enregistrée, de 1 minute à 15
 * heures — l'écart est précisément TD-020, la date enregistrée étant celle de la
 * confirmation. Le cas à 15 heures traverse minuit : c'est le scénario du faux
 * compteur, en une ligne.
 */
export function timestampFromTikTokVideoId(videoId: string): number | null {
  if (!/^\d{6,25}$/.test(videoId)) return null;
  let seconds: number;
  try {
    // `BigInt(32)` et non le littéral `32n` : la cible TS du dépôt est
    // antérieure à ES2020, qui seule autorise la syntaxe littérale.
    seconds = Number(BigInt(videoId) >> BigInt(32));
  } catch {
    return null;
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1000;
}

/**
 * Date de publication lisible dans l'URL, ou la raison de son absence.
 *
 * `now` est un paramètre (et non `Date.now()` en dur) pour que les tests bornent
 * le futur sans dépendre de l'horloge de la machine.
 */
export function publicationDateFromUrl(
  url: string,
  platform: PostDatePlatform,
  now: number,
): PostDateRead {
  if (platform !== "TikTok") return { at: null, reason: "platform" };
  const trimmed = url.trim();
  if (trimmed === "") return { at: null, reason: "no-id" };
  // Testé AVANT l'extraction : un shortlink n'a pas d'id, et le dire
  // « shortlink » plutôt que « no-id » change le message montré au clippeur.
  if (isTikTokShortlink(trimmed)) return { at: null, reason: "shortlink" };
  const m = trimmed.match(TIKTOK_ID_RE);
  if (!m) return { at: null, reason: "no-id" };
  const at = timestampFromTikTokVideoId(m[1]);
  if (at === null) return { at: null, reason: "no-id" };
  if (at < FLOOR_MS || at > now + FUTURE_TOLERANCE_MS) {
    return { at: null, reason: "out-of-range" };
  }
  return { at, source: "tiktok-id" };
}
