import { describe, expect, it } from "vitest";
import {
  FREE_BREAKER,
  FREE_FRESH_MS,
  FREE_LANE_MAX_MS,
  FREE_REGION_PAGES,
  GAP_PAGES,
  LANE_FRESH_POST_MS,
  LANE_WAIT_FRESH_MS,
  LANE_WAIT_MS,
  freeNote,
  freePlan,
  freeProfileUrl,
  freeRead,
  freeStart,
  freeVideoUrl,
  gapReached,
  laneOrder,
  listGap,
  overflowToPay,
  paced,
  runFreeLane,
  parseFreeProfile,
  parseFreeVideo,
  retrying,
  videoIdTime,
  TRIAL_DETAIL_MAX,
  TRIAL_EVERY,
  TRIAL_PER_DAY,
  TRIAL_TOTAL,
  trialPick,
  trialPlan,
  type FreePage,
  type KnownVideo,
} from "../convex/radarFreeMath";
import { profileNextCursor } from "../convex/scrapeCreatorsApi";

/**
 * Radar — le relevé gratuit d'un compte sur les pages publiques de TikTok (13/11/2026). Les pages d'essai ont la
 * forme relevée ce jour-là : la page d'intégration du profil porte « userInfo » et « videoList », la page d'une
 * vidéo un bloc JSON « __UNIVERSAL_DATA_FOR_REHYDRATION__ ».
 */
const NOW = Date.UTC(2026, 10, 13, 12, 0);
const HOUR = 3_600_000;
/** L'identifiant d'une vidéo publiée à cette heure (ses 32 bits de poids fort sont des secondes). */
const idAt = (ms: number, n = 1) => String((BigInt(Math.floor(ms / 1000)) << BigInt(32)) + BigInt(n));
const V_NEUVE = idAt(NOW - 5 * HOUR, 1);
const V_HIER = idAt(NOW - 30 * HOUR, 2);
const V_SEMAINE = idAt(NOW - 6 * 24 * HOUR, 3);
const V_VIEILLE = idAt(NOW - 20 * 24 * HOUR, 4);

type Listed = { id: string; desc?: string; playCount?: number | string; coverUrl?: string };
const profil = (videos: Listed[], user: Record<string, unknown> = {}) =>
  `<html><script>window.__data={"userInfo":${JSON.stringify({ uniqueId: "lea.revise", followerCount: 1_840, signature: "J'utilise : shortfy.io", privateAccount: false, ...user })},"videoList":${JSON.stringify(videos.map((v) => ({ desc: "", playCount: 0, ...v })))}}</script></html>`;

const video = (id: string, o: Record<string, unknown> = {}, stats: Record<string, unknown> = {}) => {
  const item = {
    id,
    desc: "pq j’apprends ça que mtn 😭 @Koro AI #argent",
    createTime: String(Math.floor(videoIdTime(id) / 1000)),
    author: { id: "7276822206176609312", uniqueId: "lea.revise", signature: "Bio lue sur la page vidéo" },
    authorStats: { followerCount: 1_700 },
    stats: { diggCount: 91, shareCount: 12, commentCount: 3, playCount: 8_410, collectCount: "9", ...stats },
    music: { id: "7706838535877200673", title: "son original", authorName: "lea.revise" },
    stickersOnItem: [{ stickerText: ["Le nom du site\nc'est koro.ai"], stickerType: 4 }, { stickerText: ["  "] }, { stickerText: ["Enregistre"] }],
    textExtra: [
      // Positions en CARACTÈRES, comme TikTok les donne (l'emoji compte pour un).
      { start: 27, end: 35, userId: "9001", userUniqueId: "koroai", type: 0 },
      { start: 36, end: 43, hashtagName: "argent", type: 1 },
      { start: 27, end: 35, userId: "7276822206176609312", type: 0 },
    ],
    video: { duration: "65", cover: "https://p16.tiktokcdn.com/cover.jpeg?x-expires=1" },
    textLanguage: "fr",
    locationCreated: "FR",
    isAd: false,
    ...o,
  };
  return `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.video-detail": { statusCode: 0, itemInfo: { itemStruct: item } } } })}</script></html>`;
};
const supprimee = `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.video-detail": { statusCode: 10204, statusMsg: "item doesn't exist" } } })}</script></html>`;

