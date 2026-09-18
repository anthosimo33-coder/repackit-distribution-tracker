import { describe, it, expect } from "vitest";
import {
  aggregatePayWindow,
  payCutoffAt,
  payWindowEndsAt,
  retainedViews,
} from "../convex/payWindow";
import { parisDayStart } from "../convex/managerCpm";

/**
 * POST POUSSÉ EN SPARK AD — l'assiette de paie se fige au dernier relevé AVANT
 * le lancement (convex/payWindow, statut `adFrozen`).
 *
 * Entrées à la FORME de la prod : post publié un après-midi (pas à minuit),
 * relevé de 23h30 Paris, vues à 5-6 chiffres non rondes, lancement au minuit
 * Paris d'un jour saisi dans un <input type="date"> (heure d'été, UTC+2).
 */

const DAY = 86_400_000;
/** Publié le 12/09/2026 à 14:37 UTC. */
const DATE_PUBLI = Date.UTC(2026, 8, 12, 14, 37, 12);
/** Lancement saisi « 2026-09-17 » → minuit Paris = 16/09 22:00 UTC. */
const LAUNCH = parisDayStart("2026-09-17")!;
/** Relevé du 16/09 à 23h30 Paris (21:30 UTC), le dernier avant la pub — J+4. */
const RELEVE_AVANT = { vues: 84_213, daysSincePublication: 4 };
const MESURE = 312_947;
const NOW = Date.UTC(2026, 8, 18, 9, 12);

describe("payCutoffAt", () => {
  it("le lancement de pub est bien minuit Paris (UTC+2 en septembre)", () => {
    expect(LAUNCH).toBe(Date.UTC(2026, 8, 16, 22, 0));
  });

  it("borne = la pub quand elle part avant J+31, J+31 sinon", () => {
    expect(payCutoffAt(DATE_PUBLI, LAUNCH)).toBe(LAUNCH);
    expect(payCutoffAt(DATE_PUBLI, null)).toBe(payWindowEndsAt(DATE_PUBLI));
    const tardive = DATE_PUBLI + 45 * DAY;
    expect(payCutoffAt(DATE_PUBLI, tardive)).toBe(payWindowEndsAt(DATE_PUBLI));
  });
});

describe("retainedViews — spark ad", () => {
  const base = {
    datePubli: DATE_PUBLI,
    measuredViews: MESURE,
    windowSnapshot: RELEVE_AVANT,
    now: NOW,
  };

  it("pub lancée à J+5 : paie figée au relevé d'avant, le reste est hors paie", () => {
    const r = retainedViews({ ...base, adLaunchedAt: LAUNCH });
    expect(r).toEqual({
      views: 84_213,
      status: "adFrozen",
      retainedAtDay: 4,
      viewsOutsideWindow: 228_734,
    });
  });

  it("sans pub, le même post (J+6) est payé sur toutes ses vues", () => {
    const r = retainedViews(base);
    expect(r.status).toBe("open");
    expect(r.views).toBe(MESURE);
  });

  it("lancement à venir : la paie suit encore les vues", () => {
    const r = retainedViews({ ...base, adLaunchedAt: LAUNCH, now: LAUNCH - 1 });
    expect(r.status).toBe("open");
    expect(r.views).toBe(MESURE);
  });

  it("aucun relevé avant la pub : ZÉRO retenu (payer le mesuré paierait la pub)", () => {
    const r = retainedViews({ ...base, adLaunchedAt: LAUNCH, windowSnapshot: null });
    expect(r.status).toBe("adFrozen");
    expect(r.views).toBe(0);
    expect(r.viewsOutsideWindow).toBe(MESURE);
  });

  it("compteur redescendu sous le relevé : on retient le mesuré (un gel n'ajoute jamais)", () => {
    const r = retainedViews({ ...base, adLaunchedAt: LAUNCH, measuredViews: 71_508 });
    expect(r.status).toBe("adFrozen");
    expect(r.views).toBe(71_508);
    expect(r.viewsOutsideWindow).toBe(0);
  });

  it("pub lancée après J+30 : SANS EFFET, c'est la règle J+30 qui s'applique", () => {
    const now = DATE_PUBLI + 50 * DAY;
    const releveJ30 = { vues: 297_406, daysSincePublication: 30 };
    const avecPub = retainedViews({
      ...base,
      now,
      windowSnapshot: releveJ30,
      adLaunchedAt: DATE_PUBLI + 42 * DAY,
    });
    const sansPub = retainedViews({ ...base, now, windowSnapshot: releveJ30 });
    expect(avecPub).toEqual(sansPub);
    expect(avecPub.status).toBe("closed");
    expect(avecPub.views).toBe(297_406);
  });
});

describe("aggregatePayWindow — le gel pub ne s'annonce pas comme un plafond J+30", () => {
  it("un post adFrozen n'allume ni « fenêtre close » ni « vues hors fenêtre »", () => {
    const gele = retainedViews({
      datePubli: DATE_PUBLI,
      measuredViews: MESURE,
      windowSnapshot: RELEVE_AVANT,
      now: NOW,
      adLaunchedAt: LAUNCH,
    });
    expect(gele.status).toBe("adFrozen");
    expect(gele.viewsOutsideWindow).toBe(228_734);
    expect(aggregatePayWindow([{ retained: gele, isPaid: true }])).toEqual({
      closed: false,
      viewsOutsideWindow: 0,
    });
  });

  it("…alors qu'un post réellement au-delà de J+30 les allume", () => {
    const plafonne = retainedViews({
      datePubli: DATE_PUBLI,
      measuredViews: MESURE,
      windowSnapshot: { vues: 297_406, daysSincePublication: 30 },
      now: DATE_PUBLI + 50 * DAY,
    });
    expect(aggregatePayWindow([{ retained: plafonne, isPaid: true }])).toEqual({
      closed: true,
      viewsOutsideWindow: 15_541,
    });
  });
});
