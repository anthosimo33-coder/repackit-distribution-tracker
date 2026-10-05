import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { DOMAINES_ECRITURE } from "../convex/mcpWriteDomains";
import { NON_DEFAISABLE, OUTILS_DEFAISABLES, OUTILS_DEFAIRE } from "../convex/mcpDefaire";

/**
 * AUDIT DU JOURNAL. Tous les outils d'écriture gardent au journal les documents
 * touchés, avant et après — `journaliser` l'exige par son type (un outil qui
 * l'oublie ne compile pas). Ce test tient l'autre moitié : chaque outil est
 * rangé, soit parmi ceux qui se DÉFONT (le journal porte une annulation), soit
 * parmi ceux qui ne se défont pas, AVEC la raison. Un outil ajouté demain sans
 * être rangé fait échouer la CI.
 */
describe("journal des modifications — chaque outil d'écriture est rangé", () => {
  const ecriture = DOMAINES_ECRITURE.flatMap((d) => d.outils.map((t) => t.name));
  const nonDefaisables = new Set(Object.keys(NON_DEFAISABLE));

  it("défaisable OU non défaisable avec sa raison — jamais aucun des deux", () => {
    const orphelins = ecriture.filter((n) => !OUTILS_DEFAISABLES.has(n) && !nonDefaisables.has(n));
    expect(orphelins).toEqual([]);
  });

  it("jamais les deux à la fois", () => {
    expect([...OUTILS_DEFAISABLES].filter((n) => nonDefaisables.has(n))).toEqual([]);
  });

  it("aucun nom fantôme dans les listes", () => {
    const connus = new Set([...ecriture, ...OUTILS_DEFAIRE.map((t) => t.name)]);
    expect([...OUTILS_DEFAISABLES, ...nonDefaisables].filter((n) => !connus.has(n))).toEqual([]);
  });

  it("l'abandon et la réécriture d'une mission se défont désormais", () => {
    expect(OUTILS_DEFAISABLES.has("annuler_mission")).toBe(true);
    expect(OUTILS_DEFAISABLES.has("reecrire_mission")).toBe(true);
    expect(ecriture).toContain("reecrire_mission");
  });
});

/**
 * L'écran « Connecter Claude » nomme chaque outil d'écriture par une clé
 * construite (`outil.${nom}`) que le contrôle i18n ne voit pas : un outil sans
 * libellé fait planter l'écran (vu le 05/10/2026 avec reecrire_mission).
 */
describe("« Connecter Claude » — chaque outil d'écriture a son libellé", () => {
  const ecriture = DOMAINES_ECRITURE.flatMap((d) => d.outils.map((t) => t.name));
  for (const loc of ["fr", "en"]) {
    it(`libellés ${loc}`, () => {
      const cat = JSON.parse(readFileSync(join(process.cwd(), `messages/admin/${loc}/common.json`), "utf8")) as {
        McpAccessDialog: { outil: Record<string, string> };
      };
      expect(ecriture.filter((n) => !cat.McpAccessDialog.outil[n])).toEqual([]);
    });
  }
});

