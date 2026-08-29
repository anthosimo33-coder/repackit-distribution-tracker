/**
 * Disponibilité d'un hook (`convex/hookAvailability.ts`).
 *
 * L'enjeu de ces tests : verrouiller que l'affichage suit la VRAIE règle
 * (combo × créatrice × plateforme + cooldown projet) et n'en invente pas une
 * autre au grain du compte.
 */
import { describe, it, expect } from "vitest";
import {
  hookAvailabilityFor,
  isHookAvailable,
  type HookUsage,
} from "../convex/hookAvailability";

const DAY = 86_400_000;
/**
 * Fenêtre EXPLICITE (4 j) et non le défaut produit : ces cas vérifient l'ORDRE
 * des deux règles (unicité d'abord, cooldown ensuite) et la borne stricte, pas
 * la durée retenue par le projet. Les écarts choisis plus bas (2 j, 3 j) n'ont
 * de sens que dans une fenêtre plus large qu'eux.
 */
const COOLDOWN_DAYS = 4;
const COOLDOWN_MS = COOLDOWN_DAYS * DAY;
/** Date visée : 20/08/2026, comme une assignation programmée pour dans 3 jours. */
const CIBLE = Date.UTC(2026, 7, 20, 22, 0);

const usage = (o: Partial<HookUsage> = {}): HookUsage => ({
  creatorId: "cr_kelly",
  creatorName: "Kelly",
  platforms: ["TikTok"],
  anchorAt: CIBLE - 30 * DAY, // vieux : hors cooldown
  comboImposed: false,
  ...o,
});

const etat = (usages: HookUsage[], o: Partial<Parameters<typeof hookAvailabilityFor>[0]> = {}) =>
  hookAvailabilityFor({
    usages,
    creatorId: "cr_kelly",
    platforms: ["TikTok"],
    targetAt: CIBLE,
    cooldownMs: COOLDOWN_MS,
    ...o,
  });

describe("libre", () => {
  it("aucun usage → libre", () => {
    expect(etat([])).toEqual({ kind: "free" });
    expect(isHookAvailable(etat([]))).toBe(true);
  });

  it("usage d'une AUTRE créatrice, hors cooldown → libre", () => {
    // L'unicité est PAR créatrice : le hook d'Orlane ne bloque pas Kelly.
    expect(
      etat([usage({ creatorId: "cr_orlane", creatorName: "Orlane" })]),
    ).toEqual({ kind: "free" });
  });

  it("même créatrice sur une AUTRE plateforme → libre", () => {
    // Cross-plateforme autorisé : le même script sur son TikTok ET son YouTube.
    expect(etat([usage({ platforms: ["YouTube"] })])).toEqual({ kind: "free" });
  });

  it("un combo IMPOSÉ ne consomme pas l'unicité à vie", () => {
    // « Rejouer ce script » ne retire rien de la rotation automatique.
    expect(etat([usage({ comboImposed: true })])).toEqual({ kind: "free" });
  });
});

describe("utilisé — unicité à vie", () => {
  it("même créatrice, même plateforme → utilisé, avec le nom et la date", () => {
    const quand = CIBLE - 30 * DAY;
    expect(etat([usage({ anchorAt: quand })])).toEqual({
      kind: "used",
      creatorName: "Kelly",
      platform: "TikTok",
      at: quand,
    });
  });

  it("l'unicité PRIME sur le cooldown", () => {
    // Un usage récent de la même créatrice coche les deux règles. Annoncer
    // « libre dans 2 jours » sur un hook qu'elle ne reprendra JAMAIS serait un
    // mensonge par omission.
    const recent = CIBLE - 1 * DAY;
    expect(etat([usage({ anchorAt: recent })])).toMatchObject({ kind: "used" });
  });

  it("s'applique même sans date d'ancrage (l'usage existe quand même)", () => {
    expect(etat([usage({ anchorAt: null })])).toEqual({
      kind: "used",
      creatorName: "Kelly",
      platform: "TikTok",
      at: null,
    });
  });

  it("rend la plateforme EN COLLISION, pas la première de la liste", () => {
    const a = etat([usage({ platforms: ["Instagram", "TikTok"] })]);
    expect(a).toMatchObject({ platform: "TikTok" });
  });
});

describe("cooldown — fenêtre projet", () => {
  it("usage RÉCENT d'une autre créatrice → en cooldown, avec la date de sortie", () => {
    const recent = CIBLE - 1 * DAY;
    expect(
      etat([
        usage({ creatorId: "cr_orlane", creatorName: "Orlane", anchorAt: recent }),
      ]),
    ).toEqual({ kind: "cooldown", until: recent + COOLDOWN_MS });
  });

  it("un combo IMPOSÉ occupe bien la fenêtre (c'est une vraie publication)", () => {
    // Symétrique du test d'unicité : imposé = ignoré de l'unicité, mais PAS du
    // cooldown. Une vidéo imposée sort le même jour que les autres.
    const recent = CIBLE - 1 * DAY;
    expect(
      etat([
        usage({
          creatorId: "cr_orlane",
          creatorName: "Orlane",
          anchorAt: recent,
          comboImposed: true,
        }),
      ]),
    ).toEqual({ kind: "cooldown", until: recent + COOLDOWN_MS });
  });

  it("borne EXACTE : un écart de COOLDOWN_DAYS pile est autorisé", () => {
    const pile = CIBLE - COOLDOWN_MS;
    expect(
      etat([usage({ creatorId: "cr_o", creatorName: "O", anchorAt: pile })]),
    ).toEqual({ kind: "free" });
    // Une milliseconde de moins bloque.
    expect(
      etat([usage({ creatorId: "cr_o", creatorName: "O", anchorAt: pile + 1 })]),
    ).toMatchObject({ kind: "cooldown" });
  });

  it("plusieurs usages bloquants → la date la PLUS TARDIVE", () => {
    // Rendre la plus proche promettrait une disponibilité qu'un autre usage
    // bloque encore.
    const tot = CIBLE - 3 * DAY;
    const tard = CIBLE - 1 * DAY;
    expect(
      etat([
        usage({ creatorId: "cr_a", creatorName: "A", anchorAt: tot }),
        usage({ creatorId: "cr_b", creatorName: "B", anchorAt: tard }),
      ]),
    ).toEqual({ kind: "cooldown", until: tard + COOLDOWN_MS });
  });

  it("sans date visée, pas de cooldown calculable — seule l'unicité s'applique", () => {
    const recent = Date.UTC(2026, 7, 19, 22, 0);
    expect(
      etat(
        [usage({ creatorId: "cr_o", creatorName: "O", anchorAt: recent })],
        { targetAt: null },
      ),
    ).toEqual({ kind: "free" });
    // Contre-épreuve : l'unicité, elle, s'applique toujours.
    expect(etat([usage({ anchorAt: recent })], { targetAt: null })).toMatchObject({
      kind: "used",
    });
  });
});

describe("isHookAvailable — le filtre « disponible pour »", () => {
  it("ne laisse passer QUE les hooks libres", () => {
    expect(isHookAvailable({ kind: "free" })).toBe(true);
    expect(
      isHookAvailable({
        kind: "used",
        creatorName: "Kelly",
        platform: "TikTok",
        at: null,
      }),
    ).toBe(false);
    expect(isHookAvailable({ kind: "cooldown", until: CIBLE })).toBe(false);
  });
});
