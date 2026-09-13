import { describe, expect, it } from "vitest";
import {
  SCOPE_ALL_TRACE,
  creatorIdOfScopeTrace,
  creatorScopeFrom,
  filterByCreatorScope,
  isInCreatorScope,
  scopeTrace,
} from "../convex/creatorScope";

/**
 * Le périmètre d'un manager. Le piège qui compte est la différence entre
 * « absent » (toutes) et « vide » (aucune) : les confondre ouvre le projet entier
 * à quelqu'un qu'on vient de restreindre.
 */
describe("creatorScopeFrom", () => {
  it("absent ou null ⇒ toutes (null)", () => {
    expect(creatorScopeFrom(undefined)).toBeNull();
    expect(creatorScopeFrom(null)).toBeNull();
  });

  it("liste VIDE ⇒ aucune, jamais toutes", () => {
    const scope = creatorScopeFrom([]);
    expect(scope).not.toBeNull();
    expect(isInCreatorScope(scope, "k57abc")).toBe(false);
  });
});

describe("isInCreatorScope", () => {
  // Ids à la forme de la prod (32 caractères base32), pas « a »/« b ».
  const kelly = "k5790t3q6e2mfz1dx8bkyvsw9n7h4a2c";
  const ines = "k57fq2wm0c8vj3tpd1rehxz6ynb45s9g";

  it("sans restriction, tout passe — y compris un objet sans créatrice", () => {
    expect(isInCreatorScope(null, kelly)).toBe(true);
    expect(isInCreatorScope(null, undefined)).toBe(true);
  });

  it("restreint : sa créatrice passe, la voisine non", () => {
    const scope = creatorScopeFrom([kelly]);
    expect(isInCreatorScope(scope, kelly)).toBe(true);
    expect(isInCreatorScope(scope, ines)).toBe(false);
  });

  it("restreint : un objet SANS créatrice (compte interne) est refusé", () => {
    const scope = creatorScopeFrom([kelly]);
    expect(isInCreatorScope(scope, undefined)).toBe(false);
    expect(isInCreatorScope(scope, null)).toBe(false);
  });

  it("filterByCreatorScope garde les siennes, et tout quand rien n'est restreint", () => {
    const rows = [
      { handle: "@kelly.fr", creatorId: kelly },
      { handle: "@ines_rs", creatorId: ines },
      { handle: "@repackit.team", creatorId: undefined },
    ];
    expect(
      filterByCreatorScope(rows, (r) => r.creatorId, creatorScopeFrom([kelly])).map(
        (r) => r.handle,
      ),
    ).toEqual(["@kelly.fr"]);
    expect(filterByCreatorScope(rows, (r) => r.creatorId, null)).toHaveLength(3);
  });
});

describe("scopeTrace — la forme de journal", () => {
  it("« toutes » est une ligne à elle seule, une liste vide n'en écrit aucune", () => {
    expect(scopeTrace(undefined)).toEqual([SCOPE_ALL_TRACE]);
    expect(scopeTrace([])).toEqual([]);
  });

  it("chaque créatrice se relit par son id", () => {
    const [ligne] = scopeTrace(["k5790t3q6e2mfz1dx8bkyvsw9n7h4a2c"]);
    expect(creatorIdOfScopeTrace(ligne)).toBe("k5790t3q6e2mfz1dx8bkyvsw9n7h4a2c");
    expect(creatorIdOfScopeTrace(SCOPE_ALL_TRACE)).toBeNull();
    // Un bloc du catalogue n'est pas une ligne de périmètre.
    expect(creatorIdOfScopeTrace("creators.read")).toBeNull();
  });
});
