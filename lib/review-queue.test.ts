// Même épinglage que lib/creator-schedule.test.ts : l'admin lit cet écran depuis
// Paris, et un runner en UTC ferait basculer les cas « aujourd'hui/demain » d'un
// jour — le test passerait au vert pour la mauvaise raison.
process.env.TZ = "Europe/Paris";

import { describe, expect, it } from "vitest";
import { countTomorrow, reviewSlot } from "./review-queue";

/** 15/08/2026, heures LOCALES Paris. */
const J = (h: number, m = 0) => new Date(2026, 7, 15, h, m).getTime();
const AVANT_HIER = new Date(2026, 7, 13, 0, 0).getTime();
const HIER = new Date(2026, 7, 14, 0, 0).getTime();
const AUJ = new Date(2026, 7, 15, 0, 0).getTime();
const DEMAIN = new Date(2026, 7, 16, 0, 0).getTime();
const APRES_DEMAIN = new Date(2026, 7, 17, 0, 0).getTime();

describe("reviewSlot — ce qui sort quand", () => {
  it("aujourd'hui reste « aujourd'hui » même une fois minuit passé", () => {
    // postDate = minuit LOCAL du jour même, donc DÉJÀ dans le passé dès 00h01.
    // Une comparaison brute de timestamps la classerait « en retard » toute la
    // journée : c'est la forme réelle des données (100 % des postDate de prod
    // sont à minuit), pas un cas de bord.
    expect(reviewSlot(AUJ, J(9))).toBe("today");
    expect(reviewSlot(AUJ, J(23, 59))).toBe("today");
  });

  it("hier et avant-hier → en retard", () => {
    expect(reviewSlot(HIER, J(9))).toBe("overdue");
    expect(reviewSlot(AVANT_HIER, J(9))).toBe("overdue");
  });

  it("demain → « demain », après-demain → « à venir »", () => {
    expect(reviewSlot(DEMAIN, J(9))).toBe("tomorrow");
    expect(reviewSlot(APRES_DEMAIN, J(9))).toBe("upcoming");
    // Le basculement se fait au JOUR, pas à 24 h près : à 23h30, demain minuit
    // n'est qu'à 30 minutes et reste pourtant « demain ».
    expect(reviewSlot(DEMAIN, J(23, 30))).toBe("tomorrow");
  });

  it("sans date de publication → « non planifiée », jamais « en retard »", () => {
    // 27 % du parc de prod n'a pas de postDate. Les traiter comme un retard
    // remonterait un quart de la file en tête.
    expect(reviewSlot(null, J(9))).toBe("undated");
    expect(reviewSlot(undefined, J(9))).toBe("undated");
  });

  it("le changement d'heure ne décale pas « demain »", () => {
    // Nuit du 25 octobre 2026 : la journée fait 25 h. Une division de timestamps
    // rendrait 1,04 jour et sortirait du cas « demain ».
    const veille = new Date(2026, 9, 24, 15, 0).getTime();
    const lendemain = new Date(2026, 9, 25, 0, 0).getTime();
    expect(reviewSlot(lendemain, veille)).toBe("tomorrow");
  });
});

describe("countTomorrow — l'en-tête de la file", () => {
  it("compte les sorties de demain, et rien d'autre", () => {
    const rows = [
      { postDate: HIER },
      { postDate: AUJ },
      { postDate: DEMAIN },
      { postDate: DEMAIN },
      { postDate: APRES_DEMAIN },
      { postDate: null },
    ];
    expect(countTomorrow(rows, J(10))).toBe(2);
    // Contrôle de PRÉSENCE apparié : sans aucune sortie demain, on obtient 0 —
    // et le total, lui, n'est pas nul (la file n'est pas vide).
    expect(countTomorrow([{ postDate: AUJ }, { postDate: null }], J(10))).toBe(0);
  });
});
