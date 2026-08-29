// Le composant tourne dans le NAVIGATEUR, épinglé Europe/Paris par Playwright.
// On épingle la même horloge ici : sans ça, un runner en UTC ferait basculer les
// cas « jour même » d'un jour, et le test passerait au vert pour la mauvaise
// raison (cf. les trois horloges du repo).
process.env.TZ = "Europe/Paris";

import { describe, expect, it } from "vitest";
import {
  groupBySchedule,
  isToCatchUp,
  scheduleBucket,
  sortBySchedule,
} from "./creator-schedule";

/** 15/08/2026, heures LOCALES Paris. */
const J = (h: number, m = 0) => new Date(2026, 7, 15, h, m).getTime();
const HIER = new Date(2026, 7, 14, 0, 0).getTime();
const AVANT_HIER = new Date(2026, 7, 13, 0, 0).getTime();
const AUJ = new Date(2026, 7, 15, 0, 0).getTime();
const DEMAIN = new Date(2026, 7, 16, 0, 0).getTime();
const SOIR = { startMin: 21 * 60, endMin: 23 * 60 };

describe("à rattraper — les quatre cas limites", () => {
  it("jour passé sans publication → à rattraper", () => {
    expect(isToCatchUp({ postDate: HIER }, J(10))).toBe(true);
  });

  it("jour même, créneau DÉPASSÉ → à rattraper", () => {
    // 23h30 alors que le créneau finissait à 23h.
    expect(isToCatchUp({ postDate: AUJ, postWindow: SOIR }, J(23, 30))).toBe(true);
  });

  it("jour même, créneau NON dépassé → pas encore", () => {
    expect(isToCatchUp({ postDate: AUJ, postWindow: SOIR }, J(22, 59))).toBe(false);
    // Borne exacte : à 23h00 pile on est encore dedans.
    expect(isToCatchUp({ postDate: AUJ, postWindow: SOIR }, J(23, 0))).toBe(false);
  });

  it("jour même SANS créneau → jamais en retard avant minuit", () => {
    // Même à 23h59 : la journée n'est pas finie, rien ne permet de l'accuser.
    expect(isToCatchUp({ postDate: AUJ }, J(23, 59))).toBe(false);
  });

  it("publié en retard → plus à rattraper", () => {
    expect(
      isToCatchUp({ postDate: HIER, publishedAt: J(9) }, J(10)),
    ).toBe(false);
  });

  it("sans postDate → hors chronologie", () => {
    expect(isToCatchUp({}, J(10))).toBe(false);
  });
});

describe("ordre du dashboard", () => {
  it("retards anciens → récents → aujourd'hui → à venir, sans exception", () => {
    const items = [
      { id: "demain", postDate: DEMAIN },
      { id: "aujourdhui", postDate: AUJ },
      { id: "hier", postDate: HIER },
      { id: "avant-hier", postDate: AVANT_HIER },
    ];
    const ordre = sortBySchedule(items, J(10)).map((x) => x.id);
    expect(ordre).toEqual(["avant-hier", "hier", "aujourdhui", "demain"]);
  });

  it("une tâche du JOUR ne passe jamais au-dessus d'un rattrapage", () => {
    // Le cas piège : la tâche du jour a un créneau imminent, le retard est vieux
    // de trois jours. L'urgence ressentie dirait « aujourd'hui d'abord » ; la
    // règle dit l'inverse, sinon l'ancien ne remonte jamais.
    const items = [
      { id: "auj-creneau-imminent", postDate: AUJ, postWindow: SOIR },
      { id: "retard-3j", postDate: AVANT_HIER },
    ];
    expect(sortBySchedule(items, J(20, 55)).map((x) => x.id)).toEqual([
      "retard-3j",
      "auj-creneau-imminent",
    ]);
  });

  it("les sections sont celles attendues", () => {
    expect(scheduleBucket({ postDate: HIER }, J(10))).toBe("catchup");
    expect(scheduleBucket({ postDate: AUJ }, J(10))).toBe("today");
    expect(scheduleBucket({ postDate: DEMAIN }, J(10))).toBe("upcoming");
    expect(scheduleBucket({ postDate: HIER, publishedAt: J(9) }, J(10))).toBe("none");
    expect(scheduleBucket({}, J(10))).toBe("none");
  });

  it("le tri ne modifie pas la liste d'entrée", () => {
    const items = [{ postDate: DEMAIN }, { postDate: HIER }];
    sortBySchedule(items, J(10));
    expect(items[0].postDate).toBe(DEMAIN);
  });
});

