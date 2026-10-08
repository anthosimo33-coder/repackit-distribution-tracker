import { describe, expect, it } from "vitest";
import {
  judgeRecruitTrial,
  recruitsFromDocs,
  type RecruitAssignmentDoc,
  type RecruitCreatorDoc,
  type RecruitPublicationDoc,
  type TrialPublication,
  type TrialVideo,
} from "../convex/recruitTrial";
import {
  RECRUIT_KEEP_MIN_VIEWS,
  RECRUIT_MATURITY_MS,
} from "../convex/decisionThresholds";

const H = 3_600_000;
const D = 24 * H;
// 08/10/2026, 11 h 47 Paris — l'heure du rejeu sur l'export de prod.
const NOW = Date.UTC(2026, 9, 8, 9, 47);
// Première vidéo du test : 30/09/2026, 18 h 12 Paris.
const T0 = Date.UTC(2026, 8, 30, 16, 12);

let seq = 0;
function pub(o: Partial<TrialPublication> = {}): TrialPublication {
  seq += 1;
  return {
    publicationId: `pub_${seq}`,
    plateforme: "TikTok",
    compte: "@sarah_olv8",
    postedAt: T0,
    vues: 1_393,
    ...o,
  };
}

/** n vidéos à un jour d'écart, TikTok + Instagram, vues sous le seuil. */
function videos(n: number, from = T0): TrialVideo[] {
  return Array.from({ length: n }, (_, i) => ({
    assignmentId: `asg_${i}`,
    publications: [
      pub({ postedAt: from + i * D + 37 * 60_000, vues: 811 + i * 53 }),
      pub({
        plateforme: "Instagram",
        compte: "@Sarah_snytch",
        postedAt: from + i * D + 41 * 60_000,
        vues: 98 + i * 17,
      }),
    ],
  }));
}

const tenthOf = (vs: TrialVideo[]) =>
  Math.min(...vs[9].publications.map((p) => p.postedAt));

describe("judgeRecruitTrial — garder", () => {
  it("UNE publication Instagram à 15 347 suffit, avant la 10e vidéo et malgré des relevés manquants (cas Quentin)", () => {
    const vs = videos(6);
    vs[1].publications[1] = pub({
      plateforme: "Instagram",
      compte: "@quentin.snytch",
      postedAt: T0 + D + 41 * 60_000,
      vues: 15_347,
    });
    vs[5].publications[1] = pub({ plateforme: "Instagram", vues: null });
    const j = judgeRecruitTrial(vs, T0 + 6 * D);
    expect(j?.proposed).toBe("keep");
    expect(j?.best?.vues).toBe(15_347);
    expect(j?.best?.plateforme).toBe("Instagram");
    expect(j?.videos).toBe(6);
    expect(j?.unmeasured).toBe(1);
    expect(j?.tenthPostedAt).toBeNull();
  });

  it("le seuil est atteint à 10 000 pile, pas à 9 999", () => {
    const at = (vues: number) => {
      const vs = videos(3);
      vs[2].publications[0] = pub({ postedAt: T0 + 2 * D, vues });
      return judgeRecruitTrial(vs, NOW);
    };
    expect(at(RECRUIT_KEEP_MIN_VIEWS)?.proposed).toBe("keep");
    expect(at(RECRUIT_KEEP_MIN_VIEWS - 1)).toBeNull();
  });

  it("TikTok et Instagram d'une même vidéo ne s'additionnent JAMAIS (6 412 + 4 903)", () => {
    const vs = videos(10);
    vs[4].publications = [
      pub({ postedAt: T0 + 4 * D, vues: 6_412 }),
      pub({ plateforme: "Instagram", postedAt: T0 + 4 * D + 60_000, vues: 4_903 }),
    ];
    const j = judgeRecruitTrial(vs, tenthOf(vs) + RECRUIT_MATURITY_MS);
    expect(j?.proposed).toBe("stop");
    expect(j?.best?.vues).toBe(6_412);
  });

  it("seules les 10 PREMIÈRES vidéos comptent, rangées par date de publication et non par ordre d'arrivée", () => {
    const vs = videos(10);
    // Une 11e vidéo, publiée APRÈS les dix autres mais listée en tête.
    const onzieme: TrialVideo = {
      assignmentId: "asg_tardive",
      publications: [pub({ postedAt: T0 + 10 * D + 2 * H, vues: 52_300 })],
    };
    const j = judgeRecruitTrial([onzieme, ...vs], tenthOf(vs) + RECRUIT_MATURITY_MS);
    expect(j?.proposed).toBe("stop");
    expect(j?.best?.vues).not.toBe(52_300);
    // Contre-épreuve : publiée en PREMIER, la même vidéo fait garder.
    onzieme.publications[0].postedAt = T0 - D;
    expect(judgeRecruitTrial([...vs, onzieme], NOW)?.proposed).toBe("keep");
  });
});

