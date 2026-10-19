/**
 * MODE TOURNAGE BLUSH — les règles pures (cf convex/scenarioTournage).
 *
 * Module PUR (aucun import `_generated`). Garde : lib/scenario-tournage.test.ts.
 */

/** Le prénom d'un nom complet (« Juliette Chetrit » → « Juliette »), celui du fichier et du vocal. Vide si le nom l'est. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** Un lien de tournage tient sur une ligne : au-delà, ce n'est pas un lien collé. */
export const MAX_LIEN_TOURNAGE = 500;

/**
 * La veille d'un jour de Paris (AAAA-MM-JJ). Le fichier figé FINIT LA VEILLE de
 * sa préparation : ses derniers messages (22 h, 23 h…) sont déjà passés quand
 * l'équipe l'importe dans BLUSH dans la journée.
 */
export function veille(jour: string): string {
  const [a, m, j] = jour.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, j - 1)).toISOString().slice(0, 10);
}

/**
 * Le lien collé depuis BLUSH (« Copier le lien »), relu avant d'être servi aux
 * créatrices : `https://`, sans espace, une ligne. Vide = retirer le lien.
 * Le domaine n'est pas imposé : le lien est celui que BLUSH a donné.
 */
export function lireLienTournage(texte: string): { ok: true; lien: string | null } | { ok: false } {
  const lien = texte.trim();
  if (lien === "") return { ok: true, lien: null };
  if (lien.length > MAX_LIEN_TOURNAGE || /\s/.test(lien)) return { ok: false };
  try {
    return new URL(lien).protocol === "https:" ? { ok: true, lien } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Le lien que la MISSION donne à la créatrice : celui de BLUSH, avec son prénom
 * (`?prenom=`). Un lien BLUSH peut servir à plusieurs créatrices (une lecture par
 * histoire, collée sur chacune) et sa conv porte le prénom de celle dont le
 * fichier a été lu : sans `?prenom=`, BLUSH ne sait pas qui filme (« Prête à
 * filmer, Léa ? », « Qui es-tu ? »). Prénom vide ou lien illisible : tel quel.
 */
export function lienDeLaMission(lien: string, prenom: string): string {
  const p = prenom.trim();
  if (!p) return lien;
  try {
    const url = new URL(lien);
    url.searchParams.set("prenom", p);
    return url.toString();
  } catch {
    return lien;
  }
}

// ─── API BLUSH (convex/scenarioTournageBlush) ────────────────────────────────

/** La `ref` envoyée à BLUSH : même ref = même lien, sans nouvelle lecture. Une nouvelle version = un nouveau lien. */
export function refBlush(tournageId: string, version: number): string {
  return `jarvia-${tournageId}-v${version}`;
}

/** Le nom du lien dans BLUSH › Tournage : « Kelly · A1 · Le mdr de 5h52 ». */
export function nomBlush(prenom: string, code: string, titre: string): string {
  return `${prenom} · ${code} · ${titre}`.slice(0, 120);
}

/** Le message d'un refus de BLUSH, tel que l'équipe le lit sur l'écran. */
function refusBlush(status: number, corps: unknown, prenom: string): string {
  const detail =
    typeof corps === "object" && corps !== null && "erreur" in corps ? String((corps as { erreur: unknown }).erreur) : "";
  const suite = detail ? ` (BLUSH : ${detail.slice(0, 160)})` : "";
  if (status === 401 || status === 403) return `Clé BLUSH refusée : vérifie BLUSH_TOURNAGE_CLE${suite}.`;
  if (status === 404) return `Lien inconnu de BLUSH${suite}.`;
  if (status === 422) return `Le prénom « ${prenom} » n'apparaît pas dans le fichier${suite}.`;
  if (status === 429) return `Limite de lectures BLUSH du jour atteinte : réessaie demain${suite}.`;
  return `BLUSH a répondu ${status}${suite}.`;
}

/** Un 5xx ou une coupure : on réessaie plus tard, ce n'est pas un échec de la demande. */
const transitoire = (status: number) => status >= 500 || status === 0;

export type ReponseCreation =
  | { ok: true; id: string }
  | { ok: false; transitoire: boolean; erreur: string };

/** POST /api/admin/tournage → `{ id, nouvelle, statut: "en_lecture" }`. */
export function lireReponseCreation(status: number, corps: unknown, prenom: string): ReponseCreation {
  if (status >= 200 && status < 300) {
    const id = typeof corps === "object" && corps !== null && "id" in corps ? (corps as { id: unknown }).id : null;
    if (typeof id === "string" || typeof id === "number") return { ok: true, id: String(id) };
    return { ok: false, transitoire: false, erreur: "BLUSH n'a pas renvoyé d'id de lien." };
  }
  return { ok: false, transitoire: transitoire(status), erreur: refusBlush(status, corps, prenom) };
}

export type ReponseSuivi =
  | { statut: "en_lecture" }
  | { statut: "pret"; lien: string }
  | { statut: "echec"; erreur: string }
  | { statut: "transitoire"; erreur: string };

/** GET /api/admin/tournage/<id> → `{ statut, lien?, erreur? }`. Un lien prêt doit être https. */
export function lireReponseSuivi(status: number, corps: unknown, prenom: string): ReponseSuivi {
  if (status < 200 || status >= 300) {
    return transitoire(status)
      ? { statut: "transitoire", erreur: refusBlush(status, corps, prenom) }
      : { statut: "echec", erreur: refusBlush(status, corps, prenom) };
  }
  const o = (typeof corps === "object" && corps !== null ? corps : {}) as Record<string, unknown>;
  if (o.statut === "pret") {
    const lu = typeof o.lien === "string" ? lireLienTournage(o.lien) : ({ ok: false } as const);
    return lu.ok && lu.lien ? { statut: "pret", lien: lu.lien } : { statut: "echec", erreur: "BLUSH a dit « prêt » sans lien https." };
  }
  if (o.statut === "echec") {
    return { statut: "echec", erreur: `La lecture BLUSH a échoué${typeof o.erreur === "string" ? ` : ${o.erreur.slice(0, 160)}` : "."}` };
  }
  return { statut: "en_lecture" };
}

/** Le message d'une lecture trop longue (celui d'avant le 15/10 au soir disait « en 20 minutes »). */
export const LECTURE_TROP_LONGUE = "BLUSH n'a pas fini la lecture";

export type FaconDeRedemander = "rien" | "reprendre" | "relancer";

/**
 * Redemander le lien d'un fichier : RIEN (lien posé, ou demande en cours),
 * REPRENDRE la même demande (même ref : BLUSH renvoie le même lien SANS relire —
 * lecture trop longue, BLUSH injoignable), ou RELANCER (nouvelle ref = nouvelle
 * lecture payée — BLUSH a dit « echec », ou refus 4xx).
 */
export function faconDeRedemander(
  b: { statut: string; reprise?: boolean; erreur?: string } | undefined,
  aLien: boolean,
): FaconDeRedemander {
  if (aLien || b?.statut === "demande" || b?.statut === "en_lecture") return "rien";
  if (b?.statut === "echec" && (b.reprise || (b.erreur ?? "").startsWith(LECTURE_TROP_LONGUE))) return "reprendre";
  return "relancer";
}
