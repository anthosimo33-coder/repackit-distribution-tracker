import { describe, it, expect } from "vitest";
import {
  refusDeMarche,
  partitionMarches,
  NOM_MAX,
  type MarcheCompose,
} from "./market-groups";

/**
 * Les marchés composés : ce qu'on accepte, et ce qu'on refuse.
 *
 * Les jeux ont la forme de la prod : des ids Convex (« kd7… »), des codes ISO
 * réels, et le cas qui a motivé la fonctionnalité — la Serbie et la Croatie
 * lues ensemble.
 */

const BALKANS: MarcheCompose = { id: "kd71", nom: "Balkans", pays: ["RS", "HR"] };
const FRANCO: MarcheCompose = { id: "kd72", nom: "Francophonie", pays: ["FR", "BE"] };

describe("refusDeMarche — la partition tient, ou rien ne tient", () => {
  it("accepte un marché neuf sur des pays libres", () => {
    expect(refusDeMarche({ nom: "Balkans", pays: ["RS", "HR"] }, [])).toBeNull();
  });

  it("refuse un pays déjà pris, et DIT par quel marché", () => {
    const r = refusDeMarche({ nom: "Europe de l'Est", pays: ["RS", "PL"] }, [BALKANS]);
    expect(r?.code).toBe("pays-deja-pris");
    // Sans le nom du marché qui le détient, la personne doit chercher elle-même
    // lequel des sept c'était.
    expect(r && "marche" in r && r.marche).toBe("Balkans");
    expect(r && "pays" in r && r.pays).toEqual(["RS"]);
  });

  it("un marché qu'on ÉDITE ne se fait pas concurrence à lui-même", () => {
    // Rejouer « Balkans » avec ses propres pays, plus un : recevable.
    expect(
      refusDeMarche({ nom: "Balkans élargis", pays: ["RS", "HR", "SI"] }, [BALKANS], "kd71"),
    ).toBeNull();
    // Contre-épreuve de PRÉSENCE : sans l'id d'édition, le même appel est refusé.
    expect(
      refusDeMarche({ nom: "Balkans élargis", pays: ["RS", "HR", "SI"] }, [BALKANS])?.code,
    ).toBe("pays-deja-pris");
  });

  it("refuse un nom vide ou fait d'espaces", () => {
    expect(refusDeMarche({ nom: "", pays: ["RS"] }, [])?.code).toBe("nom-vide");
    expect(refusDeMarche({ nom: "   ", pays: ["RS"] }, [])?.code).toBe("nom-vide");
  });

  it("refuse un nom trop long, et accepte celui qui tient tout juste", () => {
    expect(refusDeMarche({ nom: "x".repeat(NOM_MAX + 1), pays: ["RS"] }, [])?.code)
      .toBe("nom-trop-long");
    // La borne est INCLUSIVE : sans cette moitié, un test verrait passer un
    // refus à `NOM_MAX` comme un succès.
    expect(refusDeMarche({ nom: "x".repeat(NOM_MAX), pays: ["RS"] }, [])).toBeNull();
  });

  it("refuse un marché sans pays, et un pays choisi deux fois", () => {
    expect(refusDeMarche({ nom: "Vide", pays: [] }, [])?.code).toBe("aucun-pays");
    expect(refusDeMarche({ nom: "Double", pays: ["RS", "RS"] }, [])?.code)
      .toBe("pays-en-double");
  });

  it("deux marchés disjoints coexistent", () => {
    expect(refusDeMarche({ nom: "Balkans", pays: ["RS", "HR"] }, [FRANCO])).toBeNull();
  });
});

describe("partitionMarches — les composés, puis les pays restants", () => {
  const CONNUS = ["FR", "BE", "CH", "RS", "HR", "MA"];

  it("range les pays d'un marché ensemble, et laisse les autres seuls", () => {
    const p = partitionMarches(CONNUS, [BALKANS]);
    expect(p[0]).toEqual({ key: "g:kd71", label: "Balkans", pays: ["RS", "HR"], composed: true });
    // Les quatre autres restent des marchés d'un pays, dans l'ordre d'arrivée.
    expect(p.slice(1).map((x) => x.key)).toEqual(["FR", "BE", "CH", "MA"]);
    expect(p.slice(1).every((x) => x.composed === false)).toBe(true);
  });

  it("chaque pays n'apparaît QU'UNE fois dans la partition", () => {
    const p = partitionMarches(CONNUS, [BALKANS, FRANCO]);
    const tous = p.flatMap((x) => x.pays);
    // C'est la propriété qui rend la ligne « tous marchés » vraie : un pays
    // compté deux fois doublerait son coût dans le total.
    expect(tous.length).toBe(new Set(tous).size);
    expect([...tous].sort()).toEqual([...CONNUS].sort());
  });

  it("un marché qui référence un pays disparu rend ce qu'il RESTE", () => {
    // « SI » n'a plus aucun paiement : le marché ne doit ni disparaître ni
    // porter une ligne fantôme.
    const p = partitionMarches(CONNUS, [{ id: "kd73", nom: "Balkans", pays: ["RS", "SI"] }]);
    expect(p[0].pays).toEqual(["RS"]);
    expect(p[0].composed).toBe(true);
  });

  it("un marché dont TOUS les pays ont disparu reste, mais vide", () => {
    // Le garder visible est délibéré : il est modifiable, donc réparable. Le
    // faire disparaître laisserait quelqu'un chercher un marché qu'il a créé.
    const p = partitionMarches(["FR"], [{ id: "kd74", nom: "Asie", pays: ["JP", "KR"] }]);
    expect(p[0]).toEqual({ key: "g:kd74", label: "Asie", pays: [], composed: true });
    expect(p[1].key).toBe("FR");
  });

  it("sans aucun marché composé, chaque pays est son propre marché", () => {
    const p = partitionMarches(CONNUS, []);
    expect(p.map((x) => x.key)).toEqual(CONNUS);
    expect(p.every((x) => x.composed === false)).toBe(true);
  });
});
