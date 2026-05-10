/**
 * Batch G — palette de couleurs pour les dossiers d'inspirations. Le folder
 * stocke uniquement la KEY ("slate" / "rose" / ...) en DB, jamais le hex.
 * Permet de muter la palette plus tard sans migration data.
 *
 * Chaque entrée expose deux classes Tailwind utilisées par les composants :
 *   - badgeClass : pour les badges folder dans InspirationCard
 *   - dotClass   : pour la pastille couleur dans FolderManagerSection
 *
 * Default key "slate" si folder.color absent ou inconnu (clé migrée /
 * obsolète). Garantit affichage cohérent même si la palette évolue.
 */

export const FOLDER_COLORS = [
  {
    key: "slate",
    label: "Slate",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    dotClass: "bg-slate-400",
  },
  {
    key: "rose",
    label: "Rose",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
    dotClass: "bg-rose-400",
  },
  {
    key: "amber",
    label: "Amber",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
    dotClass: "bg-amber-400",
  },
  {
    key: "emerald",
    label: "Emerald",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dotClass: "bg-emerald-400",
  },
  {
    key: "sky",
    label: "Sky",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
    dotClass: "bg-sky-400",
  },
  {
    key: "violet",
    label: "Violet",
    badgeClass: "bg-violet-50 text-violet-700 border-violet-200",
    dotClass: "bg-violet-400",
  },
  {
    key: "pink",
    label: "Pink",
    badgeClass: "bg-pink-50 text-pink-700 border-pink-200",
    dotClass: "bg-pink-400",
  },
  {
    key: "indigo",
    label: "Indigo",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dotClass: "bg-indigo-400",
  },
] as const;

export type FolderColorKey = (typeof FOLDER_COLORS)[number]["key"];

export type FolderColor = (typeof FOLDER_COLORS)[number];

const DEFAULT_COLOR = FOLDER_COLORS[0];

export function getFolderColor(key: string | undefined | null): FolderColor {
  if (!key) return DEFAULT_COLOR;
  return FOLDER_COLORS.find((c) => c.key === key) ?? DEFAULT_COLOR;
}
