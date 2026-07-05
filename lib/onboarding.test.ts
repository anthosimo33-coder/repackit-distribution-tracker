import { describe, it, expect } from "vitest";
import {
  deriveOnboarding,
  type OnboardingAccount,
  type OnboardingServerState,
} from "./onboarding";

function acc(over: Partial<OnboardingAccount> = {}): OnboardingAccount {
  return {
    id: "c1",
    handle: "@moi",
    plateforme: "TikTok",
    status: "warmup",
    checksDone: 0,
    targetDays: 7,
    warmupDone: false,
    dueToday: true,
    bio: "none",
    ...over,
  };
}

function state(
  accounts: OnboardingAccount[],
  applicable = true,
  fullyManaged = false,
): OnboardingServerState {
  return { applicable, accounts, fullyManaged };
}

describe("deriveOnboarding", () => {
  it("hors Snytch (non applicable) → toujours complete, quel que soit l'état", () => {
    const d = deriveOnboarding(state([], false));
    expect(d.applicable).toBe(false);
    expect(d.complete).toBe(true);
  });

  it("créatrice neuve (0 compte) → declare todo, PAS complete", () => {
    const d = deriveOnboarding(state([]));
    expect(d.hasDeclaredAccount).toBe(false);
    expect(d.steps.declare).toBe("todo");
    expect(d.steps.warmup).toBe("upcoming");
    expect(d.steps.validation).toBe("upcoming");
    expect(d.complete).toBe(false);
  });

  it("warmup en cours → declare done, warmup in_progress, validation upcoming", () => {
    const d = deriveOnboarding(
      state([acc({ checksDone: 3, targetDays: 7, warmupDone: false })]),
    );
    expect(d.steps.declare).toBe("done");
    expect(d.steps.warmup).toBe("in_progress");
    expect(d.steps.validation).toBe("upcoming");
    expect(d.best?.checksDone).toBe(3);
    expect(d.complete).toBe(false);
  });

  it("warmup terminé mais NON validé → warmup done, validation pending, PAS complete", () => {
    const d = deriveOnboarding(
      state([acc({ checksDone: 7, targetDays: 7, warmupDone: true })]),
    );
    expect(d.steps.warmup).toBe("done");
    expect(d.steps.validation).toBe("pending");
    expect(d.hasActiveAccount).toBe(false);
    expect(d.complete).toBe(false);
  });

  it("compte actif sans bio → complete, toutes étapes done, bio na", () => {
    const d = deriveOnboarding(
      state([acc({ status: "actif", warmupDone: true, bio: "none" })]),
    );
    expect(d.steps.declare).toBe("done");
    expect(d.steps.warmup).toBe("done");
    expect(d.steps.validation).toBe("done");
    expect(d.steps.bio).toBe("na");
    expect(d.complete).toBe(true);
  });

  it("compte actif + bio appliquée → complete, bio done", () => {
    const d = deriveOnboarding(
      state([acc({ status: "actif", warmupDone: true, bio: "applied" })]),
    );
    expect(d.steps.bio).toBe("done");
    expect(d.complete).toBe(true);
  });

  it("compte actif MAIS bio à appliquer → PAS complete, bio todo", () => {
    const d = deriveOnboarding(
      state([acc({ status: "actif", warmupDone: true, bio: "to_apply" })]),
    );
    expect(d.bioPending).toBe(true);
    expect(d.steps.bio).toBe("todo");
    expect(d.complete).toBe(false);
  });

  it("bio non fournie par l'admin → étape bio masquée (na)", () => {
    const d = deriveOnboarding(state([acc({ bio: "none" })]));
    expect(d.bioApplicable).toBe(false);
    expect(d.steps.bio).toBe("na");
  });

  it("best = compte le plus avancé (actif l'emporte sur warmup en cours)", () => {
    const d = deriveOnboarding(
      state([
        acc({ id: "a", plateforme: "TikTok", status: "warmup", warmupDone: false }),
        acc({ id: "b", plateforme: "Instagram", status: "actif", warmupDone: true }),
      ]),
    );
    expect(d.best?.id).toBe("b");
    expect(d.hasActiveAccount).toBe(true);
    expect(d.complete).toBe(true);
  });

  it("shadowban/archived seuls → hors parcours (best null, warmup upcoming)", () => {
    const d = deriveOnboarding(
      state([acc({ status: "archived" }), acc({ status: "shadowban" })]),
    );
    expect(d.hasDeclaredAccount).toBe(true);
    expect(d.best).toBeNull();
    expect(d.steps.warmup).toBe("upcoming");
    expect(d.complete).toBe(false);
  });

  // ─── Comptes GÉRÉS PAR L'ÉQUIPE (#107) — onboarding conscient du mode géré ────

  it("full gérée (0 compte propre, fullyManaged) → complete, PAS de checklist", () => {
    // accounts = [] car les comptes gérés sont exclus côté serveur ; fullyManaged
    // distingue ce cas d'une créatrice NEUVE (qui, elle, doit déclarer).
    const d = deriveOnboarding(state([], true, true));
    expect(d.fullyManaged).toBe(true);
    expect(d.applicable).toBe(true);
    // complete=true ⇒ showChecklist (applicable && !complete) = false → pas de checklist.
    expect(d.complete).toBe(true);
    expect(d.hasDeclaredAccount).toBe(false);
  });

  it("créatrice NEUVE (0 compte, PAS gérée) ≠ full gérée → declare todo, PAS complete", () => {
    const d = deriveOnboarding(state([], true, false));
    expect(d.fullyManaged).toBe(false);
    expect(d.steps.declare).toBe("todo");
    expect(d.complete).toBe(false);
  });

  it("mix (comptes propres + gérés) → checklist sur les PROPRES only, fullyManaged false", () => {
    // Le serveur n'envoie QUE les comptes propres dans `accounts` (gérés exclus) ;
    // fullyManaged=false car il reste ≥1 compte propre. La dérivation porte donc
    // uniquement sur les comptes propres, exactement comme sans compte géré.
    const d = deriveOnboarding(
      state([acc({ checksDone: 2, targetDays: 7, warmupDone: false })], true, false),
    );
    expect(d.fullyManaged).toBe(false);
    expect(d.hasDeclaredAccount).toBe(true);
    expect(d.steps.warmup).toBe("in_progress");
    expect(d.complete).toBe(false);
  });

  it("full propre (0 géré) → onboarding INCHANGÉ (compte actif ⇒ complete)", () => {
    const d = deriveOnboarding(
      state([acc({ status: "actif", warmupDone: true, bio: "none" })], true, false),
    );
    expect(d.fullyManaged).toBe(false);
    expect(d.complete).toBe(true);
    expect(d.steps.validation).toBe("done");
  });
});
