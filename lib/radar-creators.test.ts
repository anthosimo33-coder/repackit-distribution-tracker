import { describe, expect, it } from "vitest";
import {
  CREATOR_LANGS,
  CREATOR_VIDEOS_CAP,
  DEFAULT_CREATOR_LANG,
  DEFAULT_CREATOR_SORT,
  KEPT_CAP,
  appOptions,
  creatorVideos,
  filterCreators,
  keptFirst,
  sortCreators,
  type CreatorRow,
} from "../convex/radarCreatorsMath";
import { multiplierOf } from "../convex/radarNetworkMath";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 11, 12, 0);

const c = (handle: string, o: Partial<CreatorRow> = {}): CreatorRow => ({
  handle,
  bio: null,
  app: "Retain Cards",
  rival: false,
  fans: 100,
  medianViews: 800,
  posts7d: 0,
  lastPostAt: NOW - 24 * HOUR,
  ...o,
});
const handles = (rows: readonly CreatorRow[]) => rows.map((r) => r.handle);

describe("Radar — Créateurs : la liste", () => {
  it("s'ouvre sur le français, triée par ce qu'une vidéo du compte fait d'habitude", () => {
    expect(DEFAULT_CREATOR_LANG).toBe("fr");
    expect(DEFAULT_CREATOR_SORT).toBe("median");
    // « autre » n'est pas une langue de compte : un compte n'a une langue que si TikTok en donne une à ses légendes.
    expect(CREATOR_LANGS).not.toContain("autre");
  });

  it("par vues habituelles : 1 461 abonnés et 13 979 vues par vidéo passent devant 40 818 abonnés et 7 038 vues", () => {
    // @reviseavecnoa2 (1 461 abonnés, 13 979 vues par vidéo) et @learnwithlanto (40 818 abonnés, 7 038), le 11/11/2026.
    const rows = [c("learnwithlanto", { fans: 40_818, medianViews: 7_038 }), c("reviseavecnoa2", { fans: 1_461, medianViews: 13_979 }), c("carlarevise", { fans: 28, medianViews: 768 })];
    expect(handles(sortCreators(rows, "median"))).toEqual(["reviseavecnoa2", "learnwithlanto", "carlarevise"]);
    expect(handles(sortCreators(rows, "fans"))).toEqual(["learnwithlanto", "reviseavecnoa2", "carlarevise"]);
  });

  it("un compte sans normale connue passe après ceux qu'on sait juger, même avec plus d'abonnés", () => {
    const rows = [c("sansnormale", { fans: 90_000, medianViews: null }), c("petit", { fans: 10, medianViews: 0 }), c("moyen", { fans: 500, medianViews: 900 })];
    expect(handles(sortCreators(rows, "median"))).toEqual(["moyen", "petit", "sansnormale"]);
  });

  it("par dernière vidéo, et par vidéos de la semaine ; à égalité, l'ordre du pseudo (une liste qui ne saute pas)", () => {
    const rows = [
      c("b", { lastPostAt: NOW - 50 * HOUR, posts7d: 7 }),
      c("a", { lastPostAt: NOW - 50 * HOUR, posts7d: 7 }),
      c("recent", { lastPostAt: NOW - 2 * HOUR, posts7d: 1 }),
      c("jamais", { lastPostAt: null, posts7d: 0 }),
    ];
    expect(handles(sortCreators(rows, "recent"))).toEqual(["recent", "a", "b", "jamais"]);
    expect(handles(sortCreators(rows, "posts"))).toEqual(["a", "b", "recent", "jamais"]);
    // Le tri ne touche pas à la liste reçue.
    expect(handles(rows)).toEqual(["b", "a", "recent", "jamais"]);
  });

  it("le filtre d'app, et la recherche dans le pseudo, la bio et l'app — avec ou sans « @ »", () => {
    const rows = [
      c("lilimystery", { app: "Snitchy", rival: true, bio: "appelée sur une nouvelle enquête" }),
      c("etudie.avec.chlo", { bio: "Astuce pour bien réviser — www.retain.cards" }),
      c("johan_love8", { app: "Love8", bio: "Ambassadeur LOVE8 — collab : johan@exemple.fr" }),
    ];
    expect(handles(filterCreators(rows, { app: "Snitchy", q: "" }))).toEqual(["lilimystery"]);
    expect(handles(filterCreators(rows, { app: null, q: "@Johan" }))).toEqual(["johan_love8"]);
    expect(handles(filterCreators(rows, { app: null, q: "  ambassadeur " }))).toEqual(["johan_love8"]);
    expect(handles(filterCreators(rows, { app: null, q: "retain" }))).toEqual(["etudie.avec.chlo"]);
    // Le nom de l'app compte aussi : ni son pseudo ni sa bio ne disent « Snitchy ».
    expect(handles(filterCreators(rows, { app: null, q: "snitchy" }))).toEqual(["lilimystery"]);
    // Les deux se cumulent.
    expect(filterCreators(rows, { app: "Snitchy", q: "retain" })).toEqual([]);
    expect(filterCreators(rows, { app: null, q: "" })).toHaveLength(3);
  });

  it("les apps du filtre : les concurrentes du projet d'abord, puis les plus fournies", () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => c(`r${i}`)),
      c("s1", { app: "Snitchy", rival: true }),
      c("i1", { app: "The Ick", rival: true }),
      c("i2", { app: "The Ick", rival: true }),
      c("sansapp", { app: null }),
    ];
    expect(appOptions(rows)).toEqual([
      { name: "The Ick", rival: true, count: 2 },
      { name: "Snitchy", rival: true, count: 1 },
      { name: "Retain Cards", rival: false, count: 3 },
    ]);
  });
});