describe("Radar — relevé gratuit : le profil", () => {
  it("abonnés, bio, et ses vidéos les plus récentes d'abord, chacune avec ses vues et sa date", () => {
    const p = parseFreeProfile(profil([{ id: V_SEMAINE, desc: "épinglée", playCount: 90_000 }, { id: V_NEUVE, desc: "la dernière", playCount: "320", coverUrl: "https://c/1.jpg" }, { id: V_HIER, playCount: 1_200 }]));
    expect(p).toEqual({
      fans: 1_840,
      bio: "J'utilise : shortfy.io",
      private: false,
      videos: [
        { videoId: V_NEUVE, caption: "la dernière", views: 320, publishedAt: NOW - 5 * HOUR, coverUrl: "https://c/1.jpg" },
        { videoId: V_HIER, caption: "", views: 1_200, publishedAt: NOW - 30 * HOUR },
        { videoId: V_SEMAINE, caption: "épinglée", views: 90_000, publishedAt: NOW - 6 * 24 * HOUR },
      ],
    });
  });

  it("la date d'une vidéo se lit dans son identifiant", () => {
    // Une vraie vidéo relevée le 12/11/2026 : publiée à 1 794 483 773 s d'après TikTok, 15 s après la date de son identifiant.
    expect(videoIdTime("7707249055482547470")).toBe(1_794_483_758_000);
    expect(Math.abs(videoIdTime("7707249055482547470") - 1_794_483_773_000)).toBeLessThan(60_000);
    expect(videoIdTime("pas un identifiant")).toBe(0);
  });

  it("un compte privé, une vidéo en double ou sans identifiant, une page sans liste", () => {
    expect(parseFreeProfile(profil([], { privateAccount: true }))?.private).toBe(true);
    expect(parseFreeProfile(profil([{ id: V_NEUVE }, { id: V_NEUVE }, { id: "abc" }, { id: "" }]))?.videos.map((v) => v.videoId)).toEqual([V_NEUVE]);
    expect(parseFreeProfile("<html>ratelimit triggered</html>")).toBeNull();
    expect(parseFreeProfile('<html>"videoList":[]</html>')).toBeNull();
  });
});

describe("Radar — relevé gratuit : la page d'une vidéo", () => {
  it("rend tout ce que le relevé payant donnait, dans la même forme", () => {
    expect(parseFreeVideo(video(V_NEUVE), "lea.revise")).toEqual({
      videoId: V_NEUVE,
      url: `https://www.tiktok.com/@lea.revise/video/${V_NEUVE}`,
      authorId: "7276822206176609312",
      authorHandle: "lea.revise",
      authorFans: 1_700,
      caption: "pq j’apprends ça que mtn 😭 @Koro AI #argent",
      lang: "fr",
      region: "FR",
      publishedAt: NOW - 5 * HOUR,
      durationSec: 65,
      coverUrl: "https://p16.tiktokcdn.com/cover.jpeg?x-expires=1",
      isAd: false,
      views: 8_410,
      likes: 91,
      comments: 3,
      shares: 12,
      // « collectCount » arrive en texte.
      saves: 9,
      // Chaque bloc de texte sur une ligne, les blocs vides écartés.
      hook: "Le nom du site c'est koro.ai · Enregistre",
      musicId: "7706838535877200673",
      musicTitle: "son original",
      musicOwner: "lea.revise",
      // Le compte mentionné (pas un hashtag, pas l'auteur lui-même), son libellé lu dans la légende.
      mentions: [{ id: "9001", label: "@Koro AI" }],
      authorBio: "Bio lue sur la page vidéo",
    });
  });

  it("l'espagnol se range par pays, une langue inconnue en « autre », sans texte à l'écran pas de hook", () => {
    expect(parseFreeVideo(video(V_NEUVE, { textLanguage: "es", locationCreated: "MX" }), "x")).toMatchObject({ lang: "es-am", region: "MX" });
    expect(parseFreeVideo(video(V_NEUVE, { textLanguage: "es", locationCreated: "ES" }), "x")).toMatchObject({ lang: "es-es" });
    const nue = parseFreeVideo(video(V_NEUVE, { textLanguage: "un", stickersOnItem: [], textExtra: [], music: {} }), "x");
    expect(nue).toMatchObject({ lang: "autre" });
    expect(nue).not.toHaveProperty("hook");
    expect(nue).not.toHaveProperty("musicId");
    expect(nue).not.toHaveProperty("mentions");
  });

  it("une vidéo supprimée est « gone » ; une page refusée ou vide ne se lit pas", () => {
    expect(parseFreeVideo(supprimee, "x")).toBe("gone");
    expect(parseFreeVideo("<html>ratelimit triggered</html>", "x")).toBeNull();
    expect(parseFreeVideo('<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{pas du json</script></html>', "x")).toBeNull();
    expect(parseFreeVideo(video(V_NEUVE, { createTime: "0" }), "x")).toBeNull();
  });
});

