import { describe, it, expect } from "vitest";
import {
  daysBetween,
  firstNameOf,
  inspectExport,
  personalizeExport,
  shiftDaysFor,
} from "../convex/conversationExport";

/**
 * Export WhatsApp d'une brique « conversation ». Les entrées ont la FORME d'un
 * vrai export iOS français : fins de ligne CRLF, marque U+200E devant les
 * médias, ligne système en tête, message sur plusieurs lignes, nom complet de
 * l'utilisatrice, emojis, et un mois qui change en cours de route.
 */
const LRM = "‎";
const IOS_FR = [
  `[02/09/2026 21:03:11] Jules: ${LRM}Les messages et les appels sont chiffrés de bout en bout. Seuls les participants à cette discussion peuvent les lire, les écouter ou les partager.`,
  `[02/09/2026 21:03:11] Léa Martin: coucou c'est Léa 🙈`,
  `[02/09/2026 21:05:40] Jules: ah enfin ! Léa de la soirée chez Inès ? Léandre m'a parlé de toi`,
  `${LRM}[03/09/2026 08:12:03] Léa Martin: ${LRM}image absente`,
  `[30/09/2026 23:14:02] Léa Martin: jsp si c'est moi mais t'es plus pareil depuis samedi…`,
  `avant on s'appelait tous les soirs, Léa elle se sent bête là`,
  `[01/10/2026 05:52:19] Jules: mdr`,
  ``,
].join("\r\n");

describe("inspectExport", () => {
  it("compte les messages, range les auteurs et borne les jours", () => {
    const r = inspectExport(IOS_FR);
    expect(r.messages).toBe(6);
    expect(r.participants).toEqual([
      { name: "Jules", messages: 3 },
      { name: "Léa Martin", messages: 3 },
    ]);
    expect(r.firstDay).toBe("2026-09-02");
    expect(r.lastDay).toBe("2026-10-01");
    expect(r.order).toBe("dmy");
  });

  it("rend null sans aucune ligne d'en-tête (un fichier qui n'est pas un export)", () => {
    const r = inspectExport("bonjour\nceci n'est pas un export\n");
    expect(r.messages).toBe(0);
    expect(r.firstDay).toBeNull();
    expect(r.lastDay).toBeNull();
  });

  it("lit les dates américaines (mois d'abord) quand le second nombre dépasse 12", () => {
    const us = [
      "[9/12/26, 10:45:53 PM] Jules: hey",
      "[9/30/26, 11:02:10 PM] Lea: you up?",
    ].join("\n");
    const r = inspectExport(us);
    expect(r.order).toBe("mdy");
    expect(r.firstDay).toBe("2026-09-12");
    expect(r.lastDay).toBe("2026-09-30");
  });
});

