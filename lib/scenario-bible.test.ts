import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { codeValide, lireBible, verifierBible, type ErreurBible } from "../convex/scenarioBible";
import { genererConversation } from "../convex/scenarioEngine";
import modele from "../convex/scenarioModele.json";

/**
 * Vérification d'une bible — la bible C2 réelle passe ; chaque cassure ci-dessous
 * part d'une COPIE de C2 (forme de production), pas d'un objet minimal taillé
 * pour le test.
 */
const TEXTE_C2 = readFileSync(new URL("../docs/scenarios/bibles/bible_C2.json", import.meta.url), "utf8");
const c2 = () => JSON.parse(TEXTE_C2) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const erreurs = (b: unknown): ErreurBible[] => {
  const r = verifierBible(b);
  return r.ok ? [] : r.erreurs;
};

describe("verifierBible", () => {
  it("accepte la bible C2 telle que livrée", () => {
    const r = lireBible(TEXTE_C2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bible.ecran_choc).toHaveLength(5);
  });

  it("situe une erreur de syntaxe JSON (ligne, colonne)", () => {
    const casse = TEXTE_C2.replace('"titre": "Le like de l\'ex",', '"titre": "Le like de l\'ex"');
    const r = lireBible(casse);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erreurs[0]!.code).toBe("json");
      expect(r.erreurs[0]!.params?.ligne).toBe(4);
    }
  });

  it("nomme un champ requis manquant et un type hors liste", () => {
    const b = c2();
    delete b.lui;
    b.type = "situationship";
    expect(erreurs(b)).toEqual(
      expect.arrayContaining([
        { chemin: "lui", code: "requis" },
        expect.objectContaining({ chemin: "type", code: "type" }),
      ]),
    );
  });

  it("refuse une date qui n'existe pas et des dates dans le désordre", () => {
    const b = c2();
    b.dates.record = "2026-02-30";
    expect(erreurs(b)).toContainEqual({ chemin: "dates.record", code: "date", params: { valeur: "2026-02-30" } });
    const o = c2();
    o.dates.tournant = "2025-10-01"; // avant la fin de la lune de miel
    expect(erreurs(o)).toContainEqual({ chemin: "dates", code: "ordre_dates" });
    const r = c2();
    r.dates.record = "2026-11-01"; // après la fin
    expect(erreurs(r)).toContainEqual({ chemin: "dates.record", code: "hors_periode" });
  });

  it("exige des secondes, le dernier jour et l'ordre dans l'écran choc", () => {
    const b = c2();
    b.ecran_choc[1][0] = "2026-10-12 22:31";
    b.ecran_choc[3][0] = "2026-10-11 22:32:30";
    const e = erreurs(b);
    expect(e).toContainEqual({ chemin: "ecran_choc[1][0]", code: "horodatage_secondes", params: { valeur: "2026-10-12 22:31" } });
    expect(e).toContainEqual({ chemin: "ecran_choc[3][0]", code: "ecran_jour", params: { fin: "2026-10-12" } });
    const o = c2();
    o.ecran_choc[2][0] = "2026-10-12 22:31:30"; // avant le message précédent (22:31:40)
    expect(erreurs(o)).toEqual([{ chemin: "ecran_choc[2][0]", code: "ecran_ordre" }]);
  });

  it("borne l'écran choc à 3-6 messages", () => {
    const b = c2();
    b.ecran_choc.push(["2026-10-12 22:34:00", "Y", "ok"], ["2026-10-12 22:35:00", "L", "ok"]);
    expect(erreurs(b)).toContainEqual({ chemin: "ecran_choc", code: "nb_messages", params: { min: 3, max: 6, n: 7 } });
  });

  it("refuse un locuteur inconnu, une probabilité > 1, une fourchette à l'envers", () => {
    const b = c2();
    b.munitions[2][1][1] = "X";
    b.vocaux.Y_nuit = 1.2;
    b.rythme.dialogues_par_jour.avant = [4, 2];
    const e = erreurs(b);
    expect(e).toContainEqual({ chemin: "munitions[2][1][1]", code: "locuteur" });
    expect(e).toContainEqual({ chemin: "vocaux.Y_nuit", code: "proba" });
    expect(e).toContainEqual({ chemin: "rythme.dialogues_par_jour.avant", code: "paire" });
  });

  it("refuse un prénom « lui » qui casserait l'export (deux-points)", () => {
    const b = c2();
    b.lui = "Yanis: le vrai";
    expect(erreurs(b)).toContainEqual({ chemin: "lui", code: "prenom" });
  });

  it("rapporte TOUTES les erreurs d'un coup, pas seulement la première", () => {
    const b = c2();
    b.titre = "";
    b.mot_a_vous.proba_par_jour = -0.1;
    b.derniere_semaine[0][0][0] = "hier soir";
    expect(erreurs(b).map((x) => x.chemin)).toEqual(
      expect.arrayContaining(["titre", "mot_a_vous.proba_par_jour", "derniere_semaine[0][0][0]"]),
    );
  });
});

describe("le modèle « Nouveau scénario »", () => {
  it("est une bible valide que le moteur sait générer", () => {
    const r = verifierBible({ ...modele, id: "A1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const gen = genererConversation(r.bible, { prenom: "Juliette" });
      expect(gen.texte.trimEnd().split("\n").slice(-1)[0]).toBe("[12/10/2026 22:33:05] Juliette: la chute");
    }
  });
});

describe("codeValide", () => {
  it("accepte un code court, refuse espaces, accents et codes trop longs", () => {
    for (const ok of ["C2", "A1-bis", "d2_v3"]) expect(codeValide(ok)).toBe(true);
    for (const ko of ["", " C2", "C 2", "Ç2", "-A1", "A".repeat(21)]) expect(codeValide(ko)).toBe(false);
  });
});
