import { describe, expect, it } from "vitest";
import { isCrawlable } from "./robots-policy";

/**
 * Les chemins testés sont ceux de la PRODUCTION, relevés dans les logs runtime
 * du 21/09/2026 — pas des exemples arrondis. Une politique d'exploration qui
 * n'a jamais vu passer une vraie URL d'asset ne prouve rien.
 */
describe("politique d'exploration — ce qui reste ouvert", () => {
  it("laisse entrer sur la vitrine, et seulement sur la racine exacte", () => {
    expect(isCrawlable("/")).toBe(true);
  });

  it("laisse les scripts et les visuels : Google rend la page avant de la juger", () => {
    expect(isCrawlable("/_next/static/chunks/turbopack-0jnpwmas0yw2h.js")).toBe(
      true,
    );
    expect(isCrawlable("/landing/videos/kelly-750k.mp4")).toBe(true);
  });

  it("laisse les dashboards à jeton, pour que l'aperçu de lien survive", () => {
    expect(isCrawlable("/s/ms7dffzt8tbs4yxh74ygvkmwkn8evsnh")).toBe(true);
  });
});

describe("politique d'exploration — ce qui se ferme", () => {
  it("ferme l'espace d'équipe et l'espace créatrice", () => {
    expect(isCrawlable("/admin/repackit/dashboard")).toBe(false);
    expect(isCrawlable("/app/missions")).toBe(false);
    expect(isCrawlable("/app/assignments/ms709dnhaj0ztxjafe54a1ahdh8erea0")).toBe(
      false,
    );
  });

  it("ferme les écrans pré-session, qui n'ont rien à indexer", () => {
    expect(isCrawlable("/login")).toBe(false);
    expect(isCrawlable("/snytch/login")).toBe(false);
    expect(isCrawlable("/join/abc123")).toBe(false);
    expect(isCrawlable("/reset-password/abc123")).toBe(false);
  });

  it("ferme la cible de la réécriture, pas seulement `/`", () => {
    // La vitrine est servie depuis `/accueil/<langue>` : une URL qu'un robot ne
    // doit pas indexer en double, le canonical de la page la ramenant sur `/`.
    expect(isCrawlable("/accueil/fr")).toBe(false);
  });

  it("n'ouvre pas `/sitemap-…` ni `/support` sous prétexte que `/s/` est ouvert", () => {
    // Le piège du préfixe nu : `/s` aurait ouvert tout ce qui commence par un s.
    expect(isCrawlable("/sitemap-index.xml")).toBe(false);
    expect(isCrawlable("/support")).toBe(false);
  });

  it("ne confond pas la racine avec ce qui la suit", () => {
    // `Allow: /$` est ancré : il ne doit pas déteindre sur `/talent`.
    expect(isCrawlable("/talent")).toBe(false);
  });
});
