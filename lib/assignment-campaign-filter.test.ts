import { describe, it, expect } from "vitest";
import {
  buildCampaignOptions,
  campaignTriggerLabel,
  matchesCampaignFilter,
  NO_CAMPAIGN,
  sanitizeCampaignSelection,
  type CampaignFilterable,
} from "./assignment-campaign-filter";

const a = (
  id: string | null,
  name: string | null,
  status: "active" | "archived" | null = "active",
): CampaignFilterable => ({
  scriptCampaignId: id,
  scriptCampaignName: name,
  scriptCampaignStatus: status,
});

/** Réplique la forme prod Snytch : 3 actives inégales + 1 archivée. */
const PROD_LIKE: CampaignFilterable[] = [
  ...Array.from({ length: 46 }, () => a("c1", "Format Warmup 🇫🇷")),
  ...Array.from({ length: 31 }, () => a("c2", "BATCH C — Plaie ouverte")),
  ...Array.from({ length: 12 }, () => a("c3", "Format 3 - POV Demo 🇫🇷")),
  ...Array.from({ length: 11 }, () => a("c4", "Format 2 - POV DEMO 🇺🇸", "archived")),
];

describe("buildCampaignOptions — ordre et comptes", () => {
  it("trie par NOMBRE décroissant, pas alphabétiquement", () => {
    const o = buildCampaignOptions(PROD_LIKE);
    expect(o.map((x) => x.label)).toEqual([
      "Format Warmup 🇫🇷",
      "BATCH C — Plaie ouverte",
      "Format 3 - POV Demo 🇫🇷",
      "Format 2 - POV DEMO 🇺🇸",
    ]);
    expect(o.map((x) => x.count)).toEqual([46, 31, 12, 11]);
  });

  it("les archivées viennent APRÈS toutes les actives, même plus fournies", () => {
    const o = buildCampaignOptions([
      ...Array.from({ length: 99 }, () => a("arch", "Grosse archivée", "archived")),
      a("act", "Petite active"),
    ]);
    expect(o.map((x) => x.section)).toEqual(["active", "archived"]);
    expect(o[0].label).toBe("Petite active");
  });

  it("à compte égal, l'ordre est stable (alphabétique en départage)", () => {
    const o = buildCampaignOptions([a("z", "Zeta"), a("b", "Beta"), a("m", "Mu")]);
    expect(o.map((x) => x.label)).toEqual(["Beta", "Mu", "Zeta"]);
  });

  it("une campagne SANS assignation n'apparaît pas (elle n'a rien à filtrer)", () => {
    // C'est ce qui rendait « Tous formats » inutile : ses options venaient d'une
    // dimension vide. Les options se construisent depuis les assignations.
    const o = buildCampaignOptions([a("c1", "Utilisée")]);
    expect(o).toHaveLength(1);
    expect(o[0].value).toBe("c1");
  });

  it("une campagne SUPPRIMÉE (statut null) est rangée avec les archivées", () => {
    const o = buildCampaignOptions([a("act", "Active"), a("gone", "Fantôme", null)]);
    expect(o.find((x) => x.value === "gone")?.section).toBe("archived");
  });
});

describe("entrée « sans campagne » — conditionnelle", () => {
  it("absente quand toutes les assignations ont une campagne (cas prod)", () => {
    expect(buildCampaignOptions(PROD_LIKE).map((o) => o.value)).not.toContain(
      NO_CAMPAIGN,
    );
  });

  it("apparaît d'elle-même dès qu'une assignation n'en a pas", () => {
    const o = buildCampaignOptions([a("c1", "Une"), a(null, null)]);
    const sans = o.find((x) => x.value === NO_CAMPAIGN);
    expect(sans).toBeDefined();
    expect(sans!.count).toBe(1);
    expect(o.at(-1)!.value).toBe(NO_CAMPAIGN); // toujours en dernier
  });
});

describe("matchesCampaignFilter", () => {
  it("sélection vide = aucun filtre, tout passe", () => {
    expect(matchesCampaignFilter(a("c1", "X"), new Set())).toBe(true);
    expect(matchesCampaignFilter(a(null, null), new Set())).toBe(true);
  });

  it("ne garde que les campagnes cochées", () => {
    const s = new Set(["c1", "c2"]);
    expect(matchesCampaignFilter(a("c1", "X"), s)).toBe(true);
    expect(matchesCampaignFilter(a("c3", "Z"), s)).toBe(false);
  });

  it("une assignation sans campagne est exclue dès qu'un filtre est actif…", () => {
    expect(matchesCampaignFilter(a(null, null), new Set(["c1"]))).toBe(false);
  });

  it("…sauf si « sans campagne » est explicitement coché", () => {
    expect(matchesCampaignFilter(a(null, null), new Set([NO_CAMPAIGN]))).toBe(true);
  });

  it("les archivées se filtrent comme les autres (sélectionnables)", () => {
    const arch = a("c4", "Archivée", "archived");
    expect(matchesCampaignFilter(arch, new Set(["c4"]))).toBe(true);
  });
});

describe("sanitizeCampaignSelection — le filtre persistant ne doit pas mentir", () => {
  const options = buildCampaignOptions(PROD_LIKE);

  it("garde les ids encore proposés", () => {
    expect([...sanitizeCampaignSelection(["c1", "c4"], options)]).toEqual([
      "c1",
      "c4",
    ]);
  });

  it("écarte un id FANTÔME (campagne supprimée)", () => {
    expect([...sanitizeCampaignSelection(["c1", "disparue"], options)]).toEqual([
      "c1",
    ]);
  });

  it("une sélection restaurée dans un AUTRE projet est entièrement écartée", () => {
    // Le piège de la persistance : sans purge, les ids Snytch rapatriés sur
    // RepackIt ne matchent rien → liste vide, sans cause visible à l'écran.
    const autreProjet = buildCampaignOptions([a("r1", "RepackIt - UGC 1")]);
    expect(sanitizeCampaignSelection(["c1", "c2"], autreProjet).size).toBe(0);
  });

  it("sélection vide → vide", () => {
    expect(sanitizeCampaignSelection([], options).size).toBe(0);
  });
});

describe("campaignTriggerLabel — un filtre actif doit se lire d'un coup d'œil", () => {
  const options = buildCampaignOptions(PROD_LIKE);

  it("rien de sélectionné → le libellé neutre", () => {
    expect(campaignTriggerLabel(new Set(), options, "Toutes campagnes")).toBe(
      "Toutes campagnes",
    );
  });

  it("une seule → son nom", () => {
    expect(campaignTriggerLabel(new Set(["c2"]), options, "Toutes")).toBe(
      "BATCH C — Plaie ouverte",
    );
  });

  it("plusieurs → le premier NOMMÉ plus le reste compté, jamais « 2 sélectionnés »", () => {
    const l = campaignTriggerLabel(new Set(["c1", "c3"]), options, "Toutes");
    expect(l).toBe("Format Warmup 🇫🇷 +1");
    expect(l).not.toMatch(/sélectionn/);
  });

  it("une sélection devenue entièrement fantôme retombe sur le libellé neutre", () => {
    expect(campaignTriggerLabel(new Set(["zzz"]), options, "Toutes")).toBe(
      "Toutes",
    );
  });
});