describe("anciens assignments — aucun champ neuf", () => {
  it("rendu propre sans postWindow ni publishedAt : pas de NaN, pas de crash", () => {
    // Les 191 assignations d'avant ces champs passent par ici à chaque rendu.
    const item = { postDate: HIER };
    expect(isToCatchUp(item, J(10))).toBe(true);
    expect(scheduleBucket(item, J(10))).toBe("catchup");
    expect(Number.isNaN(sortBySchedule([item], J(10))[0].postDate)).toBe(false);
  });
});

describe("groupBySchedule — la semaine d'un coup d'œil", () => {
  // Forme de PROD : 16 missions actionnables d'une même créatrice (cas Jade,
  // relevé le 28/08/2026), donc des retards nombreux, un post du jour, un à
  // venir — pas un jeu idéalisé à une mission par famille.
  const J_PLUS = (n: number) => new Date(2026, 7, 15 + n, 0, 0).getTime();

  it("répartit retards / jours / plus tard / sans date", () => {
    const items = [
      { id: "retard-vieux", postDate: AVANT_HIER },
      { id: "retard-hier", postDate: HIER },
      { id: "auj", postDate: AUJ },
      { id: "auj-2", postDate: AUJ },
      { id: "demain", postDate: DEMAIN },
      { id: "j6", postDate: J_PLUS(6) },
      { id: "j7-hors-horizon", postDate: J_PLUS(7) },
      { id: "sans-date", postDate: null, dueDate: J(12) },
    ];
    const g = groupBySchedule(items, J(10));

    expect(g.catchup.map((x) => x.id)).toEqual(["retard-vieux", "retard-hier"]);
    // Deux missions le même jour = UN seau à deux éléments, pas deux seaux.
    expect(g.days.map((d) => d.items.map((x) => x.id))).toEqual([
      ["auj", "auj-2"],
      ["demain"],
      ["j6"],
    ]);
    // Horizon de 7 jours : J+7 tombe DEHORS (borne exclue), J+6 dedans.
    expect(g.later.map((x) => x.id)).toEqual(["j7-hors-horizon"]);
    expect(g.undated.map((x) => x.id)).toEqual(["sans-date"]);
  });

  it("les jours SANS mission ne sont pas matérialisés", () => {
    const g = groupBySchedule([{ id: "a", postDate: J_PLUS(5) }], J(10));
    expect(g.days).toHaveLength(1);
    expect(g.days[0].dayStart).toBe(J_PLUS(5));
  });

  it("le retard le plus ANCIEN est en tête", () => {
    const g = groupBySchedule(
      [{ id: "hier", postDate: HIER }, { id: "avant", postDate: AVANT_HIER }],
      J(10),
    );
    expect(g.catchup.map((x) => x.id)).toEqual(["avant", "hier"]);
  });

  it("une mission d'un jour PASSÉ mais publiée ne réapparaît nulle part", () => {
    // Elle n'est ni « à rattraper » (publiée) ni dans un jour à venir : elle
    // sort de la liste. Contrôle de PRÉSENCE apparié : la même mission non
    // publiée, elle, est bien rendue.
    const publiee = { id: "p", postDate: HIER, publishedAt: J(9) };
    const g = groupBySchedule([publiee], J(10));
    expect([...g.catchup, ...g.later, ...g.undated, ...g.days.flatMap((d) => d.items)]).toEqual([]);

    const nonPubliee = { id: "p", postDate: HIER };
    expect(groupBySchedule([nonPubliee], J(10)).catchup).toHaveLength(1);
  });

  it("le créneau dépassé bascule la mission DU JOUR en rattrapage", () => {
    // Même entrée, deux instants : à 22h elle est « aujourd'hui », à 23h30 elle
    // est « à rattraper ». Deux tests opposés sur la même condition.
    const item = { id: "soir", postDate: AUJ, postWindow: SOIR };
    expect(groupBySchedule([item], J(22)).days[0].items).toHaveLength(1);
    expect(groupBySchedule([item], J(22)).catchup).toHaveLength(0);
    expect(groupBySchedule([item], J(23, 30)).catchup).toHaveLength(1);
    expect(groupBySchedule([item], J(23, 30)).days).toHaveLength(0);
  });
});
