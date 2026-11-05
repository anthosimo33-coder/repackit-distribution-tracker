import { describe, it, expect } from "vitest";
import {
  initialMissionState,
  linkDayGap,
  skipsVideoReview,
} from "../convex/videoReviewSkip";
import { dayOffset, lateDays } from "../convex/calendarStatus";
import {
  buildPublicationMessage,
  publicationLine,
  type PublicationContext,
} from "../convex/notificationMessage";

/** Id TikTok réel : mis en ligne 2026-08-12T16:32:42Z (18 h 32 à Paris). */
const TT_ID = "7673183969470352673";
const TT_URL = `https://www.tiktok.com/@kellyleydie/video/${TT_ID}`;
/** Minuit Paris (heure d'été) du jour `d` d'août 2026 — la forme de `postDate`. */
const aout = (d: number) => Date.UTC(2026, 7, d - 1, 22, 0, 0);
/** Id TikTok synthétique mis en ligne à `at` (même encodage que les vrais). */
const ttIdAt = (at: number) => (BigInt(Math.floor(at / 1000)) << BigInt(32)).toString();
const NOW = Date.UTC(2026, 7, 20);

describe("skipsVideoReview — partenaires seulement", () => {
  it("partenaire (kind absent = partenaire) avec le réglage → oui", () => {
    expect(skipsVideoReview({ kind: undefined, skipVideoReview: true })).toBe(true);
    expect(skipsVideoReview({ kind: "partner", skipVideoReview: true })).toBe(true);
  });
  it("sans le réglage, ou hors partenaire → non", () => {
    expect(skipsVideoReview({ kind: "partner", skipVideoReview: undefined })).toBe(false);
    expect(skipsVideoReview({ kind: "clipper", skipVideoReview: true })).toBe(false);
    expect(skipsVideoReview({ kind: "talent", skipVideoReview: true })).toBe(false);
    expect(skipsVideoReview(null)).toBe(false);
  });
});

describe("initialMissionState — l'état de naissance d'une mission", () => {
  const confiance = { kind: "partner" as const, skipVideoReview: true };
  it("mission normale : todo, et RIEN d'autre de posé", () => {
    expect(initialMissionState(false, { kind: "partner", skipVideoReview: undefined })).toEqual({
      status: "todo",
    });
  });
  it("créatrice de confiance : à publier, d'où elle venait = todo", () => {
    expect(initialMissionState(false, confiance)).toEqual({
      status: "to_publish",
      reviewSkippedFrom: "todo",
    });
  });
  it("compte géré : l'équipe publie, la confiance n'y change rien", () => {
    expect(initialMissionState(true, confiance)).toEqual({
      status: "to_publish",
      managedByAdmin: true,
    });
  });
});

describe("dayOffset — l'écart SIGNÉ, lateDays inchangé", () => {
  const prevu = aout(12);
  it("le bon jour → 0 ; lateDays → null", () => {
    expect(dayOffset({ postDate: prevu, postedAt: aout(12) + 20 * 3_600_000 })).toBe(0);
    expect(lateDays({ postDate: prevu, postedAt: aout(12) + 20 * 3_600_000 })).toBeNull();
  });
  it("deux jours d'avance → −2 ; lateDays ne compte toujours pas l'avance", () => {
    expect(dayOffset({ postDate: prevu, postedAt: aout(10) + 3_600_000 })).toBe(-2);
    expect(lateDays({ postDate: prevu, postedAt: aout(10) + 3_600_000 })).toBeNull();
  });
  it("trois jours de retard → 3 des deux côtés", () => {
    expect(dayOffset({ postDate: prevu, postedAt: aout(15) + 3_600_000 })).toBe(3);
    expect(lateDays({ postDate: prevu, postedAt: aout(15) + 3_600_000 })).toBe(3);
  });
});

describe("linkDayGap — le jour LU DANS LE LIEN contre le jour prévu", () => {
  const cible = (url: string, platform = "TikTok") => [
    { platform, publishedUrl: url, publishedAt: NOW },
  ];
  it("publié le jour prévu → rien à dire", () => {
    expect(linkDayGap({ postDate: aout(12), targets: cible(TT_URL) }, null, NOW)).toBeNull();
  });
  it("publié la veille du jour prévu → 1 jour d'avance, jour du lien rendu", () => {
    expect(linkDayGap({ postDate: aout(13), targets: cible(TT_URL) }, null, NOW)).toEqual({
      days: -1,
      linkDay: Date.UTC(2026, 7, 12),
      postDate: aout(13),
      platform: "TikTok",
    });
  });
  it("publié le lendemain → 1 jour de retard — même si le lien est collé tout de suite", () => {
    const gap = linkDayGap({ postDate: aout(11), targets: cible(TT_URL) }, null, NOW);
    expect(gap?.days).toBe(1);
  });
  it("lu DANS SON FUSEAU : 23 h 30 UTC, c'est encore le 12 à New York, déjà le 13 à Paris", () => {
    const url = `https://www.tiktok.com/@k/video/${ttIdAt(Date.UTC(2026, 7, 12, 23, 30))}`;
    const a = { postDate: aout(12), targets: cible(url) };
    expect(linkDayGap(a, "America/New_York", NOW)).toBeNull();
    expect(linkDayGap(a, null, NOW)?.days).toBe(1);
  });
  it("pas de date lisible (lien court, YouTube) ou pas de jour prévu → on ne dit rien", () => {
    expect(
      linkDayGap({ postDate: aout(13), targets: cible("https://vm.tiktok.com/ZNRd7Kq2x/") }, null, NOW),
    ).toBeNull();
    expect(
      linkDayGap(
        { postDate: aout(13), targets: cible("https://www.youtube.com/shorts/abc123def45", "YouTube") },
        null,
        NOW,
      ),
    ).toBeNull();
    expect(linkDayGap({ postDate: null, targets: cible(TT_URL) }, null, NOW)).toBeNull();
  });
});

describe("message de publication — sans validation, hors date", () => {
  const ctx: PublicationContext = {
    creatorName: "Kelly",
    campaignName: "Campagne Été",
    formatName: null,
    targets: [{ platform: "TikTok", accountHandle: "@kelly", url: TT_URL }],
    byAdmin: false,
  };
  const msg = (c: PublicationContext) =>
    buildPublicationMessage({ ctx: c, appBaseUrl: "https://app.test", projectSlug: "snytch" });

  it("publication normale : aucune des deux mentions", () => {
    expect(msg(ctx)).not.toContain("sans validation");
    expect(msg(ctx)).not.toContain("Hors date");
    expect(publicationLine(ctx)).not.toContain("sans validation");
  });
  it("sans validation : le message ET la ligne groupée le disent", () => {
    const c = { ...ctx, reviewSkipped: true };
    expect(msg(c)).toContain("Publiée sans validation");
    expect(publicationLine(c)).toContain("(sans validation)");
  });
  it("hors date : le jour du lien, le jour prévu et le sens de l'écart", () => {
    const c: PublicationContext = {
      ...ctx,
      reviewSkipped: true,
      linkDayGap: { days: -1, linkDay: Date.UTC(2026, 7, 12), postDate: aout(13), platform: "TikTok" },
    };
    expect(msg(c)).toContain("Hors date : lien TikTok du 12/08, prévu le 13/08 (1 jour d'avance)");
    expect(publicationLine(c)).toContain("⚠️ lien TikTok du 12/08, prévu le 13/08 (1 jour d'avance)");
  });
});
