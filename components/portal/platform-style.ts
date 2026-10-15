/** Couleurs des pastilles plateforme de l'espace créatrice (« Mes vidéos », « Mes paiements »). */
export const PLATFORM_STYLE: Record<string, string> = {
  TikTok: "bg-slate-900 text-white",
  Instagram: "bg-fuchsia-600 text-white",
  YouTube: "bg-red-600 text-white",
  Facebook: "bg-blue-600 text-white",
  Snapchat: "bg-yellow-300 text-slate-900",
};

/** Plateforme hors liste : pastille neutre. */
export const PLATFORM_STYLE_FALLBACK = "bg-slate-200 text-slate-700";
