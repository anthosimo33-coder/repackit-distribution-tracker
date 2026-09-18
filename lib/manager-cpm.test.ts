import { describe, expect, it } from "vitest";
import {
  buildManagerPayRows,
  applyCpmEdits,
  cpmAt,
  cpmTrace,
  parisDayStart,
  currentCpms,
  managerCpmProblem,
  nextCpmHistory,
  managerPayAllPeriods,
  managerPeriodStatus,
  managerPayAmount,
  managerPayByCreator,
  managerPayPeriodOf,
  managerPayPeriods,
  parseCpmTrace,
  sumManagerPayRows,
} from "../convex/managerCpm";

// Ids de la forme de ceux de la prod (Convex), jamais « a » / « b ».
const KELLY = "k57dq3hc9w1ry2v0e7t5n8m4xs6jbf1p";
const INES = "k57f0a2m8c3rq9w1y6t4v7n5bx2hsd8e";
const HORS = "k57zz9y8x7w6v5u4t3s2r1q0pon2mlk3";

// 14/09/2026 18:37 Paris et 31/08/2026 23:12 UTC : un jour ≠ aujourd'hui, et une
// vidéo publiée à la toute fin d'un mois.
const SEPT = Date.UTC(2026, 8, 14, 16, 37);
const FIN_AOUT = Date.UTC(2026, 7, 31, 23, 12);

describe("managerPayAmount", () => {
  it("0,20 pour 1 000 vues sur 48 317 vues", () => {
    expect(managerPayAmount(48_317, 0.2)).toBeCloseTo(9.6634, 6);
  });
  it("des vues négatives ne font jamais un montant négatif", () => {
    expect(managerPayAmount(-1_200, 0.35)).toBe(0);
  });
});

describe("managerCpmProblem", () => {
  it("accepte un CPM à décimales", () => {
    expect(managerCpmProblem(0.35)).toBeNull();
  });
  it("refuse zéro, le négatif, NaN et l'excès", () => {
    expect(managerCpmProblem(0)).toBe("not_positive");
    expect(managerCpmProblem(-0.2)).toBe("not_positive");
    expect(managerCpmProblem(Number.NaN)).toBe("not_a_number");
    expect(managerCpmProblem(200)).toBe("too_high");
  });
});

describe("managerPayPeriodOf", () => {
  it("prend le mois UTC de la publication", () => {
    expect(managerPayPeriodOf(SEPT)).toBe("2026-09");
    expect(managerPayPeriodOf(FIN_AOUT)).toBe("2026-08");
  });
});

describe("buildManagerPayRows", () => {
  const videos = [
    { creatorId: KELLY, publishedAt: SEPT, payableViews: 48_317, totalViews: 51_904 },
    { creatorId: KELLY, publishedAt: SEPT + 3_600_000, payableViews: 12_086, totalViews: 12_086 },
    { creatorId: KELLY, publishedAt: FIN_AOUT, payableViews: 7_431, totalViews: 9_002 },
    { creatorId: INES, publishedAt: SEPT, payableViews: 103_559, totalViews: 103_559 },
    // Une créatrice sans CPM : ne rapporte rien, même si elle fait des vues.
    { creatorId: HORS, publishedAt: SEPT, payableViews: 250_000, totalViews: 250_000 },
  ];
  const cpms = [
    { creatorId: KELLY, cpm: 0.2 },
    { creatorId: INES, cpm: 0.35 },
  ];
  const rows = buildManagerPayRows(videos, cpms);

  it("une ligne par (créatrice, mois), la créatrice sans CPM absente", () => {
    expect(rows.map((r) => `${r.creatorId}|${r.period}`).sort()).toEqual(
      [`${INES}|2026-09`, `${KELLY}|2026-08`, `${KELLY}|2026-09`].sort(),
    );
    expect(rows.some((r) => r.creatorId === HORS)).toBe(false);
  });

  it("chaque créatrice est payée à SON taux, sur les vues RÉMUNÉRÉES", () => {
    const kellySept = rows.find((r) => r.creatorId === KELLY && r.period === "2026-09")!;
    expect(kellySept.videos).toBe(2);
    expect(kellySept.payableViews).toBe(60_403);
    expect(kellySept.totalViews).toBe(63_990);
    expect(kellySept.amount).toBeCloseTo(12.0806, 6);
    const ines = rows.find((r) => r.creatorId === INES)!;
    expect(ines.amount).toBeCloseTo(36.24565, 6);
  });

  it("totaux par mois et depuis le début", () => {
    expect(sumManagerPayRows(rows, "2026-08").amount).toBeCloseTo(1.4862, 6);
    const all = sumManagerPayRows(rows);
    expect(all.videos).toBe(4);
    expect(all.payableViews).toBe(171_393);
    expect(all.amount).toBeCloseTo(12.0806 + 36.24565 + 1.4862, 6);
  });

  it("par créatrice, du plus gros montant au plus petit", () => {
    const by = managerPayByCreator(rows);
    expect(by.map((b) => b.creatorId)).toEqual([INES, KELLY]);
    expect(by[1].videos).toBe(3);
    expect(managerPayByCreator(rows, "2026-08").map((b) => b.creatorId)).toEqual([KELLY]);
  });

  it("mois du plus récent au plus ancien", () => {
    expect(managerPayPeriods(rows)).toEqual(["2026-09", "2026-08"]);
  });
});

