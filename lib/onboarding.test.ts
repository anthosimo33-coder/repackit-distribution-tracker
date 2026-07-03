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
): OnboardingServerState {
  return { applicable, accounts };
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
});
