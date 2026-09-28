import { describe, expect, it } from "vitest";

import { settledVideoBonusResolver, settledViewsResolver } from "../convex/settledCycles";

/**
 * Forme de la PROD (2026-09-22, projet Snytch) : une créatrice ancrée au
 * 03/07/2026, deux cycles réglés (03/07 payé le 17/08, 02/08 payé le 16/09), le
 * cycle courant encore ouvert, et les rows mensuelles legacy à 0 $ qui cohabitent
 * dans la table. Les lignes gelées sont celles qu'écrit `frozenPricingLineItems` :
 * une ligne « Fixe » par GROUPE de barème (représentant, aucune vue), une ligne
 * CPM par vidéo avec son assiette.
 */
const ANCRE = Date.parse("2026-07-03T15:08:11.718Z");
const JOUR = 86_400_000;
const AOUT_VIDEO = "k17a3v9m2q8xw0pd4n6ty5rz7s8ejk21";
const JUILLET_VIDEO = "k17b8c4f1h9nm2vq6w3rt5yz8p0edla7";

const ROWS = [
  {
    period: "2026-07-03",
    status: "paid" as const,
    lineItems: [
      { assignmentId: JUILLET_VIDEO, kind: "fixed", detail: { videoCount: 12 }, amount: 20 },
      { assignmentId: JUILLET_VIDEO, kind: "cpm", detail: { views: 84_312 }, amount: 126.47 },
    ],
  },
  {
    period: "2026-08-02",
    status: "paid" as const,
    lineItems: [
      { assignmentId: AOUT_VIDEO, kind: "cpm", detail: { views: 156_962 }, amount: 150 },
      { kind: "bonus_tier", detail: {}, amount: 100 },
    ],
  },
  {
    period: "2026-09-01",
    status: "accruing" as const,
    lineItems: [],
  },
  { period: "2026-08", status: "accruing" as const, lineItems: [] },
];

/** Une ligne CPM gelée, telle que `frozenPricingLineItems` l'écrit. */
const ligneCpm = (assignmentId: string, views?: number) => ({
  assignmentId,
  kind: "cpm",
  ...(views === undefined ? {} : { detail: { views } }),
  amount: 150,
});

const PUBLIEE_EN_AOUT = Date.parse("2026-08-27T18:30:00.000Z");
const PUBLIEE_EN_JUILLET = Date.parse("2026-07-05T07:00:00.000Z");