describe("judgeRecruitTrial — arrêter", () => {
  it("rien avant J+7 de la 10e vidéo, « arrêter » à J+7 pile", () => {
    const vs = videos(10);
    const tenth = tenthOf(vs);
    expect(judgeRecruitTrial(vs, tenth + RECRUIT_MATURITY_MS - 1)).toBeNull();
    const j = judgeRecruitTrial(vs, tenth + RECRUIT_MATURITY_MS);
    expect(j?.proposed).toBe("stop");
    expect(j?.videos).toBe(10);
    expect(j?.tenthPostedAt).toBe(tenth);
    expect(j?.unmeasured).toBe(0);
  });

  it("9 vidéos, même anciennes : rien à trancher ; la 10e déclenche le verdict", () => {
    const vs = videos(10, T0 - 40 * D);
    expect(judgeRecruitTrial(vs.slice(0, 9), NOW)).toBeNull();
    expect(judgeRecruitTrial(vs, NOW)?.proposed).toBe("stop");
  });

  it("une publication jamais relevée SUSPEND l'arrêt (verdict « incomplete »), jamais lue comme zéro", () => {
    const vs = videos(10);
    vs[7].publications[1] = pub({ plateforme: "Instagram", vues: null });
    const now = tenthOf(vs) + RECRUIT_MATURITY_MS;
    const j = judgeRecruitTrial(vs, now);
    expect(j?.proposed).toBe("incomplete");
    expect(j?.unmeasured).toBe(1);
    vs[7].publications[1].vues = 1_174;
    expect(judgeRecruitTrial(vs, now)?.proposed).toBe("stop");
  });
});

/* ── Depuis les documents : le chemin exact de la query du dashboard ─────── */

type Fiche = { creator: RecruitCreatorDoc; assignments: RecruitAssignmentDoc[]; pubs: RecruitPublicationDoc[] };

/** Une créatrice et ses missions, sous la forme des documents de prod. */
function fiche(
  name: string,
  status: string,
  vuesParVideo: (number | undefined)[],
  o: { decided?: boolean; from?: number; handle?: string } = {},
): Fiche {
  const id = `crt_${name.replace(/\W/g, "")}`;
  const handle = o.handle ?? "@sarah_olv8";
  const from = o.from ?? T0 - 30 * D;
  const assignments: RecruitAssignmentDoc[] = [];
  const pubs: RecruitPublicationDoc[] = [];
  vuesParVideo.forEach((vues, i) => {
    const pid = `${id}_p${i}`;
    pubs.push({
      _id: pid,
      plateforme: "TikTok",
      compte: handle,
      datePubli: from + i * D + 3 * H,
      postUrl: `https://www.tiktok.com/${handle}/video/76931${i}2810140896544`,
      ...(vues === undefined ? {} : { vuesLatest: vues, latestSnapshotAt: from + i * D + 20 * H }),
    });
    assignments.push({ _id: `${id}_a${i}`, creatorId: id, targets: [{ publicationId: pid }] });
  });
  return {
    creator: {
      _id: id,
      name,
      status,
      ...(o.decided ? { trialDecision: { decision: "keep", decidedAt: NOW - D, decidedBy: "usr_1" } } : {}),
    },
    assignments,
    pubs,
  };
}

const dix = (base: number) => Array.from({ length: 10 }, (_, i) => base + i * 61);

function run(fiches: Fiche[], extra: Partial<Parameters<typeof recruitsFromDocs>[0]> = {}) {
  return recruitsFromDocs({
    creators: fiches.map((f) => f.creator),
    assignments: fiches.flatMap((f) => f.assignments),
    publications: fiches.flatMap((f) => f.pubs),
    now: NOW,
    ...extra,
  });
}

