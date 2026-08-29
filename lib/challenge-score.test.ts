/**
 * DÉFIS — score, franchissement, départage, fin de défi.
 *
 * Ce que ces tests verrouillent, et qui n'est PAS évident :
 *   - le score part de zéro et ne compte que les vidéos du défi (aucune de ces
 *     fonctions ne voit l'historique — c'est structurel, mais on le dit) ;
 *   - CUMULÉ somme, UNIQUE prend le maximum : deux règles différentes sur la
 *     même donnée, l'inversion des deux ne casserait aucun typage ;
 *   - une victoire acquise ne se reprend JAMAIS, même si le score retombe ;
 *   - le départage se fait au score du relevé, pas à un ordre d'arrivée que
 *     personne ne connaît.
 *
 * Les données ont la FORME de la prod : des vues réelles prises de l'export
 * Snytch (1 643 = médiane par vidéo, 51 200 = p90, 402 588 = la meilleure), des
 * prénoms de vraies créatrices, et des dates à minuit Paris. Des nombres ronds
 * (100, 200) rendraient vertes des assertions qu'une arithmétique fausse
 * satisferait aussi.
 */
import { describe, expect, it } from "vitest";
import {
  challengeIsOver,
  countedVideos,
  newWinnersAt,
  progressRatio,
  rankParticipants,
  scoreOf,
  viewsToTarget,
  winnerSlots,
  type ChallengeVideo,
  type ExistingWin,
  type Participant,
  type RankedParticipant,
} from "../convex/challengeScore";

const JOUR = 86_400_000;
/** Relevé du 20/08/2026 à 23h30 Paris = 21:30 UTC. */
const RELEVE = Date.UTC(2026, 7, 20, 21, 30);
const DEADLINE = RELEVE + 3 * JOUR;

const v = (views: number, o: Partial<ChallengeVideo> = {}): ChallengeVideo => ({
  views,
  published: true,
  ...o,
});

describe("ce qui compte dans un score", () => {
  it("une vidéo NON publiée ne compte pas", () => {
    expect(scoreOf([v(51_200), v(8_177, { published: false })], "cumulative")).toBe(
      51_200,
    );
  });

  it("une vidéo RETIRÉE du défi ne compte pas — elle reste publiée par ailleurs", () => {
    const videos = [v(51_200), v(8_177, { removed: true })];
    expect(scoreOf(videos, "cumulative")).toBe(51_200);
    // CONTRÔLE DE PRÉSENCE apparié : sans le retrait, elle comptait bien.
    expect(scoreOf([v(51_200), v(8_177)], "cumulative")).toBe(59_377);
    // Et le retrait ne la fait pas disparaître de la liste, seulement du compte.
    expect(videos).toHaveLength(2);
    expect(countedVideos(videos)).toHaveLength(1);
  });

  it("aucune vidéo comptée ⇒ 0 dans les deux modes (jamais -Infinity)", () => {
    expect(scoreOf([], "cumulative")).toBe(0);
    expect(scoreOf([], "single")).toBe(0);
    expect(scoreOf([v(9_999, { published: false })], "single")).toBe(0);
  });

  it("des vues négatives (donnée corrompue) ne retranchent rien", () => {
    expect(scoreOf([v(1_643), v(-500)], "cumulative")).toBe(1_643);
  });
});

describe("CUMULÉ somme, UNIQUE prend la meilleure", () => {
  const videos = [v(1_643), v(8_177), v(51_200)];

  it("cumulé : la somme", () => {
    expect(scoreOf(videos, "cumulative")).toBe(61_020);
  });

  it("unique : la meilleure seule", () => {
    expect(scoreOf(videos, "single")).toBe(51_200);
  });

  it("le mode change qui franchit — sur les MÊMES vidéos", () => {
    // Une barre à 60 000 : franchie en cumulé (61 020), pas en unique (51 200).
    // C'est tout l'écart entre « récompenser le volume » et « récompenser un hit ».
    expect(scoreOf(videos, "cumulative") >= 60_000).toBe(true);
    expect(scoreOf(videos, "single") >= 60_000).toBe(false);
  });
});

