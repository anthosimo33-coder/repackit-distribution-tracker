import { describe, it, expect } from "vitest";
import {
  warmupStateOf,
  compareUrgence,
  type WarmupCompteLike,
} from "./compte-warmup-state";

/**
 * Jeux d'essai à la FORME de la production (projet Snytch, export du
 * 2026-09-09) : les quatre comptes réellement en chauffe ce jour-là, dont
 * `@sofiamatcha22`, démarré depuis 26 jours avec zéro check — le cas que
 * l'écran ne savait pas distinguer d'un démarrage de la veille.
 */
const D = 86_400_000;
const MAINTENANT = Date.parse("2026-09-09T10:00:00Z");
const jour = (n: number) =>
  new Date(MAINTENANT - n * D).toISOString().slice(0, 10);

function compte(p: Partial<WarmupCompteLike> = {}): WarmupCompteLike {
  return {
    status: "warmup",
    plateforme: "TikTok",
    targetDays: 3,
    creatorTimezone: "Europe/Paris",
    warmupProtocol: { targetDays: 3, dailyChecks: [] },
    ...p,
  };
}

describe("warmupStateOf — les quatre états du parc", () => {
  it("« en souffrance » : @sofiamatcha22, 26 jours, zéro check", () => {
    const s = warmupStateOf(
      compte({ warmupStartedAt: MAINTENANT - 26 * D }),
      MAINTENANT,
    );
    expect(s.kind).toBe("enSouffrance");
    // L'ÂGE dit la vérité (26 j) là où les jours manqués plafonnent à la durée
    // cible (3). C'est toute la raison d'être de ce champ.
    expect(s.age).toBe(26);
    expect(s.manques).toBe(3);
    expect(s.targetDays).toBe(3);
  });

  it("« à valider » : @Sophia_secretacc1, 3 checks sur 3", () => {
    const s = warmupStateOf(
      compte({
        warmupStartedAt: MAINTENANT - 3 * D,
        warmupProtocol: {
          targetDays: 3,
          dailyChecks: [jour(2), jour(1), jour(0)],
        },
      }),
      MAINTENANT,
    );
    expect(s.kind).toBe("aValider");
    expect(s.checks).toBe(3);
  });

  it("« check du jour » : démarré ce matin, rien de posé", () => {
    const s = warmupStateOf(
      compte({ warmupStartedAt: MAINTENANT - 2 * 3_600_000 }),
      MAINTENANT,
    );
    expect(s.kind).toBe("duJour");
    expect(s.day).toBe(1);
    expect(s.age).toBe(0);
  });

  it("« à jour » : le check d'aujourd'hui est déjà posé", () => {
    const s = warmupStateOf(
      compte({
        warmupStartedAt: MAINTENANT - 1 * D,
        warmupProtocol: { targetDays: 3, dailyChecks: [jour(0)] },
      }),
      MAINTENANT,
    );
    expect(s.kind).toBe("aJour");
    expect(s.checks).toBe(1);
    expect(s.day).toBe(2);
  });

  it("un compte qui n'est pas en chauffe est classé « none »", () => {
    expect(warmupStateOf(compte({ status: "actif" }), MAINTENANT).kind).toBe(
      "none",
    );
    expect(warmupStateOf(compte({ status: "archived" }), MAINTENANT).kind).toBe(
      "none",
    );
    // Présence, en regard : le même compte en warmup, lui, est bien classé.
    expect(warmupStateOf(compte({ status: "warmup" }), MAINTENANT).kind).toBe(
      "duJour",
    );
  });
});

describe("warmupStateOf — la chauffe jamais démarrée", () => {
  const jamais = warmupStateOf(compte({ warmupStartedAt: undefined }), MAINTENANT);

  it("réclame son premier check sans être dite « en retard »", () => {
    // Marie a deux comptes dans cet état sur le parc réel. Ils n'ont pas de
    // retard : ils n'ont pas commencé.
    expect(jamais.kind).toBe("duJour");
    expect(jamais.age).toBeNull();
    expect(jamais.manques).toBe(0);
  });

  it("ne bascule jamais en souffrance, quel que soit le temps qui passe", () => {
    const beaucoupPlusTard = warmupStateOf(
      compte({ warmupStartedAt: undefined }),
      MAINTENANT + 400 * D,
    );
    expect(beaucoupPlusTard.kind).toBe("duJour");
    // Présence : un compte DÉMARRÉ au même instant, lui, souffre bien.
    expect(
      warmupStateOf(compte({ warmupStartedAt: MAINTENANT }), MAINTENANT + 400 * D)
        .kind,
    ).toBe("enSouffrance");
  });
});

describe("warmupStateOf — la frontière du dépassement", () => {
  it("le jour de l'échéance ne souffre pas encore, le lendemain oui", () => {
    const pile = warmupStateOf(
      compte({ warmupStartedAt: MAINTENANT - 3 * D }),
      MAINTENANT,
    );
    const lendemain = warmupStateOf(
      compte({ warmupStartedAt: MAINTENANT - 4 * D }),
      MAINTENANT,
    );
    expect(pile.kind).toBe("duJour");
    expect(lendemain.kind).toBe("enSouffrance");
  });

  it("des checks complets priment sur le dépassement", () => {
    // Fini en retard reste FINI : c'est une validation qui manque, pas un check.
    const s = warmupStateOf(
      compte({
        warmupStartedAt: MAINTENANT - 40 * D,
        warmupProtocol: {
          targetDays: 3,
          dailyChecks: [jour(30), jour(29), jour(28)],
        },
      }),
      MAINTENANT,
    );
    expect(s.kind).toBe("aValider");
  });

  it("lit la durée SERVIE par le serveur, pas une constante", () => {
    // Instagram tourne à 14 jours sur certains projets : à 10 jours d'âge, un
    // compte à targetDays 14 ne souffre pas, un compte à targetDays 3 si.
    const long = warmupStateOf(
      compte({ targetDays: 14, warmupStartedAt: MAINTENANT - 10 * D }),
      MAINTENANT,
    );
    const court = warmupStateOf(
      compte({ targetDays: 3, warmupStartedAt: MAINTENANT - 10 * D }),
      MAINTENANT,
    );
    expect(long.kind).toBe("duJour");
    expect(court.kind).toBe("enSouffrance");
  });
});

describe("compareUrgence", () => {
  it("ce qui traîne passe devant, puis le plus vieux démarrage", () => {
    const souffre26 = warmupStateOf(
      compte({ warmupStartedAt: MAINTENANT - 26 * D }),
      MAINTENANT,
    );
    const souffre5 = warmupStateOf(
      compte({ warmupStartedAt: MAINTENANT - 5 * D }),
      MAINTENANT,
    );
    const duJour = warmupStateOf(
      compte({ warmupStartedAt: MAINTENANT }),
      MAINTENANT,
    );
    const aValider = warmupStateOf(
      compte({
        warmupStartedAt: MAINTENANT - 3 * D,
        warmupProtocol: { targetDays: 3, dailyChecks: [jour(2), jour(1), jour(0)] },
      }),
      MAINTENANT,
    );
    const ordre = [aValider, duJour, souffre5, souffre26]
      .sort(compareUrgence)
      .map((s) => `${s.kind}:${s.age}`);
    expect(ordre).toEqual([
      "enSouffrance:26",
      "enSouffrance:5",
      "duJour:0",
      "aValider:3",
    ]);
  });
});
