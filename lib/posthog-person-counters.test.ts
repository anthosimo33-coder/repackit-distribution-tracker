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

/**
 * GARDE-FOU — troncature silencieuse à 100.
 *
 * PostHog plafonne à 100 lignes toute requête HogQL sans `LIMIT` explicite. Sur
 * une requête dont le regroupement porte une DATE, la cardinalité croît d'un pas
 * par jour : la requête est correcte le jour où on l'écrit et se met à mentir
 * quelques semaines plus tard, sans erreur ni trace.
 *
 * Cas vécu (prod, 2026-08-29) : `subsByMembership` groupait par (jour,
 * membership_id) sans LIMIT et rendait exactement 100 lignes, dernier jour
 * 2026-08-24. La réconciliation ne voyait donc plus AUCUN sub depuis le 25/08 et
 * rangeait tous les clients Whop en « paiement sans event » — 2 le 25/08, 6 le
 * 26, 8 le 27, 16 le 28. Elle fabriquait un jour divergent, et un de plus chaque
 * jour. Le piège était déjà documenté sur `abFlippers` ; il avait été oublié ici.
 *
 * La règle ne porte QUE sur les regroupements datés : c'est la classe où la
 * cardinalité n'est pas bornée. Un GROUP BY par segment (offre, langue, source)
 * est borné par le produit, pas par le calendrier.
 */
describe("garde-fou : troncature silencieuse à 100 lignes", () => {
  /**
   * Ne garde que le SELECT EXTÉRIEUR : retire les groupes de parenthèses de
   * premier niveau qui contiennent un SELECT (les sous-requêtes), et SEULEMENT
   * eux. Un `formatDateTime(toStartOfDay(...), ...)` doit rester lisible —
   * c'est exactement la forme sous laquelle `subsByMembership` groupait par
   * jour, et une neutralisation trop large la rendait invisible au garde-fou.
   */
  const outerOf = (sql: string): string => {
    let out = "";
    let depth = 0;
    let start = 0;
    for (let i = 0; i < sql.length; i++) {
      if (sql[i] === "(") {
        if (depth === 0) start = i;
        depth++;
      } else if (sql[i] === ")") {
        depth--;
        if (depth === 0) {
          const inner = sql.slice(start, i + 1);
          out += /\bSELECT\b/i.test(inner) ? "()" : inner;
        }
      } else if (depth === 0) {
        out += sql[i];
      }
    }
    return out;
  };

  it("toute requête groupée par DATE porte un LIMIT explicite", () => {
    const offenders: string[] = [];
    for (const [key, sql] of Object.entries(queries)) {
      const outer = outerOf(sql);
      const groupedByDate =
        /GROUP BY/i.test(outer) && /toStartOf(Day|Week|Month)/i.test(outer);
      if (groupedByDate && !/\bLIMIT\b/i.test(outer)) offenders.push(key);
    }
    expect(
      offenders,
      `Séries temporelles sans LIMIT : ${offenders.join(", ")}. PostHog tronque ` +
        `SILENCIEUSEMENT à 100 lignes et l'ORDER BY est ascendant : ce sont les ` +
        `jours RÉCENTS qui disparaissent. Ajoute un LIMIT explicite.`,
    ).toEqual([]);
  });

  it("le LIMIT couvre largement la fenêtre (pas un 100 déguisé)", () => {
    for (const [key, sql] of Object.entries(queries)) {
      const outer = outerOf(sql);
      if (!/GROUP BY/i.test(outer) || !/toStartOf(Day|Week|Month)/i.test(outer))
        continue;
      const m = outer.match(/\bLIMIT\s+(\d+)/i);
      expect(m, `${key} : LIMIT introuvable`).not.toBeNull();
      expect(
        Number(m![1]),
        `${key} : LIMIT ${m![1]} — trop bas pour une série qui grandit chaque jour`,
      ).toBeGreaterThanOrEqual(1000);
    }
  });
});
