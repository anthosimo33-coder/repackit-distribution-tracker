import { describe, expect, it } from "vitest";
import {
  planResetRequest,
  RESET_EMAIL_COOLDOWN_MS,
} from "../convex/passwordResetRequest";

const NOW = Date.UTC(2026, 9, 2, 19, 47, 13);
const base = {
  user: { role: "member" },
  projectId: "m97274geezfkgg0fs19n3xtjyx88w6mv",
  lastTokenCreatedAt: null,
  now: NOW,
};

describe("planResetRequest", () => {
  it("envoie un lien à un compte qui n'en a jamais demandé", () => {
    expect(planResetRequest(base)).toBe("send");
  });

  it("n'envoie rien quand l'email n'a pas de compte", () => {
    expect(planResetRequest({ ...base, user: null })).toBe("ignore");
  });

  it("n'envoie rien à un superadmin", () => {
    expect(planResetRequest({ ...base, user: { role: "superadmin" } })).toBe(
      "ignore",
    );
  });

  it("n'envoie rien à un compte rattaché à aucun projet", () => {
    expect(planResetRequest({ ...base, projectId: null })).toBe("ignore");
  });

  it("retient un second lien demandé pendant le délai, le laisse passer après", () => {
    const juste = NOW - RESET_EMAIL_COOLDOWN_MS + 1_500;
    expect(planResetRequest({ ...base, lastTokenCreatedAt: juste })).toBe(
      "throttled",
    );
    const passe = NOW - RESET_EMAIL_COOLDOWN_MS - 1_500;
    expect(planResetRequest({ ...base, lastTokenCreatedAt: passe })).toBe(
      "send",
    );
  });
});