describe("Radar — relevé gratuit : ce qu'on lit en entier", () => {
  const liste = [V_NEUVE, V_HIER, V_SEMAINE, V_VIEILLE].map((videoId, i) => ({ videoId, caption: "", views: 100 * (i + 1), publishedAt: videoIdTime(videoId), ...(i === 2 ? { coverUrl: "https://c/3.jpg" } : {}) }));

  it("une vidéo inconnue, ou de moins de 48 heures, est lue sur sa page ; les autres ne reçoivent que leurs vues", () => {
    expect(FREE_FRESH_MS).toBe(48 * HOUR);
    const known: KnownVideo[] = [{ videoId: V_HIER }, { videoId: V_SEMAINE }];
    const plan = freePlan(liste, known, NOW);
    // La neuve et la vieille sont inconnues ; celle d'hier est connue mais fraîche.
    expect(plan.detail.map((v) => v.videoId)).toEqual([V_NEUVE, V_HIER, V_VIEILLE]);
    expect(plan.light).toEqual([{ videoId: V_SEMAINE, views: 300, coverUrl: "https://c/3.jpg" }]);
    // Tout est connu et ancien : aucune page vidéo à lire.
    expect(freePlan(liste.slice(2), [{ videoId: V_SEMAINE }, { videoId: V_VIEILLE }], NOW).detail).toEqual([]);
  });

  it("un compte sans pays : deux de ses vidéos rangées dont on ignore le pays sont relues, pas plus", () => {
    expect(FREE_REGION_PAGES).toBe(2);
    const V_MOIS = idAt(NOW - 30 * 24 * HOUR, 5);
    const cinq = [...liste, { videoId: V_MOIS, caption: "", views: 500, publishedAt: videoIdTime(V_MOIS) }];
    const known: KnownVideo[] = [{ videoId: V_HIER }, { videoId: V_SEMAINE }, { videoId: V_VIEILLE }, { videoId: V_MOIS }];
    // Les deux rangées les plus récentes (hors celle d'hier, fraîche, relue de toute façon) ; la troisième garde ses vues.
    const plan = freePlan(cinq, known, NOW, true);
    expect(plan.detail.map((v) => v.videoId)).toEqual([V_NEUVE, V_HIER, V_SEMAINE, V_VIEILLE]);
    expect(plan.light.map((v) => v.videoId)).toEqual([V_MOIS]);
    // Une vidéo dont le pays est déjà rangé n'est pas relue pour ça : la suivante l'est.
    const situee = freePlan(cinq, [{ videoId: V_HIER }, { videoId: V_SEMAINE, region: "FR" }, { videoId: V_VIEILLE }, { videoId: V_MOIS }], NOW, true);
    expect(situee.detail.map((v) => v.videoId)).toEqual([V_NEUVE, V_HIER, V_VIEILLE, V_MOIS]);
    expect(situee.light.map((v) => v.videoId)).toEqual([V_SEMAINE]);
    // Le compte a déjà un pays : rien de plus n'est lu.
    expect(freePlan(cinq, known, NOW).detail.map((v) => v.videoId)).toEqual([V_NEUVE, V_HIER]);
  });

  it("une vidéo PROGRAMMÉE : son identifiant date son téléversement, la fraîcheur se juge sur sa publication rangée (14/11)", () => {
    // Téléversée il y a 6 jours (identifiant), publiée il y a 5 heures (relevé payant, page de la vidéo) : fraîche.
    const programmee: KnownVideo = { videoId: V_SEMAINE, publishedAt: NOW - 5 * HOUR };
    expect(freePlan(liste, [{ videoId: V_HIER }, programmee, { videoId: V_VIEILLE }], NOW).detail.map((v) => v.videoId)).toEqual([V_NEUVE, V_HIER, V_SEMAINE]);
    // Sans date rangée, l'identifiant décide encore (ancienne : seules ses vues).
    expect(freePlan(liste, [{ videoId: V_HIER }, { videoId: V_SEMAINE }, { videoId: V_VIEILLE }], NOW).detail.map((v) => v.videoId)).toEqual([V_NEUVE, V_HIER]);
    // Et l'inverse : rangée publiée il y a 3 jours, même si l'identifiant la dit d'il y a 5 heures.
    expect(freePlan(liste, [{ videoId: V_NEUVE, publishedAt: NOW - 72 * HOUR }, { videoId: V_HIER }, { videoId: V_SEMAINE }, { videoId: V_VIEILLE }], NOW).detail.map((v) => v.videoId)).toEqual([V_HIER]);
  });
});