describe("settledViewsResolver", () => {
  it("rend l'assiette PAYÉE de la vidéo, pas ses vues du jour", () => {
    const vues = settledViewsResolver(ANCRE, ROWS);
    expect(vues(AOUT_VIDEO, PUBLIEE_EN_AOUT)).toBe(156_962);
    expect(vues(JUILLET_VIDEO, PUBLIEE_EN_JUILLET)).toBe(84_312);
  });

  it("une vidéo du cycle EN COURS n'est pas gelée", () => {
    const vues = settledViewsResolver(ANCRE, ROWS);
    expect(vues(AOUT_VIDEO, Date.parse("2026-09-10T12:00:00.000Z"))).toBeNull();
  });

  it("une ligne payée ne gèle QUE sa vidéo", () => {
    const vues = settledViewsResolver(ANCRE, ROWS);
    // Une autre vidéo du MÊME cycle payé, sans ligne CPM à elle : rien à geler.
    expect(vues("k17zzzz9m2q8xw0pd4n6ty5rz7s8ejk9", PUBLIEE_EN_AOUT)).toBeNull();
    // Contrôle de PRÉSENCE : le cycle, lui, gèle bien — l'absence ci-dessus
    // vient de la vidéo, pas d'un cycle qu'on aurait raté.
    expect(vues(AOUT_VIDEO, PUBLIEE_EN_AOUT)).toBe(156_962);
  });

  it("la frontière de cycle se lit sur l'ANCRE, pas sur minuit", () => {
    const vues = settledViewsResolver(ANCRE, ROWS);
    // 02/08 à 08:00 UTC est ENCORE dans le cycle 0 (l'ancre est à 15:08), donc
    // la vidéo d'août n'y a pas de ligne : rien de gelé.
    expect(vues(AOUT_VIDEO, Date.parse("2026-08-02T08:00:00.000Z"))).toBeNull();
    // une minute après l'ancre du cycle 1, elle bascule et retrouve la sienne.
    expect(vues(AOUT_VIDEO, ANCRE + 30 * JOUR + 60_000)).toBe(156_962);
  });

  it("une ligne CPM sans assiette (row écrite avant `detail`) ne gèle rien", () => {
    const vues = settledViewsResolver(ANCRE, [
      {
        period: "2026-08-02",
        status: "paid",
        lineItems: [ligneCpm(AOUT_VIDEO)],
      },
    ]);
    expect(vues(AOUT_VIDEO, PUBLIEE_EN_AOUT)).toBeNull();
  });

  it("une row mensuelle legacy ne gèle rien, même payée", () => {
    const vues = settledViewsResolver(ANCRE, [
      {
        period: "2026-08",
        status: "paid",
        lineItems: [ligneCpm(AOUT_VIDEO, 156_962)],
      },
    ]);
    expect(vues(AOUT_VIDEO, PUBLIEE_EN_AOUT)).toBeNull();
  });

  it("un cycle PAS ENCORE payé ne gèle rien, même s'il porte déjà des lignes", () => {
    const vues = settledViewsResolver(ANCRE, [
      {
        period: "2026-08-02",
        status: "accruing",
        lineItems: [ligneCpm(AOUT_VIDEO, 156_962)],
      },
    ]);
    expect(vues(AOUT_VIDEO, PUBLIEE_EN_AOUT)).toBeNull();
  });

  it("sans ancre (fiche supprimée, aucun post) rien n'est gelé", () => {
    // La row est choisie pour être PIÉGEUSE : "2026-08-05" est exactement la clé
    // que produirait une ancre coercée à 0 (l'epoch tombe sur un cycle qui
    // démarre ce jour-là). Sans ce détail, l'assertion serait tautologique —
    // aucune clé ne matcherait, quelle que soit la façon de rater le garde.
    const piege = [
      {
        period: "2026-08-05",
        status: "paid" as const,
        lineItems: [ligneCpm(AOUT_VIDEO, 156_962)],
      },
    ];
    expect(settledViewsResolver(undefined, piege)(AOUT_VIDEO, PUBLIEE_EN_AOUT)).toBeNull();
    // Contrôle de PRÉSENCE : la même row gèle bien quand une ancre la rend
    // atteignable — l'absence ci-dessus vient du garde, pas d'une row morte.
    expect(settledViewsResolver(0, piege)(AOUT_VIDEO, PUBLIEE_EN_AOUT)).toBe(156_962);
  });
});

describe("settledVideoBonusResolver", () => {
  const AVEC_BONUS = [
    ...ROWS.slice(0, 1),
    {
      period: "2026-08-02",
      status: "paid" as const,
      lineItems: [
        { assignmentId: AOUT_VIDEO, kind: "cpm", detail: { views: 156_962 }, amount: 150 },
        { assignmentId: AOUT_VIDEO, kind: "video_bonus", detail: { views: 141_207 }, amount: 30 },
      ],
    },
    ...ROWS.slice(2),
  ];

  it("cycle payé : rend le MONTANT versé à la vidéo", () => {
    const bonus = settledVideoBonusResolver(ANCRE, AVEC_BONUS);
    expect(bonus(AOUT_VIDEO, PUBLIEE_EN_AOUT)).toBe(30);
  });

  it("cycle payé SANS ligne de bonus pour la vidéo : 0, pas null (elle n'a rien touché)", () => {
    const bonus = settledVideoBonusResolver(ANCRE, AVEC_BONUS);
    expect(bonus(JUILLET_VIDEO, PUBLIEE_EN_JUILLET)).toBe(0);
  });

  it("cycle pas encore payé : null, le calcul reste live", () => {
    const bonus = settledVideoBonusResolver(ANCRE, AVEC_BONUS);
    expect(bonus(AOUT_VIDEO, ANCRE + 62 * JOUR)).toBeNull();
  });

  it("aucune ancre ou aucune row payée : null partout", () => {
    expect(settledVideoBonusResolver(undefined, AVEC_BONUS)(AOUT_VIDEO, PUBLIEE_EN_AOUT)).toBeNull();
    expect(
      settledVideoBonusResolver(ANCRE, AVEC_BONUS.filter((r) => r.status !== "paid"))(
        AOUT_VIDEO,
        PUBLIEE_EN_AOUT,
      ),
    ).toBeNull();
  });
});
