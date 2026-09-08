import { describe, expect, it } from "vitest";
import {
  TTL_EN_COURS_MS,
  TTL_PASSE_MS,
  windowCacheKey,
  windowCacheTtlMs,
} from "../convex/windowCacheTtl";

/**
 * Le piège n'est PAS la règle (« plage passée = 24 h, plage en cours = 1 h »),
 * c'est le FUSEAU dans lequel « aujourd'hui » se décide. Le sélecteur de période
 * rend des jours PARISIENS ; le runtime Convex tourne en UTC. Entre 22 h et
 * minuit à Paris, UTC est encore la veille : une comparaison faite en UTC
 * classerait la plage du jour comme « passée » et la figerait 24 h alors qu'elle
 * est en train de se remplir.
 *
 * Les instants ci-dessous sont donc écrits en UTC explicite, et choisis
 * exactement là où les deux fuseaux divergent.
 */
const utc = (iso: string) => new Date(iso).getTime();

describe("windowCacheTtlMs", () => {
  it("une plage entièrement passée est figée 24 h", () => {
    // 8 septembre à Paris comme à UTC ; la plage s'arrête le 5.
    expect(windowCacheTtlMs("2026-09-05", utc("2026-09-08T09:00:00Z"))).toBe(
      TTL_PASSE_MS,
    );
  });

  it("une plage qui finit AUJOURD'HUI suit la cadence horaire", () => {
    expect(windowCacheTtlMs("2026-09-08", utc("2026-09-08T09:00:00Z"))).toBe(
      TTL_EN_COURS_MS,
    );
  });

  it("une plage qui déborde dans le futur suit aussi la cadence horaire", () => {
    expect(windowCacheTtlMs("2026-09-30", utc("2026-09-08T09:00:00Z"))).toBe(
      TTL_EN_COURS_MS,
    );
  });

  it("LE SOIR À PARIS, le jour courant reste le jour PARISIEN", () => {
    // 8 septembre 22:30 à Paris = 20:30 UTC (heure d'été, +2 h). Les deux
    // fuseaux sont d'accord ici : on est le 8 des deux côtés.
    expect(windowCacheTtlMs("2026-09-08", utc("2026-09-08T20:30:00Z"))).toBe(
      TTL_EN_COURS_MS,
    );
    // 9 septembre 00:30 à Paris = 8 septembre 22:30 UTC. C'est LE cas qui
    // sépare les deux lectures : à Paris on est le 9, à UTC encore le 8. Une
    // plage qui s'arrête le 8 est donc PASSÉE — une comparaison faite en UTC
    // la croirait encore en cours et la recalculerait toutes les heures pour
    // rien.
    expect(windowCacheTtlMs("2026-09-08", utc("2026-09-08T22:30:00Z"))).toBe(
      TTL_PASSE_MS,
    );
    // Et la plage du 9, à ce même instant, est bien EN COURS.
    expect(windowCacheTtlMs("2026-09-09", utc("2026-09-08T22:30:00Z"))).toBe(
      TTL_EN_COURS_MS,
    );
  });

  it("en heure d'HIVER, la bascule tombe à 23 h UTC et pas à 22 h", () => {
    // Paris est à +1 h en janvier. Le 8 janvier 22:30 UTC = 23:30 à Paris,
    // encore le 8 : une plage qui s'arrête le 8 est donc toujours EN COURS.
    expect(windowCacheTtlMs("2026-01-08", utc("2026-01-08T22:30:00Z"))).toBe(
      TTL_EN_COURS_MS,
    );
    // Une demi-heure plus tard, Paris est le 9 : la plage du 8 est passée.
    expect(windowCacheTtlMs("2026-01-08", utc("2026-01-08T23:30:00Z"))).toBe(
      TTL_PASSE_MS,
    );
  });
});

describe("windowCacheKey", () => {
  it("distingue deux plages qui ne partagent qu'une borne", () => {
    expect(windowCacheKey("2026-09-01", "2026-09-08")).toBe(
      "2026-09-01|2026-09-08",
    );
    expect(windowCacheKey("2026-09-01", "2026-09-08")).not.toBe(
      windowCacheKey("2026-09-01", "2026-09-09"),
    );
    expect(windowCacheKey("2026-09-01", "2026-09-08")).not.toBe(
      windowCacheKey("2026-09-02", "2026-09-08"),
    );
  });
});
