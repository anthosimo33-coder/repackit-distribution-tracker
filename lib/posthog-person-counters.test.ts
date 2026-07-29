import { describe, it, expect } from "vitest";
import { buildQueries } from "../convex/posthogSync";

/**
 * GARDE-FOU — la règle « un compteur de PERSONNES ne doit jamais utiliser
 * count()/countIf sans GROUP BY person_id » (sinon il compte des EVENTS et gonfle,
 * cf le bug des 54 clients) est vérifiée automatiquement sur les requêtes HogQL
 * RÉELLES (buildQueries, entièrement interpolées). Sans ce test, la règle se
 * perdrait au prochain ajout de requête.
 *
 * count()/countIf est correct s'il porte sur une sous-requête GROUP BY person_id
 * (chaque ligne = une personne). Sinon il agrège des events — acceptable UNIQUEMENT
 * pour un compteur d'events assumé, qui DOIT figurer dans EXEMPT avec sa raison.
 */

/** Compteurs d'EVENTS légitimes (pas des personnes) — justification obligatoire. */
const EXEMPT: Record<string, string> = {
  scanReliability:
    "scans = events backend (souvent un seul person_id pour tous) ; 'runs' = nombre de scans exécutés",
  scanLatency:
    "n = nombre de mesures de latence (events scan_completed), pas de personnes",
  scanCost:
    "coût d'infrastructure : runs/with_cost = nombre de scans (events scan_completed) ventilés léger/complet, pas de personnes",
  instrumentation:
    "les countIf sont des SONDES de présence de propriété (nb d'events portant la prop) ; les compteurs de personnes, eux, utilisent uniqIf(person_id)",
};

// Requêtes réelles, interpolations résolues (notInternal/internalMarker à vide).
const queries = buildQueries("", "") as Record<string, string>;

describe("garde-fou : compteurs de personnes en HogQL", () => {
  it("les requêtes sont bien récupérées", () => {
    expect(Object.keys(queries).length).toBeGreaterThan(15);
  });

  it("aucun count()/countIf de PERSONNES sans GROUP BY person_id", () => {
    const offenders: string[] = [];
    for (const [key, sql] of Object.entries(queries)) {
      if (key in EXEMPT) continue;
      const hasCount =
        /\bcount\s*\(\s*\)/.test(sql) || /\bcountIf\s*\(/.test(sql);
      const hasPersonGroup = /GROUP BY person_id/.test(sql);
      if (hasCount && !hasPersonGroup) offenders.push(key);
    }
    expect(
      offenders,
      `Requêtes suspectes (count/countIf sans GROUP BY person_id) : ${offenders.join(", ")}. ` +
        `Passe par uniqIf(person_id) / une sous-requête GROUP BY person_id, ou ajoute la clé à EXEMPT si c'est un compteur d'events assumé.`,
    ).toEqual([]);
  });

  it("les exemptions correspondent à des requêtes réelles et sont justifiées", () => {
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(key in queries, `EXEMPT.${key} ne correspond à aucune requête`).toBe(
        true,
      );
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});
