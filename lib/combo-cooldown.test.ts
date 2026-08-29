/**
 * COOLDOWN DE COMBO — la DURÉE, son défaut, et son réglage par projet.
 *
 * Ce fichier couvre ce que `lib/scriptCombos.test.ts` ne couvre volontairement
 * plus : là-bas les cas passent une fenêtre EXPLICITE parce qu'ils testent la
 * mécanique (borne stricte, symétrie, ancre) ; ici on teste la VALEUR — celle
 * qui s'applique réellement en production quand personne n'a rien réglé.
 *
 * Les données ont la forme de la prod : des `comboKey` de vrais ids Convex
 * (« md7… », 3 segments hook:flux:cta) et des dates à MINUIT PARIS, c'est-à-dire
 * 22:00 UTC la veille en été — exactement ce que `postDate` contient en base.
 * Un test qui utiliserait `0`, `1`, `2` comme dates passerait aussi bien avec
 * une arithmétique fausse sur les fuseaux.
 */
import { describe, expect, it } from "vitest";
import {
  COMBO_COOLDOWN_DAYS_FALLBACK,
  COMBO_COOLDOWN_DAYS_MAX,
  COMBO_COOLDOWN_DAYS_MIN,
  assertValidComboCooldownDays,
  comboCooldownDaysOf,
  comboCooldownMsOf,
} from "../convex/comboCooldown";
import { comboKeysInCooldown, type ScheduledComboUsage } from "./scriptCombos";

/** Un vrai comboKey : trois ids Convex, comme ceux stockés sur les assignments. */
const COMBO = "md7f3k9x2q1p:md7a8b4c6d2e:md7z1y5w9v3u";

/** Mardi 11/08/2026, minuit heure de PARIS = 10/08 22:00 UTC (heure d'été). */
const MARDI = Date.UTC(2026, 7, 10, 22, 0, 0);
const JOUR = 86_400_000;
const LUNDI = MARDI - JOUR;
const MERCREDI = MARDI + JOUR;

const usage = (anchorAt: number): ScheduledComboUsage[] => [
  { comboKey: COMBO, anchorAt },
];

/** Ce qu'applique le tirage d'un projet qui n'a rien réglé. */
const DEFAUT = comboCooldownDaysOf({});

describe("durée par défaut du projet", () => {
  it("aucun réglage ⇒ 1 jour", () => {
    expect(COMBO_COOLDOWN_DAYS_FALLBACK).toBe(1);
    expect(comboCooldownDaysOf({})).toBe(1);
    expect(comboCooldownDaysOf({ comboCooldownDays: undefined })).toBe(1);
    expect(comboCooldownDaysOf({ comboCooldownDays: null })).toBe(1);
  });

  it("un réglage de projet PRIME sur le défaut", () => {
    expect(comboCooldownDaysOf({ comboCooldownDays: 7 })).toBe(7);
    expect(comboCooldownMsOf({ comboCooldownDays: 7 })).toBe(7 * JOUR);
  });

  it("0 est une valeur DÉFINIE, pas une absence", () => {
    // Le piège que ce test verrouille : `days || FALLBACK` rendrait 1 ici, et
    // « cooldown désactivé » serait silencieusement sans effet.
    expect(comboCooldownDaysOf({ comboCooldownDays: 0 })).toBe(0);
    expect(comboCooldownMsOf({ comboCooldownDays: 0 })).toBe(0);
  });
});

describe("avec le défaut du produit — un script se réutilise dès le lendemain", () => {
  it("utilisé le jour même : INDISPONIBLE", () => {
    expect(comboKeysInCooldown(usage(MARDI), MARDI, DEFAUT).has(COMBO)).toBe(
      true,
    );
  });

  it("utilisé la VEILLE : disponible le lendemain", () => {
    // Le pendant exact du cas ci-dessus : même combo, même fenêtre, un jour
    // d'écart. C'est ce couple qui prouve que la fenêtre vaut bien 1 jour et
    // non 0 (tout serait libre) ni 2 (rien ne le serait).
    expect(comboKeysInCooldown(usage(LUNDI), MARDI, DEFAUT).size).toBe(0);
  });

  it("et symétriquement : programmer la VEILLE d'un usage de demain passe", () => {
    // La règle est en valeur absolue — planifier à rebours ne la contourne pas,
    // mais un jour d'écart reste un jour d'écart dans les deux sens.
    expect(comboKeysInCooldown(usage(MERCREDI), MARDI, DEFAUT).size).toBe(0);
    expect(comboKeysInCooldown(usage(MERCREDI), MERCREDI, DEFAUT).has(COMBO)).toBe(
      true,
    );
  });

  it("l'ancienne fenêtre de 4 jours bloquait ces mêmes cas", () => {
    // Contre-épreuve de la décision : ce que la valeur précédente refusait et
    // que le défaut actuel autorise. Sans ce cas, remettre 4 en douce ne ferait
    // rougir aucun test de ce fichier.
    expect(comboKeysInCooldown(usage(LUNDI), MARDI, 4).has(COMBO)).toBe(true);
    expect(comboKeysInCooldown(usage(MARDI - 3 * JOUR), MARDI, 4).has(COMBO)).toBe(
      true,
    );
    expect(comboKeysInCooldown(usage(MARDI - 4 * JOUR), MARDI, 4).size).toBe(0);
  });
});

describe("cooldown désactivé (0 jour)", () => {
  it("le même jour redevient libre", () => {
    const off = comboCooldownDaysOf({ comboCooldownDays: 0 });
    expect(comboKeysInCooldown(usage(MARDI), MARDI, off).size).toBe(0);
    // CONTRÔLE DE PRÉSENCE apparié : la même situation avec le défaut bloque.
    expect(comboKeysInCooldown(usage(MARDI), MARDI, DEFAUT).has(COMBO)).toBe(
      true,
    );
  });
});

describe("validation de la saisie admin", () => {
  it("null = « ce projet ne définit rien » — une saisie valide, pas une erreur", () => {
    expect(assertValidComboCooldownDays(null)).toBeUndefined();
  });

  it("les bornes sont acceptées, ce qui les dépasse est refusé", () => {
    expect(assertValidComboCooldownDays(COMBO_COOLDOWN_DAYS_MIN)).toBe(0);
    expect(assertValidComboCooldownDays(COMBO_COOLDOWN_DAYS_MAX)).toBe(30);
    expect(() => assertValidComboCooldownDays(-1)).toThrow();
    expect(() => assertValidComboCooldownDays(31)).toThrow();
  });

  it("refuse ce qui n'est pas un entier", () => {
    expect(() => assertValidComboCooldownDays(1.5)).toThrow();
    expect(() => assertValidComboCooldownDays(Number.NaN)).toThrow();
  });
});
