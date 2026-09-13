import { describe, expect, it } from "vitest";
import { nextCreatorAction, type NextActionRow } from "./creator-next-action";

/**
 * Données à la forme de la prod : ids Convex, jours prévus posés à minuit Paris
 * (22:00 UTC la veille en été), échéances différentes du jour prévu, et une
 * horloge qui n'est pas « aujourd'hui à minuit ».
 */
const NOW = Date.UTC(2026, 8, 18, 12, 37); // jeu. 18/09/2026 14:37 Paris
const parisMidnight = (d: number) => Date.UTC(2026, 8, d - 1, 22, 0); // 09/d 00:00 Paris
let seq = 0;
function row(over: Partial<NextActionRow> & { status: string }): NextActionRow {
  seq += 1;
  return {
    _id: `k97a3x8y2m1q4z6w0n5b7c9d${String(seq).padStart(2, "0")}`,
    dueDate: parisMidnight(25),
    creatorTimezone: "Europe/Paris",
    targets: [{ platform: "TikTok", publishedAt: null }],
    ...over,
  };
}
const base = { now: NOW, warmupDue: 0, onboardingPending: false };

describe("nextCreatorAction — l'ordre", () => {
  it("le rattrapage passe avant la publication du jour", () => {
    const late = row({ status: "to_publish", postDate: parisMidnight(15) });
    const today = row({ status: "to_publish", postDate: parisMidnight(18) });
    const a = nextCreatorAction({ ...base, rows: [today, late] });
    expect(a.kind).toBe("catchup");
    expect(a.kind === "catchup" && a.row._id).toBe(late._id);
    // Présence appariée : sans le retard, c'est bien la tâche du jour.
    expect(nextCreatorAction({ ...base, rows: [today] }).kind).toBe("publishToday");
  });

  it("parmi plusieurs retards, le plus ancien, et on compte les autres", () => {
    const r12 = row({ status: "todo", postDate: parisMidnight(12) });
    const r9 = row({ status: "to_publish", postDate: parisMidnight(9) });
    const r16 = row({ status: "in_progress", postDate: parisMidnight(16) });
    const a = nextCreatorAction({ ...base, rows: [r12, r16, r9] });
    expect(a).toMatchObject({ kind: "catchup", others: 2 });
    expect(a.kind === "catchup" && a.row._id).toBe(r9._id);
  });

  it("une vidéo refusée passe avant l'onboarding, le warmup et le reste", () => {
    const redo = row({ status: "video_rejected", postDate: parisMidnight(22) });
    const produce = row({ status: "todo", postDate: parisMidnight(20) });
    const a = nextCreatorAction({
      ...base,
      warmupDue: 2,
      onboardingPending: true,
      rows: [produce, redo],
    });
    expect(a.kind).toBe("redo");
  });

  it("onboarding avant le warmup, warmup avant publier et tourner", () => {
    const publish = row({ status: "to_publish", postDate: parisMidnight(24) });
    expect(
      nextCreatorAction({ ...base, warmupDue: 1, onboardingPending: true, rows: [publish] }).kind,
    ).toBe("onboarding");
    expect(
      nextCreatorAction({ ...base, warmupDue: 1, rows: [publish] }),
    ).toEqual({ kind: "warmup", count: 1 });
    expect(nextCreatorAction({ ...base, rows: [publish] }).kind).toBe("publish");
  });

  it("le matin, tourner passe avant la chauffe et la publication", () => {
    const publish = row({ status: "to_publish", postDate: parisMidnight(24) });
    const produce = row({ status: "todo", postDate: parisMidnight(22) });
    expect(
      nextCreatorAction({ ...base, warmupDue: 1, dayPart: "morning", rows: [publish, produce] }).kind,
    ).toBe("produce");
    // Présence appariée : l'après-midi, l'ordre habituel revient.
    expect(
      nextCreatorAction({ ...base, warmupDue: 1, dayPart: "afternoon", rows: [publish, produce] }).kind,
    ).toBe("warmup");
    expect(
      nextCreatorAction({ ...base, dayPart: "evening", rows: [publish, produce] }).kind,
    ).toBe("publish");
  });

  it("le matin ne fait jamais passer tourner avant un retard ou une vidéo à refaire", () => {
    const late = row({ status: "to_publish", postDate: parisMidnight(15) });
    const redo = row({ status: "video_rejected", postDate: parisMidnight(23) });
    const produce = row({ status: "todo", postDate: parisMidnight(22) });
    expect(
      nextCreatorAction({ ...base, dayPart: "morning", rows: [produce, late] }).kind,
    ).toBe("catchup");
    expect(
      nextCreatorAction({ ...base, dayPart: "morning", rows: [produce, redo] }).kind,
    ).toBe("redo");
  });

  it("à tourner : sans date de publication, l'échéance la plus proche", () => {
    const loin = row({ status: "todo", dueDate: parisMidnight(28) });
    const proche = row({ status: "in_progress", dueDate: parisMidnight(21) });
    const a = nextCreatorAction({ ...base, rows: [loin, proche] });
    expect(a.kind === "produce" && a.row._id).toBe(proche._id);
  });

  it("en validation n'est pas « tout est à jour »", () => {
    const sent = row({ status: "video_submitted", postDate: parisMidnight(21) });
    expect(nextCreatorAction({ ...base, rows: [sent] })).toEqual({ kind: "waiting", count: 1 });
    expect(nextCreatorAction({ ...base, rows: [] })).toEqual({ kind: "allClear" });
  });
});

describe("nextCreatorAction — ce qui n'est jamais une action", () => {
  it("un compte géré par l'équipe, même en retard", () => {
    const managed = row({ status: "to_publish", postDate: parisMidnight(10), managedByAdmin: true });
    expect(nextCreatorAction({ ...base, rows: [managed] }).kind).toBe("allClear");
    // Présence appariée : la même mission non gérée est un rattrapage.
    expect(
      nextCreatorAction({ ...base, rows: [{ ...managed, managedByAdmin: false }] }).kind,
    ).toBe("catchup");
  });

  it("une mission publiée ou annulée, même au jour passé", () => {
    const done = row({
      status: "published",
      postDate: parisMidnight(11),
      targets: [{ platform: "TikTok", publishedAt: parisMidnight(11) + 3_600_000 }],
    });
    const cancelled = row({ status: "cancelled", postDate: parisMidnight(13) });
    expect(nextCreatorAction({ ...base, rows: [done, cancelled] }).kind).toBe("allClear");
  });
});
