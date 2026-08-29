// Testé depuis lib/ mais DÉFINI dans convex/ : le module est pur, et la règle A6
// n'interdit que l'import inverse. Aucune réplique à tenir en phase.
process.env.TZ = "Europe/Paris";

import { describe, expect, it } from "vitest";
import {
  buildReminderEmail,
  groupRemindersByRecipient,
  type ReminderTarget,
} from "../convex/reminderGrouping";
import { reminderEmailCopy } from "../convex/emailMessages";

const J = (h: number) => new Date(2026, 7, 15, h, 0).getTime();
const HIER = new Date(2026, 7, 14, 12, 0).getTime();
const DEMAIN = new Date(2026, 7, 16, 12, 0).getTime();
const APRES = new Date(2026, 7, 17, 12, 0).getTime();

/** Forme de PROD : un lot partage la MÊME échéance, au millième près. */
const cible = (o: Partial<ReminderTarget> & { assignmentId: string }): ReminderTarget => ({
  email: "kelly@exemple.test",
  name: "Kelly",
  locale: null,
  missionLabel: "Fake-feature + Demo LAB",
  dueDate: DEMAIN,
  ...o,
});

describe("groupRemindersByRecipient", () => {
  it("un lot de 11 missions devient UN groupe, pas onze", () => {
    // Le cas réel : lots de 1 à 11 en prod, tous à la même dueDate.
    const lot = Array.from({ length: 11 }, (_, i) =>
      cible({ assignmentId: `a${i}` }),
    );
    const groupes = groupRemindersByRecipient(lot, J(10));
    expect(groupes).toHaveLength(1);
    expect(groupes[0].items).toHaveLength(11);
    // Contrôle de PRÉSENCE apparié : aucune mission n'est PERDUE au passage.
    expect(groupes[0].items.map((i) => i.assignmentId).sort()).toEqual(
      lot.map((i) => i.assignmentId).sort(),
    );
  });

  it("deux personnes restent deux groupes", () => {
    const groupes = groupRemindersByRecipient(
      [
        cible({ assignmentId: "a", email: "kelly@exemple.test" }),
        cible({ assignmentId: "b", email: "jade@exemple.test", name: "Jade" }),
        cible({ assignmentId: "c", email: "kelly@exemple.test" }),
      ],
      J(10),
    );
    expect(groupes.map((g) => g.email)).toEqual([
      "kelly@exemple.test",
      "jade@exemple.test",
    ]);
    expect(groupes[0].items).toHaveLength(2);
    expect(groupes[1].items).toHaveLength(1);
  });

  it("la même boîte à la casse près = UN groupe", () => {
    // Deux fiches d'une même personne (une par projet) peuvent différer de casse.
    const groupes = groupRemindersByRecipient(
      [
        cible({ assignmentId: "a", email: "Kelly@Exemple.test" }),
        cible({ assignmentId: "b", email: "kelly@exemple.test" }),
      ],
      J(10),
    );
    expect(groupes).toHaveLength(1);
    // L'adresse CONSERVÉE est celle d'origine, pas une version minusculée : on
    // n'écrit jamais une adresse réécrite dans un To:.
    expect(groupes[0].email).toBe("Kelly@Exemple.test");
  });

  it("compte les retards, qui donnent le ton du message", () => {
    const g = groupRemindersByRecipient(
      [
        cible({ assignmentId: "a", dueDate: HIER }),
        cible({ assignmentId: "b", dueDate: HIER }),
        cible({ assignmentId: "c", dueDate: DEMAIN }),
      ],
      J(10),
    )[0];
    expect(g.lateCount).toBe(2);
    // Deux tests opposés sur la même condition : sans aucun retard, c'est 0 —
    // et le groupe n'est pas vide pour autant.
    const sansRetard = groupRemindersByRecipient(
      [cible({ assignmentId: "d", dueDate: DEMAIN })],
      J(10),
    )[0];
    expect(sansRetard.lateCount).toBe(0);
    expect(sansRetard.items).toHaveLength(1);
  });

  it("dans un groupe, l'échéance la plus PROCHE est en tête", () => {
    const g = groupRemindersByRecipient(
      [
        cible({ assignmentId: "tard", dueDate: APRES }),
        cible({ assignmentId: "retard", dueDate: HIER }),
        cible({ assignmentId: "demain", dueDate: DEMAIN }),
      ],
      J(10),
    )[0];
    expect(g.items.map((i) => i.assignmentId)).toEqual([
      "retard",
      "demain",
      "tard",
    ]);
  });

  it("aucune cible → aucun groupe (et donc aucun envoi)", () => {
    expect(groupRemindersByRecipient([], J(10))).toEqual([]);
  });
});

