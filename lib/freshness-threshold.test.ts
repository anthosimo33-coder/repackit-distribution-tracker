import { describe, it, expect } from "vitest";
// Module PUR du hub, lu par l'écran Fiabilité ET l'outil MCP `fiabilite`.
import { freshnessStaleHours, isFreshnessStale } from "../convex/analyticsHubMath";

/**
 * FRAÎCHEUR — un seuil par source, calé sur SA cadence. Les vues ne sont
 * relevées qu'une fois par nuit (23 h 30 Paris) : un seuil commun de 12 h les
 * déclarait « périmées » chaque jour de midi à 23 h 30 alors que tout allait bien.
 * Relevé réel du 30/09/2026 : dernière synchro des vues le 29/09 à 23 h 59
 * Paris, lue le 30/09 à 21 h 45 Paris → « périmé » à tort.
 */
const PARIS_29_23H59 = Date.UTC(2026, 8, 29, 21, 59); // UTC+2
const PARIS_30_21H45 = Date.UTC(2026, 8, 30, 19, 45);
const H = 3_600_000;

describe("fraîcheur des sources — un seuil par cadence", () => {
  it("les vues relevées la nuit dernière restent FRAÎCHES le soir suivant", () => {
    expect(isFreshnessStale("scraping", PARIS_29_23H59, PARIS_30_21H45)).toBe(false);
  });

  it("une nuit de relevé sautée est signalée dès le lendemain matin", () => {
    // Dernier relevé le 29 à 23 h 59, rien le 30 au soir : le 1er/10 à 06 h 30
    // Paris, 30 h 31 min se sont écoulées.
    const PARIS_01_06H30 = Date.UTC(2026, 9, 1, 4, 30);
    expect(isFreshnessStale("scraping", PARIS_29_23H59, PARIS_01_06H30)).toBe(true);
  });

  it("PostHog et Whop gardent 12 h : ils se synchronisent plusieurs fois par jour", () => {
    const derniere = PARIS_30_21H45 - 13 * H;
    expect(isFreshnessStale("posthog", derniere, PARIS_30_21H45)).toBe(true);
    expect(isFreshnessStale("whop", derniere, PARIS_30_21H45)).toBe(true);
    expect(isFreshnessStale("whop", PARIS_30_21H45 - 11 * H, PARIS_30_21H45)).toBe(false);
  });

  it("source inconnue : le seuil le plus strict ; jamais synchronisée : périmée", () => {
    expect(freshnessStaleHours("source_future")).toBe(12);
    expect(isFreshnessStale("source_future", PARIS_30_21H45 - 13 * H, PARIS_30_21H45)).toBe(true);
    expect(isFreshnessStale("scraping", null, PARIS_30_21H45)).toBe(true);
  });

  it("le seuil affiché est celui appliqué", () => {
    expect(freshnessStaleHours("scraping")).toBe(30);
    expect(freshnessStaleHours("posthog")).toBe(12);
  });
});
