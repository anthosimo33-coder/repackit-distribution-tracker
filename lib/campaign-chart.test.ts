import { describe, expect, it } from "vitest";
import {
  aggregateByCategory,
  shapeCampaignRows,
  CAMPAIGN_NONE_LABEL,
  ANGLE_FAMILY_NONE_LABEL,
  type CategoryItem,
} from "./tracker-data";
import { angleFamilyKey } from "../convex/angleFamily";

/**
 * Graphe « Vues par campagne » — mise en forme.
 *
 * L'agrégation elle-même est celle des graphes existants (aggregateByCategory,
 * déjà testée) ; ce qui est neuf est le RANGEMENT : top N, bucket « Autres », et
 * « Hors campagne » toujours en dernier.
 */
const post = (
  campaign: string | null,
  vues: number,
  isWarmup = false,
): CategoryItem => ({
  key: campaign ?? "__none__",
  label: campaign ?? CAMPAIGN_NONE_LABEL,
  vues,
  likes: Math.round(vues * 0.04),
  comments: Math.round(vues * 0.01),
  isWarmup,
});

describe("agrégation par campagne", () => {
  it("somme les vues des posts d'une même campagne, tri décroissant", () => {
    const rows = shapeCampaignRows(
      aggregateByCategory(
        [post("Warmup FR", 100_000), post("Warmup FR", 20_937), post("POV Demo", 133_071)],
        "all",
      ),
    );
    expect(rows.map((r) => [r.label, r.vues])).toEqual([
      ["POV Demo", 133_071],
      ["Warmup FR", 120_937],
    ]);
  });

  it("les publications sans campagne tombent dans « Hors campagne », EN DERNIER", () => {
    const rows = shapeCampaignRows(
      aggregateByCategory(
        // Le bucket sans campagne pèse plus lourd que les autres : il doit
        // quand même finir dernier, sinon il vole la tête du graphe.
        [post(null, 999_999), post("Petite campagne", 10)],
        "all",
      ),
    );
    expect(rows.at(-1)!.label).toBe(CAMPAIGN_NONE_LABEL);
    expect(rows.at(-1)!.vues).toBe(999_999);
    expect(rows[0].label).toBe("Petite campagne");
  });

  it("au-delà de 10 campagnes : top 10 + « Autres » agrégée", () => {
    const items = Array.from({ length: 14 }, (_, i) =>
      post(`Campagne ${i}`, (14 - i) * 1000),
    );
    const rows = shapeCampaignRows(aggregateByCategory(items, "all"));
    expect(rows).toHaveLength(11);
    expect(rows.slice(0, 10).map((r) => r.label)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Campagne ${i}`),
    );
    // Les 4 restantes : 4000 + 3000 + 2000 + 1000.
    expect(rows[10].label).toBe("Autres (4)");
    expect(rows[10].vues).toBe(10_000);
  });

  it("« Hors campagne » n'est JAMAIS fondue dans « Autres »", () => {
    // Une absence de rattachement n'est pas une petite campagne : la noyer dans
    // « Autres » masquerait un défaut de données.
    const items = [
      ...Array.from({ length: 12 }, (_, i) => post(`C${i}`, (12 - i) * 100)),
      post(null, 5),
    ];
    const rows = shapeCampaignRows(aggregateByCategory(items, "all"));
    expect(rows.at(-1)!.label).toBe(CAMPAIGN_NONE_LABEL);
    expect(rows.find((r) => r.label.startsWith("Autres"))!.vues).toBe(100 + 200);
  });

  it("les campagnes à 0 vue sont écartées", () => {
    const rows = shapeCampaignRows(
      aggregateByCategory([post("Vide", 0), post("Active", 500)], "all"),
    );
    expect(rows.map((r) => r.label)).toEqual(["Active"]);
  });

  it("le filtre warmup s'applique comme aux autres graphes", () => {
    // Mode "exclude" : les vues warmup restent comptées en `vues` (colonne
    // brute) mais sortent du dénominateur d'engagement — comportement partagé
    // avec « Vues par créateur », qu'on ne redéfinit pas ici.
    const rows = shapeCampaignRows(
      aggregateByCategory([post("Mixte", 1000, true), post("Mixte", 500)], "exclude"),
    );
    expect(rows[0].vues).toBe(1500);
    expect(rows[0].engagementVues).toBe(500);
  });
});

/**
 * Graphe « Vues par famille d'angle » — MÊME mise en forme, autre bucket de
 * repli. Ces tests verrouillent la généralisation de `shapeCampaignRows` : si
 * quelqu'un recodait un rangement séparé pour les familles, les deux graphes
 * divergeraient sur le top N ou sur la place du bucket « sans ».
 */
describe("graphe des familles d'angle — réutilise le rangement des campagnes", () => {
  const parFamille = (famille: string | null, vues: number): CategoryItem => ({
    key: famille ? angleFamilyKey(famille) : "__none__",
    label: famille ?? ANGLE_FAMILY_NONE_LABEL,
    vues,
    likes: Math.round(vues * 0.08),
    comments: Math.round(vues * 0.01),
  });

  it("« Sans famille » finit DERNIER même s'il pèse le plus lourd", () => {
    const rows = shapeCampaignRows(
      aggregateByCategory(
        [parFamille(null, 480_000), parFamille("trahison", 12_400)],
        "all",
      ),
      undefined,
      ANGLE_FAMILY_NONE_LABEL,
    );
    expect(rows.map((r) => r.label)).toEqual([
      "trahison",
      ANGLE_FAMILY_NONE_LABEL,
    ]);
  });

  it("deux orthographes d'une même famille font UNE barre", () => {
    // Le piège du champ libre : sans pliage de casse/accents, « Nostalgie » et
    // « nostalgie » donneraient deux barres anémiques au lieu d'un angle qui
    // ressort.
    const rows = shapeCampaignRows(
      aggregateByCategory(
        [
          parFamille("Nostalgie", 30_000),
          parFamille("nostalgie", 22_000),
          parFamille("NOSTALGIE", 8_000),
        ],
        "all",
      ),
      undefined,
      ANGLE_FAMILY_NONE_LABEL,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].vues).toBe(60_000);
    // Le libellé affiché est la 1re orthographe rencontrée, pas la clé pliée.
    expect(rows[0].label).toBe("Nostalgie");
  });

  it("ne fusionne PAS deux familles réellement distinctes", () => {
    const rows = shapeCampaignRows(
      aggregateByCategory(
        [parFamille("rechute", 40_000), parFamille("renoncement/fierté", 25_000)],
        "all",
      ),
      undefined,
      ANGLE_FAMILY_NONE_LABEL,
    );
    expect(rows.map((r) => r.label)).toEqual([
      "rechute",
      "renoncement/fierté",
    ]);
  });

  it("agrège au-delà du top N, « Sans famille » restant hors du bucket « Autres »", () => {
    const nombreuses = Array.from({ length: 13 }, (_, i) =>
      parFamille(`famille ${i}`, 13_000 - i * 100),
    );
    const rows = shapeCampaignRows(
      aggregateByCategory([...nombreuses, parFamille(null, 5_000)], "all"),
      3,
      ANGLE_FAMILY_NONE_LABEL,
    );
    expect(rows.map((r) => r.label)).toEqual([
      "famille 0",
      "famille 1",
      "famille 2",
      "Autres (10)",
      ANGLE_FAMILY_NONE_LABEL,
    ]);
  });
});
