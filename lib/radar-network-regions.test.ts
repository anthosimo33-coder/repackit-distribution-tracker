import { describe, expect, it } from "vitest";
import {
  CAP_FREE_LANGS,
  MAX_OTHER_TOTAL,
  MAX_PER_OTHER_APP,
  MAX_TRACKED,
  NETWORK_REGIONS,
  canAttach,
  capFree,
  networkFoundBy,
  networkPasses,
} from "../convex/radarNetworkMath";
import { networkPageRequest } from "../convex/scrapeCreatorsApi";
import { isRelationFind } from "../convex/radarDiscoveryQueries";

/**
 * Recherche des réseaux avec la région France (11/11/2026). Le fondateur : « on a que 127 comptes de créateurs
 * français ? » — la recherche du réseau d'une app n'indiquait aucun pays à TikTok, et les deux apps où il y a le
 * plus de Françaises (Retain Cards, Astra AI) étaient au plafond de 100 comptes.
 */
describe("recherche du réseau d'une app : la passe France", () => {
  it("chaque recherche passe deux fois : sans région, puis par la France", () => {
    expect(NETWORK_REGIONS).toEqual([null, "FR"]);
    expect(networkPasses(["retain cards", "#retaincards"])).toEqual([
      { kind: "keyword", value: "retain cards", region: null },
      { kind: "keyword", value: "retain cards", region: "FR" },
      { kind: "hashtag", value: "retaincards", region: null },
      { kind: "hashtag", value: "retaincards", region: "FR" },
    ]);
    // Le nombre d'étapes que l'écran affiche pendant la recherche.
    expect(networkPasses(["a", "b", "#c"])).toHaveLength(6);
    expect(networkPasses([])).toEqual([]);
  });

  it("sans région, la requête est celle d'avant, à l'identique", () => {
    expect(networkPageRequest("keyword", "retain cards", undefined)).toEqual({
      path: "/v1/tiktok/search/keyword",
      params: { query: "retain cards", date_posted: "last-3-months", sort_by: "relevance" },
    });
    expect(networkPageRequest("hashtag", "retaincards", undefined)).toEqual({ path: "/v1/tiktok/search/hashtag", params: { hashtag: "retaincards" } });
    expect(networkPageRequest("keyword", "theick", 30).params).toEqual({ query: "theick", date_posted: "last-3-months", sort_by: "relevance", cursor: "30" });
  });

  it("avec la France, la région part dans les deux recherches, page suivante comprise", () => {
    expect(networkPageRequest("keyword", "retain cards", undefined, "FR").params).toEqual({ query: "retain cards", date_posted: "last-3-months", sort_by: "relevance", region: "FR" });
    expect(networkPageRequest("hashtag", "retaincards", 20, "FR")).toEqual({ path: "/v1/tiktok/search/hashtag", params: { hashtag: "retaincards", region: "FR", cursor: "20" } });
  });

  it("un signal garde la passe qui l'a trouvé, sans passer pour une trouvaille de la découverte", () => {
    expect(networkFoundBy("Retain Cards", null)).toBe("réseau Retain Cards");
    expect(networkFoundBy("Retain Cards", "FR")).toBe("réseau Retain Cards·fr");
    expect(isRelationFind([networkFoundBy("Love8", "FR")])).toBe(false);
  });
});

describe("plafond de 100 comptes par app non concurrente : les francophones passent outre", () => {
  const counts = (total: number, ofApp: number, others: number) => ({ total, ofApp, others });

  it("le français, et lui seul", () => {
    expect(CAP_FREE_LANGS).toEqual(["fr"]);
    expect(capFree("fr")).toBe(true);
    for (const l of ["en", "pt", "es-am", "es-es", "autre", ""]) expect(capFree(l)).toBe(false);
    expect(capFree(undefined)).toBe(false);
  });

  it("Retain Cards à 102 comptes : une vidéo en français fait entrer son compte, une vidéo en anglais non", () => {
    const plein = counts(2_174, 102, 1_300);
    expect(canAttach(plein, false, "caption", "fr")).toBe(true);
    expect(canAttach(plein, false, "caption", "en")).toBe(false);
    expect(canAttach(plein, false, "caption")).toBe(false);
    // Le plafond de toutes les apps non concurrentes ensemble non plus ne l'arrête pas.
    expect(canAttach(counts(2_500, MAX_PER_OTHER_APP, MAX_OTHER_TOTAL), false, "caption", "fr")).toBe(true);
  });

  it("le plafond de tous les comptes suivis vaut pour tout le monde", () => {
    expect(canAttach(counts(MAX_TRACKED, 3, 10), false, "caption", "fr")).toBe(false);
    expect(canAttach(counts(MAX_TRACKED, 3, 10), true, "caption", "fr")).toBe(false);
    expect(canAttach(counts(MAX_TRACKED - 1, 3, 10), false, "caption", "fr")).toBe(true);
  });

  it("rien ne change pour le reste : concurrentes sans plafond par app, comptes de départ et ajouts à la main comme avant", () => {
    expect(canAttach(counts(700, 500, 10), true, "caption", "en")).toBe(true);
    expect(canAttach(counts(700, MAX_PER_OTHER_APP - 1, 10), false, "caption", "en")).toBe(true);
    expect(canAttach(counts(700, MAX_PER_OTHER_APP, 10), false, "seed")).toBe(true);
    expect(canAttach(counts(700, MAX_PER_OTHER_APP, 10), false, "manual")).toBe(true);
  });
});
