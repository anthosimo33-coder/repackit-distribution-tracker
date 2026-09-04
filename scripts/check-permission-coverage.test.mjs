import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  diffAgainstBaseline,
  diffCatalogues,
  findLegacyAdminFunctions,
  parseCatalogueFromDoc,
  parseCatalogueFromModule,
  scanConvexDir,
} from "./check-permission-coverage.mjs";

/**
 * Une garde qui ne sait pas dire NON ne garde rien. Chaque cas décrit d'abord ce
 * qui doit ÉCHOUER, puis ce qui doit passer.
 */
describe("couverture — détection des fonctions sans bloc", () => {
  it("repère une fonction encore gardée par adminQuery", () => {
    const src = `
      export const listThings = adminQuery({ args: {}, handler: async () => [] });
    `;
    expect(findLegacyAdminFunctions("t.ts", src).map((h) => h.key)).toEqual([
      "t.ts::listThings",
    ]);
  });

  it("repère aussi adminMutation", () => {
    const src = `export const setThing = adminMutation({ handler: async () => {} });`;
    expect(findLegacyAdminFunctions("t.ts", src)).toHaveLength(1);
  });

  it("IGNORE une fonction qui a déclaré son bloc", () => {
    // C'est la forme d'arrivée : elle ne doit plus jamais être signalée.
    const src = `
      export const listThings = permissionQuery("creators.read")({
        args: {}, handler: async () => [],
      });
    `;
    expect(findLegacyAdminFunctions("t.ts", src)).toEqual([]);
  });

  it("ignore les autres wrappers (portail, e2e, interne)", () => {
    const src = `
      export const a = creatorQuery({ handler: async () => {} });
      export const b = e2eMutation({ handler: async () => {} });
      export const c = internalMutation({ handler: async () => {} });
      export const d = adminViewAsQuery({ handler: async () => {} });
    `;
    expect(findLegacyAdminFunctions("t.ts", src)).toEqual([]);
  });
});

describe("couverture — le cliquet", () => {
  const baseline = ["a.ts::q"];

  it("échoue sur une fonction ABSENTE du baseline (nouvelle, sans bloc)", () => {
    const { added, stale } = diffAgainstBaseline(
      [{ key: "a.ts::q" }, { key: "b.ts::r" }],
      baseline,
    );
    expect(added.map((a) => a.key)).toEqual(["b.ts::r"]);
    expect(stale).toEqual([]);
  });

  it("échoue sur une entrée de baseline qui a disparu (migrée : à retirer)", () => {
    const { added, stale } = diffAgainstBaseline([], baseline);
    expect(added).toEqual([]);
    expect(stale).toEqual(["a.ts::q"]);
  });

  it("passe quand le relevé est exactement le baseline", () => {
    const { added, stale } = diffAgainstBaseline([{ key: "a.ts::q" }], baseline);
    expect(added).toEqual([]);
    expect(stale).toEqual([]);
  });
});

describe("alignement catalogue ↔ document", () => {
  const mod = [
    { id: "a.b", section: "Argent", label: "Paiements", defaultForManager: false },
  ];

  it("échoue si le document OUBLIE un bloc", () => {
    expect(diffCatalogues(mod, [])).toEqual([
      "`a.b` est dans le module mais ABSENT du document.",
    ]);
  });

  it("échoue si le document INVENTE un bloc", () => {
    const doc = [
      ...mod,
      { id: "z.z", section: "Système", label: "X", defaultForManager: true },
    ];
    expect(diffCatalogues(mod, doc)).toEqual([
      "`z.z` est dans le document mais ABSENT du module.",
    ]);
  });

  it("échoue si le DÉFAUT diverge — le cas qui trompe vraiment quelqu'un", () => {
    // Un document qui montre « décoché » sur un bloc coché dans le code fait
    // cocher une case en croyant faire autre chose. C'est la raison d'être du
    // contrôle B.
    const doc = [{ ...mod[0], defaultForManager: true }];
    expect(diffCatalogues(mod, doc)).toEqual([
      "`a.b` — defaultForManager : module « false » ≠ document « true ».",
    ]);
  });

  it("échoue si le LIBELLÉ ou la SECTION divergent", () => {
    expect(diffCatalogues(mod, [{ ...mod[0], label: "Autre" }])).toHaveLength(1);
    expect(diffCatalogues(mod, [{ ...mod[0], section: "Contenu" }])).toHaveLength(1);
  });

  it("passe quand les deux coïncident", () => {
    expect(diffCatalogues(mod, [...mod])).toEqual([]);
  });
});

describe("sur le vrai dépôt", () => {
  /**
   * LE CLIQUET, exécuté par `pnpm test:unit` — donc par la CI. Le script est
   * aussi branché sur `pnpm lint`, mais le job `test` ne lance pas `lint` : sans
   * ce test, le cliquet ne tiendrait qu'en local.
   */
  it("relève exactement le baseline — ni fonction nouvelle, ni entrée périmée", () => {
    const baseline = JSON.parse(
      readFileSync(
        new URL("./permission-coverage-baseline.json", import.meta.url),
        "utf8",
      ),
    );
    const { added, stale } = diffAgainstBaseline(scanConvexDir(), baseline);
    expect(
      added.map((a) => `${a.file}:${a.line}  ${a.key}`),
      "fonction(s) d'administration sans bloc de permission — utilise permissionQuery(\"bloc\")",
    ).toEqual([]);
    expect(
      stale,
      "entrée(s) de permission-coverage-baseline.json qui ne correspondent plus à rien — retire-les",
    ).toEqual([]);
  });

  it("le baseline décroît à mesure que les blocs sont migrés", () => {
    // Ce test dit l'intention du lot. Il devra être mis à jour à l'étape 4 —
    // et c'est voulu : le nombre baisse par décision, pas par dérive.
    const baseline = JSON.parse(
      readFileSync(
        new URL("./permission-coverage-baseline.json", import.meta.url),
        "utf8",
      ),
    );
    expect(baseline).toHaveLength(46);
  });

  it("le catalogue du module et celui du document coïncident", () => {
    const fromModule = parseCatalogueFromModule(
      readFileSync(new URL("../convex/permissions.ts", import.meta.url), "utf8"),
    );
    const fromDoc = parseCatalogueFromDoc(
      readFileSync(
        new URL("../docs/CATALOGUE-PERMISSIONS.md", import.meta.url),
        "utf8",
      ),
    );
    // Contrôle de PRÉSENCE d'abord : un parseur cassé rendrait deux listes vides,
    // donc un diff vide, donc un test vert pour la pire des raisons.
    expect(fromModule).toHaveLength(21);
    expect(fromDoc).toHaveLength(21);
    expect(diffCatalogues(fromModule, fromDoc)).toEqual([]);
  });
});