describe("journal des CPM", () => {
  it("aller-retour d'une ligne", () => {
    const [line] = cpmTrace([{ creatorId: KELLY, cpm: 0.35 }]);
    expect(line).toBe(`cpm:${KELLY}:0.35`);
    expect(parseCpmTrace(line)).toEqual({ creatorId: KELLY, cpm: 0.35, fromDay: null });
  });
  it("une ligne de périmètre ou un bloc n'est pas un CPM", () => {
    expect(parseCpmTrace(`périmètre:${KELLY}`)).toBeNull();
    expect(parseCpmTrace("creators.read")).toBeNull();
  });
  it("absent = aucune ligne", () => {
    expect(cpmTrace(undefined)).toEqual([]);
  });
});

describe("versements — reste à payer", () => {
  // Kelly : 48 317 vues à 0,20 (9,6634) + Inès : 103 559 vues à 0,35 (36,24565)
  // en septembre ⇒ dû 45,91 au centime.
  const rows = buildManagerPayRows(
    [
      { creatorId: KELLY, publishedAt: SEPT, payableViews: 48_317, totalViews: 51_904 },
      { creatorId: INES, publishedAt: SEPT, payableViews: 103_559, totalViews: 103_559 },
    ],
    [
      { creatorId: KELLY, cpm: 0.2 },
      { creatorId: INES, cpm: 0.35 },
    ],
  );

  it("rien de versé : tout est à payer", () => {
    expect(managerPeriodStatus(rows, [], "2026-09")).toEqual({
      period: "2026-09",
      due: 45.91,
      paid: 0,
      remaining: 45.91,
      state: "unpaid",
    });
  });

  it("versement du reste exact ⇒ payé, au centime près", () => {
    const st = managerPeriodStatus(
      rows,
      [{ period: "2026-09", amount: 45.91, cancelled: false }],
      "2026-09",
    );
    expect(st.remaining).toBe(0);
    expect(st.state).toBe("paid");
  });

  it("acompte ⇒ partiel ; un versement ANNULÉ ne compte pas", () => {
    const st = managerPeriodStatus(
      rows,
      [
        { period: "2026-09", amount: 30.5, cancelled: false },
        { period: "2026-09", amount: 15.41, cancelled: true },
        { period: "2026-08", amount: 99, cancelled: false },
      ],
      "2026-09",
    );
    expect(st.paid).toBe(30.5);
    expect(st.remaining).toBe(15.41);
    expect(st.state).toBe("partial");
  });

  it("taux baissé après versement ⇒ trop-perçu, jamais un reste négatif caché", () => {
    const st = managerPeriodStatus(
      rows,
      [{ period: "2026-09", amount: 50.12, cancelled: false }],
      "2026-09",
    );
    expect(st.remaining).toBe(-4.21);
    expect(st.state).toBe("overpaid");
  });

  it("un mois versé sans vidéo reste listé ; un versement annulé seul non", () => {
    expect(
      managerPayAllPeriods(rows, [
        { period: "2026-07", amount: 12.4, cancelled: false },
        { period: "2026-06", amount: 3.1, cancelled: true },
      ]),
    ).toEqual(["2026-09", "2026-07"]);
  });
});

