/**
 * Disponibilité d'un hook (`convex/hookAvailability.ts`).
 *
 * L'enjeu de ces tests : verrouiller que l'affichage suit la VRAIE règle
 * (cooldown projet = seul interdit ; « déjà fait » par créatrice × plateforme =
 * une information depuis le 11/11/2026) et n'en invente pas une autre au grain
 * du compte.
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
 * des deux lectures (cooldown d'abord, déjà fait ensuite) et la borne stricte, pas
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
    // « Déjà fait » est PAR créatrice : le hook d'Orlane reste neuf pour Kelly.
    expect(
      etat([usage({ creatorId: "cr_orlane", creatorName: "Orlane" })]),
    ).toEqual({ kind: "free" });
  });

  it("même créatrice sur une AUTRE plateforme → libre", () => {
    // Cross-plateforme autorisé : le même script sur son TikTok ET son YouTube.
    expect(etat([usage({ platforms: ["YouTube"] })])).toEqual({ kind: "free" });
  });

  it("un combo IMPOSÉ ne compte pas comme déjà fait", () => {
    // « Rejouer ce script » ne retire rien de la rotation automatique.
    expect(etat([usage({ comboImposed: true })])).toEqual({ kind: "free" });
  });
});

describe("déjà fait — une information, plus un refus", () => {
  it("même créatrice, même plateforme → déjà fait, avec le nom et la date, et ASSIGNABLE", () => {
    const quand = CIBLE - 30 * DAY;
    expect(etat([usage({ anchorAt: quand })])).toEqual({
      kind: "used",
      creatorName: "Kelly",
      platform: "TikTok",
      at: quand,
    });
    // Scripts réutilisables (11/11/2026) : un hook déjà fait reste assignable.
    expect(isHookAvailable(etat([usage({ anchorAt: quand })]))).toBe(true);
  });

  it("le cooldown PRIME sur « déjà fait »", () => {
    // Un usage récent de la même créatrice coche les deux. Le cooldown est le
    // seul vrai interdit : il faut dire quand le hook redevient assignable.
    const recent = CIBLE - 1 * DAY;
    expect(etat([usage({ anchorAt: recent })])).toEqual({
      kind: "cooldown",
      until: recent + COOLDOWN_MS,
    });
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
    // Symétrique du test « déjà fait » : imposé = ignoré de « déjà fait », mais PAS du
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

  it("sans date visée, pas de cooldown calculable — seul « déjà fait » se lit", () => {
    const recent = Date.UTC(2026, 7, 19, 22, 0);
    expect(
      etat(
        [usage({ creatorId: "cr_o", creatorName: "O", anchorAt: recent })],
        { targetAt: null },
      ),
    ).toEqual({ kind: "free" });
    // Contre-épreuve : « déjà fait », lui, se lit toujours.
    expect(etat([usage({ anchorAt: recent })], { targetAt: null })).toMatchObject({
      kind: "used",
    });
  });
});

describe("isHookAvailable — le filtre « disponible pour »", () => {
  it("ne cache QUE les hooks en cooldown — un hook déjà fait reste assignable", () => {
    expect(isHookAvailable({ kind: "free" })).toBe(true);
    expect(
      isHookAvailable({
        kind: "used",
        creatorName: "Kelly",
        platform: "TikTok",
        at: null,
      }),
    ).toBe(true);
    expect(isHookAvailable({ kind: "cooldown", until: CIBLE })).toBe(false);
  });
});
