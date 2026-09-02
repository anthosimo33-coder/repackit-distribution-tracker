// ⚠️ AVANT tout : on simule le runtime Convex, qui tourne en UTC. Sans cette
// ligne la spec serait VERTE sur un poste réglé à Paris — y compris avec le bug —
// et vitest ne tourne PAS en CI (cf. e2e.yml) : personne ne la verrait rouge.
// Node relit `process.env.TZ` à chaud, et `formatDateFr` lit le fuseau à l'appel,
// pas à l'import : la pose ici suffit.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { formatDateFr, formatDayMonthFr, monthKeyParis } from "../convex/dateFr";
import { periodOf } from "../convex/payments";

/**
 * FUSEAU des dates rendues à un humain par le SERVEUR.
 *
 * Le runtime Convex tourne en UTC ; l'admin lit une heure de Paris. Les dates de
 * publication (`publications.datePubli`) sont posées à MINUIT PARIS, ce qui vaut
 * 22:00 UTC la veille en été (UTC+2) et 23:00 UTC la veille en hiver (UTC+1).
 * Formatées sans fuseau explicite, elles affichent donc LA VEILLE.
 *
 * Mesuré sur l'export prod du 2026-08-14 : 61 des 219 publications (28 %) rendent
 * un JOUR différent selon qu'on formate en UTC ou en Europe/Paris.
 *
 * ⚠️ Les horodatages « été » et « journée » sont RELEVÉS EN PROD (pas fabriqués).
 * Le cas « hiver » est CONSTRUIT : le projet a démarré en mai 2026, la prod n'a
 * encore aucune publication en UTC+1. Il garde la branche d'heure d'hiver, que
 * l'échantillon réel ne peut pas couvrir avant octobre.
 */
describe("formatDateFr — fuseau de lecture", () => {
  it("rend le jour PARISIEN d'une publication postée à minuit (été, UTC+2)", () => {
    // Prod : publication @repackit.io TikTok, datePubli = 2026-05-10 22:00 UTC.
    // À l'écran l'admin l'a saisie pour le 11/05 ; en UTC elle se lit 10/05.
    expect(formatDateFr(1778450400000)).toBe("11/05/26");
  });

  it("rend le jour PARISIEN d'une publication postée à minuit (hiver, UTC+1)", () => {
    // CONSTRUIT (cf. en-tête) : 2026-01-14 23:00 UTC = 15/01/2026 00:00 à Paris.
    expect(formatDateFr(Date.UTC(2026, 0, 14, 23, 0, 0))).toBe("15/01/26");
  });

  it("ne décale PAS une publication de plein après-midi", () => {
    // Prod : @hopemedia16, datePubli = 2026-06-22 15:21 UTC = 17:21 à Paris.
    // Même jour dans les deux fuseaux — le correctif ne doit rien y changer.
    expect(formatDateFr(1782141710967)).toBe("22/06/26");
  });

  it("bascule au bon instant : 21:59 UTC est encore la veille, 22:00 le jour même", () => {
    // La frontière EXACTE en heure d'été. Sans elle, un correctif qui décalerait
    // d'un jour en dur (au lieu d'épingler le fuseau) passerait les cas ci-dessus.
    expect(formatDateFr(Date.UTC(2026, 4, 10, 21, 59, 59))).toBe("10/05/26");
    expect(formatDateFr(Date.UTC(2026, 4, 10, 22, 0, 0))).toBe("11/05/26");
  });
});

/**
 * VARIANTE SANS ANNÉE — libellés des lignes de paie (« Clip — 11/05 »,
 * « Vidéo — tiktok — 11/05 »), lus par l'admin ET par la créatrice.
 *
 * ⚠️ Les horodatages sont les MÊMES valeurs de prod que ci-dessus, et ce n'est
 * pas un raccourci : à la confirmation, le même instant (`effectiveDate`) est
 * écrit dans `publications.datePubli` ET dans le libellé de la ligne de paie
 * (convex/assignments.ts — `materializeTargetPublication` puis
 * `accrueBaseLineItem`/`accrueClipLineItem`). Le relevé « 61 sur 219 » porte
 * donc littéralement sur les instants qui produisent ces libellés.
 *
 * Un libellé est ÉCRIT en base et jamais recalculé : le correctif ne répare que
 * les lignes à venir, les anciennes gardent leur date fausse.
 */
