/**
 * MOMENT DE LA JOURNÉE — chez la créatrice, pas chez l'équipe.
 *
 * Module PUR. L'accueil n'attend pas la même chose d'elle à 9 h et à 19 h : le
 * matin on tourne, le soir on publie avant la fin du créneau. L'heure est lue
 * dans SON fuseau (servi par le serveur sur ses missions) ; inconnu ⇒ Paris,
 * comme partout ailleurs (cf convex/calendarStatus).
 *
 * Minuit–5 h compte comme « soir » : à 1 h du matin, on n'attend pas d'elle
 * qu'elle commence un tournage.
 */
export type DayPart = "morning" | "afternoon" | "evening";

function hourIn(now: number, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(now);
  return Number(h);
}

export function dayPartAt(now: number, timeZone?: string | null): DayPart {
  let hour: number;
  try {
    hour = hourIn(now, timeZone || "Europe/Paris");
  } catch {
    // Fuseau illisible (valeur saisie à la main) : on retombe sur celui de l'équipe.
    hour = hourIn(now, "Europe/Paris");
  }
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}