describe("taux daté — un nouveau taux ne touche pas les anciennes vidéos", () => {
  // Kelly passe de 0,20 à 0,30 le 10/10/2026 à 14:32 UTC.
  const CHANGEMENT = Date.UTC(2026, 9, 10, 14, 32);
  const AVANT = Date.UTC(2026, 9, 3, 9, 15); // publiée le 03/10
  const APRES = Date.UTC(2026, 9, 21, 19, 48); // publiée le 21/10
  const history = nextCpmHistory(
    nextCpmHistory([], [{ creatorId: KELLY, cpm: 0.2 }], Date.UTC(2026, 8, 1)),
    [{ creatorId: KELLY, cpm: 0.3 }],
    CHANGEMENT,
  );

  it("le premier taux n'a pas de date : il couvre aussi les vidéos déjà publiées", () => {
    expect(history[0]).toEqual({ creatorId: KELLY, cpm: 0.2 });
    expect(cpmAt(history, KELLY, Date.UTC(2025, 11, 24))).toBe(0.2);
  });

  it("le changement AJOUTE une entrée datée, l'ancienne reste", () => {
    expect(history).toEqual([
      { creatorId: KELLY, cpm: 0.2 },
      { creatorId: KELLY, cpm: 0.3, from: CHANGEMENT },
    ]);
  });

  it("chaque vidéo prend le taux de SA date de publication", () => {
    expect(cpmAt(history, KELLY, AVANT)).toBe(0.2);
    expect(cpmAt(history, KELLY, APRES)).toBe(0.3);
    // À l'instant exact du changement : le nouveau taux.
    expect(cpmAt(history, KELLY, CHANGEMENT)).toBe(0.3);
  });

  it("deux vidéos du même mois, deux taux : le montant les additionne", () => {
    const rows = buildManagerPayRows(
      [
        { creatorId: KELLY, publishedAt: AVANT, payableViews: 48_317, totalViews: 48_317 },
        { creatorId: KELLY, publishedAt: APRES, payableViews: 31_864, totalViews: 33_010 },
      ],
      history,
    );
    expect(rows).toHaveLength(1);
    // 48 317 × 0,20 + 31 864 × 0,30 = 9,6634 + 9,5592
    expect(rows[0].amount).toBeCloseTo(19.2226, 6);
  });

  it("réenregistrer le même taux ne crée aucune date", () => {
    expect(nextCpmHistory(history, [{ creatorId: KELLY, cpm: 0.3 }], APRES)).toEqual(history);
  });

  it("arrêter : les vidéos déjà publiées restent payées, les suivantes non", () => {
    const STOP = Date.UTC(2026, 10, 2, 8, 0);
    const arretee = nextCpmHistory(history, [], STOP);
    expect(arretee[arretee.length - 1]).toEqual({ creatorId: KELLY, cpm: 0, from: STOP });
    expect(currentCpms(arretee)).toEqual([]);
    const rows = buildManagerPayRows(
      [
        { creatorId: KELLY, publishedAt: APRES, payableViews: 31_864, totalViews: 31_864 },
        { creatorId: KELLY, publishedAt: STOP + 86_400_000, payableViews: 12_500, totalViews: 12_500 },
      ],
      arretee,
    );
    expect(rows.map((r) => r.videos)).toEqual([1]);
    expect(rows[0].amount).toBeCloseTo(9.5592, 6);
  });

  it("le journal ne trace que le taux ACTIF", () => {
    // Le 10/10/2026 à 14:32 UTC = le 10/10 à Paris.
    expect(cpmTrace(history)).toEqual([`cpm:${KELLY}:0.3@2026-10-10`]);
    expect(parseCpmTrace(`cpm:${KELLY}:0.3@2026-10-10`)).toEqual({
      creatorId: KELLY,
      cpm: 0.3,
      fromDay: "2026-10-10",
    });
  });
});

