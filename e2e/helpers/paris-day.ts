import { parisDayIndex } from "../../convex/calendarStatus";

/**
 * MINUIT PARIS du jour contenant `at` — l'instant que l'app stocke dans
 * `postDate`.
 *
 * ⚠️ POURQUOI ÇA NE PEUT PAS ÊTRE `new Date(); d.setHours(0,0,0,0)`.
 *
 * Il y a TROIS horloges dans un run e2e : le navigateur (épinglé Europe/Paris
 * par playwright.config), le process Node du test (le fuseau du runner — UTC en
 * CI, Paris en local), et le runtime Convex (UTC). Construire minuit avec
 * `setHours` prend l'horloge du PROCESS : en CI, « minuit aujourd'hui » veut
 * dire minuit UTC, alors que l'écran, lui, découpe ses journées à Paris.
 *
 * Entre 22 h et minuit UTC — soit 00 h–02 h à Paris — les deux ne désignent plus
 * le même jour : un post posé « aujourd'hui » par le test tombe HIER pour
 * l'écran, et les specs qui comptent les groupes du jour rougissent. C'est un
 * flake d'une fenêtre de deux heures par nuit, invisible le reste du temps (et
 * toujours vert en local, où le process EST à Paris).
 *
 * Cette fonction dérive donc le jour de Paris depuis l'instant, puis redescend
 * jusqu'à la bascule — aucune arithmétique de fuseau codée en dur, donc juste
 * aussi bien en été qu'en hiver.
 */
export function minuitParis(at: number = Date.now()): number {
  const jour = parisDayIndex(at);
  const y = Math.floor(jour / 10000);
  const m = Math.floor((jour % 10000) / 100); // parisDayIndex : mois 0-based
  const d = jour % 100;
  // Midi UTC du jour visé est toujours DANS ce jour à Paris ; on redescend
  // heure par heure tant que l'heure précédente appartient encore au même jour.
  let t = Date.UTC(y, m, d, 12);
  while (parisDayIndex(t - 3_600_000) === jour) t -= 3_600_000;
  return t;
}

/** Minuit Paris du jour situé à `decalageJours` d'aujourd'hui (négatif = passé). */
export function minuitParisDecale(decalageJours: number): number {
  return minuitParis(Date.now() + decalageJours * 86_400_000);
}
