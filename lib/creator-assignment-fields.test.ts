import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CREATOR_ASSIGNMENT_FIELDS,
  NON_CREATOR_ASSIGNMENT_FIELDS,
  pickCreatorAssignment,
} from "../convex/creatorAssignmentFields";

/**
 * Champs top-level de la table `assignments` lus DEPUIS LE SCHÉMA (source de
 * vérité, pas une liste figée). Le test de couverture casse donc dès qu'un
 * nouveau champ apparaît sans être classé → décision consciente forcée.
 */
function assignmentSchemaFields(): string[] {
  const src = readFileSync(
    new URL("../convex/schema.ts", import.meta.url),
    "utf8",
  ).split("\n");
  const start = src.findIndex((l) =>
    l.startsWith("  assignments: defineTable("),
  );
  expect(start).toBeGreaterThan(-1);
  const fields: string[] = [];
  for (let i = start + 1; i < src.length; i++) {
    if (/^    \.index\(/.test(src[i])) break; // fin du corps de table
    const m = src[i].match(/^    ([a-zA-Z_]+): v\./);
    if (m) fields.push(m[1]);
  }
  return [...new Set(fields)];
}

describe("creatorAssignmentFields — allowlist anti-fuite créatrice", () => {
  it("pickCreatorAssignment ne garde QUE les champs de l'allowlist", () => {
    const picked = pickCreatorAssignment({
      status: "published",
      dueDate: 1,
      // interdits (admin / interne) :
      publishedBy: "admin",
      replayVerbatim: true,
      comboImposed: true,
      replayedFrom: "x",
      scriptCombo: { foo: 1 },
      adminFeedback: "note interne",
      lastNudgeAt: 123,
      // champ FUTUR non classé → doit être invisible par défaut :
      champInconnu: "fuite ?",
    });
    for (const k of Object.keys(picked)) {
      expect(CREATOR_ASSIGNMENT_FIELDS).toContain(k);
    }
    expect(picked).toEqual({ status: "published", dueDate: 1 });
  });

  it("comboImposed/replayedFrom/replayVerbatim/publishedBy NE sont PAS exposés", () => {
    for (const f of [
      "comboImposed",
      "replayedFrom",
      "replayVerbatim",
      "publishedBy",
    ]) {
      expect(CREATOR_ASSIGNMENT_FIELDS as readonly string[]).not.toContain(f);
      expect(NON_CREATOR_ASSIGNMENT_FIELDS as readonly string[]).toContain(f);
    }
  });

  it("les deux listes sont DISJOINTES", () => {
    const nonCreator = new Set<string>(NON_CREATOR_ASSIGNMENT_FIELDS);
    const inter = CREATOR_ASSIGNMENT_FIELDS.filter((f) => nonCreator.has(f));
    expect(inter).toEqual([]);
  });

  it("CHAQUE champ du schéma assignments est classé (sinon décision requise)", () => {
    const schemaFields = assignmentSchemaFields();
    expect(schemaFields.length).toBeGreaterThan(30); // garde-fou du parsing
    const classified = new Set<string>([
      ...CREATOR_ASSIGNMENT_FIELDS,
      ...NON_CREATOR_ASSIGNMENT_FIELDS,
    ]);
    const unclassified = schemaFields.filter((f) => !classified.has(f));
    expect(
      unclassified,
      `Champ(s) de schéma NON classé(s) — ajoute-les à CREATOR_ASSIGNMENT_FIELDS ou NON_CREATOR_ASSIGNMENT_FIELDS (convex/creatorAssignmentFields.ts) : ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("aucune liste ne référence un champ FANTÔME (absent du schéma)", () => {
    const known = new Set<string>([
      ...assignmentSchemaFields(),
      "_id",
      "_creationTime",
    ]);
    const phantom = [
      ...CREATOR_ASSIGNMENT_FIELDS,
      ...NON_CREATOR_ASSIGNMENT_FIELDS,
    ].filter((f) => !known.has(f));
    expect(phantom).toEqual([]);
  });
});
