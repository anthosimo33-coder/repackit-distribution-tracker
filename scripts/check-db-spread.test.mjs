import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  QUERY_WRAPPERS,
  diffAgainstBaseline,
  findDbSpreads,
  scanConvexDir,
} from "./check-db-spread.mjs";

/**
 * Une garde qui ne sait pas dire NON ne garde rien. Chaque cas ci-dessous
 * décrit d'abord ce qui doit ÉCHOUER, puis ce qui doit passer — la garde i18n a
 * appris au dépôt qu'un détecteur peut être vert et menteur.
 */
describe("check-db-spread — ce qui doit échouer", () => {
  it("signale un spread de document dans le retour d'une query", () => {
    const src = `
      export const listThings = adminQuery({
        args: {},
        handler: async (ctx) => {
          const rows = await ctx.db.query("things").collect();
          return rows.map((t) => ({ ...t, extra: 1 }));
        },
      });
    `;
    const hits = findDbSpreads("things.ts", src);
    expect(hits.map((h) => h.key)).toEqual(["things.ts::listThings::...t"]);
  });

  it("signale aussi un spread d'accès à une propriété", () => {
    const src = `
      export const getThing = adminQuery({
        args: {},
        handler: async (ctx) => ({ ...row.data, ok: true }),
      });
    `;
    expect(findDbSpreads("t.ts", src).map((h) => h.key)).toEqual([
      "t.ts::getThing::...row.data",
    ]);
  });

  it("compte DEUX fuites quand le même spread apparaît deux fois", () => {
    const src = `
      export const q = adminQuery({
        handler: async () => ({ a: { ...d }, b: { ...d } }),
      });
    `;
    expect(findDbSpreads("t.ts", src)).toHaveLength(2);
  });

  it("couvre chaque wrapper de query, pas seulement adminQuery", () => {
    for (const wrapper of QUERY_WRAPPERS) {
      const src = `export const q = ${wrapper}({ handler: async () => ({ ...doc }) });`;
      expect(findDbSpreads("t.ts", src), wrapper).toHaveLength(1);
    }
  });
});

describe("check-db-spread — ce qui doit passer", () => {
  it("SUIT une fonction migrée vers un bloc — forme curryfiée", () => {
    // Le piège qui a mordu pendant la migration : `permissionQuery("bloc")({…})`
    // est un appel d'appel. Avec une détection qui n'attend qu'un identifiant,
    // chaque fonction migrée SORTAIT du champ de cette garde — et son entrée de
    // baseline devenait « périmée », ce qui ressemble à un progrès.
    const src = `
      export const listThings = permissionQuery("library.manage")({
        args: {},
        handler: async (ctx) => rows.map((t) => ({ ...t })),
      });
    `;
    expect(findDbSpreads("t.ts", src).map((h) => h.key)).toEqual([
      "t.ts::listThings::...t",
    ]);
  });
});

describe("check-db-spread — ce qui doit passer", () => {
  it("ignore une mutation : elle spread dans des arguments de db.patch, pas dans une réponse", () => {
    const src = `
      export const setThing = adminMutation({
        handler: async (ctx) => {
          await ctx.db.patch(id, { ...doc, x: 1 });
        },
      });
    `;
    expect(findDbSpreads("t.ts", src)).toEqual([]);
  });

  it("ignore l'idiome du champ conditionnel `...(cond ? { x } : {})`", () => {
    const src = `
      export const q = adminQuery({
        handler: async () => ({ a: 1, ...(cond ? { b: 2 } : {}) }),
      });
    `;
    expect(findDbSpreads("t.ts", src)).toEqual([]);
  });

  it("ignore une projection explicite — la forme qu'on veut voir", () => {
    const src = `
      export const q = adminQuery({
        handler: async () => ({ _id: d._id, name: d.name }),
      });
    `;
    expect(findDbSpreads("t.ts", src)).toEqual([]);
  });
});

describe("check-db-spread — le cliquet", () => {
  const baseline = ["a.ts::q::...doc"];

  it("échoue sur un spread ABSENT du baseline (régression)", () => {
    const { added, stale } = diffAgainstBaseline(
      [{ key: "a.ts::q::...doc" }, { key: "b.ts::r::...row" }],
      baseline,
    );
    expect(added.map((a) => a.key)).toEqual(["b.ts::r::...row"]);
    expect(stale).toEqual([]);
  });

  it("échoue sur une entrée de baseline qui a disparu (baseline périmé)", () => {
    const { added, stale } = diffAgainstBaseline([], baseline);
    expect(added).toEqual([]);
    expect(stale).toEqual(["a.ts::q::...doc"]);
  });

  it("passe quand le relevé est exactement le baseline", () => {
    const { added, stale } = diffAgainstBaseline(
      [{ key: "a.ts::q::...doc" }],
      baseline,
    );
    expect(added).toEqual([]);
    expect(stale).toEqual([]);
  });
});

describe("check-db-spread — sur le vrai dépôt", () => {
  /**
   * LE CLIQUET, exécuté par `pnpm test:unit` — donc par la CI.
   *
   * La garde est aussi branchée sur `pnpm lint`, mais le job `test` ne lance pas
   * `lint` : sans ce test, le cliquet ne tiendrait qu'en local et une PR pourrait
   * réintroduire une fuite sans que rien ne s'y oppose.
   */
  it("relève exactement le baseline — ni spread nouveau, ni entrée périmée", () => {
    const baseline = JSON.parse(
      readFileSync(
        new URL("./db-spread-baseline.json", import.meta.url),
        "utf8",
      ),
    );
    const { added, stale } = diffAgainstBaseline(scanConvexDir(), baseline);
    expect(
      added.map((a) => `${a.file}:${a.line}  ${a.key}`),
      "spread(s) de document ajouté(s) dans le retour d'une query — écris la liste des champs",
    ).toEqual([]);
    expect(
      stale,
      "entrée(s) de db-spread-baseline.json qui ne correspondent plus à rien — retire-les",
    ).toEqual([]);
  });

  it("ne voit PLUS de spread dans listCreators ni listAssignments", () => {
    const keys = scanConvexDir().map((h) => h.key);
    // Les deux fuites colmatées (AUDIT_ROLE_MANAGER.md, F3/F4). Si l'une revient,
    // elle sera absente du baseline → la garde échoue. Ce test dit POURQUOI.
    expect(keys).not.toContain("creators.ts::listCreators::...c");
    expect(keys).not.toContain("assignments.ts::listAssignments::...a");
    // Contrôle de PRÉSENCE : le scanner voit bien quelque chose par ailleurs —
    // sans lui, un scanner cassé rendrait ce test vert pour la mauvaise raison.
    expect(keys).toContain("comptes.ts::listComptes::...c");
  });
});
