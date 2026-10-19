import { describe, it, expect } from "vitest";
import {
  canAddPublishedTarget,
  canAddTarget,
  comboTakenOnPlatform,
  isTargetAccountLocked,
  targetAccountRefusal,
  resolvePublishedTargetDate,
  targetAddRefusal,
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

describe("canAddTarget — une plateforme s'ajoute tant que la vidéo n'est pas sortie", () => {
  it.each(["todo", "in_progress", "video_submitted", "video_rejected", "to_publish"])(
    "AUTORISÉ en %s",
    (status) => {
      expect(canAddTarget(status)).toBe(true);
    },
  );

  it.each(["published", "paid", "validated", "cancelled"])(
    "REFUSÉ en %s (sortie ou abandonnée)",
    (status) => {
      expect(canAddTarget(status)).toBe(false);
    },
  );
});

describe("canAddPublishedTarget — un compte + son lien s'ajoutent à une vidéo SORTIE", () => {
  it.each(["published", "validated"])("AUTORISÉ en %s", (status) => {
    expect(canAddPublishedTarget(status)).toBe(true);
  });

  it.each(["todo", "in_progress", "video_submitted", "video_rejected", "to_publish", "cancelled"])(
    "REFUSÉ en %s (pas sortie : on ajoute le compte sans lien, il sera exigé à la publication)",
    (status) => {
      expect(canAddPublishedTarget(status)).toBe(false);
    },
  );

  it("REFUSÉ en paid : le montant de la vidéo est versé", () => {
    expect(canAddPublishedTarget("paid")).toBe(false);
  });

  it("aucun statut n'ouvre les DEUX ajouts à la fois", () => {
    for (const s of ["todo", "to_publish", "published", "paid", "validated", "cancelled"]) {
      expect(canAddTarget(s) && canAddPublishedTarget(s)).toBe(false);
    }
  });
});

describe("resolvePublishedTargetDate — la cible ajoutée ne déplace pas la vidéo", () => {
  // TikTok sorti le 19/10 à 18 h (Paris, = 16 h UTC), saisie le 20/10 à 10 h.
  const releasedAt = Date.UTC(2026, 9, 19, 16, 0);
  const now = Date.UTC(2026, 9, 20, 8, 0);
  const bounds = { releasedAt, now };

  it("garde toute date entre la sortie et maintenant", () => {
    expect(resolvePublishedTargetDate(releasedAt, bounds)).toEqual({ at: releasedAt });
    expect(resolvePublishedTargetDate(now, bounds)).toEqual({ at: now });
    const lendemain = Date.UTC(2026, 9, 20, 6, 0);
    expect(resolvePublishedTargetDate(lendemain, bounds)).toEqual({ at: lendemain });
  });

  it("le JOUR de la sortie, une heure antérieure (midi envoyé par l'écran) est recalée sur la sortie", () => {
    const midiParis = Date.UTC(2026, 9, 19, 10, 0);
    expect(resolvePublishedTargetDate(midiParis, bounds)).toEqual({ at: releasedAt });
    // 00 h 30 à Paris le 19 = 22 h 30 UTC le 18 : même jour de Paris.
    const minuitEtDemi = Date.UTC(2026, 9, 18, 22, 30);
    expect(resolvePublishedTargetDate(minuitEtDemi, bounds)).toEqual({ at: releasedAt });
  });

  it("refuse le futur", () => {
    expect(resolvePublishedTargetDate(now + 1, bounds)).toEqual({ refusal: "future" });
  });

  it("refuse un jour antérieur à la sortie — la vidéo changerait de cycle de paie", () => {
    // 23 h 30 à Paris le 18 = 21 h 30 UTC le 18 : la veille, à Paris.
    expect(resolvePublishedTargetDate(Date.UTC(2026, 9, 18, 21, 30), bounds)).toEqual({
      refusal: "beforeRelease",
    });
  });
});

describe("comboTakenOnPlatform — unicité du script par plateforme", () => {
  const self = { _id: "k17self", status: "todo", targets: [{ platform: "TikTok" }, { platform: "Instagram" }] };

  it("libre quand seule l'assignation elle-même porte le combo", () => {
    expect(comboTakenOnPlatform([self], { excludeId: "k17self", platform: "Snapchat" })).toBe(false);
    // Elle-même vise TikTok : exclue, donc pas un conflit avec soi.
    expect(comboTakenOnPlatform([self], { excludeId: "k17self", platform: "TikTok" })).toBe(false);
  });

  it("PRIS quand une autre assignation vivante vise déjà la plateforme", () => {
    const other = { _id: "k17other", status: "to_publish", targets: [{ platform: "Snapchat" }] };
    expect(comboTakenOnPlatform([self, other], { excludeId: "k17self", platform: "Snapchat" })).toBe(true);
    // …mais pas une autre plateforme.
    expect(comboTakenOnPlatform([self, other], { excludeId: "k17self", platform: "Facebook" })).toBe(false);
  });

  it("PRIS aussi quand l'autre ligne est publiée (le script y est déjà sorti)", () => {
    const other = { _id: "k17other", status: "paid", targets: [{ platform: "Snapchat" }] };
    expect(comboTakenOnPlatform([self, other], { excludeId: "k17self", platform: "Snapchat" })).toBe(true);
  });

  it.each(["cancelled", "video_rejected"])(
    "une assignation %s ne réserve rien (jamais publiée)",
    (status) => {
      const other = { _id: "k17other", status, targets: [{ platform: "Snapchat" }] };
      expect(comboTakenOnPlatform([self, other], { excludeId: "k17self", platform: "Snapchat" })).toBe(false);
    },
  );
});

describe("targetAddRefusal — refus du remplacement + format + script", () => {
  const ok = {
    available: true,
    accountManaged: false,
    assignmentManaged: false,
    formatAllowed: true,
    comboTaken: false,
  };

  it("accepte un compte disponible, même mode, format compatible, script libre", () => {
    expect(targetAddRefusal(ok)).toBe(null);
  });

  it("reprend les refus du remplacement", () => {
    expect(targetAddRefusal({ ...ok, available: false })).toBe("unavailable");
    expect(targetAddRefusal({ ...ok, accountManaged: true })).toBe("managedMismatch");
  });

  it("refuse un format non publiable sur la plateforme", () => {
    expect(targetAddRefusal({ ...ok, formatAllowed: false })).toBe("formatIncompatible");
  });

  it("refuse un script déjà pris sur la plateforme", () => {
    expect(targetAddRefusal({ ...ok, comboTaken: true })).toBe("comboUsed");
  });
});