describe("classement nominatif", () => {
  const participants: Participant[] = [
    { creatorId: "cr_kelly", name: "Kelly", videos: [v(402_588), v(260_200)] },
    { creatorId: "cr_marine", name: "Marine", videos: [v(63_100)] },
    { creatorId: "cr_orlane", name: "Orlane", videos: [v(15_000), v(7_541)] },
    { creatorId: "cr_cinthia", name: "Cinthia", videos: [] },
    { creatorId: "cr_jade", name: "Jade", videos: [] },
  ];

  it("trie par score décroissant et numérote les rangs", () => {
    const r = rankParticipants(participants, "cumulative", 100_000);
    expect(r.map((x) => x.name)).toEqual([
      "Kelly", // 662 788
      "Marine", // 63 100
      "Orlane", // 22 541
      "Cinthia", // 0 — départagée par le nom
      "Jade", // 0
    ]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("marque qui a franchi la barre, et compte ses vidéos", () => {
    const r = rankParticipants(participants, "cumulative", 100_000);
    expect(r.filter((x) => x.crossed).map((x) => x.name)).toEqual(["Kelly"]);
    expect(r.find((x) => x.name === "Kelly")!.videoCount).toBe(2);
    expect(r.find((x) => x.name === "Jade")!.videoCount).toBe(0);
  });

  it("le mode UNIQUE rebat le classement", () => {
    // Marine (63 100 sur une vidéo) reste 2e, mais Orlane passe à 15 000 au lieu
    // de 22 541 : en mode unique, publier beaucoup ne compense pas.
    const r = rankParticipants(participants, "single", 100_000);
    expect(r.map((x) => x.score)).toEqual([402_588, 63_100, 15_000, 0, 0]);
  });
});

describe("désignation des gagnantes", () => {
  /** Trois participantes, deux au-dessus d'une barre à 50 000. */
  const ranked = (): RankedParticipant[] =>
    rankParticipants(
      [
        { creatorId: "cr_kelly", name: "Kelly", videos: [v(402_588)] },
        { creatorId: "cr_marine", name: "Marine", videos: [v(63_100)] },
        { creatorId: "cr_orlane", name: "Orlane", videos: [v(15_000)] },
      ],
      "cumulative",
      50_000,
    );

  const win = (o: Partial<ExistingWin> & { creatorId: string }): ExistingWin => ({
    ...o,
  });

  it("« la première » : une seule place, celle qui a le plus de vues au relevé", () => {
    const out = newWinnersAt({
      ranked: ranked(),
      rule: { kind: "first" },
      existingWins: [],
      at: RELEVE,
      deadline: DEADLINE,
    });
    expect(out.map((x) => x.name)).toEqual(["Kelly"]);
    expect(out[0].score).toBe(402_588);
  });

  it("« les N premières » : N places, dans l'ordre du score au relevé", () => {
    const out = newWinnersAt({
      ranked: ranked(),
      rule: { kind: "topN", n: 2 },
      existingWins: [],
      at: RELEVE,
      deadline: DEADLINE,
    });
    expect(out.map((x) => x.name)).toEqual(["Kelly", "Marine"]);
    // Orlane (15 000) n'a pas franchi : elle n'aurait pas gagné même à 3 places.
    const trois = newWinnersAt({
      ranked: ranked(),
      rule: { kind: "topN", n: 3 },
      existingWins: [],
      at: RELEVE,
      deadline: DEADLINE,
    });
    expect(trois.map((x) => x.name)).toEqual(["Kelly", "Marine"]);
  });

  it("« toutes » : aucun plafond", () => {
    expect(winnerSlots({ kind: "all" })).toBe(Number.POSITIVE_INFINITY);
    const out = newWinnersAt({
      ranked: ranked(),
      rule: { kind: "all" },
      existingWins: [],
      at: RELEVE,
      deadline: DEADLINE,
    });
    expect(out.map((x) => x.name)).toEqual(["Kelly", "Marine"]);
  });

  it("une gagnante déjà actée ne regagne pas, et occupe sa place", () => {
    const out = newWinnersAt({
      ranked: ranked(),
      rule: { kind: "topN", n: 2 },
      existingWins: [win({ creatorId: "cr_kelly" })],
      at: RELEVE + JOUR,
      deadline: DEADLINE,
    });
    expect(out.map((x) => x.name)).toEqual(["Marine"]);
    // Places pleines → plus personne.
    expect(
      newWinnersAt({
        ranked: ranked(),
        rule: { kind: "topN", n: 2 },
        existingWins: [
          win({ creatorId: "cr_kelly" }),
          win({ creatorId: "cr_marine" }),
        ],
        at: RELEVE + JOUR,
        deadline: DEADLINE,
      }),
    ).toEqual([]);
  });

  it("une victoire ANNULÉE libère sa place", () => {
    const out = newWinnersAt({
      ranked: ranked(),
      rule: { kind: "first" },
      existingWins: [win({ creatorId: "cr_kelly", cancelled: true })],
      at: RELEVE + JOUR,
      deadline: DEADLINE,
    });
    // Kelly n'est plus gagnante : la place se rejoue, et elle peut la reprendre.
    expect(out.map((x) => x.name)).toEqual(["Kelly"]);
  });

  it("après la deadline, plus AUCUNE victoire — même barre franchie", () => {
    expect(
      newWinnersAt({
        ranked: ranked(),
        rule: { kind: "all" },
        existingWins: [],
        at: DEADLINE + 1,
        deadline: DEADLINE,
      }),
    ).toEqual([]);
    // CONTRÔLE DE PRÉSENCE apparié : le relevé qui tombe PILE à la deadline
    // compte encore (borne inclusive — une convention, écrite).
    expect(
      newWinnersAt({
        ranked: ranked(),
        rule: { kind: "all" },
        existingWins: [],
        at: DEADLINE,
        deadline: DEADLINE,
      }).map((x) => x.name),
    ).toEqual(["Kelly", "Marine"]);
  });

  it("personne n'a franchi ⇒ rien n'est acté (et rien ne sera versé)", () => {
    const aucune = rankParticipants(
      [
        { creatorId: "cr_jade", name: "Jade", videos: [v(1_984)] },
        { creatorId: "cr_cinthia", name: "Cinthia", videos: [v(607)] },
      ],
      "cumulative",
      100_000,
    );
    expect(
      newWinnersAt({
        ranked: aucune,
        rule: { kind: "all" },
        existingWins: [],
        at: RELEVE,
        deadline: DEADLINE,
      }),
    ).toEqual([]);
  });

  it("DÉPARTAGE au même relevé : le plus de vues gagne", () => {
    // Deux franchissements constatés au MÊME relevé, écart de 12 vues. C'est le
    // cas qui n'a pas de bonne réponse « chronologique » : entre deux relevés,
    // personne ne sait qui est passée devant l'autre.
    const serre = rankParticipants(
      [
        { creatorId: "cr_sarah", name: "Sarah", videos: [v(100_612)] },
        { creatorId: "cr_marine", name: "Marine", videos: [v(100_600)] },
      ],
      "cumulative",
      100_000,
    );
    const out = newWinnersAt({
      ranked: serre,
      rule: { kind: "first" },
      existingWins: [],
      at: RELEVE,
      deadline: DEADLINE,
    });
    expect(out.map((x) => x.name)).toEqual(["Sarah"]);
  });
});

describe("une victoire ne se dé-acquiert pas toute seule", () => {
  /**
   * ⚠️ Chacun de ces cas fait franchir la barre à une AUTRE participante. Sans
   * elle, l'assertion « aucune nouvelle gagnante » serait vraie pour la mauvaise
   * raison — parce que personne n'était éligible, pas parce que la place est
   * tenue. C'est le piège vu en contre-épreuve : la première version de ce test
   * restait verte alors que la protection était retirée du code.
   */
  it("le score de la gagnante retombe sous la barre : sa place reste tenue", () => {
    // La vidéo de Kelly a été retirée du défi APRÈS sa victoire → score 0. Sarah,
    // elle, vient de franchir : c'est elle qui prendrait la place si la victoire
    // de Kelly avait été recalculée au lieu d'être lue.
    const apres = rankParticipants(
      [
        {
          creatorId: "cr_kelly",
          name: "Kelly",
          videos: [v(402_588, { removed: true })],
        },
        { creatorId: "cr_sarah", name: "Sarah", videos: [v(163_000)] },
      ],
      "cumulative",
      100_000,
    );
    expect(apres.find((x) => x.name === "Kelly")!.score).toBe(0);
    expect(apres.find((x) => x.name === "Sarah")!.crossed).toBe(true);

    expect(
      newWinnersAt({
        ranked: apres,
        rule: { kind: "first" },
        existingWins: [{ creatorId: "cr_kelly" }],
        at: RELEVE + JOUR,
        deadline: DEADLINE,
      }),
    ).toEqual([]);

    // CONTRÔLE DE PRÉSENCE apparié : sans la victoire de Kelly en entrée, Sarah
    // prend bien la place. L'assertion vide ci-dessus dit donc quelque chose.
    expect(
      newWinnersAt({
        ranked: apres,
        rule: { kind: "first" },
        existingWins: [],
        at: RELEVE + JOUR,
        deadline: DEADLINE,
      }).map((x) => x.name),
    ).toEqual(["Sarah"]);
  });

  it("en « toutes », une gagnante n'est jamais actée DEUX fois", () => {
    // Isolation du garde `alreadyWon`, sans interférence du compte de places :
    // en « toutes » il n'y a pas de plafond, donc si Kelly ressort ici, c'est
    // qu'on lui doit une SECONDE prime pour la même victoire. C'est le seul
    // montage où ce garde travaille seul — sous « la première » ou « les N
    // premières », l'épuisement des places masquerait son absence.
    const apres = rankParticipants(
      [
        { creatorId: "cr_kelly", name: "Kelly", videos: [v(402_588)] },
        { creatorId: "cr_sarah", name: "Sarah", videos: [v(163_000)] },
      ],
      "cumulative",
      100_000,
    );
    expect(apres.every((x) => x.crossed)).toBe(true);

    const out = newWinnersAt({
      ranked: apres,
      rule: { kind: "all" },
      existingWins: [{ creatorId: "cr_kelly" }],
      at: RELEVE + JOUR,
      deadline: DEADLINE,
    });
    expect(out.map((x) => x.name)).toEqual(["Sarah"]);
  });
});

describe("fin de défi (dérivée, jamais stockée)", () => {
  it("deadline dépassée", () => {
    expect(
      challengeIsOver({
        rule: { kind: "all" },
        existingWins: [],
        deadline: DEADLINE,
        now: DEADLINE + 1,
      }),
    ).toBe(true);
    expect(
      challengeIsOver({
        rule: { kind: "all" },
        existingWins: [],
        deadline: DEADLINE,
        now: DEADLINE,
      }),
    ).toBe(false);
  });

  it("toutes les places prises", () => {
    expect(
      challengeIsOver({
        rule: { kind: "topN", n: 2 },
        existingWins: [{ creatorId: "a" }, { creatorId: "b" }],
        deadline: DEADLINE,
        now: RELEVE,
      }),
    ).toBe(true);
    // Une annulée ne compte pas : le défi rouvre.
    expect(
      challengeIsOver({
        rule: { kind: "topN", n: 2 },
        existingWins: [{ creatorId: "a" }, { creatorId: "b", cancelled: true }],
        deadline: DEADLINE,
        now: RELEVE,
      }),
    ).toBe(false);
  });

  it("« toutes » ne se termine que par la deadline", () => {
    expect(
      challengeIsOver({
        rule: { kind: "all" },
        existingWins: [{ creatorId: "a" }, { creatorId: "b" }],
        deadline: DEADLINE,
        now: RELEVE,
      }),
    ).toBe(false);
  });
});

describe("barre de progression", () => {
  it("progression bornée à 1, restant borné à 0", () => {
    expect(progressRatio(51_200, 100_000)).toBeCloseTo(0.512, 5);
    expect(progressRatio(402_588, 100_000)).toBe(1);
    expect(viewsToTarget(51_200, 100_000)).toBe(48_800);
    expect(viewsToTarget(402_588, 100_000)).toBe(0);
  });

  it("objectif nul (donnée corrompue) ⇒ 0, jamais NaN à l'écran", () => {
    expect(progressRatio(1_643, 0)).toBe(0);
    expect(Number.isNaN(progressRatio(1_643, 0))).toBe(false);
  });
});
