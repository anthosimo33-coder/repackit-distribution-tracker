import { describe, expect, it } from "vitest";
import {
  AB_LOOKUP_LIMIT,
  buildQueries,
  DEFAULT_WINDOW,
  shapeAbFlippers,
  shapeAbPersonArms,
} from "../convex/posthogSync";
import { hogWindowClause } from "./hog-window";

/**
 * TABLE DE REPLI `distinct_id → bras` (revenu ↔ bras quand l'abonnement Whop
 * n'a pas de metadata ; contrôle de divergence sinon).
 *
 * Défaut du 24/10/2026 : elle listait TOUS les distinct_id des personnes au
 * bras stable (~26 000 sur le test pass) et s'arrêtait à `LIMIT 10000` sans le
 * dire — 788 Ko de cache, 31 abonnements sans bras, 218 hors du contrôle de
 * divergence. Restreinte aux distinct_id qui ont ouvert un checkout ou porté un
 * abonnement : 1 188 lignes (107 Ko), 487 abonnements sur 487 couverts.
 */
const NC = "\n  AND NOT (toString(person.properties.is_internal) = 'true')";
const base = buildQueries(NC, "''");
const DID = (i: number) => `https://site.snytch.co|k17${i.toString(36).padStart(29, "0")}`;

describe("requête abPersonArms", () => {
  const sql = base.abPersonArms;

  it("ne garde que les distinct_id d'un checkout ou d'un abonnement depuis le début du test", () => {
    expect(sql).toContain(
      "groupUniqArrayIf(toString(distinct_id),\n      event IN ('checkout_started', 'subscription_completed') AND timestamp >= ab_start) AS dids",
    );
    expect(sql).toContain("HAVING n_bras = 1 AND length(dids) > 0");
  });

  it("lit le bras au niveau de la PERSONNE, puis le pose sur chacun de ses distinct_id", () => {
    // Par distinct_id, la copie serveur de subscription_completed (sans
    // experiment_variant) n'avait pas de bras.
    expect(sql).toContain("GROUP BY person_id");
    expect(sql).not.toContain("GROUP BY distinct_id");
    expect(sql).toContain("ARRAY JOIN dids AS did");
  });

  it("écarte les flippers (leur revenu suit abFlippers) et balaie 90 jours, même en fenêtre libre", () => {
    expect(sql).toContain("n_bras = 1");
    expect(sql).toContain(`WHERE ${DEFAULT_WINDOW}${NC}`);
    const W = hogWindowClause("2026-10-10", "2026-10-16")!;
    const WSUB = hogWindowClause("2026-10-10", "2026-10-16", "t_first_sub")!;
    expect(buildQueries(NC, "''", W, WSUB).abPersonArms).toBe(sql);
  });

  it("les deux tables de rattachement portent la MÊME borne, celle que les formes comparent", () => {
    expect(sql).toContain(`LIMIT ${AB_LOOKUP_LIMIT}`);
    expect(base.abFlippers).toContain(`LIMIT ${AB_LOOKUP_LIMIT}`);
  });
});

describe("shapeAbPersonArms / shapeAbFlippers — la borne atteinte se DIT", () => {
  it("signale une table pleine : des lignes manquent forcément", () => {
    const pleine = Array.from({ length: AB_LOOKUP_LIMIT }, (_, i) => [DID(i), i % 2 ? "hard" : "pass"]);
    const r = shapeAbPersonArms(pleine);
    expect(r.truncated).toBe(true);
    expect(r.rows).toHaveLength(AB_LOOKUP_LIMIT);
  });

  it("PRÉSENCE du cas sain : sous la borne, rien n'est signalé", () => {
    const r = shapeAbPersonArms([
      [DID(1), "hard"],
      [DID(2), "pass"],
    ]);
    expect(r).toEqual({
      rows: [
        { distinctId: DID(1), variant: "hard" },
        { distinctId: DID(2), variant: "pass" },
      ],
      truncated: false,
    });
  });

  it("une cellule vide n'est pas une ligne (mais compte pour la borne : la requête l'a rendue)", () => {
    const r = shapeAbPersonArms([[DID(1), ""], [null, "hard"], [DID(3), "pass"]]);
    expect(r.rows).toEqual([{ distinctId: DID(3), variant: "pass" }]);
  });

  it("abFlippers signale aussi sa borne", () => {
    const personne = [[DID(1)], ["hard"], ["pass"]];
    expect(shapeAbFlippers([personne]).truncated).toBe(false);
    expect(shapeAbFlippers(Array.from({ length: AB_LOOKUP_LIMIT }, () => personne)).truncated).toBe(true);
  });
});
