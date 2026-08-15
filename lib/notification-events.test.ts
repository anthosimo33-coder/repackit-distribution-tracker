import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_KEYS,
  isEventEnabled,
  sanitizeEnabledEvents,
  type NotificationEventKey,
} from "./notification-events";
// Réplique serveur (A6) importée en RELATIF : le test verrouille la parité des
// DEUX implémentations. Le module convex est PUR (aucun import `_generated`),
// donc chargeable tel quel par vitest.
import * as convexEvents from "../convex/notificationEvents";

describe("catalogue — forme et contenu", () => {
  it("expose les 13 événements du catalogue", () => {
    expect(NOTIFICATION_EVENT_KEYS).toEqual([
      "video_submitted",
      "video_resubmitted",
      "video_approved",
      "video_rejected",
      "publication_confirmed",
      "publication_late",
      "whop_dispute",
      "whop_renewal_failed",
      "digest_overdue_missions",
      "digest_pay_cycles",
      "digest_warmup_late",
      "digest_clipper_sans_talent",
      "evening_unpublished",
    ]);
  });

  it("8 immédiats, 4 digest, 1 planifié — le classement arbitré", () => {
    const immediate = NOTIFICATION_EVENTS.filter((e) => e.kind === "immediate");
    const digest = NOTIFICATION_EVENTS.filter((e) => e.kind === "digest");
    expect(immediate.map((e) => e.key)).toEqual([
      "video_submitted",
      "video_resubmitted",
      "video_approved",
      "video_rejected",
      "publication_confirmed",
      "publication_late",
      "whop_dispute",
      "whop_renewal_failed",
    ]);
    expect(digest.map((e) => e.key)).toEqual([
      "digest_overdue_missions",
      "digest_pay_cycles",
      "digest_warmup_late",
      "digest_clipper_sans_talent",
    ]);
    // `scheduled` : ni réaction à un geste, ni section du digest — un envoi à
    // une heure choisie, avec son propre message.
    expect(
      NOTIFICATION_EVENTS.filter((e) => e.kind === "scheduled").map((e) => e.key),
    ).toEqual(["evening_unpublished"]);
  });

  it("aucune clé dupliquée, tout est libellé", () => {
    expect(new Set(NOTIFICATION_EVENT_KEYS).size).toBe(
      NOTIFICATION_EVENT_KEYS.length,
    );
    for (const e of NOTIFICATION_EVENTS) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("isEventEnabled — liste d'AUTORISATION", () => {
  it("absent de la liste = éteint", () => {
    expect(isEventEnabled(["video_submitted"], "whop_dispute")).toBe(false);
  });
  it("présent = allumé", () => {
    expect(isEventEnabled(["video_submitted"], "video_submitted")).toBe(true);
  });
  it("config absente = tout éteint (projet jamais configuré)", () => {
    expect(isEventEnabled(undefined, "video_submitted")).toBe(false);
  });
  it("liste vide = tout éteint", () => {
    expect(isEventEnabled([], "video_submitted")).toBe(false);
  });
  it("un événement AJOUTÉ au catalogue arrive éteint sur une config existante", () => {
    // Config écrite avant l'ajout d'un 8e événement : elle ne le contient pas,
    // donc il reste éteint jusqu'à un geste admin explicite. C'est la propriété
    // qui justifie la liste d'autorisation plutôt qu'une liste d'exclusion.
    const ancienneConfig = ["video_submitted", "whop_dispute"];
    for (const k of NOTIFICATION_EVENT_KEYS) {
      if (!ancienneConfig.includes(k)) {
        expect(isEventEnabled(ancienneConfig, k)).toBe(false);
      }
    }
  });
});

describe("sanitizeEnabledEvents — assainissement de la saisie", () => {
  it("écarte les clés inconnues", () => {
    expect(sanitizeEnabledEvents(["video_submitted", "n_importe_quoi"])).toEqual([
      "video_submitted",
    ]);
  });
  it("déduplique et remet dans l'ordre du catalogue", () => {
    expect(
      sanitizeEnabledEvents([
        "whop_dispute",
        "video_submitted",
        "whop_dispute",
      ]),
    ).toEqual(["video_submitted", "whop_dispute"]);
  });
  it("saisie vide → liste vide", () => {
    expect(sanitizeEnabledEvents([])).toEqual([]);
  });
});

// ─── Parité lib/ ↔ convex/ (règle A6) ────────────────────────────────────────
//
// Les deux implémentations DOIVENT être strictement identiques. Si l'une évolue
// sans l'autre, ce bloc casse — c'est tout son objet.

describe("parité lib/ ↔ convex/ (règle A6)", () => {
  it("catalogue identique, champ par champ", () => {
    expect(convexEvents.NOTIFICATION_EVENTS).toEqual(NOTIFICATION_EVENTS);
  });

  it("liste des clés identique et dans le même ordre", () => {
    expect(convexEvents.NOTIFICATION_EVENT_KEYS).toEqual(NOTIFICATION_EVENT_KEYS);
  });

  it("isEventEnabled identique sur toutes les combinaisons", () => {
    const configs: (string[] | undefined)[] = [
      undefined,
      [],
      ["video_submitted"],
      [...NOTIFICATION_EVENT_KEYS],
      ["clé_inconnue"],
    ];
    for (const cfg of configs) {
      for (const key of NOTIFICATION_EVENT_KEYS) {
        expect(convexEvents.isEventEnabled(cfg, key)).toBe(
          isEventEnabled(cfg, key),
        );
      }
    }
  });

  it("sanitizeEnabledEvents identique sur toutes les entrées", () => {
    const inputs: string[][] = [
      [],
      ["video_submitted"],
      ["inconnu"],
      ["whop_dispute", "video_submitted", "whop_dispute"],
      [...NOTIFICATION_EVENT_KEYS].reverse(),
    ];
    for (const input of inputs) {
      expect(convexEvents.sanitizeEnabledEvents(input)).toEqual(
        sanitizeEnabledEvents(input),
      );
    }
  });

  it("les types de clés restent assignables entre les deux modules", () => {
    // Vérification de TYPE (échoue à la compilation si les unions divergent),
    // doublée d'une assertion runtime pour que le test ait un corps.
    const fromLib: NotificationEventKey = "whop_dispute";
    const fromConvex: convexEvents.NotificationEventKey = fromLib;
    expect(fromConvex).toBe("whop_dispute");
  });
});
