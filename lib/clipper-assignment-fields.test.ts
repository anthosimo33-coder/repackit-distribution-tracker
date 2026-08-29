import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLIPPER_ASSIGNMENT_FIELDS,
  NON_CLIPPER_ASSIGNMENT_FIELDS,
  pickClipperAssignment,
} from "../convex/clipperAssignmentFields";
import { CREATOR_ASSIGNMENT_FIELDS } from "../convex/creatorAssignmentFields";

/**
 * Champs top-level de la table `assignments` lus DEPUIS LE SCHÉMA (source de
 * vérité, pas une liste figée) — même extraction que
 * lib/creator-assignment-fields.test.ts. Le test de couverture casse donc dès
 * qu'un nouveau champ apparaît sans être classé → décision consciente forcée.
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

describe("clipperAssignmentFields — allowlist anti-fuite clippeur", () => {
  it("pickClipperAssignment ne garde QUE les champs de l'allowlist", () => {
    const picked = pickClipperAssignment({
      status: "to_publish",
      dueDate: 1,
      instructions: "filme en extérieur",
      // interdits (admin / interne / sans objet dans le flux clip) :
      scriptCombo: { comboKey: "h:f:c" },
      comboKey: "h:f:c",
      pricingSnapshot: { pricingId: "x", tauxCPM: 3 },
      rateSnapshot: { basePerPost: 0 },
      managedByAdmin: true,
      publishedBy: "admin",
      adminFeedback: "note interne",
      // champ FUTUR non classé → doit être invisible par défaut :
      champInconnu: "fuite ?",
    });
    for (const k of Object.keys(picked)) {
      expect(CLIPPER_ASSIGNMENT_FIELDS).toContain(k);
    }
    expect(picked).toEqual({
      status: "to_publish",
      dueDate: 1,
      instructions: "filme en extérieur",
    });
  });

  it("la décomposition du script n'est JAMAIS exposée", () => {
    for (const f of [
      "scriptCombo",
      "comboKey",
      "comboImposed",
      "replayedFrom",
      "replayVerbatim",
    ]) {
      expect(CLIPPER_ASSIGNMENT_FIELDS as readonly string[]).not.toContain(f);
      expect(NON_CLIPPER_ASSIGNMENT_FIELDS as readonly string[]).toContain(f);
    }
  });

  it("aucun champ de PAIE n'est exposé au clippeur (payé au clip, pas au CPM)", () => {
    // Un `pricingSnapshot` sur une assignation de clip serait un bug de double
    // paiement (clip + CPM) ; le retirer de la sortie est la 2e ligne de défense.
    for (const f of ["pricingSnapshot", "rateSnapshot"]) {
      expect(CLIPPER_ASSIGNMENT_FIELDS as readonly string[]).not.toContain(f);
      expect(NON_CLIPPER_ASSIGNMENT_FIELDS as readonly string[]).toContain(f);
    }
  });

  it("les deux listes sont DISJOINTES", () => {
    const nonClipper = new Set<string>(NON_CLIPPER_ASSIGNMENT_FIELDS);
    const inter = CLIPPER_ASSIGNMENT_FIELDS.filter((f) => nonClipper.has(f));
    expect(inter).toEqual([]);
  });

  it("CHAQUE champ du schéma assignments est classé (sinon décision requise)", () => {
    const schemaFields = assignmentSchemaFields();
    expect(schemaFields.length).toBeGreaterThan(30); // garde-fou du parsing
    const classified = new Set<string>([
      ...CLIPPER_ASSIGNMENT_FIELDS,
      ...NON_CLIPPER_ASSIGNMENT_FIELDS,
    ]);
    const unclassified = schemaFields.filter((f) => !classified.has(f));
    expect(
      unclassified,
      `Champ(s) de schéma NON classé(s) — ajoute-les à CLIPPER_ASSIGNMENT_FIELDS ou NON_CLIPPER_ASSIGNMENT_FIELDS (convex/clipperAssignmentFields.ts) : ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("aucune liste ne référence un champ FANTÔME (absent du schéma)", () => {
    const known = new Set<string>([
      ...assignmentSchemaFields(),
      "_id",
      "_creationTime",
    ]);
    const phantom = [
      ...CLIPPER_ASSIGNMENT_FIELDS,
      ...NON_CLIPPER_ASSIGNMENT_FIELDS,
    ].filter((f) => !known.has(f));
    expect(phantom).toEqual([]);
  });

  it("la liste clippeur DIFFÈRE de la liste créatrice (ce n'est pas un alias)", () => {
    // Si les deux listes convergeaient, il faudrait n'en garder qu'une. Elles
    // divergent par construction (paie au clip, pas de format, pas de mode géré).
    const creator = new Set<string>(CREATOR_ASSIGNMENT_FIELDS);
    const onlyCreator = CREATOR_ASSIGNMENT_FIELDS.filter(
      (f) => !(CLIPPER_ASSIGNMENT_FIELDS as readonly string[]).includes(f),
    );
    const onlyClipper = CLIPPER_ASSIGNMENT_FIELDS.filter((f) => !creator.has(f));
    expect(onlyCreator).toEqual([
      "managedByAdmin",
      "formatId",
      "rateSnapshot",
      "pricingSnapshot",
      // Les DÉFIS sont réservés aux créatrices partenaires : un clippeur monte
      // les rushes d'un talent, il n'a jamais de vidéo à lui dans un défi. Le
      // champ est donc exposé d'un côté et classé NON_CLIPPER de l'autre.
      "challengeId",
    ]);
    expect(onlyClipper).toEqual([]);
  });
});