describe("date d'effet choisie", () => {
  // « Maintenant » = 18/09/2026 11:52 Paris.
  const NOW = Date.UTC(2026, 8, 18, 9, 52);
  const HIER = "2026-09-17";
  const HIER_MINUIT = Date.UTC(2026, 8, 16, 22, 0); // 17/09 00:00 Paris (UTC+2)
  const ok = (r: ReturnType<typeof applyCpmEdits>) => {
    if ("problem" in r) throw new Error(`problème inattendu : ${r.problem.code}`);
    return r.history;
  };

  it("minuit de Paris, été comme hiver", () => {
    expect(parisDayStart(HIER)).toBe(HIER_MINUIT);
    expect(parisDayStart("2026-12-03")).toBe(Date.UTC(2026, 11, 2, 23, 0));
    expect(parisDayStart("2026-02-30")).toBeNull();
  });

  it("LE CAS DU 18/09 : 9 taux posés « depuis toujours », on corrige en « à partir d'hier »", () => {
    const poses = [
      { creatorId: KELLY, cpm: 0.2 },
      { creatorId: INES, cpm: 0.2 },
    ];
    const corrige = ok(
      applyCpmEdits(
        poses,
        poses.map((p) => ({ ...p, fromDay: HIER })),
        NOW,
      ),
    );
    // Correction EN PLACE : pas de deuxième entrée, et plus de « depuis toujours ».
    expect(corrige).toEqual([
      { creatorId: KELLY, cpm: 0.2, from: HIER_MINUIT },
      { creatorId: INES, cpm: 0.2, from: HIER_MINUIT },
    ]);
    // Une vidéo d'avant-hier ne rapporte plus rien ; une d'hier soir, si.
    expect(cpmAt(corrige, KELLY, Date.UTC(2026, 8, 16, 18, 40))).toBeUndefined();
    expect(cpmAt(corrige, KELLY, Date.UTC(2026, 8, 17, 19, 5))).toBe(0.2);
  });

  it("premier taux daté d'hier : les vidéos d'avant ne comptent pas", () => {
    const h = ok(applyCpmEdits([], [{ creatorId: KELLY, cpm: 0.35, fromDay: HIER }], NOW));
    expect(h).toEqual([{ creatorId: KELLY, cpm: 0.35, from: HIER_MINUIT }]);
  });

  it("nouveau taux à une date passée : ajouté, l'ancien reste pour les vidéos d'avant", () => {
    const h = ok(
      applyCpmEdits(
        [{ creatorId: KELLY, cpm: 0.2 }],
        [{ creatorId: KELLY, cpm: 0.3, fromDay: HIER }],
        NOW,
      ),
    );
    expect(h).toEqual([
      { creatorId: KELLY, cpm: 0.2 },
      { creatorId: KELLY, cpm: 0.3, from: HIER_MINUIT },
    ]);
  });

  it("refuse une date future", () => {
    const r = applyCpmEdits([], [{ creatorId: KELLY, cpm: 0.2, fromDay: "2026-09-19" }], NOW);
    expect("problem" in r && r.problem.code).toBe("future");
  });

  it("refuse une date qui remonte avant le taux précédent", () => {
    const h = [
      { creatorId: KELLY, cpm: 0.2 },
      { creatorId: KELLY, cpm: 0.3, from: HIER_MINUIT },
    ];
    // Corriger la date du 0,30 au 03/09 : OK (toujours après « depuis toujours »).
    expect("history" in applyCpmEdits(h, [{ creatorId: KELLY, cpm: 0.3, fromDay: "2026-09-03" }], NOW)).toBe(true);
    // Un NOUVEAU taux avant le 17/09 : refusé, il passerait sous l'entrée en vigueur.
    const r = applyCpmEdits(h, [{ creatorId: KELLY, cpm: 0.4, fromDay: "2026-09-12" }], NOW);
    expect(r).toEqual({
      problem: { code: "before_previous", creatorId: KELLY, previousFrom: HIER_MINUIT },
    });
    // « Depuis toujours » sur un 2e taux : refusé (réécrirait le 0,20 d'avant).
    const t = applyCpmEdits(h, [{ creatorId: KELLY, cpm: 0.3, fromDay: null }], NOW);
    expect("problem" in t && t.problem.code).toBe("before_previous");
  });
});
