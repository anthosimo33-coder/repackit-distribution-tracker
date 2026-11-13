import { describe, expect, it } from "vitest";
import {
  FREE_BREAKER,
  FREE_FRESH_MS,
  FREE_LANE_MAX_MS,
  FREE_REGION_PAGES,
  freeNote,
  freePlan,
  freeProfileUrl,
  freeRead,
  freeStart,
  freeVideoUrl,
  paced,
  runFreeLane,
  parseFreeProfile,
  parseFreeVideo,
  retrying,
  videoIdTime,
  type FreePage,
  type KnownVideo,
} from "../convex/radarFreeMath";

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

  type Out = { ok: true } | { ok: false; why: "absent" | "suspect" | "private" | "empty" | "detail"; reason?: string };
  const lane = (issues: Record<string, Out>, alive: () => boolean = () => true) => {
    const read: string[] = [];
    return {
      read,
      run: runFreeLane(Object.keys(issues), async (h) => (read.push(h), issues[h]), alive),
    };
  };
  const ok: Out = { ok: true };
  const refus: Out = { ok: false, why: "suspect", reason: "HTTP 403" };

  it("un compte après l'autre ; ce que le gratuit ne relève pas part au payant", async () => {
    expect(FREE_LANE_MAX_MS).toBe(5 * 60_000);
    const t = lane({ a: ok, b: { ok: false, why: "private" }, c: ok, d: { ok: false, why: "detail" }, e: refus, f: ok });
    const r = await t.run;
    expect(t.read).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(r.toPay).toEqual(["b", "d", "e"]);
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
    expect(r.toPay).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "x", "y"]);
    expect(r.state).toMatchObject({ on: false, ok: 1, fallback: 6, stopped: "6 profils refusés d'affilée (HTTP 403)" });
  });

  it("le temps imparti écoulé : les comptes restants partent au payant, la voie n'est pas « arrêtée »", async () => {
    let left = 2;
    const t = lane({ a: ok, b: ok, c: ok, d: ok }, () => left-- > 0);
    const r = await t.run;
    expect(t.read).toEqual(["a", "b"]);
    expect(r.toPay).toEqual(["c", "d"]);
    expect(r.state).toMatchObject({ on: true, ok: 2, fallback: 0, stopped: null });
  });
});
