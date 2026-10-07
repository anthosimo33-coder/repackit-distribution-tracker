/**
 * Types partagés du générateur de conversations (serveur ↔ client), SANS code :
 * le client les importe sans tirer les consignes du modèle dans son paquet.
 */

/** Un élément du fil tel que le modèle le lit ou l'écrit. */
export type LlmItem = {
  kind: "message" | "date";
  /** « none » pour un séparateur de date. */
  side: "in" | "out" | "none";
  text: string;
  edited: boolean;
  reaction: string | null;
};

/** Lecture d'une capture : le fil, plus l'en-tête et la barre d'état s'ils sont visibles. */
export type ScreenshotReading = {
  theme: "dark" | "light" | "custom";
  locale: "fr" | "en";
  contact: { name: string; username: string };
  status: { time: string | null; battery: number | null; lowPower: boolean; signal: number | null };
  items: LlmItem[];
};

/** Images d'un post TikTok : photos d'un carrousel, ou couverture d'une vidéo. */
export type TikTokMedia =
  | { kind: "photos"; images: string[] }
  | { kind: "video"; images: string[] }
  | { kind: "unreadable"; reason: string };
