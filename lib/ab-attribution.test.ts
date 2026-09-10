import { describe, it, expect } from "vitest";
import {
  resolveArm,
  armDivergence,
  type ArmLookup,
} from "../convex/abAttribution";

/**
 * Le rattachement revenu ↔ bras avait une garde anti-flipper qui ne mordait que
 * sur la voie de REPLI : `abVariant ?? fromPosthog` court-circuitait la garde dès
 * que la metadata Whop existait. Ces tests verrouillent la règle « les gardes
 * passent AVANT les deux voies ».
 *
 * Les entrées ont la FORME de la prod : distinctId au format
 * `https://site.snytch.co|<id>`, identifiants `mem_*`, et les trois abonnements
 * réellement fautifs du 22/08/2026 (mem_RkKWAKB4ScRdaQ 4,48 € soft,
 * mem_S0eBnIuMvjMqvn 4,48 € soft, mem_zhBeuPeM9E8d6Q 9,27 € hard).
 */

const DID_FLIPPER_A = "https://site.snytch.co|k177k63g8631ccsgme0drvega18c2h0x";
const DID_FLIPPER_B = "https://site.snytch.co|k17ey7880m4y8bd9ag4vzw98w18bbq60";
const DID_FLIPPER_C = "https://site.snytch.co|k1729xr4v0m1w0dcbz8kq3v6bs8c9ptd";
const DID_STABLE = "https://site.snytch.co|k17b4qm2yy8t0v1hzn5jc0k9dx8ce2rv";
const DID_UNKNOWN = "https://site.snytch.co|k17zzzzzzzzzzzzzzzzzzzzzzzz8czzz";

const lookup: ArmLookup = {
  personArms: new Map([
    [DID_STABLE, "hard"],
    // Un flipper N'EST PAS dans personArms : la requête abPersonArms l'écarte.
    // C'est justement pourquoi son absence ne peut pas servir de garde.
  ]),
  flipperDistinctIds: new Set([DID_FLIPPER_A, DID_FLIPPER_B, DID_FLIPPER_C]),
};

describe("resolveArm — la garde flipper passe avant les DEUX voies", () => {
  it("écarte un abonnement dont la personne est flipper MÊME avec une metadata abVariant", () => {
    // Cas réel mem_RkKWAKB4ScRdaQ : abVariant='soft', personne f43ebbf4 instable.
    // Avant correctif : rendait « soft » et versait 4,48 € dans la colonne soft.
    expect(resolveArm({ abVariant: "soft", distinctId: DID_FLIPPER_A }, lookup)).toEqual({
      variant: null,
      via: null,
      rejected: "flipper",
    });
  });

  it("écarte aussi le bras HARD porté par metadata sur une personne flipper", () => {
    // Cas réel mem_zhBeuPeM9E8d6Q : abVariant='hard', 9,27 €.
    expect(resolveArm({ abVariant: "hard", distinctId: DID_FLIPPER_C }, lookup)).toEqual({
      variant: null,
      via: null,
      rejected: "flipper",
    });
  });

  it("écarte un flipper SANS metadata (la voie de repli était déjà gardée)", () => {
    expect(resolveArm({ distinctId: DID_FLIPPER_B }, lookup).rejected).toBe("flipper");
  });

  it("rattache par metadata quand la personne est stable", () => {
    expect(resolveArm({ abVariant: "soft", distinctId: DID_STABLE }, lookup)).toEqual({
      variant: "soft",
      via: "metadata",
      rejected: null,
    });
  });

  it("rattache par le repli distinctId quand la metadata manque", () => {
    expect(resolveArm({ distinctId: DID_STABLE }, lookup)).toEqual({
      variant: "hard",
      via: "distinctId",
      rejected: null,
    });
  });

  it("écarte une session de QA à bras forcé, metadata ou pas", () => {
    expect(
      resolveArm({ abVariant: "hard", abForced: true, distinctId: DID_STABLE }, lookup).rejected,
    ).toBe("forced");
  });

  it("rend « unassigned » — et non un bras inventé — quand aucune voie ne dit rien", () => {
    expect(resolveArm({ distinctId: DID_UNKNOWN }, lookup)).toEqual({
      variant: null,
      via: null,
      rejected: "unassigned",
    });
    expect(resolveArm({}, lookup).rejected).toBe("unassigned");
  });

  it("ne prend pas une chaîne vide ni 'null' pour un bras", () => {
    // toString(NULL) rend la chaîne 'null' côté HogQL, et le champ Whop peut
    // arriver vide : sans filtre, une 3e colonne « null » apparaissait.
    for (const junk of ["", "  ", "null", "NULL", "undefined"]) {
      expect(resolveArm({ abVariant: junk, distinctId: DID_UNKNOWN }, lookup).variant).toBeNull();
    }
  });

  it("PRÉSENCE — la garde n'écarte QUE les flippers, pas tout le monde", () => {
    // Contrepartie obligatoire des assertions d'absence ci-dessus : sans elle,
    // une garde qui écarterait TOUT passerait les 3 premiers tests.
    const kept = [
      resolveArm({ abVariant: "soft", distinctId: DID_STABLE }, lookup),
      resolveArm({ abVariant: "hard", distinctId: DID_UNKNOWN }, lookup),
      resolveArm({ distinctId: DID_STABLE }, lookup),
    ];
    expect(kept.every((r) => r.variant !== null)).toBe(true);
    expect(kept.map((r) => r.variant)).toEqual(["soft", "hard", "hard"]);
  });

  it("un abonnement SANS distinctId reste rattaché par sa metadata (limite assumée)", () => {
    // La garde s'exerce par distinctId : sans lui, aucun contrôle possible. Le
    // test fige le comportement pour que la limite soit visible, pas subie.
    expect(resolveArm({ abVariant: "soft" }, lookup)).toEqual({
      variant: "soft",
      via: "metadata",
      rejected: null,
    });
  });
});

describe("armDivergence — signalée, jamais tranchée en silence", () => {
  it("signale un désaccord entre metadata et PostHog", () => {
    expect(armDivergence({ abVariant: "soft", distinctId: DID_STABLE }, lookup)).toEqual({
      metadata: "soft",
      posthog: "hard",
    });
  });

  it("ne signale rien quand les deux voies s'accordent", () => {
    expect(armDivergence({ abVariant: "hard", distinctId: DID_STABLE }, lookup)).toBeNull();
  });

  it("ne signale rien quand une seule voie a une valeur", () => {
    expect(armDivergence({ abVariant: "hard", distinctId: DID_UNKNOWN }, lookup)).toBeNull();
    expect(armDivergence({ distinctId: DID_STABLE }, lookup)).toBeNull();
  });
});
