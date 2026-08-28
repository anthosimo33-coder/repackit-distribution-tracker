import { describe, it, expect } from "vitest";
import {
  defaultTargetDays,
  warmupTargetDaysOf,
  isAccountAvailable,
  isWarmupComplete,
  WARMUP_TARGET_DAYS_FALLBACK,
} from "./warmup";

/**
 * DURÉE DE WARMUP PAR PROJET — le barème n'est plus une constante de l'app.
 *
 * Ce fichier verrouille les deux choses que le chantier a corrigées :
 *   1. chaque projet impose SA durée, et un chemin d'écriture qui l'ignorerait
 *      reposerait 7 en silence (ici on prouve que le barème passe bien) ;
 *   2. la publication reste gouvernée par le gate STRICT chez Snytch — la durée
 *      ne l'ouvre pas.
 *
 * Les barèmes sont ceux de la PROD, pas un jeu inventé.
 */
const REPACKIT = { tiktok: 7, instagram: 14, youtube: 7 };
const SNYTCH = { tiktok: 3, instagram: 3, youtube: 3 };

/** n checks distincts — seul leur NOMBRE compte pour la complétion. */
const checks = (n: number) => Array.from({ length: n }, (_, i) => `d${i}`);
const compte = (plateforme: "TikTok" | "Instagram", n: number) => ({
  plateforme,
  status: "warmup" as const,
  warmupProtocol: { dailyChecks: checks(n) },
});

describe("Le barème du projet gouverne la durée figée", () => {
  it("SNYTCH pose 3 sur TikTok ET Instagram", () => {
    const d = warmupTargetDaysOf({ warmupTargetDays: SNYTCH });
    expect(defaultTargetDays("TikTok", d)).toBe(3);
    expect(defaultTargetDays("Instagram", d)).toBe(3);
  });

  it("REPACKIT garde 7 / 14 / 7", () => {
    const d = warmupTargetDaysOf({ warmupTargetDays: REPACKIT });
    expect(defaultTargetDays("TikTok", d)).toBe(7);
    expect(defaultTargetDays("Instagram", d)).toBe(14);
    expect(defaultTargetDays("YouTube", d)).toBe(7);
  });

  it("CONTRE-ÉPREUVE — un projet sans barème ne prend PAS celui de Snytch", () => {
    // Le piège du chantier : un site d'écriture qui oublie le projet. Il ne peut
    // plus compiler, mais si un jour un défaut revenait, il vaudrait 7/14/7 —
    // jamais 3. Cette assertion le fige.
    const d = warmupTargetDaysOf({});
    expect(d).toEqual(WARMUP_TARGET_DAYS_FALLBACK);
    expect(defaultTargetDays("TikTok", d)).toBe(7);
    expect(defaultTargetDays("TikTok", d)).not.toBe(3);
  });

  it("la complétion suit le barème du projet, pas un global", () => {
    const trois = compte("Instagram", 3);
    // Chez Snytch : 3 checks suffisent. Chez RepackIt : il en faut 14.
    expect(isWarmupComplete(trois, SNYTCH)).toBe(true);
    expect(isWarmupComplete(trois, REPACKIT)).toBe(false);
  });
});

describe("Publication — REPACKIT (non strict) : la durée décide", () => {
  it("3 checks sur une cible de 3 → DISPONIBLE", () => {
    const troisJours = { tiktok: 3, instagram: 3, youtube: 3 };
    expect(isAccountAvailable(compte("TikTok", 3), troisJours)).toBe(true);
  });

  it("2 checks sur une cible de 3 → INDISPONIBLE", () => {
    const troisJours = { tiktok: 3, instagram: 3, youtube: 3 };
    expect(isAccountAvailable(compte("TikTok", 2), troisJours)).toBe(false);
  });

  it("le même compte à 3 checks reste indisponible sur un barème à 7", () => {
    // C'est la régression que le chantier corrige : le compte était bloqué non
    // par la règle produit, mais par un barème qui n'était pas le sien.
    expect(isAccountAvailable(compte("TikTok", 3), REPACKIT)).toBe(false);
  });
});

describe("Publication — SNYTCH (gate strict #98) : la durée n'ouvre RIEN", () => {
  it("3 checks, warmup terminé, et pourtant PAS publiable", () => {
    const c = compte("TikTok", 3);
    // Le warmup est bien terminé…
    expect(isWarmupComplete(c, SNYTCH)).toBe(true);
    // …mais publier exige que l'admin repasse le compte en « actif ».
    expect(isAccountAvailable(c, SNYTCH, { strict: true })).toBe(false);
  });

  it("2 checks non plus, évidemment", () => {
    expect(isAccountAvailable(compte("TikTok", 2), SNYTCH, { strict: true })).toBe(
      false,
    );
  });

  it("CONTRÔLE DE PRÉSENCE — en « actif », il devient publiable", () => {
    // Sans ce contre-test, les deux assertions d'absence ci-dessus passeraient
    // aussi si `isAccountAvailable` rendait toujours false.
    expect(
      isAccountAvailable(
        { plateforme: "TikTok", status: "actif" },
        SNYTCH,
        { strict: true },
      ),
    ).toBe(true);
  });
});

describe("Un projet ne définit QUE ses plateformes", () => {
  it("SNYTCH ne définit pas YouTube — il retombe sur le dernier recours", () => {
    // Hors périmètre Snytch : lui donner une valeur affirmerait une règle qui
    // n'existe pas. Le repli est CHAMP PAR CHAMP.
    const d = warmupTargetDaysOf({ warmupTargetDays: { tiktok: 3, instagram: 3 } });
    expect(d.tiktok).toBe(3);
    expect(d.instagram).toBe(3);
    expect(d.youtube).toBe(WARMUP_TARGET_DAYS_FALLBACK.youtube);
    expect(d.youtube).not.toBe(3);
  });

  it("un barème partiel ne contamine pas les autres plateformes", () => {
    const d = warmupTargetDaysOf({ warmupTargetDays: { instagram: 5 } });
    expect(d.instagram).toBe(5);
    expect(d.tiktok).toBe(WARMUP_TARGET_DAYS_FALLBACK.tiktok);
    expect(d.youtube).toBe(WARMUP_TARGET_DAYS_FALLBACK.youtube);
  });
});
