/**
 * RADAR — helpers d'AFFICHAGE (front uniquement, jamais importés côté Convex).
 * Formatage compact des stats, durée, fraîcheur du sync, engagement.
 */

/** 2 300 000 → "2,3 M" ; 45 600 → "45,6 k" ; 980 → "980". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return trimDecimal(n / 1_000_000) + " M";
  if (abs >= 1_000) return trimDecimal(n / 1_000) + " k";
  return String(Math.round(n));
}

function trimDecimal(x: number): string {
  // 1 décimale, virgule FR, sans ",0" superflu (12,0 → 12).
  return x.toFixed(1).replace(/\.0$/, "").replace(".", ",");
}

/** Durée vidéo en mm:ss (90 → "1:30"). null/undefined → "". */
export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) {
    return "";
  }
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** Ratio d'engagement (0.123) → "12,3 %". */
export function formatEngagement(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "0 %";
  return (ratio * 100).toFixed(1).replace(".", ",") + " %";
}

/** Date de publication courte (fr-FR) : "25 juin 2026". */
export function formatPublished(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Fraîcheur du sync : "à l'instant", "il y a 2 h", "il y a 3 j", sinon date. */
export function formatRelative(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "jamais";
  const diff = Date.now() - ms;
  if (diff < 0) return "à l'instant";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return formatPublished(ms);
}
