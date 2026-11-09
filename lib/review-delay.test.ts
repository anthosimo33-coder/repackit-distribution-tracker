import { describe, expect, it } from "vitest";
import {
  decoupeDuree,
  fenetre,
  tempsDeReponse,
  type DecisionMesuree,
} from "../convex/reviewDelay";

const MIN = 60_000;
const H = 60 * MIN;
const J = 24 * H;
// Lundi 9 novembre 2026, 17 h 42 à Paris — une heure de lecture quelconque.
const NOW = Date.UTC(2026, 10, 9, 16, 42, 13);

/** Une décision prise `ilYa` avant NOW, après `attente` dans la file. */
const d = (ilYa: number, attente: number, decision: DecisionMesuree["decision"] = "approved"): DecisionMesuree => ({
  submittedAt: NOW - ilYa - attente,
  decidedAt: NOW - ilYa,
  decision,
});

describe("fenetre — les chiffres d'un ensemble de décisions", () => {
  it("moyenne, médiane (nombre PAIR : milieu des deux du centre), part < 12 h, plus long", () => {
    // Vendredi soir 22 h 10 → lundi 9 h 03 : le week-end compte (c'est ce que
    // la créatrice a attendu).
    const weekEnd = 2 * J + 10 * H + 53 * MIN;
    const f = fenetre([
      d(1 * H, 47 * MIN),
      d(2 * H, 3 * H + 5 * MIN, "rejected"),
      d(3 * H, 11 * H + 59 * MIN),
      d(4 * H, weekEnd),
    ]);
    expect(f.videos).toBe(4);
    expect(f.validees).toBe(3);
    expect(f.refusees).toBe(1);
    expect(f.moyenneMs).toBe((47 * MIN + 3 * H + 5 * MIN + 11 * H + 59 * MIN + weekEnd) / 4);
    expect(f.medianeMs).toBe((3 * H + 5 * MIN + 11 * H + 59 * MIN) / 2);
    expect(f.partRapide).toBe(3 / 4);
    expect(f.plusLongMs).toBe(weekEnd);
  });

  it("médiane d'un nombre IMPAIR : la valeur du milieu, pas une moyenne", () => {
    const f = fenetre([d(H, 5 * H), d(H, 20 * MIN), d(H, 30 * H)]);
    expect(f.medianeMs).toBe(5 * H);
  });

  it("pile 12 h n'est PAS « en moins de 12 h »", () => {
    expect(fenetre([d(H, 12 * H)]).partRapide).toBe(0);
    expect(fenetre([d(H, 12 * H - MIN)]).partRapide).toBe(1);
  });

  it("vide : null partout, jamais 0 (« 0 min » se lirait comme une réponse instantanée)", () => {
    const f = fenetre([]);
    expect(f).toEqual({
      videos: 0,
      validees: 0,
      refusees: 0,
      moyenneMs: null,
      medianeMs: null,
      partRapide: null,
      plusLongMs: null,
    });
  });
});

describe("tempsDeReponse — les trois fenêtres de l'écran", () => {
  it("range chaque décision par sa date de DÉCISION, bornes comprises côté récent", () => {
    const decisions = [
      d(0, 2 * H), // à l'instant
      d(7 * J - MIN, 4 * H), // dans les 7 derniers jours, de justesse
      d(7 * J, 6 * H), // pile 7 jours : la semaine d'AVANT
      d(13 * J, 8 * H),
      d(20 * J, 10 * H), // seulement dans les 30 jours
      d(30 * J, 99 * H), // pile 30 jours : hors fenêtre
    ];
    const t = tempsDeReponse(decisions, NOW);
    expect(t.septJours.videos).toBe(2);
    expect(t.septJours.moyenneMs).toBe(3 * H);
    expect(t.septJoursAvant.videos).toBe(2);
    expect(t.septJoursAvant.moyenneMs).toBe(7 * H);
    expect(t.trenteJours.videos).toBe(5);
    expect(t.trenteJours.plusLongMs).toBe(10 * H);
  });

  it("une vidéo refusée puis renvoyée compte DEUX attentes", () => {
    // Même mission : envoi 10 h, refus 13 h ; renvoi 18 h, validation le lendemain 9 h.
    const t = tempsDeReponse([d(20 * H, 3 * H, "rejected"), d(H, 15 * H)], NOW);
    expect(t.septJours.videos).toBe(2);
    expect(t.septJours.refusees).toBe(1);
    expect(t.septJours.moyenneMs).toBe(9 * H);
  });
});

describe("decoupeDuree — ce que l'écran affiche", () => {
  it("minutes sous l'heure, heures + minutes sous le jour, jours + heures au-delà", () => {
    expect(decoupeDuree(47 * MIN + 20_000)).toEqual({ unite: "minutes", m: 47 });
    expect(decoupeDuree(3 * H + 5 * MIN + 31_000)).toEqual({ unite: "heures", h: 3, m: 6 });
    expect(decoupeDuree(2 * J + 10 * H + 53 * MIN)).toEqual({ unite: "jours", j: 2, h: 11 });
  });

  it("l'arrondi qui franchit une unité change d'unité (59 min 40 s = 1 h, pas « 60 min »)", () => {
    expect(decoupeDuree(59 * MIN + 40_000)).toEqual({ unite: "heures", h: 1, m: 0 });
    expect(decoupeDuree(23 * H + 59 * MIN + 45_000)).toEqual({ unite: "jours", j: 1, h: 0 });
  });

  it("jamais négatif", () => {
    expect(decoupeDuree(-5 * MIN)).toEqual({ unite: "minutes", m: 0 });
  });
});