describe("Radar — relevé gratuit : la liste trouée (14/11/2026)", () => {
  const liste = [V_NEUVE, V_HIER, V_SEMAINE].map((videoId) => ({ videoId, caption: "", views: 1, publishedAt: videoIdTime(videoId) }));

  it("la dernière vidéo qu'on avait du compte n'est plus dans sa liste : trou", () => {
    expect(listGap(liste, { videoId: V_SEMAINE, publishedAt: videoIdTime(V_SEMAINE) })).toBe(false);
    expect(listGap(liste, { videoId: V_VIEILLE, publishedAt: videoIdTime(V_VIEILLE) })).toBe(true);
    // Rien de connu (compte jamais relevé, ou vidéo déjà vérifiée supprimée) : pas de contrôle.
    expect(listGap(liste, null)).toBe(false);
    expect(listGap([], { videoId: V_VIEILLE, publishedAt: 0 })).toBe(false);
  });

  it("le relevé payant d'un trou s'arrête à la vidéo retrouvée, ou passé sa date sans la voir ; 3 pages au plus", () => {
    expect(GAP_PAGES).toBe(3);
    const cible = { videoId: V_SEMAINE, publishedAt: videoIdTime(V_SEMAINE) };
    expect(gapReached(liste.slice(0, 2), cible)).toEqual({ done: false, found: false });
    expect(gapReached(liste, cible)).toEqual({ done: true, found: true });
    // Une vidéo plus ancienne que la cible est arrivée, sans la cible : elle n'est plus en ligne.
    expect(gapReached([liste[0], { videoId: V_VIEILLE, publishedAt: videoIdTime(V_VIEILLE) }], cible)).toEqual({ done: true, found: false });
  });
});

describe("Radar — relevé gratuit : ce qui attend la voie, ce qui part au payant (14/11/2026)", () => {
  const MIN = 60_000;
  const acc = (name: string, dueMinAgo: number, postHoursAgo?: number) => ({
    name,
    dueAt: NOW - dueMinAgo * MIN,
    ...(postHoursAgo !== undefined ? { lastPostAt: NOW - postHoursAgo * HOUR } : {}),
  });

  it("d'abord les comptes qui ont publié ces dernières 24 heures, puis les plus en retard", () => {
    expect(LANE_FRESH_POST_MS).toBe(24 * HOUR);
    const order = laneOrder([acc("calme", 300, 72), acc("frais-recent", 5, 18), acc("vieux", 500), acc("frais-ancien", 30, 20)], NOW).map((a) => a.name);
    expect(order).toEqual(["frais-ancien", "frais-recent", "vieux", "calme"]);
  });

  it("voie ouverte : un compte frais attend 20 min, un autre 1 h ; au-delà, payant « retard »", () => {
    expect([LANE_WAIT_FRESH_MS, LANE_WAIT_MS]).toEqual([20 * MIN, 60 * MIN]);
    const r = overflowToPay([acc("frais-19", 19, 18), acc("frais-20", 20, 18), acc("calme-59", 59, 72), acc("calme-60", 60, 72), acc("jamais-publie", 61)], true, NOW);
    expect(r.reason).toBe("retard");
    expect(r.pay.map((a) => a.name)).toEqual(["frais-20", "calme-60", "jamais-publie"]);
  });

  it("voie fermée (coupe-circuit) : tout ce qui n'a pas été pris part au payant, comme avant", () => {
    const r = overflowToPay([acc("a", 0, 1), acc("b", 1)], false, NOW);
    expect(r).toEqual({ pay: [acc("a", 0, 1), acc("b", 1)], reason: "coupure" });
  });
});