describe("personalizeExport", () => {
  it("glisse toutes les dates du même nombre de jours, sans toucher aux heures", () => {
    const out = personalizeExport(IOS_FR, { shiftDays: 35 });
    expect(out).toContain("[07/10/2026 21:03:11] Jules:");
    expect(out).toContain(`${LRM}[08/10/2026 08:12:03] Léa Martin: ${LRM}image absente`);
    expect(out).toContain("[04/11/2026 23:14:02] Léa Martin:");
    expect(out).toContain("[05/11/2026 05:52:19] Jules: mdr");
    expect(out).not.toContain("/09/2026");
    expect(inspectExport(out).lastDay).toBe("2026-11-05");
  });

  it("garde les fins de ligne CRLF et les lignes de suite", () => {
    const out = personalizeExport(IOS_FR, { shiftDays: 1 });
    expect(out.split("\r\n")).toHaveLength(IOS_FR.split("\r\n").length);
    expect(out).toContain("depuis samedi…\r\navant on s'appelait tous les soirs");
  });

  it("remplace le nom de « elle » par le prénom de la créatrice, en-têtes ET textes", () => {
    const out = personalizeExport(IOS_FR, {
      shiftDays: 0,
      rename: { fromName: "Léa Martin", toName: "Juliette" },
    });
    expect(out).toContain("[02/09/2026 21:03:11] Juliette: coucou c'est Juliette 🙈");
    expect(out).toContain("Jules: ah enfin ! Juliette de la soirée chez Inès ?");
    // Ligne de suite d'un message : remplacée aussi.
    expect(out).toContain("Juliette elle se sent bête là");
    // Mot entier seulement : un autre prénom qui commence pareil reste intact.
    expect(out).toContain("Léandre m'a parlé de toi");
    expect(out).not.toMatch(/Léa(?![\p{L}])/u);
    // L'autre auteur ne change pas.
    expect(out).toContain("] Jules: mdr");
    expect(inspectExport(out).participants.map((p) => p.name).sort()).toEqual(["Jules", "Juliette"]);
  });

  it("ne remplace pas deux fois quand le nouveau prénom contient l'ancien", () => {
    const out = personalizeExport("[01/10/2026 10:00:00] Léa: c'est Léa\n", {
      shiftDays: 0,
      rename: { fromName: "Léa", toName: "Léana" },
    });
    expect(out).toBe("[01/10/2026 10:00:00] Léana: c'est Léana\n");
  });

  it("rend le fichier à l'octet près sans décalage ni prénom", () => {
    expect(personalizeExport(IOS_FR, { shiftDays: 0 })).toBe(IOS_FR);
  });

  it("change d'année et garde le style du fichier (sans zéro devant 9.1.27)", () => {
    const android = [
      "30.12.26, 23:40 - Jules: bonne année en avance",
      "9.1.27, 9:05 - Léa: tu fais quoi ce soir ?",
    ].join("\n");
    const out = personalizeExport(android, { shiftDays: 3 });
    expect(out).toBe(
      ["2.1.27, 23:40 - Jules: bonne année en avance", "12.1.27, 9:05 - Léa: tu fais quoi ce soir ?"].join("\n"),
    );
  });

  it("garde le zéro d'un fichier qui en met (02/09), même sur une date qui n'en avait pas besoin", () => {
    const out = personalizeExport("[28/09/2026 10:00:00] Jules: hey\n", { shiftDays: 5 });
    expect(out).toBe("[03/10/2026 10:00:00] Jules: hey\n");
  });

  it("garde l'ordre américain (mois d'abord) en décalant", () => {
    const us = ["[9/12/26, 10:45:53 PM] Jules: hey", "[9/30/26, 11:02:10 PM] Lea: you up?"].join("\n");
    const out = personalizeExport(us, { shiftDays: 2 });
    expect(out).toBe(["[9/14/26, 10:45:53 PM] Jules: hey", "[10/2/26, 11:02:10 PM] Lea: you up?"].join("\n"));
  });

  it("lit le format Android français « à » et l'année d'abord", () => {
    const out = personalizeExport(
      ["12/09/2026 à 10:45 - Jules: salut", "2026-09-13 11:00 - Léa: hey"].join("\n"),
      { shiftDays: -1 },
    );
    expect(out).toBe(["11/09/2026 à 10:45 - Jules: salut", "2026-09-12 11:00 - Léa: hey"].join("\n"));
  });
});

describe("shiftDaysFor", () => {
  it("pose le dernier message `gapDays` jours avant le jour du téléchargement", () => {
    const shift = shiftDaysFor({ lastDay: "2026-10-11", gapDays: 2, today: "2026-11-05" });
    expect(shift).toBe(23);
    const out = personalizeExport("[11/10/2026 22:30:00] Léa: j'ai trop kiffé hier soir 🙈\n", { shiftDays: shift });
    expect(inspectExport(out).lastDay).toBe("2026-11-03");
    expect(daysBetween("2026-11-03", "2026-11-05")).toBe(2);
  });

  it("recule les dates quand le fichier est daté dans le futur", () => {
    expect(shiftDaysFor({ lastDay: "2026-11-10", gapDays: 0, today: "2026-11-05" })).toBe(-5);
  });

  it("traverse le passage à l'heure d'hiver sans perdre de jour", () => {
    // 25 octobre 2026 : passage à l'heure d'hiver en France.
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });
});

describe("firstNameOf", () => {
  it("garde le premier mot d'un nom complet", () => {
    expect(firstNameOf("Juliette Chetrit")).toBe("Juliette");
    expect(firstNameOf("  Kelly ")).toBe("Kelly");
    expect(firstNameOf("")).toBe("");
  });
});
