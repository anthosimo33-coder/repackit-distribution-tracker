import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  TALENT_BRIEF_FIELDS,
  NON_TALENT_BRIEF_FIELDS,
  pickTalentBrief,
} from "../convex/talentBriefFields";

/**
 * Allowlist du brief permanent. Le format est réutilisé tel quel côté admin —
 * c'est le bon choix (un seul outil d'édition) mais il porte des TEXTES DE
 * SCRIPT et une GRILLE DE PAIE : toute la sûreté de la réutilisation tient à
 * cette liste. Un `...format` à la place, et le talent lit les hooks.
 */

/** Champs top-level de la table `formats` lus DEPUIS LE SCHÉMA. */
function formatSchemaFields(): string[] {
  const src = readFileSync(
    new URL("../convex/schema.ts", import.meta.url),
    "utf8",
  ).split("\n");
  const start = src.findIndex((l) => l.startsWith("  formats: defineTable("));
  expect(start).toBeGreaterThan(-1);
  const fields: string[] = [];
  for (let i = start + 1; i < src.length; i++) {
    // Fin du corps de table. `formats` se termine par `  }).index(…)` sur UNE
    // ligne (là où `rushes` met le `.index` en dessous) : on borne sur `  })`,
    // qui couvre les deux écritures. Sans ça, le parseur déborderait sur la
    // table suivante et le test « chaque champ classé » deviendrait du bruit.
    if (/^ {2}\}\)/.test(src[i])) break;
    const m = src[i].match(/^ {4}([a-zA-Z_]+): v\./);
    if (m) fields.push(m[1]);
  }
  return [...new Set(fields)];
}

describe("talentBriefFields — allowlist du brief permanent", () => {
  it("pickTalentBrief ne garde QUE le brief et les exemples", () => {
    const picked = pickTalentBrief({
      brief: "Filme en extérieur, lumière naturelle.",
      exampleVideos: [{ kind: "url", url: "https://x", platform: "tiktok" }],
      // interdits :
      hooks: ["Tu savais que…", "Arrête de scroller"],
      rateModel: { basePerPost: 12 },
      guidelines: { do: ["cadrer serré"], dont: ["parler"] },
      name: "Hook produit",
      type: "short",
      status: "active",
      projectId: "p1",
      createdAt: 1,
      updatedAt: 2,
      // champ FUTUR non classé → invisible par défaut :
      noteInterne: "fuite ?",
    });
    for (const k of Object.keys(picked)) {
      expect(TALENT_BRIEF_FIELDS).toContain(k);
    }
    expect(picked).toEqual({
      brief: "Filme en extérieur, lumière naturelle.",
      exampleVideos: [{ kind: "url", url: "https://x", platform: "tiktok" }],
    });
  });

  it("les HOOKS ne sortent JAMAIS — le talent ne voit aucun script", () => {
    // Invariant central de la population : si ce test tombe, la séparation
    // talent/clippeur n'a plus d'objet.
    expect(TALENT_BRIEF_FIELDS as readonly string[]).not.toContain("hooks");
    expect(NON_TALENT_BRIEF_FIELDS as readonly string[]).toContain("hooks");
  });

  it("la grille de rémunération du PARTENAIRE ne sort pas", () => {
    // Le talent est au forfait mensuel : lui montrer un fixe/CPM afficherait un
    // montant qui n'est pas le sien.
    expect(TALENT_BRIEF_FIELDS as readonly string[]).not.toContain("rateModel");
    expect(NON_TALENT_BRIEF_FIELDS as readonly string[]).toContain("rateModel");
  });

  it("les deux listes sont DISJOINTES", () => {
    const nonTalent = new Set<string>(NON_TALENT_BRIEF_FIELDS);
    const inter = TALENT_BRIEF_FIELDS.filter((f) => nonTalent.has(f));
    expect(inter).toEqual([]);
  });

  it("CHAQUE champ du schéma formats est classé (sinon décision requise)", () => {
    const schemaFields = formatSchemaFields();
    expect(schemaFields.length).toBeGreaterThan(8); // garde-fou du parsing
    // Garde-fou du parsing (bis) : la table suivante ne doit PAS avoir débordé.
    expect(schemaFields).not.toContain("creatorId");
    const classified = new Set<string>([
      ...TALENT_BRIEF_FIELDS,
      ...NON_TALENT_BRIEF_FIELDS,
    ]);
    const unclassified = schemaFields.filter((f) => !classified.has(f));
    expect(
      unclassified,
      `Champ(s) de schéma NON classé(s) — ajoute-les à TALENT_BRIEF_FIELDS ou NON_TALENT_BRIEF_FIELDS (convex/talentBriefFields.ts) : ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("aucune liste ne référence un champ FANTÔME (absent du schéma)", () => {
    const known = new Set<string>(formatSchemaFields());
    const phantom = [
      ...TALENT_BRIEF_FIELDS,
      ...NON_TALENT_BRIEF_FIELDS,
    ].filter((f) => !known.has(f));
    expect(phantom).toEqual([]);
  });
});
