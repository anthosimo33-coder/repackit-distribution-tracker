import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * GARDE-FOU BALAYAGE STORAGE — le cron `purgerBlobsOrphelins` supprime tout blob
 * qui n'est référencé par AUCUN des champs listés dans
 * `collecterStorageIdsReferences` (convex/storageCleanup.ts).
 *
 * Conséquence : ajouter un champ `v.id("_storage")` au schéma SANS l'ajouter à
 * cette fonction fait supprimer ses blobs par le cron au bout de 24 h — perte de
 * données SILENCIEUSE, découverte des semaines plus tard.
 *
 * Ce test compte les `v.id("_storage")` de convex/schema.ts et échoue dès que le
 * compte bouge. Réparation : câbler le nouveau champ dans
 * `collecterStorageIdsReferences`, ajouter sa purge à la suppression de sa row,
 * PUIS mettre STORAGE_FIELD_COUNT à jour.
 *
 * Impossible d'importer convex/storageCleanup.ts ici (il tire
 * ./_generated/server) → on lit les deux fichiers en source, comme
 * currency-hardcode.test.ts.
 */

const ROOT = process.cwd();

function lire(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("garde-fou : champs _storage vs balayage des orphelins", () => {
  it("le schéma déclare exactement STORAGE_FIELD_COUNT champs v.id(\"_storage\")", () => {
    const schema = lire("convex/schema.ts");
    const champs = schema.match(/v\.id\("_storage"\)/g) ?? [];

    const cleanup = lire("convex/storageCleanup.ts");
    const declare = cleanup.match(
      /export const STORAGE_FIELD_COUNT = (\d+)/,
    )?.[1];

    expect(declare, "STORAGE_FIELD_COUNT introuvable").toBeDefined();
    expect(
      champs.length,
      `convex/schema.ts déclare ${champs.length} champ(s) v.id("_storage") mais le ` +
        `balayage en connaît ${declare}. Câble le nouveau champ dans ` +
        `collecterStorageIdsReferences (sinon le cron supprimera ses blobs), ` +
        `purge-le à la suppression de sa row, puis mets STORAGE_FIELD_COUNT à jour.`,
    ).toBe(Number(declare));
  });

  it("les 5 tables porteuses sont toutes scannées par le balayage", () => {
    const cleanup = lire("convex/storageCleanup.ts");
    for (const table of [
      "publications",
      "inspirations",
      "formats",
      "assignments",
      "assets",
    ]) {
      expect(
        cleanup.includes(`ctx.db.query("${table}")`),
        `collecterStorageIdsReferences ne scanne pas la table ${table} — ses blobs ` +
          `seraient vus comme orphelins et supprimés.`,
      ).toBe(true);
    }
  });

  it("la fenêtre de grâce protège les uploads en cours (≥ 24 h)", () => {
    const cleanup = lire("convex/storageCleanup.ts");
    const heures = cleanup.match(
      /FENETRE_DE_GRACE_MS = (\d+) \* 60 \* 60 \* 1000/,
    )?.[1];
    expect(heures, "FENETRE_DE_GRACE_MS introuvable").toBeDefined();
    expect(Number(heures)).toBeGreaterThanOrEqual(24);
  });
});