describe("buildReminderEmail — une mission vs plusieurs", () => {
  const copyFr = reminderEmailCopy("fr");
  const BASE = "https://app.exemple.test";
  const groupe = (items: ReminderTarget[]) =>
    groupRemindersByRecipient(items, J(10))[0];

  it("UNE mission en retard → message d'avant le chantier, à l'identique", () => {
    const mail = buildReminderEmail(
      groupe([cible({ assignmentId: "asg1", dueDate: HIER })]),
      J(10),
      copyFr,
      BASE,
    );
    expect(mail.grouped).toBe(false);
    expect(mail.subject).toBe("On attend ta vidéo 👀");
    expect(mail.bodyHtml).toContain("Salut Kelly,");
    expect(mail.bodyHtml).toContain(
      "<strong>Fake-feature + Demo LAB</strong> était attendue pour le <strong>14/08/2026</strong>",
    );
    expect(mail.bodyHtml).toContain("réponds-moi directement");
    // LIEN PROFOND vers LA mission — c'est ce qu'on ne devait pas perdre.
    expect(mail.ctaUrl).toBe(`${BASE}/app/assignments/asg1`);
    expect(mail.ctaLabel).toBe("Ouvrir ma mission");
    // Aucune trace de la mise en forme groupée.
    expect(mail.bodyHtml).not.toContain("<ul");
  });

  it("UNE mission à venir → l'autre branche, elle aussi inchangée", () => {
    const mail = buildReminderEmail(
      groupe([cible({ assignmentId: "asg2", dueDate: DEMAIN })]),
      J(10),
      copyFr,
      BASE,
    );
    expect(mail.subject).toBe("Ta mission arrive à échéance");
    expect(mail.bodyHtml).toContain("Petit rappel :");
    expect(mail.ctaUrl).toBe(`${BASE}/app/assignments/asg2`);
  });

  it("PLUSIEURS missions → une liste, et un seul message", () => {
    const mail = buildReminderEmail(
      groupe([
        cible({ assignmentId: "a", dueDate: HIER, missionLabel: "BATCH C" }),
        cible({ assignmentId: "b", dueDate: DEMAIN, missionLabel: "TUTO" }),
        cible({ assignmentId: "c", dueDate: APRES, missionLabel: "Warmup LAB" }),
      ]),
      J(10),
      copyFr,
      BASE,
    );
    expect(mail.grouped).toBe(true);
    expect(mail.subject).toBe("On attend une vidéo 👀");
    expect(mail.bodyHtml).toContain("<strong>3 missions</strong>");
    // Une ligne par mission — c'est le comptage qui remplace les trois e-mails.
    expect((mail.bodyHtml.match(/<li /g) ?? []).length).toBe(3);
    // La seule en retard porte le marqueur, les deux autres non.
    expect(mail.bodyHtml).toContain("BATCH C</strong> — 14/08/2026 <span");
    expect((mail.bodyHtml.match(/en retard/g) ?? []).length).toBe(1);
    // CTA vers la LISTE, pas vers une mission choisie arbitrairement.
    expect(mail.ctaUrl).toBe(`${BASE}/app/missions`);
    expect(mail.ctaLabel).toBe("Voir mes missions");
  });

  it("plusieurs missions SANS retard → ton de rappel, pas de relance", () => {
    // Deux tests opposés sur la même condition (`lateCount`).
    const mail = buildReminderEmail(
      groupe([
        cible({ assignmentId: "a", dueDate: DEMAIN }),
        cible({ assignmentId: "b", dueDate: APRES }),
      ]),
      J(10),
      copyFr,
      BASE,
    );
    expect(mail.subject).toBe("2 missions arrivent à échéance");
    expect(mail.bodyHtml).toContain("Petit rappel");
    expect(mail.bodyHtml).not.toContain("en retard");
  });

  it("le libellé de mission est ÉCHAPPÉ, groupé comme non groupé", () => {
    // Le nom de campagne est saisi par l'admin et atterrit dans du HTML.
    const piege = '<script>alert("x")</script>';
    const seul = buildReminderEmail(
      groupe([cible({ assignmentId: "a", missionLabel: piege })]),
      J(10),
      copyFr,
      BASE,
    );
    const multi = buildReminderEmail(
      groupe([
        cible({ assignmentId: "a", missionLabel: piege }),
        cible({ assignmentId: "b" }),
      ]),
      J(10),
      copyFr,
      BASE,
    );
    for (const mail of [seul, multi]) {
      expect(mail.bodyHtml).not.toContain("<script>");
      expect(mail.bodyHtml).toContain("&lt;script&gt;");
    }
  });

  it("la langue du destinataire pilote tout le message", () => {
    const mail = buildReminderEmail(
      groupe([
        cible({ assignmentId: "a", locale: "en", dueDate: HIER }),
        cible({ assignmentId: "b", locale: "en", dueDate: DEMAIN }),
      ]),
      J(10),
      reminderEmailCopy("en"),
      BASE,
    );
    expect(mail.subject).toBe("We're waiting on a video 👀");
    expect(mail.bodyHtml).toContain("Hi Kelly,");
    expect(mail.bodyHtml).toContain("past due");
    // Date au format US, comme le reste des e-mails anglais.
    expect(mail.bodyHtml).toContain("08/14/2026");
  });
});
