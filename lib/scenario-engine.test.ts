import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { genererConversation, pyFixe, statsConversation, statsTexte } from "../convex/scenarioEngine";
import { lireBible, type Bible } from "../convex/scenarioBible";

/**
 * Moteur de scénarios — le portage TypeScript de `moteur.py` doit rendre LE
 * MÊME FICHIER que le Python, octet pour octet : les échantillons de
 * docs/scenarios/samples/ ont été produits par le moteur de référence, celui
 * qui a été importé sur askblush.com.
 */
const lire = (p: string) => readFileSync(new URL(`../docs/scenarios/${p}`, import.meta.url), "utf8");
const lu = lireBible(lire("bibles/bible_C2.json"));
if (!lu.ok) throw new Error("bible_C2.json invalide");
const C2: Bible = lu.bible;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("genererConversation — égalité avec le moteur Python", () => {
  const gen = genererConversation(C2, { prenom: "Kelly", graine: 7 });

  it("rend l'export de référence à l'octet près", () => {
    const attendu = lire("samples/WhatsApp Chat - Kelly, Yanis.txt");
    expect(gen.nomFichier).toBe("WhatsApp Chat - Kelly, Yanis.txt");
    expect(gen.nomZip).toBe("WhatsApp Chat - Yanis.zip");
    expect(gen.texte.length).toBe(attendu.length);
    expect(sha(gen.texte)).toBe(sha(attendu));
  });

  it("rend les stats du Python, ligne pour ligne", () => {
    const stats = statsConversation(gen, ["maëlle", "bernadette"]);
    expect(statsTexte(C2, gen, stats)).toBe(lire("samples/stats_attendues.txt").trimEnd());
  });
});

describe("critères d'acceptation (docs/scenarios/PROMPT.md)", () => {
  const gen = genererConversation(C2, { prenom: "Kelly", graine: 7 });
  const s = statsConversation(gen);

  it("≈ 5 900 messages, médianes, part lancée, record, « je t'aime », mot à vous", () => {
    expect(s.messages).toBeGreaterThanOrEqual(5310);
    expect(s.messages).toBeLessThanOrEqual(6490);
    expect(s.reponseMediane.L!).toBeGreaterThanOrEqual(2);
    expect(s.reponseMediane.L!).toBeLessThanOrEqual(3);
    expect(s.reponseMediane.Y!).toBeGreaterThanOrEqual(30);
    expect(s.reponseMediane.Y!).toBeLessThanOrEqual(40);
    expect(s.elleLancePct).toBeGreaterThanOrEqual(70);
    expect(s.elleLancePct).toBeLessThanOrEqual(80);
    expect(s.record).toMatchObject({ jour: "2026-02-14" });
    expect(s.record.messages).toBeGreaterThanOrEqual(190);
    expect(s.jeTaime.Y).toBe(0);
    expect(s.motsPartages[0]!.mot).toBe("bernadette");
  });

  it("se termine EXACTEMENT par les 5 messages de l'écran choc, à la seconde", () => {
    const fin = gen.texte.trimEnd().split("\n").slice(-5);
    expect(fin).toEqual([
      "[12/10/2026 21:47:12] Kelly: pourquoi t'as liké la photo de ton ex ?",
      "[12/10/2026 22:31:40] Yanis: t'es sérieuse là",
      "[12/10/2026 22:31:52] Yanis: c'était un réflexe",
      "[12/10/2026 22:32:30] Yanis: et toi tu regardes mes likes ?? c'est ça le vrai problème",
      "[12/10/2026 22:33:05] Kelly: t'as raison pardon",
    ]);
  });

  it("deux générations identiques donnent le même condensé", () => {
    const again = genererConversation(C2, { prenom: "Kelly", graine: 7 });
    expect(sha(again.texte)).toBe(sha(gen.texte));
  });
});

describe("variations", () => {
  const base = genererConversation(C2, { prenom: "Kelly", graine: 7 });

  it("une autre graine change le remplissage, pas l'écran choc ni les munitions", () => {
    const autre = genererConversation(C2, { prenom: "Kelly", graine: 8 });
    expect(sha(autre.texte)).not.toBe(sha(base.texte));
    expect(autre.texte.trimEnd().split("\n").slice(-5)).toEqual(base.texte.trimEnd().split("\n").slice(-5));
    for (const ligne of ["Yanis: je te présente bernadette", "Yanis: maëlle elle disait que j'étais drôle moi"]) {
      expect(autre.texte).toContain(ligne);
    }
  });

  it("le prénom de la créatrice signe ses messages (prénom accentué)", () => {
    const ines = genererConversation(C2, { prenom: "Inès", graine: 7 });
    expect(ines.nomFichier).toBe("WhatsApp Chat - Inès, Yanis.txt");
    expect(ines.texte).toContain("] Inès: t'as raison pardon\n");
    expect(ines.texte).not.toContain("Kelly");
  });

  it("option A : finLe fait glisser TOUTE la conv, heures et contenu intacts", () => {
    const glisse = genererConversation(C2, { prenom: "Kelly", graine: 7, finLe: "2026-11-05" });
    expect(glisse.decalageJours).toBe(24);
    const a = base.texte.split("\n");
    const b = glisse.texte.split("\n");
    expect(b).toHaveLength(a.length);
    expect(b[0]).toMatch(/^\[27\/08\/2025 14:02:11\] Yanis: /);
    expect(glisse.texte.trimEnd().split("\n").slice(-1)[0]).toBe("[05/11/2026 22:33:05] Kelly: t'as raison pardon");
    // Même contenu, mêmes heures : seule la date change.
    const sansDate = (l: string) => l.replace(/^\[\d\d\/\d\d\/\d{4} /, "[");
    expect(b.map(sansDate)).toEqual(a.map(sansDate));
    expect(statsConversation(glisse).record.jour).toBe("2026-03-10");
  });
});

describe("pyFixe — l'arrondi d'affichage de Python", () => {
  it("arrondit une égalité exacte au pair, le reste au plus proche", () => {
    expect(pyFixe(2.25, 1)).toBe("2.2");
    expect(pyFixe(2.35, 1)).toBe("2.4"); // 2,35 vaut 2,35000000000000008882 en binaire
    expect(pyFixe(72.5, 0)).toBe("72");
    expect(pyFixe(73.5, 0)).toBe("74");
    expect(pyFixe(35.2156, 1)).toBe("35.2");
  });
});
