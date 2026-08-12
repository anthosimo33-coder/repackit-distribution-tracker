import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  TALENT_RUSH_FIELDS,
  NON_TALENT_RUSH_FIELDS,
  pickTalentRush,
} from "../convex/talentRushFields";

/**
 * Allowlist anti-fuite de l'espace talent. Même mécanique — et mêmes tests — que
 * lib/creator-assignment-fields.test.ts et lib/clipper-assignment-fields.test.ts :
 * c'est elle qui a rattrapé deux fuites réelles côté assignments
 * (`replayVerbatim` #167, `publishedBy` #169). La couverture du schéma est la
 * partie qui compte : elle force une décision consciente à CHAQUE nouveau champ,
 * au lieu d'une relecture qu'on ne fera pas.
 */

/** Champs top-level de la table `rushes` lus DEPUIS LE SCHÉMA. */
function rushSchemaFields(): string[] {
  const src = readFileSync(
    new URL("../convex/schema.ts", import.meta.url),
    "utf8",
  ).split("\n");
  const start = src.findIndex((l) => l.startsWith("  rushes: defineTable("));
  expect(start).toBeGreaterThan(-1);
  const fields: string[] = [];
  for (let i = start + 1; i < src.length; i++) {
    if (/^    \.index\(/.test(src[i])) break; // fin du corps de table
    const m = src[i].match(/^    ([a-zA-Z_]+): v\./);
    if (m) fields.push(m[1]);
  }
  return [...new Set(fields)];
}

describe("talentRushFields — allowlist anti-fuite talent", () => {
  it("pickTalentRush ne garde QUE les champs de l'allowlist", () => {
    const picked = pickTalentRush({
      fileName: "hook-01.mov",
      sizeBytes: 31_457_280,
      status: "rejected",
      rejectionReason: "Cadrage trop serré, on ne voit pas le produit.",
      // interdits (scoping serveur / chemin vers le flux clip / infra) :
      projectId: "p1",
      talentId: "c1",
      driveFileId: "1AbC",
      webViewLink: "https://drive.google.com/file/d/1AbC/view",
      assignmentId: "a1",
      assignedAt: 1,
      binaryPurgedAt: 2,
      // champ FUTUR non classé → doit être invisible par défaut :
      champInconnu: "fuite ?",
    });
    for (const k of Object.keys(picked)) {
      expect(TALENT_RUSH_FIELDS).toContain(k);
    }
    expect(picked).toEqual({
      fileName: "hook-01.mov",
      sizeBytes: 31_457_280,
      status: "rejected",
      rejectionReason: "Cadrage trop serré, on ne voit pas le produit.",
    });
  });

  it("AUCUN chemin vers le flux clip n'est exposé", () => {
    // Un `assignmentId` suffit à trahir l'existence des scripts : le talent lit un
    // statut, jamais une jointure.
    for (const f of ["assignmentId", "assignedAt"]) {
      expect(TALENT_RUSH_FIELDS as readonly string[]).not.toContain(f);
      expect(NON_TALENT_RUSH_FIELDS as readonly string[]).toContain(f);
    }
  });

  it("le stockage Drive reste invisible (aucun lien à cliquer)", () => {
    for (const f of ["driveFileId", "webViewLink", "thumbnailLink"]) {
      expect(TALENT_RUSH_FIELDS as readonly string[]).not.toContain(f);
      expect(NON_TALENT_RUSH_FIELDS as readonly string[]).toContain(f);
    }
  });

  it("les ids de scoping serveur ne sortent jamais", () => {
    for (const f of ["projectId", "talentId"]) {
      expect(TALENT_RUSH_FIELDS as readonly string[]).not.toContain(f);
      expect(NON_TALENT_RUSH_FIELDS as readonly string[]).toContain(f);
    }
  });

  it("le motif de refus EST exposé — décision produit, verrouillée ici", () => {
    // Si ce test tombe, ce n'est pas une fuite qu'on a évitée : c'est une décision
    // produit qu'on a défaite. La personne qui a filmé doit savoir pourquoi sa
    // prise est écartée. Conséquence : ce texte est borné serveur (rejectRush) et
    // rendu en TEXTE BRUT côté écran, jamais en markdown.
    expect(TALENT_RUSH_FIELDS as readonly string[]).toContain(
      "rejectionReason",
    );
  });

  it("les deux listes sont DISJOINTES", () => {
    const nonTalent = new Set<string>(NON_TALENT_RUSH_FIELDS);
    const inter = TALENT_RUSH_FIELDS.filter((f) => nonTalent.has(f));
    expect(inter).toEqual([]);
  });

  it("CHAQUE champ du schéma rushes est classé (sinon décision requise)", () => {
    const schemaFields = rushSchemaFields();
    expect(schemaFields.length).toBeGreaterThan(10); // garde-fou du parsing
    const classified = new Set<string>([
      ...TALENT_RUSH_FIELDS,
      ...NON_TALENT_RUSH_FIELDS,
    ]);
    const unclassified = schemaFields.filter((f) => !classified.has(f));
    expect(
      unclassified,
      `Champ(s) de schéma NON classé(s) — ajoute-les à TALENT_RUSH_FIELDS ou NON_TALENT_RUSH_FIELDS (convex/talentRushFields.ts) : ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("aucune liste ne référence un champ FANTÔME (absent du schéma)", () => {
    const known = new Set<string>([
      ...rushSchemaFields(),
      "_id",
      "_creationTime",
    ]);
    const phantom = [...TALENT_RUSH_FIELDS, ...NON_TALENT_RUSH_FIELDS].filter(
      (f) => !known.has(f),
    );
    expect(phantom).toEqual([]);
  });
});
