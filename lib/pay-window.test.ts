import { describe, it, expect } from "vitest";
import {
  aggregatePayWindow,
  paidBeforePayWindow,
  PAY_WINDOW_DAYS,
  PAY_WINDOW_EFFECTIVE_AT,
  payWindowEndsAt,
  payWindowIsClosed,
  retainedViews,
} from "../convex/payWindow";

/**
 * Plafond de rémunération à J+30 — module PUR (convex/payWindow), importé ici
 * pour les tests comme viewCounters/remunerate/postUrlDate.
 *
 * Les entrées ont la FORME de la prod, pas des nombres ronds : la publication de
 * référence est un post Snytch réel (datePubli 06/07/2026 16:24 UTC, 261 300
 * vues mesurées, 230 100 au dernier relevé de fenêtre J+30, warmup ET rémunéré —
 * le « cas Kelly »). C'est le post le plus rogné du parc : 31 200 vues acquises
 * après J+30, soit 11,9 % de son compteur.
 */

const DAY = 86_400_000;
/** Post réel : Snytch, publié le 06/07/2026 à 16:24 UTC. */
const DATE_PUBLI = 1_783_355_040_434;
const MESURE = 261_300;
const RELEVE_J30 = 230_100;

describe("payWindowEndsAt", () => {
  it("la borne inclut le jour J+30 ENTIER (daysSince ≤ 30 ⇔ capturedAt < +31 j)", () => {
    // Le relevé de prod retenu a été capturé à J+30 (capturedAt réel) : il DOIT
    // tomber dans la fenêtre, sinon le plafond retiendrait le relevé de J+29.
    const capturedAtJ30 = 1_786_003_258_046;
    expect(capturedAtJ30).toBeLessThan(payWindowEndsAt(DATE_PUBLI));
    // Et un relevé du lendemain (J+31) doit en sortir.
    expect(DATE_PUBLI + 31 * DAY).toBeGreaterThanOrEqual(
      payWindowEndsAt(DATE_PUBLI),
    );
  });

  it("PAY_WINDOW_DAYS vaut 30 et n'est PAS la longueur du cycle de paie", () => {
    expect(PAY_WINDOW_DAYS).toBe(30);
    expect(payWindowEndsAt(DATE_PUBLI) - DATE_PUBLI).toBe(31 * DAY);
  });
});

describe("payWindowIsClosed", () => {
  it("ouverte jusqu'à la fin du jour J+30, close ensuite", () => {
    expect(payWindowIsClosed(DATE_PUBLI, DATE_PUBLI + 30.9 * DAY)).toBe(false);
    expect(payWindowIsClosed(DATE_PUBLI, DATE_PUBLI + 31 * DAY)).toBe(true);
  });
});

