import { describe, expect, it } from "vitest";
import { loginAvecSuite, suiteApresConnexion } from "./login-suite";

const CONSENTEMENT =
  "/oauth/authorize?response_type=code&client_id=jvcl_Ab12&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&state=Zx9";

describe("suiteApresConnexion", () => {
  it("rend la page de consentement, query comprise", () => {
    expect(suiteApresConnexion(CONSENTEMENT)).toBe(CONSENTEMENT);
    expect(suiteApresConnexion("/oauth/authorize")).toBe("/oauth/authorize");
  });

  it("refuse tout le reste — pas de redirection ouverte", () => {
    for (const x of [
      null,
      undefined,
      "",
      "/",
      "/admin/snytch/dashboard",
      "//evil.example/oauth/authorize",
      "https://evil.example/oauth/authorize",
      "/oauth/authorize-evil",
      "/oauth/authorize/../../admin",
      "/oauth/authorize?x=1\\@evil.example",
      "/oauth/authorize?x=1\r\nLocation: https://evil.example",
    ]) {
      expect(suiteApresConnexion(x), String(x)).toBeNull();
    }
  });
});

describe("loginAvecSuite", () => {
  it("encode le retour dans /login", () => {
    const url = new URL(loginAvecSuite(CONSENTEMENT), "https://app.example");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("suite")).toBe(CONSENTEMENT);
  });

  it("une autre page → /login nu", () => {
    expect(loginAvecSuite("/admin/snytch/comptes")).toBe("/login");
  });
});