describe("Radar — relevé gratuit : le relevé d'un compte, de bout en bout", () => {
  const io = (pages: Record<string, FreePage | string>, known: KnownVideo[] = []) => {
    const asked: string[] = [];
    return {
      asked,
      page: async (url: string): Promise<FreePage> => {
        asked.push(url);
        const p = pages[url];
        return p === undefined ? { ok: false, kind: "absent" } : typeof p === "string" ? { ok: true, text: p } : p;
      },
      known: async (ids: string[]) => known.filter((k) => ids.includes(k.videoId)),
    };
  };
  const P = freeProfileUrl("lea.revise");
  const U = (id: string) => freeVideoUrl("lea.revise", id);
  const liste = profil([{ id: V_NEUVE, playCount: 9_000 }, { id: V_HIER, playCount: 1_200 }, { id: V_SEMAINE, playCount: 300, coverUrl: "https://c/3.jpg" }]);

  it("lit la vidéo inconnue et la vidéo fraîche sur leur page, donne ses vues à l'ancienne, et le profil fait foi", async () => {
    const t = io({ [P]: liste, [U(V_NEUVE)]: video(V_NEUVE), [U(V_HIER)]: video(V_HIER, {}, { playCount: 1_100 }) }, [
      { videoId: V_HIER, hook: "Texte rangé à son premier relevé", musicId: "111", musicTitle: "Son rangé" },
      { videoId: V_SEMAINE },
    ]);
    const r = await freeRead("lea.revise", t, NOW);
    expect(t.asked).toEqual([P, U(V_NEUVE), U(V_HIER)]);
    expect(r).toMatchObject({ ok: true, pages: 3, profile: { fans: 1_840, bio: "J'utilise : shortfy.io" }, light: [{ videoId: V_SEMAINE, views: 300, coverUrl: "https://c/3.jpg" }] });
    if (!r.ok) throw new Error("attendu : relevé gratuit");
    // Les abonnés et la bio du PROFIL, et les vues les plus hautes des deux pages.
    expect(r.videos.map((v) => [v.videoId, v.authorFans, v.authorBio, v.views])).toEqual([
      [V_NEUVE, 1_840, "J'utilise : shortfy.io", 9_000],
      [V_HIER, 1_840, "J'utilise : shortfy.io", 1_200],
    ]);
    // La vidéo inconnue prend le texte à l'écran et le son de sa page ; la vidéo déjà rangée garde les siens.
    expect([r.videos[0].hook, r.videos[0].musicId]).toEqual(["Le nom du site c'est koro.ai · Enregistre", "7706838535877200673"]);
    expect([r.videos[1].hook, r.videos[1].musicId, r.videos[1].musicTitle]).toEqual(["Texte rangé à son premier relevé", "111", "Son rangé"]);
  });

  it("le profil ne se lit pas, est privé ou vide : le compte passe au relevé payant, sans page de plus", async () => {
    for (const [page, why] of [
      [{ ok: false, kind: "suspect" }, "suspect"],
      [{ ok: false, kind: "absent" }, "absent"],
      ["<html>ratelimit triggered</html>", "suspect"],
      [profil([{ id: V_NEUVE }], { privateAccount: true }), "private"],
      [profil([]), "empty"],
    ] as const) {
      const t = io({ [P]: page as FreePage | string });
      expect(await freeRead("lea.revise", t, NOW)).toMatchObject({ ok: false, why, pages: 1 });
      expect(t.asked).toEqual([P]);
    }
  });

  it("une vidéo INCONNUE dont la page ne se lit pas : relevé payant ; une vidéo connue garde ses vues ; une vidéo supprimée sort", async () => {
    // La neuve est inconnue et sa page est refusée.
    expect(await freeRead("lea.revise", io({ [P]: liste, [U(V_NEUVE)]: { ok: false, kind: "suspect" }, [U(V_HIER)]: video(V_HIER) }, [{ videoId: V_HIER }, { videoId: V_SEMAINE }]), NOW)).toEqual({ ok: false, why: "detail", pages: 2 });
    // Celle d'hier est connue, sa page est refusée : ses vues suffisent. La neuve a été supprimée entre-temps.
    const r = await freeRead("lea.revise", io({ [P]: liste, [U(V_NEUVE)]: supprimee, [U(V_HIER)]: { ok: false, kind: "suspect" } }, [{ videoId: V_HIER }, { videoId: V_SEMAINE }]), NOW);
    expect(r).toMatchObject({ ok: true, videos: [], pages: 3 });
    if (r.ok) expect(r.light.map((l) => [l.videoId, l.views])).toEqual([[V_SEMAINE, 300], [V_HIER, 1_200]]);
  });

  it("un compte sans pays : sa vidéo rangée est relue pour le situer, garde son texte ; si sa page manque, ses vues suffisent", async () => {
    const known: KnownVideo[] = [{ videoId: V_HIER, region: "GB" }, { videoId: V_SEMAINE, hook: "Texte rangé" }];
    const pages = { [P]: liste, [U(V_NEUVE)]: video(V_NEUVE), [U(V_HIER)]: video(V_HIER), [U(V_SEMAINE)]: video(V_SEMAINE, { locationCreated: "BE" }, { playCount: 250 }) };
    const t = io(pages, known);
    const r = await freeRead("lea.revise", t, NOW, undefined, true);
    expect(t.asked).toEqual([P, U(V_NEUVE), U(V_HIER), U(V_SEMAINE)]);
    if (!r.ok) throw new Error("attendu : relevé gratuit");
    // Le pays de la vidéo rangée est lu sur sa page ; son texte reste celui déjà rangé, ses vues les plus hautes des deux pages.
    expect(r.videos.map((v) => [v.videoId, v.region, v.hook, v.views])).toEqual([
      [V_NEUVE, "FR", "Le nom du site c'est koro.ai · Enregistre", 9_000],
      [V_HIER, "FR", undefined, 8_410],
      [V_SEMAINE, "BE", "Texte rangé", 300],
    ]);
    expect(r.light).toEqual([]);
    // Sa page est absente, supprimée ou refusée : la vidéo reçoit ses vues comme à tout autre relevé, rien n'est perdu.
    for (const manque of [undefined, supprimee, { ok: false, kind: "suspect" } as FreePage]) {
      const sans = await freeRead("lea.revise", io({ ...pages, [U(V_SEMAINE)]: manque as FreePage | string }, known), NOW, undefined, true);
      expect(sans).toMatchObject({ ok: true, pages: 4, light: [{ videoId: V_SEMAINE, views: 300, coverUrl: "https://c/3.jpg" }] });
      if (sans.ok) expect(sans.videos.map((v) => v.videoId)).toEqual([V_NEUVE, V_HIER]);
    }
    // Le compte a déjà un pays : la vidéo rangée n'est pas relue.
    const deja = io(pages, known);
    await freeRead("lea.revise", deja, NOW);
    expect(deja.asked).toEqual([P, U(V_NEUVE), U(V_HIER)]);
  });
});

