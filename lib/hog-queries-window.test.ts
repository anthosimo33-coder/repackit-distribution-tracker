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

  const W = hogWindowClause("2026-09-01", "2026-09-06")!;
  const WSUB = hogWindowClause("2026-09-01", "2026-09-06", "t_first_sub")!;

  it("une fenêtre libre remplace le prédicat des requêtes ORDINAIRES", () => {
    const fenetre = buildQueries("", "''", W, WSUB);
    let touchees = 0;
    for (const [nom, sql] of Object.entries(fenetre)) {
      if (!base[nom as keyof typeof base].includes(DEFAULT_WINDOW)) continue;
      if (sql.includes("AS ab_exp")) continue; // traitées à part, cf ci-dessous
      touchees += 1;
      expect(sql, `${nom} n'a pas reçu la fenêtre libre`).toContain(W);
      expect(sql, `${nom} porte encore la fenêtre par défaut`).not.toContain(
        DEFAULT_WINDOW,
      );
    }
    // Sans ce compteur, un `buildQueries` qui rendrait un objet vide passerait
    // la boucle sans rien vérifier.
    expect(touchees).toBeGreaterThan(15);
  });

  it("les requêtes A/B GARDENT leur balayage de 90 jours", () => {
    // Leur inner fournit `t_first_sub`, le tout premier abonnement d'une
    // personne : c'est la SEULE chose qui sépare un nouveau client d'un
    // renouvellement. Mesuré en prod sur sept jours, 58 personnes sur 203 ont
    // leur premier abonnement hors fenêtre — rétrécir le balayage les aurait
    // toutes comptées comme des clients de la semaine.
    const fenetre = buildQueries("", "''", W, WSUB);
    for (const nom of ["abArms", "abOffers", "abPurchases"] as const) {
      const sql = fenetre[nom];
      expect(sql, `${nom} a perdu son balayage de 90 jours`).toContain(
        `WHERE ${DEFAULT_WINDOW}`,
      );
      // …et ses COMPTEURS suivent bien la période demandée.
      expect(sql, `${nom} ne mesure pas sur la période`).toContain(W);
    }
    // L'acquisition se juge sur la DATE du 1er abonnement, pas sur l'activité.
    expect(fenetre.abArms).toContain(WSUB);
  });

  it("la CTE de l'expérience A/B reste sur 90 jours même en fenêtre libre", () => {
    // Elle répond à « quelle expérience tourne, depuis quand » : la borner à la
    // période regardée ferait de `ab_start` le début de la FENÊTRE.
    const abArms = buildQueries("", "''", W, WSUB).abArms;
    expect(abArms).toContain("AS ab_exp");
    expect(abArms).toContain(DEFAULT_WINDOW);
    expect(abArms).toContain(W);
  });

  it("une fenêtre libre SANS sa version sur t_first_sub est REFUSÉE", () => {
    // Silencieusement acceptée, elle ferait passer les renouvellements pour des
    // nouveaux clients. Mieux vaut une exception qu'un chiffre faux.
    expect(() => buildQueries("", "''", W)).toThrow(/windowOnFirstSub/);
    // Contre-test : avec les deux, ça passe.
    expect(() => buildQueries("", "''", W, WSUB)).not.toThrow();
  });
});
