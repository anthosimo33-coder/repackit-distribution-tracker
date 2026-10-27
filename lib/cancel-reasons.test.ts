import { describe, it, expect } from "vitest";
import {
  REASON_NONE,
  REASON_SKIPPED,
  summarizeCancelReasons,
  type CancelFlowPayload,
  type CancelServerPayload,
} from "../convex/cancelReasons";
import {
  buildQueries,
  shapeCancelFlow,
  shapeCancelServer,
} from "../convex/posthogSync";

/**
 * Motifs de résiliation (carte de l'onglet Rétention + outil MCP `retention`).
 * Les lignes d'entrée ont la forme que PostHog rend en prod (relevé du 27/10) :
 * booléens en 0/1, motif vide pour « parti avant la question », plusieurs
 * personnes par groupe.
 */

const flow = (rows: unknown[][]): CancelFlowPayload => shapeCancelFlow(rows);
const server = (rows: unknown[][]): CancelServerPayload => shapeCancelServer(rows);
const EMPTY_SERVER: CancelServerPayload = { rows: [] };

describe("shapeCancelFlow / shapeCancelServer", () => {
  it("lit les lignes telles que HogQL les rend (0/1, chaînes vides, issue inconnue)", () => {
    const f = flow([
      ["2026-08-14", "too_expensive", "retained", 0, 0, "pause", 3, 1],
      ["2026-09-20", "got_my_answer", "canceled", true, false, "", 0, 2],
      ["2026-09-21", "", "abandoned", 0, 0, "", 0, 1],
      // Issue que l'app aurait renommée : la personne reste comptée.
      ["2026-09-22", "other", "deferred", 0, 0, "", 0, 1],
      // Jour vide (maxIf sans flow) : ligne inexploitable, écartée.
      ["", "other", "canceled", 0, 0, "", 0, 4],
    ]);
    expect(f.rows).toEqual([
      { day: "2026-08-14", reason: "too_expensive", outcome: "retained", selectedPause: false, selectedSwap: false, accepted: "pause", pauseMonths: 3, persons: 1 },
      { day: "2026-09-20", reason: "got_my_answer", outcome: "canceled", selectedPause: true, selectedSwap: false, accepted: "", pauseMonths: 0, persons: 2 },
      { day: "2026-09-21", reason: "", outcome: "abandoned", selectedPause: false, selectedSwap: false, accepted: "", pauseMonths: 0, persons: 1 },
      { day: "2026-09-22", reason: "other", outcome: "abandoned", selectedPause: false, selectedSwap: false, accepted: "", pauseMonths: 0, persons: 1 },
    ]);
    expect(server([["2026-08-19", 1, 1, 1], ["2026-08-20", 0, 0, 6]]).rows).toEqual([
      { day: "2026-08-19", inFlow: true, pausedBefore: true, persons: 1 },
      { day: "2026-08-20", inFlow: false, pausedBefore: false, persons: 6 },
    ]);
  });
});

describe("summarizeCancelReasons", () => {
  // Proportions du 27/10 (90 jours) réduites : la question passée pèse PLUS
  // qu'un vrai motif, et doit pourtant venir après tous les vrais motifs.
  const f = flow([
    ["2026-09-01", "got_my_answer", "canceled", 0, 0, "", 0, 9],
    ["2026-09-01", "got_my_answer", "retained", 1, 0, "pause", 1, 1],
    ["2026-09-02", "too_expensive", "canceled", 0, 0, "", 0, 7],
    ["2026-09-02", "too_expensive", "abandoned", 0, 0, "", 0, 1],
    ["2026-09-03", REASON_SKIPPED, "canceled", 0, 0, "", 0, 8],
    ["2026-09-03", "target_inactive", "retained", 0, 1, "swap", 0, 1],
    ["2026-09-03", "target_inactive", "canceled", 0, 0, "", 0, 5],
    ["2026-09-04", REASON_NONE, "abandoned", 0, 0, "", 0, 2],
    // Pause acceptée AVANT l'event de clic (15/09) : compte comme cliquée.
    ["2026-08-14", "other", "retained", 0, 0, "pause", 3, 1],
  ]);
  const s = server([
    ["2026-09-01", 1, 0, 10],
    ["2026-09-02", 0, 0, 9],
    ["2026-09-03", 1, 1, 1],
    ["2026-08-14", 0, 0, 4],
  ]);

  it("compte des personnes, motifs réels d'abord, question passée et départ avant la question ensuite", () => {
    const r = summarizeCancelReasons(f, s, null);
    expect(r.persons).toBe(35);
    expect(r.answered).toBe(25);
    expect(r.reasons.map((l) => [l.reason, l.persons])).toEqual([
      ["got_my_answer", 10],
      ["too_expensive", 8],
      ["target_inactive", 6],
      ["other", 1],
      [REASON_SKIPPED, 8],
      [REASON_NONE, 2],
    ]);
    expect(r.reasons[0]).toEqual({ reason: "got_my_answer", persons: 10, canceled: 9, retained: 1, abandoned: 0 });
    expect(r.outcomes).toEqual({ canceled: 29, retained: 3, abandoned: 3 });
  });

  it("contre-offres : une acceptation compte comme un clic, durées de pause triées", () => {
    const r = summarizeCancelReasons(f, s, null);
    expect(r.offers).toEqual({
      selectedPause: 2,
      selectedSwap: 1,
      acceptedPause: 2,
      acceptedSwap: 1,
      pauseMonths: [
        { months: 1, persons: 1 },
        { months: 3, persons: 1 },
      ],
    });
  });

  it("résiliations serveur : passées par le questionnaire, sans, et après une pause", () => {
    expect(summarizeCancelReasons(f, s, null).server).toEqual({
      canceled: 24,
      inFlow: 11,
      withoutFlow: 13,
      pausedBefore: 1,
    });
  });

  it("la période borne les deux populations, bornes incluses", () => {
    const r = summarizeCancelReasons(f, s, { from: "2026-09-02", to: "2026-09-03" });
    // Présence : les jours de bord sont dedans.
    expect(r.persons).toBe(22);
    expect(r.reasons.map((l) => l.reason)).toEqual(["too_expensive", "target_inactive", REASON_SKIPPED]);
    expect(r.server).toEqual({ canceled: 10, inFlow: 1, withoutFlow: 9, pausedBefore: 1 });
    // Absence : la veille et le lendemain n'y sont pas.
    expect(r.reasons.some((l) => l.reason === "got_my_answer" || l.reason === REASON_NONE)).toBe(false);
    expect(r.offers.acceptedPause).toBe(0);
  });

  it("une période sans passage rend des zéros, pas une erreur", () => {
    const r = summarizeCancelReasons(f, EMPTY_SERVER, { from: "2026-10-01", to: "2026-10-27" });
    expect(r.persons).toBe(0);
    expect(r.answered).toBe(0);
    expect(r.reasons).toEqual([]);
    expect(r.server.canceled).toBe(0);
  });
});

describe("requête cancelFlow", () => {
  const sql = (buildQueries("", "") as Record<string, string>).cancelFlow;

  it("garde le dernier motif DONNÉ : une question passée ensuite ne l'efface pas", () => {
    // Relevé du 27/10 : sans cette restriction, 96 personnes sortaient en
    // « question passée » au lieu de 75 — 21 avaient répondu avant de passer.
    expect(sql).toMatch(
      /argMaxIf\(toString\(properties\.reason\), timestamp, event = 'cancel_reason_selected' AND ifNull\(toString\(properties\.skipped\), ''\) != 'true'/,
    );
  });
});
