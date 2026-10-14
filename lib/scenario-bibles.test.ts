import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import donnees from "../convex/scenarioRemplissage.json";
import { genererConversation, statsConversation } from "../convex/scenarioEngine";
import { lireBible, type Bible } from "../convex/scenarioBible";

/**
 * Les BIBLES livrées dans docs/scenarios/bibles/ — chacune doit rester valide,
 * finir exactement par son écran choc (la fin que BLUSH lit pour son vocal) et
 * faire sortir son « mot à vous » en tête des mots partagés.
 */
const dossier = new URL("../docs/scenarios/bibles/", import.meta.url);
const fichiers = readdirSync(dossier).filter((f) => /^bible_[A-Z0-9]+\.json$/.test(f));

function bibleDe(f: string): Bible {
  const lu = lireBible(readFileSync(new URL(f, dossier), "utf8"));
  if (!lu.ok) throw new Error(`${f} invalide : ${JSON.stringify(lu.erreurs.slice(0, 3))}`);
  return lu.bible;
}

describe("bibles livrées", () => {
  it("il y en a plusieurs, dont C2", () => {
    expect(fichiers).toContain("bible_C2.json");
  });

  for (const f of fichiers) {
    describe(f, () => {
      const bible = bibleDe(f);
      const gen = genererConversation(bible, { prenom: "Inès", graine: 11 });

      it("son id est celui du fichier", () => {
        expect(`bible_${bible.id}.json`).toBe(f);
      });

      it("l'export finit exactement par l'écran choc", () => {
        const fin = gen.texte.trimEnd().split(/\r?\n/).slice(-bible.ecran_choc.length);
        expect(fin.map((l) => l.replace(/^.*?\] [^:]+: /, ""))).toEqual(bible.ecran_choc.map((m) => m[2]));
      });

      it("le mot à vous sort premier des mots partagés", () => {
        expect(statsConversation(gen).motsPartages[0]?.mot).toBe(bible.mot_a_vous.mot);
      });
    });
  }
});

describe("remplissage selon le type de relation", () => {
  const reserves = (donnees.dialogues as Array<{ reserve?: string; lignes: string[][] }>)
    .filter((d) => d.reserve !== undefined)
    .map((d) => d.lignes[0]![1]!);
  const c2 = bibleDe("bible_C2.json");

  it("un couple tire les dialogues amoureux", () => {
    const textes = new Set(genererConversation(c2, { prenom: "Inès", graine: 3 }).messages.map((m) => m.texte));
    expect(reserves.some((r) => textes.has(r))).toBe(true);
  });

  it("un meilleur ami n'en tire aucun ; un talking stage pas de « je t'aime »", () => {
    const ami = genererConversation({ ...c2, type: "meilleur_ami" }, { prenom: "Inès", graine: 3 });
    const munitions = new Set(
      [...c2.munitions, ...c2.derniere_semaine].flat().map((m) => m[2]),
    );
    const remplissage = ami.messages.map((m) => m.texte).filter((t) => !munitions.has(t));
    for (const r of reserves) expect(remplissage).not.toContain(r);
    const ts = genererConversation({ ...c2, type: "talking_stage" }, { prenom: "Inès", graine: 3 });
    const textesTs = ts.messages.map((m) => m.texte).filter((t) => !munitions.has(t));
    expect(textesTs).not.toContain("je t'aime ❤️");
    expect(textesTs.some((t) => t === "tu me manques")).toBe(true);
  });
});

describe("prénoms tirés au hasard dans le remplissage", () => {
  const c2 = bibleDe("bible_C2.json");
  const munitions = new Set([...c2.munitions, ...c2.derniere_semaine].flat().map((m) => m[2]));

  it("jamais celui de lui ni celui de la créatrice", () => {
    // Mehdi est un pote du remplissage, Inès une copine : ici, ce sont les deux qui parlent.
    const gen = genererConversation({ ...c2, lui: "Mehdi" }, { prenom: "Inès", graine: 5 });
    const remplissage = gen.messages.map((m) => m.texte).filter((t) => !munitions.has(t));
    expect(remplissage.filter((t) => /\bMehdi\b|Inès/.test(t))).toEqual([]);
  });

  it("les autres potes restent tirés", () => {
    const gen = genererConversation({ ...c2, lui: "Mehdi" }, { prenom: "Inès", graine: 5 });
    expect(gen.messages.some((m) => /Karim|Bilal|Lucas/.test(m.texte))).toBe(true);
  });
});
