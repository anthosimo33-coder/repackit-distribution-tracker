import { describe, it, expect } from "vitest";
import { LOCALES, TEAM_LOCALES, normalizeLocale, teamLocaleOf } from "../convex/locales";
import { formatUtcDay } from "../convex/accountPhase";
import { postWindowBoundsFor } from "../convex/postWindow";
import { formatDateFr } from "../convex/dateFr";
import {
  approvedEmailCopy,
  assignedEmailCopy,
  emailAmount,
  emailDate,
  inviteEmailCopy,
  nudgeEmailCopy,
  paidEmailCopy,
  rejectedEmailCopy,
  reminderEmailCopy,
  revertedEmailCopy,
} from "../convex/emailMessages";
import { dateFnsLocale } from "./date-fns-locale";
import { formatMoneyDate, formatPercent } from "./format";
import { formatViews } from "./format-rate";

/**
 * ESPAGNOL ET PORTUGAIS — langues du PARCOURS CRÉATEUR seul.
 *
 * Le piège de cet ajout n'est pas dans les catalogues (la garde i18n les tient
 * clé par clé) : il est dans les ~15 endroits du code qui branchaient sur
 * `startsWith("en")` / `startsWith("fr")`. Une troisième langue y tombait dans
 * la branche de l'autre, sans rien casser — « lunes » n'apparaissait jamais, on
 * lisait « lundi 10 août » dans un écran espagnol.
 *
 * Données de la forme de la prod : une date qui n'est pas aujourd'hui, un
 * premier du mois (le « 1er » français), un montant à décimales et à milliers.
 */

const LUNDI_10_AOUT = Date.UTC(2026, 7, 10, 14, 5);
const PREMIER_JANVIER = Date.UTC(2026, 0, 1, 9, 0);

describe("les langues livrées", () => {
  it("es et pt sont des langues créatrices, pas des langues d'équipe", () => {
    expect(LOCALES).toEqual(["fr", "en", "es", "pt"]);
    expect(TEAM_LOCALES).toEqual(["fr", "en"]);
    // L'espace d'équipe n'existe pas en es/pt : il se lit en anglais.
    expect(teamLocaleOf("es")).toBe("en");
    expect(teamLocaleOf("pt")).toBe("en");
    expect(teamLocaleOf("fr")).toBe("fr");
    expect(teamLocaleOf("en")).toBe("en");
  });

  it("les étiquettes régionales du navigateur retombent sur la langue", () => {
    expect(normalizeLocale("pt-BR")).toBe("pt");
    expect(normalizeLocale("es-MX")).toBe("es");
    expect(normalizeLocale("pt-PT")).toBe("pt");
  });
});

describe("mise en forme — jamais la branche d'une autre langue", () => {
  it("jour en lettres, dans l'ordre de la langue", () => {
    expect(formatUtcDay(LUNDI_10_AOUT, "es")).toBe("lunes, 10 de agosto");
    expect(formatUtcDay(LUNDI_10_AOUT, "pt")).toBe("segunda-feira, 10 de agosto");
    // L'écran passe l'étiquette régionale de useIntlLocale(), pas la langue nue.
    expect(formatUtcDay(LUNDI_10_AOUT, "es-ES")).toBe("lunes, 10 de agosto");
    expect(formatUtcDay(LUNDI_10_AOUT, "pt-BR")).toBe("segunda-feira, 10 de agosto");
    // Pas de « 1er » : c'est un ordinal français.
    expect(formatUtcDay(PREMIER_JANVIER, "es")).toBe("jueves, 1 de enero");
    expect(formatUtcDay(PREMIER_JANVIER, "pt")).toBe("quinta-feira, 1 de janeiro");
    expect(formatUtcDay(PREMIER_JANVIER, "fr")).toBe("jeudi 1er janvier");
  });

  it("locale date-fns propre à chaque langue", () => {
    expect(dateFnsLocale("es-ES").code).toBe("es");
    expect(dateFnsLocale("pt-BR").code).toBe("pt-BR");
    expect(dateFnsLocale("fr-FR").code).toBe("fr");
    expect(dateFnsLocale("en-US").code).toBe("en-US");
  });

  it("dates numériques JJ/MM : seul l'anglais US met le mois en tête", () => {
    const troisSeptembre = Date.UTC(2026, 8, 3, 10, 0);
    expect(formatDateFr(troisSeptembre, "es-ES")).toBe("03/09/26");
    expect(formatDateFr(troisSeptembre, "pt-BR")).toBe("03/09/26");
    expect(formatDateFr(troisSeptembre, "en-US")).toBe("09/03/26");
    // L'année n'est allongée qu'en anglais, là où l'ordre est ambigu.
    expect(formatMoneyDate(troisSeptembre, "es-ES")).toBe("03/09/26");
    expect(formatMoneyDate(troisSeptembre, "pt-BR")).toBe("03/09/26");
  });

  it("heures : 21:30 en espagnol, 21h30 en portugais brésilien", () => {
    const soir = { startMin: 21 * 60 + 30, endMin: 23 * 60 };
    expect(postWindowBoundsFor(soir, "es-ES")).toEqual({
      start: "21:30",
      end: "23:00",
      range: "21:30-23:00",
    });
    expect(postWindowBoundsFor(soir, "pt-BR")).toEqual({
      start: "21h30",
      end: "23h",
      range: "21h30-23h",
    });
  });

  it("vues compactes et pourcentages à virgule décimale", () => {
    expect(formatViews(1532, "es-ES")).toBe("1,5 k");
    expect(formatViews(2_450_000, "pt-BR")).toBe("2,5 M");
    expect(formatPercent(0.0412, 2, "es-ES")).toBe("4,12 %");
    expect(formatPercent(0.0412, 2, "pt-BR")).toBe("4,12%");
  });
});

describe("e-mails — une vraie branche par langue", () => {
  it("date et montant dans les conventions de la langue, devise dollar", () => {
    const echeance = Date.UTC(2026, 8, 3, 21, 59);
    expect(emailDate(echeance, "es")).toBe("03/09/2026");
    expect(emailDate(echeance, "pt")).toBe("03/09/2026");
    expect(emailAmount(1234.5, "es")).toBe("1.234,50 US$");
    expect(emailAmount(1234.5, "pt")).toBe("US$ 1.234,50");
    expect(emailAmount(250, "pt")).toBe("US$ 250");
  });

  it("aucun e-mail es/pt ne recopie le français ou l'anglais", () => {
    const copies = [
      inviteEmailCopy,
      approvedEmailCopy,
      rejectedEmailCopy,
      paidEmailCopy,
      revertedEmailCopy,
      assignedEmailCopy,
      nudgeEmailCopy,
      reminderEmailCopy,
    ];
    // Rend chaque champ en texte : les fonctions sont appelées avec des
    // arguments plausibles, pour comparer des phrases et non des références.
    const render = (copy: object) =>
      Object.entries(copy).map(([k, v]) =>
        typeof v === "function" ? `${k}:${String(v("Lucía", "misión", 3))}` : `${k}:${v}`,
      );
    for (const get of copies) {
      const fr = render(get("fr"));
      const en = render(get("en"));
      for (const loc of ["es", "pt"]) {
        const lines = render(get(loc));
        expect(lines).toHaveLength(fr.length);
        for (const [i, line] of lines.entries()) {
          expect(line, `${loc} ${line}`).not.toBe(fr[i]);
          expect(line, `${loc} ${line}`).not.toBe(en[i]);
        }
      }
      expect(render(get("es"))).not.toEqual(render(get("pt")));
    }
  });
});
