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

  it("les trois sondes géo séparent event, bas de funnel et personne", () => {
    const geo = CONTRACT_PROPERTIES.filter((p) => p.name.includes("geoip"));
    expect(geo).toHaveLength(3);
    const [evt, bas, pers] = geo;
    expect(evt.cond).toBe("isNotNull(properties['$geoip_country_name'])");
    expect(bas.cond).toContain("event = 'subscription_completed'");
    // LA distinction qui décide si un segment est exploitable ici.
    expect(pers.cond).toContain("person.properties");
    expect(evt.cond).not.toContain("person.properties");
  });

  it("les noms de sonde sont uniques — deux puces identiques seraient illisibles", () => {
    const names = CONTRACT_PROPERTIES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