describe("retainedViews", () => {
  it("fenêtre OUVERTE : la paie suit les vues mesurées (rien ne change)", () => {
    const r = retainedViews({
      datePubli: DATE_PUBLI,
      measuredViews: 92_800,
      windowSnapshot: { vues: 92_800, daysSincePublication: 12 },
      now: DATE_PUBLI + 12 * DAY,
    });
    expect(r).toEqual({
      views: 92_800,
      status: "open",
      retainedAtDay: null,
      viewsOutsideWindow: 0,
    });
  });

  it("fenêtre CLOSE : retient le relevé de fenêtre, pas la mesure courante", () => {
    const r = retainedViews({
      datePubli: DATE_PUBLI,
      measuredViews: MESURE,
      windowSnapshot: { vues: RELEVE_J30, daysSincePublication: 30 },
      now: DATE_PUBLI + 55 * DAY,
    });
    expect(r).toEqual({
      views: RELEVE_J30,
      status: "closed",
      retainedAtDay: 30,
      viewsOutsideWindow: MESURE - RELEVE_J30,
    });
    // Contrôle de forme : c'est bien un RETRAIT, jamais un ajout.
    expect(r.views).toBeLessThan(MESURE);
    expect(r.viewsOutsideWindow).toBe(31_200);
  });

  it("le nombre retenu ne dépend PAS de l'horloge (pas de bascule à minuit)", () => {
    const at = (now: number) =>
      retainedViews({
        datePubli: DATE_PUBLI,
        measuredViews: MESURE,
        windowSnapshot: { vues: RELEVE_J30, daysSincePublication: 30 },
        now,
      }).views;
    expect(at(DATE_PUBLI + 31 * DAY)).toBe(at(DATE_PUBLI + 400 * DAY));
  });

  it("fenêtre close SANS relevé dedans : on retient la mesure, on ne fabrique PAS un zéro", () => {
    // Post suivi tardivement (lien Instagram non rapprochable, shortlink, lien
    // collé des semaines après) : sa première mesure est postérieure à J+30.
    // Le plafonner à 0 le paierait comme une vidéo jamais vue.
    const r = retainedViews({
      datePubli: DATE_PUBLI,
      measuredViews: 51_500,
      windowSnapshot: null,
      now: DATE_PUBLI + 60 * DAY,
    });
    expect(r.views).toBe(51_500);
    expect(r.status).toBe("unmeasured");
    expect(r.viewsOutsideWindow).toBe(0);
  });

  it("distingue « plafonné » de « jamais mesuré » — deux états, jamais le même", () => {
    const plafonne = retainedViews({
      datePubli: DATE_PUBLI,
      measuredViews: MESURE,
      windowSnapshot: { vues: RELEVE_J30, daysSincePublication: 30 },
      now: DATE_PUBLI + 55 * DAY,
    }).status;
    const jamaisMesure = retainedViews({
      datePubli: DATE_PUBLI,
      measuredViews: MESURE,
      windowSnapshot: null,
      now: DATE_PUBLI + 55 * DAY,
    }).status;
    expect(plafonne).toBe("closed");
    expect(jamaisMesure).toBe("unmeasured");
    expect(plafonne).not.toBe(jamaisMesure);
  });

  it("un compteur qui REDESCEND après J+30 ne fait pas payer plus que le mesuré", () => {
    // Post masqué/retiré : la plateforme affiche moins que le relevé de J+30.
    // Un plafond ne doit jamais qu'enlever.
    const r = retainedViews({
      datePubli: DATE_PUBLI,
      measuredViews: 180_000,
      windowSnapshot: { vues: RELEVE_J30, daysSincePublication: 30 },
      now: DATE_PUBLI + 55 * DAY,
    });
    expect(r.views).toBe(180_000);
    expect(r.viewsOutsideWindow).toBe(0);
  });

  it("relevé de fenêtre ANTÉRIEUR à J+30 : la série s'est arrêtée, on retient ce jour-là", () => {
    // Cas réel du parc : 25 posts > J+30 dont le dernier relevé de fenêtre est
    // antérieur à J+28 (compte devenu inactif). `retainedAtDay` doit le DIRE.
    const r = retainedViews({
      datePubli: DATE_PUBLI,
      measuredViews: 7_243,
      windowSnapshot: { vues: 7_243, daysSincePublication: 26 },
      now: DATE_PUBLI + 40 * DAY,
    });
    expect(r.retainedAtDay).toBe(26);
    expect(r.status).toBe("closed");
    expect(r.views).toBe(7_243);
  });
});