describe("Radar — relevé gratuit : second essai et coupe-circuit", () => {
  it("une page refusée est redemandée une fois, après une pause ; une page absente ou lue ne l'est pas", async () => {
    const serie = (answers: FreePage[]) => {
      let i = 0;
      let pauses = 0;
      const page = retrying(async () => answers[Math.min(i++, answers.length - 1)], async () => void pauses++);
      return { page, calls: () => i, pauses: () => pauses };
    };
    const refus: FreePage = { ok: false, kind: "suspect" };
    const lue: FreePage = { ok: true, text: "x" };
    const a = serie([refus, lue]);
    expect(await a.page("u")).toEqual(lue);
    expect([a.calls(), a.pauses()]).toEqual([2, 1]);
    const b = serie([refus, refus, lue]);
    expect(await b.page("u")).toEqual(refus);
    expect(b.calls()).toBe(2);
    const c = serie([{ ok: false, kind: "absent" }, lue]);
    expect(await c.page("u")).toEqual({ ok: false, kind: "absent" });
    expect([c.calls(), c.pauses()]).toEqual([1, 0]);
    const d = serie([lue]);
    await d.page("u");
    expect([d.calls(), d.pauses()]).toEqual([1, 0]);
  });

  it("six profils refusés d'affilée éteignent le relevé gratuit pour le passage ; un profil absent ou privé non", () => {
    expect(FREE_BREAKER).toBe(6);
    let s = freeStart();
    for (let i = 0; i < 5; i++) s = freeNote(s, "suspect");
    expect([s.on, s.fallback, s.streak, s.stopped]).toEqual([true, 5, 5, null]);
    // Un relevé réussi remet le compteur à zéro.
    expect(freeNote(s, "ok")).toMatchObject({ on: true, ok: 1, streak: 0 });
    // Un profil absent, privé, vide, ou une vidéo illisible : un repli, pas un refus de TikTok.
    for (const autre of ["absent", "private", "empty", "detail"] as const) expect(freeNote(s, autre)).toMatchObject({ on: true, fallback: 6, streak: 0 });
    s = freeNote(s, "suspect");
    expect(s).toEqual({ on: false, ok: 0, fallback: 6, streak: 6, stopped: "6 profils refusés d'affilée" });
  });
});

