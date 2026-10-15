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
