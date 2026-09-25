import { describe, it, expect } from "vitest";
import {
  isTargetAccountLocked,
  targetAccountRefusal,
} from "../convex/targetAccountSwap";

describe("isTargetAccountLocked — le compte d'une cible change tant qu'elle n'est pas publiée", () => {
  it.each(["todo", "in_progress", "video_submitted", "video_rejected", "to_publish"])(
    "LIBRE en %s, sans lien ni publication",
    (status) => {
      expect(isTargetAccountLocked(status, {})).toBe(false);
      expect(
        isTargetAccountLocked(status, { publishedUrl: null, publicationId: undefined }),
      ).toBe(false);
    },
  );

  it.each(["published", "paid", "validated"])(
    "VERROUILLÉE en %s, même sans lien sur la cible (legacy migrée)",
    (status) => {
      expect(isTargetAccountLocked(status, {})).toBe(true);
    },
  );

  it("VERROUILLÉE dès que la cible porte un lien — publication partielle d'un clip (B5)", () => {
    expect(
      isTargetAccountLocked("to_publish", {
        publishedUrl: "https://www.tiktok.com/@thekellychapters_/video/7552112233445566778",
      }),
    ).toBe(true);
  });

  it("VERROUILLÉE dès que la cible porte une publication", () => {
    expect(
      isTargetAccountLocked("to_publish", { publicationId: "k57abc123publication" }),
    ).toBe(true);
  });
});

describe("targetAccountRefusal — mêmes refus qu'à la création + mode géré inchangé", () => {
  it("accepte un compte disponible du même mode", () => {
    expect(
      targetAccountRefusal({ available: true, accountManaged: false, assignmentManaged: false }),
    ).toBe(null);
    expect(
      targetAccountRefusal({ available: true, accountManaged: true, assignmentManaged: true }),
    ).toBe(null);
  });

  it("refuse un compte indisponible (chauffe, non validé, shadowban)", () => {
    expect(
      targetAccountRefusal({ available: false, accountManaged: false, assignmentManaged: false }),
    ).toBe("unavailable");
  });

  it("refuse un compte géré par l'équipe sur une assignation de créatrice", () => {
    expect(
      targetAccountRefusal({ available: true, accountManaged: true, assignmentManaged: false }),
    ).toBe("managedMismatch");
  });

  it("refuse un compte de créatrice sur une assignation gérée par l'équipe", () => {
    expect(
      targetAccountRefusal({ available: true, accountManaged: false, assignmentManaged: true }),
    ).toBe("managedMismatch");
  });

  it("l'indisponibilité prime : c'est le refus que la création aurait opposé", () => {
    expect(
      targetAccountRefusal({ available: false, accountManaged: true, assignmentManaged: false }),
    ).toBe("unavailable");
  });
});