describe("Radar — relevé gratuit : la voie gratuite d'un passage (13/11/2026)", () => {
  it("un profil que TikTok ne sert pas dit pourquoi, et l'arrêt du passage le répète", async () => {
    const P = freeProfileUrl("lea.revise");
    const io = (page: FreePage | string) => ({ page: async (): Promise<FreePage> => (typeof page === "string" ? { ok: true, text: page } : page), known: async () => [] });
    expect(await freeRead("lea.revise", io({ ok: false, kind: "suspect", reason: "HTTP 429" }), NOW)).toEqual({ ok: false, why: "suspect", pages: 1, reason: "HTTP 429" });
    expect(await freeRead("lea.revise", io("<html>ratelimit triggered</html>"), NOW)).toEqual({ ok: false, why: "suspect", pages: 1, reason: "page sans profil" });
    expect(await freeRead("lea.revise", io({ ok: false, kind: "absent" }), NOW)).toEqual({ ok: false, why: "absent", pages: 1 });
    expect(P).toContain("/embed/@lea.revise");
    let s = freeStart();
    for (let i = 0; i < FREE_BREAKER; i++) s = freeNote(s, "suspect", "HTTP 429");
    expect(s.stopped).toBe("6 profils refusés d'affilée (HTTP 429)");
  });

  it("une pause AVANT chaque page", async () => {
    const order: string[] = [];
    const page = paced(
      async (url) => {
        order.push(`page ${url}`);
        return { ok: true, text: "" };
      },
      async () => void order.push("pause"),
    );
    await page("a");
    await page("b");
    expect(order).toEqual(["pause", "page a", "pause", "page b"]);
  });

  type Out = { ok: true } | { ok: false; why: "absent" | "suspect" | "private" | "empty" | "detail" | "gap"; reason?: string };
  const lane = (issues: Record<string, Out>, alive: () => boolean = () => true) => {
    const read: string[] = [];
    return {
      read,
      run: runFreeLane(Object.keys(issues), async (h) => (read.push(h), issues[h]), alive),
    };
  };
  const ok: Out = { ok: true };
  const refus: Out = { ok: false, why: "suspect", reason: "HTTP 403" };

  it("un compte après l'autre ; ce que le gratuit ne relève pas part au payant, avec son motif", async () => {
    expect(FREE_LANE_MAX_MS).toBe(5 * 60_000);
    const t = lane({ a: ok, b: { ok: false, why: "private" }, c: ok, d: { ok: false, why: "detail" }, e: refus, f: ok });
    const r = await t.run;
    expect(t.read).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(r.failed.map((m) => [m.account, m.why])).toEqual([["b", "private"], ["d", "detail"], ["e", "suspect"]]);
    expect(r.notReached).toEqual([]);
    expect(r.state).toMatchObject({ on: true, ok: 3, fallback: 3, stopped: null });
  });

  it("six profils refusés d'affilée : la voie se ferme, le reste du passage part au payant SANS être demandé", async () => {
    const issues: Record<string, Out> = { a: ok };
    for (let i = 1; i <= 6; i++) issues[`r${i}`] = refus;
    issues.x = ok;
    issues.y = ok;
    const t = lane(issues);
    const r = await t.run;
    expect(t.read).toEqual(["a", "r1", "r2", "r3", "r4", "r5", "r6"]);
    expect(r.failed.map((m) => m.account)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
    // Pas demandés : la voie fermée les rend à `overflowToPay`, qui les paie tous (« coupure »).
    expect(r.notReached).toEqual(["x", "y"]);
    expect(r.state).toMatchObject({ on: false, ok: 1, fallback: 6, stopped: "6 profils refusés d'affilée (HTTP 403)" });
  });

  it("le temps imparti écoulé : les comptes restants ne sont pas pris, la voie n'est pas « arrêtée » (ils attendent le passage suivant)", async () => {
    let left = 2;
    const t = lane({ a: ok, b: ok, c: ok, d: ok }, () => left-- > 0);
    const r = await t.run;
    expect(t.read).toEqual(["a", "b"]);
    expect(r.failed).toEqual([]);
    expect(r.notReached).toEqual(["c", "d"]);
    expect(r.state).toMatchObject({ on: true, ok: 2, fallback: 0, stopped: null });
  });

  it("une liste trouée part au payant avec la vidéo à retrouver, AVANT toute page de vidéo", async () => {
    const P = freeProfileUrl("lea.revise");
    const asked: string[] = [];
    const page = async (url: string): Promise<FreePage> => {
      asked.push(url);
      return url === P ? { ok: true, text: profil([{ id: V_NEUVE }, { id: V_HIER }]) } : { ok: false, kind: "absent" };
    };
    const newest = { videoId: V_SEMAINE, publishedAt: videoIdTime(V_SEMAINE) };
    expect(await freeRead("lea.revise", { page, known: async () => [], newest: async () => newest }, NOW)).toEqual({ ok: false, why: "gap", pages: 1, newest });
    expect(asked).toEqual([P]);
    // La dernière vidéo connue est dans la liste : relevé gratuit normal.
    expect(await freeRead("lea.revise", { page, known: async () => [], newest: async () => ({ videoId: V_HIER, publishedAt: videoIdTime(V_HIER) }) }, NOW)).toMatchObject({ ok: true, pages: 3 });
    // Une liste trouée n'est pas un refus de TikTok : le coupe-circuit ne compte pas.
    expect(freeNote(freeStart(), "gap")).toMatchObject({ on: true, fallback: 1, streak: 0 });
  });
});

describe("Radar — la mesure du premier relevé gratuit (14/11/2026)", () => {
  it("un compte sur 4, toujours le même ; au plus 100 par jour et 400 en tout", () => {
    expect([TRIAL_EVERY, TRIAL_PER_DAY, TRIAL_TOTAL, TRIAL_DETAIL_MAX]).toEqual([4, 100, 400, 9]);
    const handles = Array.from({ length: 4_000 }, (_, i) => `compte.${i}`);
    const picked = handles.filter(trialPick).length;
    // ~1 000 sur 4 000, à ±10 %.
    expect(picked).toBeGreaterThan(900);
    expect(picked).toBeLessThan(1_100);
    // Le pseudo décide, majuscules comprises.
    expect(trialPick("Lea.Revise")).toBe(trialPick("lea.revise"));
  });

  it("les vidéos lues sur leur page : celles de moins de 14 jours, 9 au plus, les plus récentes d'abord", () => {
    const list = Array.from({ length: 13 }, (_, i) => ({ videoId: idAt(NOW - i * 26 * HOUR, i + 10), caption: "", views: 1, publishedAt: NOW - i * 26 * HOUR }));
    expect(trialPlan(list, NOW).map((v) => v.videoId)).toEqual(list.slice(0, 9).map((v) => v.videoId));
    const vieilles = list.map((v) => ({ ...v, publishedAt: v.publishedAt - 30 * 24 * HOUR }));
    expect(trialPlan(vieilles, NOW)).toEqual([]);
  });
});

describe("Radar — relevé payant d'un compte : la page suivante (14/11/2026)", () => {
  it("max_cursor quand has_more le dit ; jamais le même curseur, ni 0, ni vide", () => {
    expect(profileNextCursor({ has_more: true, max_cursor: 1_731_000_000_000 })).toBe("1731000000000");
    expect(profileNextCursor({ has_more: 1, max_cursor: "1731" })).toBe("1731");
    expect(profileNextCursor({ has_more: false, max_cursor: "1731" })).toBeNull();
    expect(profileNextCursor({ has_more: true })).toBeNull();
    expect(profileNextCursor({ has_more: true, max_cursor: "1731" }, "1731")).toBeNull();
    expect(profileNextCursor({ has_more: true, max_cursor: 0 })).toBeNull();
    expect(profileNextCursor({ has_more: true, max_cursor: "" })).toBeNull();
  });
});
