import { describe, it, expect } from "vitest";
import { CONTRACT_PROPERTIES } from "../convex/analyticsContract";
import { INSTRUMENTATION_PROP_PROBES, buildQueries } from "../convex/posthogSync";

/**
 * SONDES D'INSTRUMENTATION — la carte Fiabilité lit le résultat PAR INDEX
 * (`shapeInstrumentation` : `cellNum(r, base + i)`). Une sonde ajoutée ailleurs
 * qu'à la fin, ou une colonne qui ne suit pas l'ordre des sondes, décale
 * SILENCIEUSEMENT toutes les valeurs suivantes : chaque propriété afficherait
 * le compte d'une autre. Rien à l'écran ne le signalerait.
 *
 * Ces tests tiennent l'invariant qui rend l'ajout de sondes sûr.
 */
describe("sondes d'instrumentation", () => {
  const queries = buildQueries("", "") as Record<string, string>;

  it("la colonne p_i porte la condition de la sonde i", () => {
    // ⚠️ Une version précédente de ce test comparait les INDEX des colonnes à
    // [0..n-1]. Elle restait VERTE en inversant l'ordre des sondes : l'index de
    // l'alias vient du `.map`, il vaut 0..n-1 quoi qu'il arrive. Tautologie.
    // Ce qui doit être tenu, c'est la CORRESPONDANCE — `shapeInstrumentation`
    // lit `cellNum(r, base + i)` et attribue le compte à la sonde i.
    INSTRUMENTATION_PROP_PROBES.forEach((p, i) => {
      expect(
        queries.instrumentation,
        `la colonne p_${i} ne porte pas la condition de « ${p.key} »`,
      ).toContain(`countIf(${p.cond}) AS p_${i}`);
    });
  });

  it("chaque sonde teste une PRÉSENCE, jamais une chaîne vide", () => {
    // `toString(NULL)` rend 'null' (non vide) : une propriété ABSENTE passerait
    // pour présente. Faux positif déjà vécu en prod sur `app_version`.
    for (const p of INSTRUMENTATION_PROP_PROBES) {
      expect(p.cond, `${p.key} : sonde sans isNotNull`).toContain("isNotNull");
    }
  });

  it("une sonde sur un event nommé filtre bien cet event", () => {
    for (const p of INSTRUMENTATION_PROP_PROBES) {
      if (p.onEvent === "*") continue;
      expect(p.cond, `${p.key} : ne filtre pas sur ${p.onEvent}`).toContain(
        `event = '${p.onEvent}'`,
      );
    }
  });

  it("un nom préfixé par $ passe par les crochets, jamais par le point", () => {
    // `properties.$geoip_country_name` est ambigu en HogQL ; le gabarit par
    // défaut produirait exactement cette forme, d'où le `cond` explicite.
    for (const p of CONTRACT_PROPERTIES) {
      if (!p.name.startsWith("$")) continue;
      expect(p.cond, `${p.name} : nom en $ sans cond explicite`).toBeDefined();
      expect(p.cond).toContain("['");
    }
  });

  it("les sondes géo couvrent les quatre rôles attendus", () => {
    // Assertion par RÔLE et non par compte : figer « exactement 3 » cassait au
    // premier ajout sans rien prouver de plus. Chaque rôle répond à une question
    // distincte, et c'est ça qui doit tenir.
    const geo = CONTRACT_PROPERTIES.filter((p) => p.name.includes("geoip"));
    const par = (f: (c: string) => boolean) => geo.filter((p) => f(p.cond ?? ""));

    // 1. le pays est-il sur les EVENTS ?
    expect(par((c) => c === "isNotNull(properties['$geoip_country_name'])")).toHaveLength(1);
    // 2. tient-il jusqu'en bas du funnel ?
    expect(par((c) => c.includes("event = 'subscription_completed'"))).toHaveLength(1);
    // 3. n'est-il QUE sur la personne ? (le piège de `source` et `language`)
    expect(par((c) => c.includes("person.properties"))).toHaveLength(1);
    // 4. le CODE ISO est-il peuplé ? (il décide de la langue d'affichage)
    expect(par((c) => c.includes("$geoip_country_code"))).toHaveLength(1);

    // Aucune sonde d'event ne doit lire la personne, et inversement.
    for (const p of geo) {
      const surPersonne = (p.cond ?? "").includes("person.properties");
      const surEvent = /properties\['\$geoip/.test((p.cond ?? "").replace("person.properties", ""));
      expect(surPersonne && surEvent).toBe(false);
    }
  });

  it("les noms de sonde sont uniques — deux puces identiques seraient illisibles", () => {
    const names = CONTRACT_PROPERTIES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