describe("aggregatePayWindow", () => {
  const DATE = DATE_PUBLI;
  const closed = (measured: number, atWindow: number) =>
    retainedViews({
      datePubli: DATE,
      measuredViews: measured,
      windowSnapshot: { vues: atWindow, daysSincePublication: 30 },
      now: DATE + 55 * DAY,
    });
  const open = (measured: number) =>
    retainedViews({
      datePubli: DATE,
      measuredViews: measured,
      windowSnapshot: { vues: measured, daysSincePublication: 12 },
      now: DATE + 12 * DAY,
    });

  it("PRÉSENCE — une vidéo rémunérée hors fenêtre s'annonce plafonnée, chiffre à l'appui", () => {
    expect(
      aggregatePayWindow([{ retained: closed(MESURE, RELEVE_J30), isPaid: true }]),
    ).toEqual({ closed: true, viewsOutsideWindow: 31_200 });
  });

  it("ABSENCE — une vidéo dont la fenêtre court n'annonce RIEN", () => {
    expect(aggregatePayWindow([{ retained: open(92_800), isPaid: true }])).toEqual({
      closed: false,
      viewsOutsideWindow: 0,
    });
  });

  it("un post NON rémunéré ne déclenche pas le message (rien à plafonner)", () => {
    // Post de chauffe pure : jamais payé, donc jamais « plafonné ». Le compter
    // ferait lire à la créatrice une perte qu'elle n'a pas subie.
    expect(
      aggregatePayWindow([{ retained: closed(261_300, 230_100), isPaid: false }]),
    ).toEqual({ closed: false, viewsOutsideWindow: 0 });
  });

  it("vidéo MIXTE (cas Kelly) : seul le post rémunéré compte dans le chiffre annoncé", () => {
    // Post warmup RÉMUNÉRÉ (payé, hors promo) + post promo non rémunéré.
    const agg = aggregatePayWindow([
      { retained: closed(261_300, 230_100), isPaid: true },
      { retained: closed(51_500, 50_400), isPaid: false },
    ]);
    expect(agg.closed).toBe(true);
    expect(agg.viewsOutsideWindow).toBe(31_200);
  });

  it("fenêtre close mais JAMAIS mesurée : pas de plafond annoncé", () => {
    const jamais = retainedViews({
      datePubli: DATE,
      measuredViews: 51_500,
      windowSnapshot: null,
      now: DATE + 60 * DAY,
    });
    expect(aggregatePayWindow([{ retained: jamais, isPaid: true }])).toEqual({
      closed: false,
      viewsOutsideWindow: 0,
    });
  });

  it("aucun post : rien à annoncer", () => {
    expect(aggregatePayWindow([])).toEqual({
      closed: false,
      viewsOutsideWindow: 0,
    });
  });
});

describe("paidBeforePayWindow", () => {
  /** Cycle 0 de Kelly, l'unique cycle payé non nul de la prod : 769,62 $ le 17/08/2026 à 14:47 UTC. */
  const KELLY_PAID_AT = 1_786_978_067_200;

  it("PRÉSENCE — le cycle payé de Kelly porte la mention d'ancienne règle", () => {
    expect(
      paidBeforePayWindow({
        paidAt: KELLY_PAID_AT,
        lineItemKinds: ["fixed", ...Array(12).fill("cpm")],
      }),
    ).toBe(true);
    // Et la date de bascule est bien POSTÉRIEURE à ce paiement.
    expect(KELLY_PAID_AT).toBeLessThan(PAY_WINDOW_EFFECTIVE_AT);
  });

  it("ABSENCE — un cycle payé APRÈS l'entrée en vigueur n'a rien à annoncer", () => {
    expect(
      paidBeforePayWindow({
        paidAt: PAY_WINDOW_EFFECTIVE_AT,
        lineItemKinds: ["fixed", "cpm"],
      }),
    ).toBe(false);
  });

  it("un cycle payé avant, mais qu'aucune vue ne rémunérait, n'annonce rien", () => {
    // Le second cycle payé de la prod (29/08/2026, 0,00 $, aucune ligne) : le
    // plafond ne l'aurait pas déplacé d'un centime. Une mention y serait un
    // avertissement sans objet.
    expect(paidBeforePayWindow({ paidAt: KELLY_PAID_AT, lineItemKinds: [] })).toBe(
      false,
    );
    // Idem pour un forfait de talent ou une paie au clip : rien n'est assis
    // sur des vues.
    expect(
      paidBeforePayWindow({
        paidAt: KELLY_PAID_AT,
        lineItemKinds: ["retainer", "clip", "fixed"],
      }),
    ).toBe(false);
  });

  it("les PALIERS comptent aussi : leur cumul est plafonné comme le CPM", () => {
    expect(
      paidBeforePayWindow({
        paidAt: KELLY_PAID_AT,
        lineItemKinds: ["bonus_tier"],
      }),
    ).toBe(true);
  });

  it("un cycle jamais payé n'a pas d'ancienne règle à annoncer", () => {
    expect(
      paidBeforePayWindow({ paidAt: null, lineItemKinds: ["cpm"] }),
    ).toBe(false);
    expect(
      paidBeforePayWindow({ paidAt: undefined, lineItemKinds: ["cpm"] }),
    ).toBe(false);
  });

  it("la date d'entrée en vigueur est le 31/08/2026 UTC, et rien d'autre", () => {
    // Elle DOIT suivre le déploiement réel : la figer ici rend tout glissement
    // visible en revue plutôt qu'invisible en prod.
    expect(new Date(PAY_WINDOW_EFFECTIVE_AT).toISOString()).toBe(
      "2026-08-31T00:00:00.000Z",
    );
  });
});