describe("recruitsFromDocs — population", () => {
  it("garde, arrête, suspend — dans cet ordre ; les fiches en pause, parties ou déjà tranchées n'y sont pas", () => {
    const quentin = fiche("Quentin", "active", [...dix(216).slice(0, 9), 15_347], { handle: "@quentin.snytch" });
    const sarah = fiche("Sarah Da Costa", "active", dix(1_174));
    const elena = fiche("Elena 🇨🇱", "active", [...dix(412).slice(0, 9), undefined], { handle: "@elena_secretacc1" });
    const veljko = fiche("Veljko", "paused", dix(1_174));
    const marine = fiche("Marine", "churned", dix(1_174));
    const kelly = fiche("Kelly", "active", dix(1_174), { decided: true });
    const out = run([elena, veljko, sarah, marine, kelly, quentin]);
    expect(out.map((r) => [r.creatorName, r.proposed])).toEqual([
      ["Quentin", "keep"],
      ["Sarah Da Costa", "stop"],
      ["Elena 🇨🇱", "incomplete"],
    ]);
  });

  it("un post warmup, un post Facebook ou un lien non publié ne comptent pas — ni pour garder, ni pour suspendre", () => {
    const f = fiche("Thania", "active", dix(936), { handle: "@thania.snytch" });
    const a = f.assignments[2];
    f.pubs.push(
      // Warmup à 96 200 (cas Kelly de juillet) : pas une vidéo promo.
      { _id: "w1", plateforme: "TikTok", compte: "@thania.snytch", datePubli: T0 - 28 * D, postUrl: "https://www.tiktok.com/@thania.snytch/video/1", isWarmup: true, vuesLatest: 96_200, latestSnapshotAt: T0 - 27 * D },
      // Facebook à 12 000 puis Facebook jamais relevé : hors règle.
      { _id: "fb1", plateforme: "Facebook", compte: "@Kellydgtl", datePubli: T0 - 28 * D, postUrl: "https://www.facebook.com/share/1M63gzP7jz", vuesLatest: 12_000, latestSnapshotAt: T0 - 27 * D },
      { _id: "fb2", plateforme: "Facebook", compte: "@Kellydgtl", datePubli: T0 - 28 * D, postUrl: "https://www.facebook.com/share/1M63gzP7j2" },
      // Mission confirmée sans lien : pas publiée.
      { _id: "nu", plateforme: "Instagram", compte: "@thania.snytch", datePubli: T0 - 28 * D, vuesLatest: 30_000, latestSnapshotAt: T0 - 27 * D },
    );
    a.targets = [...(a.targets ?? []), { publicationId: "w1" }, { publicationId: "fb1" }, { publicationId: "fb2" }, { publicationId: "nu" }];
    const [r] = run([f]);
    expect(r.proposed).toBe("stop");
    expect(r.unmeasured).toBe(0);
    expect(r.best?.vues).toBe(936 + 9 * 61);
    // Présence : la même publication à 30 000, AVEC son lien, fait garder.
    f.pubs.find((p) => p._id === "nu")!.postUrl = "https://www.instagram.com/reel/DeFcziFu1Xq/";
    expect(run([f])[0].proposed).toBe("keep");
  });

  it("le champ legacy `publicationId` et `targets` désignant la même publication ne font qu'une", () => {
    const f = fiche("Mewen", "active", [undefined, ...dix(1_410).slice(1)], { handle: "@Withmewen" });
    f.assignments[0].publicationId = f.assignments[0].targets![0].publicationId;
    const [r] = run([f]);
    expect(r.videos).toBe(10);
    expect(r.unmeasured).toBe(1);
    expect(r.proposed).toBe("incomplete");
  });

  it("le relevé rapide prime sur celui de la nuit (8 912 la nuit, 10 450 au relevé de 20 h)", () => {
    const f = fiche("Juliette Chetrit", "active", [...dix(1_246).slice(0, 9), 8_912], { handle: "@juliettesnytch" });
    expect(run([f])[0].proposed).toBe("stop");
    const fresher = new Map([[f.pubs[9]._id, 10_450]]);
    const [r] = run([f], { fresher });
    expect(r.proposed).toBe("keep");
    expect(r.best?.vues).toBe(10_450);
  });
});
