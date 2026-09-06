process.env.TZ = "UTC";
import { describe, expect, it } from "vitest";
import { buildQueries, DEFAULT_WINDOW } from "../convex/posthogSync";
import { hogWindowClause } from "./hog-window";

/**
 * PARITÉ DU SQL. Le paramétrage de la fenêtre a touché 37 sites dans 29
 * requêtes. La seule garantie qui vaille est que, sans argument, `buildQueries`
 * rende EXACTEMENT le SQL d'avant — sinon le prochain cron réécrirait tout le
 * cache avec des chiffres subtilement différents, sans que rien ne le dise.
 */
describe("buildQueries — paramétrage de la fenêtre", () => {
  const base = buildQueries("", "''");

  it("sans argument, le prédicat des 90 jours glissants est partout", () => {
    const sql = Object.values(base).join("\n");
    expect(sql).toContain(DEFAULT_WINDOW);
    // Aucun placeholder n'a survécu au remplacement.
    expect(sql).not.toContain("${");
  });

  it("passer le défaut explicitement donne le MÊME SQL, à l'octet près", () => {
    const explicite = buildQueries("", "''", DEFAULT_WINDOW);
    expect(explicite).toEqual(base);
  });

  it("une fenêtre libre remplace le prédicat dans TOUTES les requêtes", () => {
    const w = hogWindowClause("2026-09-01", "2026-09-06")!;
    const fenetre = buildQueries("", "''", w);
    let touchees = 0;
    for (const [nom, sql] of Object.entries(fenetre)) {
      if (!base[nom as keyof typeof base].includes(DEFAULT_WINDOW)) continue;
      touchees += 1;
      expect(sql, `${nom} n'a pas reçu la fenêtre libre`).toContain(w);
      // Les requêtes A/B gardent EN PLUS la fenêtre par défaut, dans leur CTE
      // d'expérience courante. Partout ailleurs elle doit avoir disparu.
      if (!sql.includes("AS ab_exp")) {
        expect(sql, `${nom} porte encore la fenêtre par défaut`).not.toContain(
          DEFAULT_WINDOW,
        );
      }
    }
    // Sans ce compteur, un `buildQueries` qui rendrait un objet vide passerait
    // la boucle sans rien vérifier.
    expect(touchees).toBeGreaterThan(20);
  });

  it("la CTE de l'expérience A/B reste sur 90 jours même en fenêtre libre", () => {
    // Elle répond à « quelle expérience tourne, depuis quand » : la borner à la
    // période regardée ferait de `ab_start` le début de la FENÊTRE.
    const w = hogWindowClause("2026-09-01", "2026-09-06")!;
    const abArms = buildQueries("", "''", w).abArms;
    expect(abArms).toContain("AS ab_exp");
    expect(abArms).toContain(DEFAULT_WINDOW);
    expect(abArms).toContain(w);
  });
});