describe("formatDayMonthFr — libellé de ligne de paie", () => {
  it("rend le jour PARISIEN d'une confirmation de fin de soirée", () => {
    // Prod : publication @repackit.io TikTok, 2026-05-10 22:00 UTC = 11/05 à
    // Paris. En UTC la ligne de paie s'intitulerait « Clip — 10/05 », soit la
    // veille du jour où la créatrice a effectivement publié.
    expect(formatDayMonthFr(1778450400000)).toBe("11/05");
  });

  it("ne décale PAS une confirmation de plein après-midi", () => {
    // Prod : @hopemedia16, 2026-06-22 15:21 UTC = 17:21 à Paris. Même jour dans
    // les deux fuseaux — et l'égalité stricte vaut contrôle du FORMAT : "22/06"
    // et non "22/06/26" (cf. convex/dateFr.ts, libellés déjà en base).
    expect(formatDayMonthFr(1782141710967)).toBe("22/06");
  });

  it("bascule au bon instant : 21:59 UTC est encore la veille, 22:00 le jour même", () => {
    // Même frontière que ci-dessus : sépare l'épingle de fuseau d'un décalage
    // d'un jour en dur, que les deux cas précédents laisseraient passer.
    expect(formatDayMonthFr(Date.UTC(2026, 4, 10, 21, 59, 59))).toBe("10/05");
    expect(formatDayMonthFr(Date.UTC(2026, 4, 10, 22, 0, 0))).toBe("11/05");
  });
});

/**
 * MOIS CALENDAIRE des écrans de revenu / rentabilité.
 *
 * Le revenu Whop était bucketisé par `periodOf` (convex/payments.ts), qui découpe
 * en UTC. Whop, lui, découpe en heure locale — et le hub Analytics compte déjà ses
 * JOURS en Europe/Paris (`analyticsHub.parisDay`) : les deux axes du même écran ne
 * tombaient pas sur le même mois.
 *
 * Les timestamps ci-dessous sont des paiements RÉELS de l'export prod du
 * 2026-09-02 (snytch / biz_e1zcXWKzcgHgt9), pas des ronds de fantaisie : les 7
 * encaissements du 31/08 22:03→23:43 UTC valent 85,93 € de brut et 80,26 € de net
 * que l'app rangeait en août et Whop en septembre.
 */
describe("monthKeyParis — mois calendaire Europe/Paris", () => {
  it("range un paiement de fin de mois UTC dans le mois PARIS (été, UTC+2)", () => {
    // pay sohanebelmehdi, 16,99 € : 31/08 22:03:31 UTC = 01/09 00:03:31 Paris.
    expect(monthKeyParis(1788213811061)).toBe("2026-09");
    // pay micronsbiofilmh, 16,99 € : 31/08 22:06:59 UTC = 01/09 00:06:59 Paris.
    expect(monthKeyParis(1788214019907)).toBe("2026-09");
    // publications.datePubli posée à MINUIT PARIS : 31/08 22:00:08 UTC, 866 vues.
    expect(monthKeyParis(1788213608033)).toBe("2026-09");
  });

  it("laisse un paiement de PLEIN MOIS dans son mois (assertion de présence)", () => {
    // Sans ce contre-test, une implémentation qui décalerait TOUT d'un mois
    // passerait le test précédent.
    expect(monthKeyParis(1787254571095)).toBe("2026-08"); // 20/08 19:36 UTC
    expect(monthKeyParis(1787235050582)).toBe("2026-08"); // 20/08 14:10 UTC
  });

  it("tient l'heure d'HIVER (UTC+1), où la bascule est à 23:00 UTC", () => {
    // 31/01/2026 22:59 UTC = 31/01 23:59 Paris → janvier, pas février.
    expect(monthKeyParis(Date.UTC(2026, 0, 31, 22, 59))).toBe("2026-01");
    // 31/01/2026 23:00 UTC = 01/02 00:00 Paris → février.
    expect(monthKeyParis(Date.UTC(2026, 0, 31, 23, 0))).toBe("2026-02");
  });

  it("passe l'année sur le réveillon lu à Paris", () => {
    // 31/12/2026 23:30 UTC = 01/01/2027 00:30 Paris.
    expect(monthKeyParis(Date.UTC(2026, 11, 31, 23, 30))).toBe("2027-01");
  });

  it("ne remplace PAS periodOf : les deux clés divergent aux frontières", () => {
    // Garde-fou explicite. `periodOf` reste en UTC parce que sa valeur est
    // PERSISTÉE (payments.period, bonusUnlocks.attributionPeriod) ; si un jour
    // quelqu'un aligne les deux, ce test tombe et rappelle pourquoi.
    expect(periodOf(1788213811061)).toBe("2026-08");
    expect(monthKeyParis(1788213811061)).toBe("2026-09");
    // Hors frontière, elles coïncident — c'est ce qui rend la substitution sûre
    // partout ailleurs.
    expect(periodOf(1787254571095)).toBe(monthKeyParis(1787254571095));
  });
});