describe("Radar — Créateurs : les TikToks d'un compte", () => {
  const score = (median: number | undefined) => (views: number) => multiplierOf(views, median) ?? null;
  const vid = (n: number, ageH: number, views: number, o: object = {}) => ({ videoId: `75${n}`, publishedAt: NOW - ageH * HOUR, views, ...o });
  const sig = (n: number, ageH: number, views: number, o: object = {}) => ({ ...vid(n, ageH, views), url: `https://www.tiktok.com/@ancien/video/75${n}`, ...o });

  it("ses vidéos relevées, les plus récentes d'abord, avec leur lien et leur multiple de sa normale", () => {
    const out = creatorVideos("lilimystery", [vid(1, 72, 4_577, { hook: "Il like en secret" }), vid(2, 5, 45_770, { caption: "enquête du jour" })], [], score(4_577));
    expect(out.map((v) => v.videoId)).toEqual(["752", "751"]);
    expect(out[0]).toMatchObject({ url: "https://www.tiktok.com/@lilimystery/video/752", views: 45_770, multiplier: 10, hook: null, caption: "enquête du jour", coverUrl: null, unavailable: null });
    expect(out[1]).toMatchObject({ hook: "Il like en secret", multiplier: 1 });
  });

  it("sans normale connue, pas de multiple", () => {
    expect(creatorVideos("x", [vid(1, 5, 9_000)], [], score(undefined))[0].multiplier).toBeNull();
  });

  it("le signal d'une vidéo lui donne sa miniature, et ses vues quand elles sont plus fraîches", () => {
    const out = creatorVideos("x", [vid(1, 30, 1_000), vid(2, 40, 9_000)], [sig(1, 30, 6_000, { coverUrl: "https://img/1.jpg", hook: "lu sur le signal" }), sig(2, 40, 2_000)], score(1_000));
    // Son texte à l'écran aussi, quand le relevé du compte ne l'avait pas.
    expect(out[0]).toMatchObject({ videoId: "751", views: 6_000, multiplier: 6, coverUrl: "https://img/1.jpg", hook: "lu sur le signal" });
    // Le relevé du compte est plus récent que celui du signal : on garde le plus haut.
    expect(out[1]).toMatchObject({ videoId: "752", views: 9_000 });
  });

  it("un signal qui n'est pas dans ses vidéos relevées (trouvé par la recherche avant qu'on le suive) y entre, une fois", () => {
    const out = creatorVideos("x", [vid(1, 30, 1_000)], [sig(1, 30, 1_000), sig(9, 10, 80_000, { hook: "trouvée avant", caption: "légende" })], score(1_000));
    expect(out.map((v) => v.videoId)).toEqual(["759", "751"]);
    expect(out[0]).toMatchObject({ hook: "trouvée avant", caption: "légende", url: "https://www.tiktok.com/@ancien/video/759" });
  });

  it("les Reels Instagram n'y sont pas : ni ceux du compte, ni ses signaux Instagram", () => {
    const out = creatorVideos("x", [vid(1, 30, 1_000), { videoId: "ig:AbC", platform: "instagram" as const, publishedAt: NOW - HOUR, views: 50_000 }], [sig(7, 2, 9_000, { platform: "instagram" as const })], score(1_000));
    expect(out.map((v) => v.videoId)).toEqual(["751"]);
  });

  it("compte passé en privé : le constat fait sur un signal vaut pour toutes ses vidéos", () => {
    const at = NOW - 3 * HOUR;
    const out = creatorVideos("x", [vid(1, 30, 1_000), vid(2, 60, 1_000), vid(3, 90, 1_000)], [sig(1, 30, 1_000, { unavailable: { reason: "private", at } })], score(1_000));
    expect(out.map((v) => v.unavailable)).toEqual([{ reason: "private", at }, { reason: "private", at }, { reason: "private", at }]);
  });

  it("une vidéo supprimée ne dit rien des autres", () => {
    const gone = { reason: "removed" as const, at: NOW - HOUR };
    const out = creatorVideos("x", [vid(1, 30, 1_000), vid(2, 60, 1_000)], [sig(1, 30, 1_000, { unavailable: gone })], score(1_000));
    expect(out.map((v) => v.unavailable)).toEqual([gone, null]);
  });

  it(`au plus ${CREATOR_VIDEOS_CAP} vidéos, les plus récentes`, () => {
    const many = Array.from({ length: CREATOR_VIDEOS_CAP + 5 }, (_, i) => vid(i, i + 1, 100));
    const out = creatorVideos("x", [...many].reverse(), [], score(100));
    expect(out).toHaveLength(CREATOR_VIDEOS_CAP);
    expect(out[0].videoId).toBe("750");
    expect(out.at(-1)?.videoId).toBe(`75${CREATOR_VIDEOS_CAP - 1}`);
  });
});

describe("Radar — Gardées", () => {
  it("les dernières gardées d'abord, quelle que soit la date de la vidéo", () => {
    const marks = [{ id: "a", updatedAt: NOW - 3 * HOUR }, { id: "b", updatedAt: NOW - HOUR }, { id: "c", updatedAt: NOW - 90 * 24 * HOUR }];
    expect(keptFirst(marks).map((m) => m.id)).toEqual(["b", "a", "c"]);
    expect(marks.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it(`au plus ${KEPT_CAP}, et ce sont les plus récentes`, () => {
    const marks = Array.from({ length: KEPT_CAP + 10 }, (_, i) => ({ id: i, updatedAt: NOW - i * HOUR }));
    const out = keptFirst([...marks].reverse());
    expect(out).toHaveLength(KEPT_CAP);
    expect(out[0].id).toBe(0);
    expect(out.at(-1)?.id).toBe(KEPT_CAP - 1);
  });
});
