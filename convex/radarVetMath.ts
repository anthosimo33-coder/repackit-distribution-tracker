/**
 * RADAR — LE FILTRE D'ENTRÉE d'un compte. Règles pures (les écritures : convex/radarVet).
 *
 * Pourquoi : jusqu'au 13/11/2026, UNE vidéo qui cite une app suffisait à faire entrer son auteur dans le réseau de
 * l'app — il était relevé tout de suite (1 crédit), montré partout, et ne sortait qu'après 9 vidéos lues sans
 * aucune citation. Le fondateur, ce jour-là, devant le compte d'une émission de télé-réalité rangé sous « declic »
 * et un compte de médecine sous « Hyper » : « beaucoup, beaucoup de déchets ».
 *
 * Un compte qui POUSSE une app en parle plus d'une fois. Avant d'entrer, il est donc lu sur sa page publique
 * (gratuite : sa bio et ses 10 à 13 dernières vidéos avec leur légende) et n'entre que PROUVÉ :
 *  - son pseudo porte l'app, ou sa bio la nomme ;
 *  - ou au moins 2 de ses dernières vidéos la citent ; ou une seule, si elle fait au moins le tiers de ce qu'il
 *    a publié (un compte tout neuf).
 *
 * Mesuré le 13/11/2026 sur 570 comptes suivis, relus sur leur page publique :
 *  - comptes des réseaux anciens : 85 % prouvés (96 % citent au moins une fois) ; les autres sont des mentions
 *    isolées — une page d'extraits de télé-réalité sous Snitchy (1 vidéo sur 11), une thérapeute sous Finch ;
 *  - comptes des apps entrées ce jour-là sous leur bon motif : 66 % prouvés, 20 % ne citent plus du tout l'app ;
 *  - comptes rattachés par un motif trop large (« hush », « hyper », « guardian »…) : 4 % prouvés ;
 *  - apps dont le nom est un mot courant (« equals », « aisance », « arkose ») : 27 %.
 * Un compte non prouvé n'est pas rattaché, donc jamais relevé : c'est aussi la première économie de crédits.
 */
import { bioNamesApp, citesNormalized, normalize, type AppRule } from "./radarNetworkMath";
import { parseFreeProfile } from "./radarFreeMath";

const HOUR = 3_600_000;

/** Vidéos qui citent l'app, parmi les dernières, pour qu'un compte soit prouvé. */
export const VET_MIN_VIDEOS = 2;
/** Une seule suffit si elle fait au moins cette part de ce qu'il a publié (un compte de 1 à 3 vidéos). */
export const VET_MIN_SHARE = 1 / 3;

export type Proof = "handle" | "bio" | "videos";

/**
 * Ce qui prouve qu'un compte pousse l'app, ou `null`. `texts` : le texte de chacune de ses dernières vidéos (sa
 * légende sur la page publique ; légende et texte à l'écran après un relevé).
 */
export function accountProof(handle: string, bio: string | null | undefined, texts: readonly string[], rule: AppRule): Proof | null {
  if (citesNormalized(normalize(handle), rule)) return "handle";
  if (bioNamesApp(bio, rule)) return "bio";
  const cites = texts.filter((t) => citesNormalized(normalize(t), rule)).length;
  return cites >= VET_MIN_VIDEOS || (cites >= 1 && cites >= texts.length * VET_MIN_SHARE) ? "videos" : null;
}

// ─── Un passage du filtre ────────────────────────────────────────────────────

/** Comptes vérifiés au plus par passage (un passage toutes les 5 minutes, une page par compte). */
export const VET_PER_RUN = 120;
/** Durée d'un passage, au plus. */
export const VET_MAX_MS = 4 * 60_000;
/** Pages refusées d'affilée qui arrêtent le passage. */
export const VET_BREAKER = 5;
/** Verdicts écrits d'un coup. */
export const VET_APPLY_BATCH = 20;
/**
 * Un compte qui attend sa vérification depuis 6 heures (TikTok ne sert pas sa page) entre quand même : son premier
 * relevé, payant, le prouvera ou le mettra en pause (`needsProof`).
 */
export const VET_MAX_WAIT_MS = 6 * HOUR;
/** Un compte écarté n'est pas revérifié pour la même app avant 30 jours. */
export const REJECTED_KEEP_MS = 30 * 24 * HOUR;

export type VetPage = { ok: true; text: string } | { ok: false; kind: "absent" | "suspect" };

export type VetOutcome =
  /** Prouvé : il entre, avec ses abonnés et sa bio lus sur sa page. */
  | { kind: "proven"; proof: Proof; fans: number; bio: string }
  /** Pas un compte qui pousse l'app : il n'entre pas. */
  | { kind: "unproven"; why: "private" | "cites" }
  /** Sa page publique ne dit rien (TikTok ne la sert pas pour ce compte, ou elle ne liste aucune vidéo) : son premier relevé tranchera. */
  | { kind: "paid" }
  /** TikTok a refusé la page : à redemander au passage suivant. */
  | { kind: "retry" };

/** Ce que la page publique d'un compte dit de lui, pour l'app où on l'a trouvé. */
export function vetOutcome(page: VetPage, handle: string, rule: AppRule): VetOutcome {
  if (!page.ok) return page.kind === "absent" ? { kind: "paid" } : { kind: "retry" };
  const profile = parseFreeProfile(page.text);
  if (!profile) return { kind: "retry" };
  // Un compte privé ne se relève pas : il n'a rien à montrer.
  if (profile.private) return { kind: "unproven", why: "private" };
  const proof = accountProof(
    handle,
    profile.bio,
    profile.videos.map((v) => v.caption),
    rule,
  );
  if (proof) return { kind: "proven", proof, fans: profile.fans, bio: profile.bio };
  return profile.videos.length === 0 ? { kind: "paid" } : { kind: "unproven", why: "cites" };
}

/** Attend-il depuis trop longtemps (la page n'est jamais servie) ? Il entre alors par le relevé payant. */
export const waitedTooLong = (queuedAt: number, now: number): boolean => now - queuedAt >= VET_MAX_WAIT_MS;
