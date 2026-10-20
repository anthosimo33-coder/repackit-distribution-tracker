import { describe, expect, it } from "vitest";
import {
  appliquerChampsMcp,
  conversationPourMcp,
  elementsDeMcp,
  lienImagePublic,
  octetsDataUrl,
} from "../convex/mcpConversationsArgs";
import {
  conversationDeData,
  defaultBlushConversation,
  defaultConversation,
  formeRefusee,
  imagesDeConversation,
  incrustationDe,
  parseConversation,
  VERSION_FORME,
  versionDeData,
} from "../convex/instaConvModel";
import { extractTikTokMedia, extractTikTokProfile, isTikTokCdnUrl, isTikTokPostUrl, isTikTokProfileUrl } from "../convex/tiktokMedia";

describe("ce que Claude écrit → la conversation", () => {
  it("convertit messages et séparateurs, côtés compris", () => {
    const r = elementsDeMcp([
      { type: "date", texte: "AUJOURD'HUI 21:43" },
      { cote: "envoye", texte: "t'es où ?", modifie: true },
      { type: "message", cote: "recu", texte: " chez moi ", reaction: "❤️" },
    ]);
    expect("items" in r && r.items.map((x) => ({ ...x, id: undefined }))).toEqual([
      { id: undefined, kind: "date", text: "AUJOURD'HUI 21:43" },
      { id: undefined, kind: "message", side: "out", text: "t'es où ?", edited: true },
      { id: undefined, kind: "message", side: "in", text: "chez moi", reaction: "❤️" },
    ]);
  });

  it("refuse un message sans côté ou vide, en nommant l'élément", () => {
    expect(elementsDeMcp([{ texte: "salut" }])).toEqual({
      refus: "Élément 1 : « cote » vaut « recu » (bulle à gauche) ou « envoye » (à droite).",
    });
    expect(elementsDeMcp([{ cote: "recu", texte: "ok" }, { cote: "recu", texte: "  " }])).toEqual({
      refus: "Élément 2 : « texte » vide.",
    });
    expect(elementsDeMcp("pas une liste")).toEqual({ refus: "« messages » : une liste." });
  });

  it("« coupure » = fin de slide, dans les deux sens", () => {
    const r = elementsDeMcp([
      { cote: "envoye", texte: "un", coupure: true },
      { type: "date", texte: "HIER", coupure: true },
      { cote: "recu", texte: "deux" },
    ]);
    if ("refus" in r) throw new Error(r.refus);
    expect(r.items.map((it) => it.cut ?? false)).toEqual([true, true, false]);
    const lu = conversationPourMcp({ ...defaultConversation(), items: r.items });
    expect(lu.messages.map((m) => m.coupure ?? false)).toEqual([true, true, false]);
  });

  it("vocal, éphémères, citation, story, appui long, heure : écrits puis relus à l'identique", () => {
    const r = elementsDeMcp([
      { type: "vocal", cote: "recu", duree: 9, reaction: "😂" },
      { type: "photo_ephemere", cote: "envoye" },
      { cote: "recu", texte: "bah en vrai", reponse: { cote: "envoye", texte: "t’as hiberné carrément" } },
      { cote: "envoye", texte: "going to school rn?", reponse: { cote: "recu", type: "photo" } },
      { cote: "envoye", texte: "tu m’étonnes", reponse: { cote: "recu", type: "vocal", duree: 9 } },
      { cote: "recu", texte: "T’aurais du m’inviter", story: { amis_proches: true } },
      { cote: "envoye", texte: "🤣🤣", story: { indisponible: true } },
      { cote: "recu", texte: "Ta meuf ?", appui_long: true, heure: "14:35" },
    ]);
    if ("refus" in r) throw new Error(r.refus);
    const [vocal, photo, cite, citePhoto, citeVocal, story, storyKo, appui] = r.items as Array<Record<string, unknown>>;
    expect(vocal).toMatchObject({ side: "in", text: "", media: { type: "voice", seconds: 9 }, reaction: "😂" });
    expect(photo).toMatchObject({ side: "out", media: { type: "photoOnce" } });
    expect(cite).toMatchObject({ reply: { side: "out", text: "t’as hiberné carrément" } });
    expect(citePhoto).toMatchObject({ reply: { side: "in", text: "", kind: "photo" } });
    expect(citeVocal).toMatchObject({ reply: { side: "in", kind: "voice", seconds: 9 } });
    expect(story).toMatchObject({ story: { closeFriends: true } });
    expect(storyKo).toMatchObject({ story: { unavailable: true } });
    expect(appui).toMatchObject({ longPress: true, time: "14:35" });
    // Aller-retour : ce que Claude lit se réécrit sans perte.
    const c = { ...defaultConversation(), items: r.items };
    const back = appliquerChampsMcp(c, { messages: conversationPourMcp(c).messages });
    if ("refus" in back) throw new Error(back.refus);
    const sansId = (xs: typeof c.items) => xs.map((x) => ({ ...x, id: "" }));
    expect(sansId(back.conversation.items)).toEqual(sansId(c.items));
    // Et le stockage le relit pareil.
    expect(parseConversation(JSON.parse(JSON.stringify(c)))?.items).toEqual(c.items);
  });

  it("refuse deux appuis longs, une citation vide, un type inconnu", () => {
    expect(elementsDeMcp([{ cote: "recu", texte: "a", appui_long: true }, { cote: "recu", texte: "b", appui_long: true }])).toEqual({
      refus: "Élément 2 : un seul « appui_long » par conversation.",
    });
    expect(elementsDeMcp([{ cote: "recu", texte: "a", reponse: { cote: "envoye" } }])).toMatchObject({ refus: expect.stringContaining("reponse.texte") });
    expect(elementsDeMcp([{ type: "gif", cote: "recu" }])).toMatchObject({ refus: expect.stringContaining("« type »") });
  });

  it("médias avec image : reel, publication, story partagée, vidéo, miniature de story — relus à l'identique", () => {
    const r = elementsDeMcp([
      { type: "reel", cote: "recu", compte: "@plein_astuces_", image: "img:abc12345xyz", photo_compte: "img:def67890uvw", certifie: true, legende: "pourquoi PERSONNE" },
      { type: "publication", cote: "recu", compte: "regina.santos" },
      { type: "video", cote: "envoye", image: "img:ghi13579rst" },
      { cote: "recu", texte: "T’aurais du m’inviter", story: { amis_proches: true, image: "img:jkl24680opq" } },
      { type: "story_partagee", cote: "recu", compte: "chloe.difrancesco", image: "fichier:0" },
    ]);
    if ("refus" in r) throw new Error(r.refus);
    const [reel, post, video, reponse, partagee] = r.items as Array<Record<string, unknown>>;
    expect(reel).toMatchObject({
      text: "",
      media: { type: "reel", image: "abc12345xyz", avatar: "def67890uvw", account: "plein_astuces_", verified: true, caption: "pourquoi PERSONNE" },
    });
    expect(post).toMatchObject({ media: { type: "post", account: "regina.santos" } });
    expect(video).toMatchObject({ side: "out", media: { type: "video", image: "ghi13579rst" } });
    expect(reponse).toMatchObject({ story: { closeFriends: true, image: "jkl24680opq" } });
    // Le jeton d'une image tout juste rangée par l'action reste tel quel : la mutation le résout.
    expect(partagee).toMatchObject({ media: { type: "storyShare", image: "fichier:0", account: "chloe.difrancesco" } });

    const c = { ...defaultConversation(), items: r.items.slice(0, 4) };
    const lu = conversationPourMcp(c).messages;
    expect(lu[0]).toMatchObject({ type: "reel", image: "img:abc12345xyz", photo_compte: "img:def67890uvw", compte: "plein_astuces_", certifie: true, legende: "pourquoi PERSONNE" });
    expect(lu[3]).toMatchObject({ story: { amis_proches: true, image: "img:jkl24680opq" } });
    const back = appliquerChampsMcp(c, { messages: lu });
    if ("refus" in back) throw new Error(back.refus);
    const sansId = (xs: typeof c.items) => xs.map((x) => ({ ...x, id: "" }));
    expect(sansId(back.conversation.items)).toEqual(sansId(c.items));
    expect(parseConversation(JSON.parse(JSON.stringify(c)))?.items).toEqual(c.items);
    expect(imagesDeConversation(c).sort()).toEqual(["abc12345xyz", "def67890uvw", "ghi13579rst", "jkl24680opq"]);
  });

  it("refuse une carte sans compte, et une image qui n'est ni un lien TikTok ni « img:<id> »", () => {
    expect(elementsDeMcp([{ type: "reel", cote: "recu" }])).toMatchObject({ refus: expect.stringContaining("« compte »") });
    expect(elementsDeMcp([{ type: "photo", cote: "envoye", image: "https://evil.example/x.jpg" }])).toMatchObject({ refus: expect.stringContaining("« image »") });
    expect(elementsDeMcp([{ cote: "recu", texte: "x", story: { image: "img:" } }])).toMatchObject({ refus: expect.stringContaining("story.image") });
    expect(elementsDeMcp([{ type: "reel", cote: "recu", compte: "x", photo_compte: 42 }])).toMatchObject({ refus: expect.stringContaining("photo_compte") });
  });

  it("une réaction trop longue est coupée sans briser un emoji", () => {
    const r = elementsDeMcp([{ cote: "recu", texte: "x", reaction: "😂😂😂😂😂😂" }]);
    expect("items" in r && r.items[0]).toMatchObject({ reaction: "😂😂😂😂" });
  });

  it("modifier : seuls les champs donnés changent, la photo reste", () => {
    const base = { ...defaultConversation(), contact: { name: "Lucas", username: "lucas", avatar: "data:image/jpeg;base64,AAA" } };
    const r = appliquerChampsMcp(base, { heure: "01:12", contact_pseudo: "@kevinp7_", theme: "coeurs", batterie: 140 });
    if ("refus" in r) throw new Error(r.refus);
    expect(r.conversation.status).toMatchObject({ time: "01:12", battery: 100 });
    expect(r.conversation.contact).toEqual({ name: "Lucas", username: "kevinp7_", avatar: "data:image/jpeg;base64,AAA" });
    expect(r.conversation.themeId).toBe("hearts");
    expect(r.conversation.items).toEqual(base.items);
    expect(base.status.time).toBe("23:47"); // l'original n'est pas touché
  });

  it("photo du contact et début du fil : posés, relus, retirés", () => {
    const r = appliquerChampsMcp(defaultConversation(), { photo_contact: "img:abc12345xyz", debut_du_fil: false });
    if ("refus" in r) throw new Error(r.refus);
    expect(r.conversation.contact.avatar).toBe("abc12345xyz");
    expect(r.conversation.threadStart).toBeUndefined();
    expect(conversationPourMcp(r.conversation)).toMatchObject({ contact: { photo: "img:abc12345xyz" }, debutDuFil: false });
    expect(imagesDeConversation(r.conversation)).toContain("abc12345xyz");
    // Le jeton d'une photo rangée par l'action passe ; "" la retire ; une URL brute n'arrive jamais ici.
    const jeton = appliquerChampsMcp(defaultConversation(), { photo_contact: "fichier:2" });
    expect("conversation" in jeton && jeton.conversation.contact.avatar).toBe("fichier:2");
    const sans = appliquerChampsMcp(r.conversation, { photo_contact: "", debut_du_fil: true });
    expect("conversation" in sans && [sans.conversation.contact.avatar, sans.conversation.threadStart]).toEqual([null, true]);
    expect(appliquerChampsMcp(defaultConversation(), { photo_contact: "https://exemple.com/a.jpg" })).toMatchObject({
      refus: expect.stringContaining("« photo_contact »"),
    });
    // Posée à l'écran (data URL) : Claude sait qu'elle existe, sans la recevoir.
    const ecran = { ...defaultConversation(), contact: { name: "L", username: "l", avatar: "data:image/jpeg;base64,AAA" } };
    expect(conversationPourMcp(ecran).contact.photo).toBe("posée à l'écran");
  });

  it("refuse un thème ou une langue inconnus", () => {
    expect(appliquerChampsMcp(defaultConversation(), { theme: "neon" })).toEqual({ refus: "« theme » : sombre, coeurs, ocean." });
    expect(appliquerChampsMcp(defaultConversation(), { langue: "es" })).toEqual({ refus: "« langue » : fr ou en." });
  });

  it("aller-retour : ce que Claude lit se réécrit à l'identique", () => {
    const c = defaultConversation();
    const lu = conversationPourMcp(c);
    expect(lu.contact.photo).toBe("aucune");
    const r = appliquerChampsMcp(c, { messages: lu.messages });
    if ("refus" in r) throw new Error(r.refus);
    const sansId = (xs: typeof c.items) => xs.map((x) => ({ ...x, id: "" }));
    expect(sansId(r.conversation.items)).toEqual(sansId(c.items));
  });
});

describe("chat BLUSH (interface « blush »)", () => {
  const base = () => ({ ...defaultBlushConversation(), items: [] });
  const sansId = (xs: ReturnType<typeof defaultBlushConversation>["items"]) => xs.map((x) => ({ ...x, id: "" }));

  it("elle à droite, BLUSH à gauche en plusieurs bulles, « BLUSH écrit », la meilleure réponse, une citation, un vocal, une capture : relus à l'identique", () => {
    const r = appliquerChampsMcp(base(), {
      interface: "blush",
      contact_nom: "Théo",
      verdict: "🔥",
      niveau: 3,
      bulles: 12,
      idees: ["il m’aime encore ?", "  "],
      messages: [
        { type: "date", texte: "Aujourd’hui 21:40", incrustation: "t'étais un 10/10 quand…" },
        { cote: "envoye", texte: "au début il me répondait en 10 min même au taf" },
        { cote: "recu", texte: "10 min au taf c’est de l’amour 😭" },
        { cote: "recu", texte: "et là ?", heure: "21:41", coupure: true, incrustation: "t'étais un 10/10 quand tu me répondais en 10 min" },
        { type: "photo", cote: "envoye", image: "img:abc12345xyz" },
        { type: "citation", texte: "mdr", legende: "Théo · 02:14" },
        { type: "citation", texte: "t’es où ?", de: "moi" },
        { type: "vocal", cote: "recu", duree: 14 },
        { type: "meilleure_reponse", lignes: ["tu me manques un peu", "il revient quand ?"], pourquoi: "Léger, sans reproche." },
        { type: "ecrit" },
      ],
    });
    if ("refus" in r) throw new Error(r.refus);
    const c = r.conversation;
    expect(c.interface).toBe("blush");
    expect(c.blush).toEqual({ verdict: "🔥", niveau: 3, bulles: 12, idees: ["il m’aime encore ?"] });
    const [date, elle, b1, b2, capture, cite, citeMoi, vocal, meilleure, ecrit] = c.items as Array<Record<string, unknown>>;
    expect(date).toMatchObject({ kind: "date", text: "Aujourd’hui 21:40", overlay: "t'étais un 10/10 quand…" });
    expect(elle).toMatchObject({ side: "out", text: "au début il me répondait en 10 min même au taf" });
    expect(b1).toMatchObject({ side: "in" });
    expect(b2).toMatchObject({ side: "in", time: "21:41", cut: true, overlay: "t'étais un 10/10 quand tu me répondais en 10 min" });
    expect(capture).toMatchObject({ side: "out", media: { type: "photo", image: "abc12345xyz" } });
    expect(cite).toMatchObject({ side: "in", text: "mdr", cited: { side: "in", caption: "Théo · 02:14" } });
    expect(citeMoi).toMatchObject({ side: "in", cited: { side: "out" } });
    expect(vocal).toMatchObject({ side: "in", media: { type: "voice", seconds: 14 } });
    expect(meilleure).toMatchObject({ side: "in", suggestion: { lines: ["tu me manques un peu", "il revient quand ?"], why: "Léger, sans reproche." } });
    expect(ecrit).toMatchObject({ side: "in", typing: true });

    // Ce que Claude lit se réécrit sans perte, et le stockage le relit pareil.
    const lu = conversationPourMcp(c);
    expect(lu).toMatchObject({ interface: "blush", contact: { nom: "Théo" }, verdict: "🔥", niveau: 3, bulles: 12 });
    expect(lu.messages[5]).toEqual({ type: "citation", texte: "mdr", de: "autre", legende: "Théo · 02:14" });
    expect(lu.messages[9]).toEqual({ type: "ecrit" });
    const back = appliquerChampsMcp(c, { messages: lu.messages });
    if ("refus" in back) throw new Error(back.refus);
    expect(sansId(back.conversation.items)).toEqual(sansId(c.items));
    expect(parseConversation(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(imagesDeConversation(c)).toEqual(["abc12345xyz"]);
    expect(incrustationDe(c.items.slice(0, 4))).toBe("t'étais un 10/10 quand tu me répondais en 10 min");
  });

  it("refuse ce que le chat BLUSH n'a pas, et les bulles de BLUSH dans un DM Instagram", () => {
    const blush = (messages: unknown[]) => appliquerChampsMcp(base(), { messages });
    expect(blush([{ type: "reel", cote: "recu", compte: "x" }])).toMatchObject({ refus: expect.stringContaining("dans le chat BLUSH") });
    expect(blush([{ cote: "recu", texte: "ok", reaction: "😂" }])).toMatchObject({ refus: expect.stringContaining("« reaction » n'existe pas") });
    expect(blush([{ type: "meilleure_reponse", lignes: [] }])).toMatchObject({ refus: expect.stringContaining("« lignes »") });
    expect(blush([{ type: "meilleure_reponse", lignes: ["a", "b", "c", "d", "e"] }])).toMatchObject({ refus: expect.stringContaining("4 messages au plus") });
    expect(blush([{ type: "citation", texte: "x", de: "lui" }])).toMatchObject({ refus: expect.stringContaining("« de »") });
    expect(blush([{ type: "ecrit", cote: "envoye" }])).toMatchObject({ refus: expect.stringContaining("bulle de BLUSH") });
    expect(blush([{ texte: "sans côté" }])).toMatchObject({ refus: expect.stringContaining("« cote »") });
    expect(blush([{ cote: "recu", texte: "x", incrustation: "y".repeat(200) }])).toMatchObject({ refus: expect.stringContaining("« incrustation »") });
    expect(appliquerChampsMcp(defaultConversation(), { messages: [{ type: "ecrit" }] })).toMatchObject({ refus: expect.stringContaining("que dans le chat BLUSH") });
    expect(appliquerChampsMcp(base(), { verdict: "😍" })).toMatchObject({ refus: expect.stringContaining("« verdict »") });
    expect(appliquerChampsMcp(base(), { niveau: 5 })).toMatchObject({ refus: expect.stringContaining("« niveau »") });
    expect(appliquerChampsMcp(base(), { idees: ["a", "b", "c", "d", "e"] })).toMatchObject({ refus: expect.stringContaining("4 au plus") });
    expect(appliquerChampsMcp(base(), { interface: "whatsapp" })).toEqual({ refus: "« interface » : instagram ou blush." });
  });

  it("passer d'un écran à l'autre garde les réglages ; un DM Instagram stocké avant BLUSH se relit sans eux", () => {
    const vers = appliquerChampsMcp(defaultConversation(), { interface: "blush" });
    if ("refus" in vers) throw new Error(vers.refus);
    expect(vers.conversation.interface).toBe("blush");
    expect(vers.conversation.blush).toEqual({ verdict: "🧊", niveau: 2, bulles: 37, idees: [] });
    const retour = appliquerChampsMcp(vers.conversation, { interface: "instagram" });
    if ("refus" in retour) throw new Error(retour.refus);
    expect(retour.conversation.interface).toBeUndefined();
    expect(retour.conversation.blush).toBeDefined();
    expect(conversationPourMcp(retour.conversation)).toMatchObject({ interface: "instagram", theme: "sombre" });
    // Une conversation d'avant (ni interface ni réglages) se relit telle quelle.
    const avant = defaultConversation();
    expect(conversationDeData(JSON.stringify(avant))).toEqual(avant);
    // Des réglages abîmés retombent sur des valeurs sûres.
    const abime = parseConversation({ ...defaultBlushConversation(), blush: { verdict: "x", niveau: 12, bulles: -3, idees: "non" } });
    expect(abime?.blush).toEqual({ verdict: "🧊", niveau: 4, bulles: 0, idees: [] });
  });

  it("l'incrustation existe aussi sur un DM Instagram", () => {
    const r = elementsDeMcp([{ cote: "recu", texte: "jdormais", incrustation: "il était un 2/10" }]);
    expect("items" in r && r.items[0]).toMatchObject({ overlay: "il était un 2/10" });
    const c = { ...defaultConversation(), items: "items" in r ? r.items : [] };
    expect(conversationPourMcp(c).messages[0]).toMatchObject({ incrustation: "il était un 2/10" });
  });
});

describe("écran périmé (version de forme)", () => {
  /** Ce qu'enregistrait l'écran d'avant le chat BLUSH : il ne gardait que les champs qu'il connaissait. */
  const ancienEcran = (data: string): string => {
    const c = JSON.parse(data) as Record<string, unknown> & { items: Array<Record<string, unknown>> };
    const garder = ["id", "kind", "side", "text", "edited", "reaction", "cut", "reply", "story", "media", "longPress", "time"];
    return JSON.stringify({
      themeId: c.themeId,
      locale: c.locale,
      contact: c.contact,
      status: c.status,
      scroll: c.scroll,
      items: c.items.map((it) => Object.fromEntries(Object.entries(it).filter(([k]) => garder.includes(k)))),
    });
  };

  it("le code d'aujourd'hui écrit sa forme : exemples, relecture d'un brouillon d'avant", () => {
    expect(VERSION_FORME).toBe(2);
    expect(defaultConversation().version).toBe(VERSION_FORME);
    expect(defaultBlushConversation().version).toBe(VERSION_FORME);
    const avant = ancienEcran(JSON.stringify(defaultConversation()));
    expect(versionDeData(avant)).toBe(1);
    expect(conversationDeData(avant).version).toBe(VERSION_FORME);
    expect(versionDeData("{cassé")).toBe(1);
    expect(versionDeData(JSON.stringify({ version: "3" }))).toBe(1);
  });

  it("un écran d'avant ne peut plus écraser un chat BLUSH (vu le 20/10) ; le code d'aujourd'hui, si", () => {
    const stocke = JSON.stringify(defaultBlushConversation());
    // L'ancien écran relit le chat, perd interface, réglages, « BLUSH écrit »… et le renvoie.
    const ampute = ancienEcran(stocke);
    expect(conversationDeData(ampute).interface).toBeUndefined();
    expect(formeRefusee(stocke, ampute)).toBe(true);
    // L'écran à jour, lui, renvoie ce qu'il a relu ; et repasser à Instagram garde les réglages.
    expect(formeRefusee(stocke, JSON.stringify(conversationDeData(stocke)))).toBe(false);
    const insta = appliquerChampsMcp(conversationDeData(stocke), { interface: "instagram" });
    if ("refus" in insta) throw new Error(insta.refus);
    expect(formeRefusee(stocke, JSON.stringify(insta.conversation))).toBe(false);
  });

  it("aucune régression : un brouillon d'avant reste modifiable par un écran d'avant ; une forme plus récente que ce code est protégée aussi", () => {
    const avant = ancienEcran(JSON.stringify(defaultConversation()));
    expect(formeRefusee(avant, ancienEcran(avant))).toBe(false);
    const futur = JSON.stringify({ ...defaultConversation(), version: VERSION_FORME + 1 });
    expect(formeRefusee(futur, JSON.stringify(conversationDeData(futur)))).toBe(true);
  });
});

describe("stockage", () => {
  it("relit une conversation stockée, et retombe sur l'exemple si elle est illisible", () => {
    const c = defaultConversation();
    expect(conversationDeData(JSON.stringify(c))).toEqual(c);
    expect(conversationDeData("{cassé").items.length).toBeGreaterThan(0);
    expect(parseConversation({ ...c, themeId: "inconnu" })).toBeNull();
  });
});

describe("images d'un TikTok", () => {
  const page = (itemStruct: object, statusCode = 0) =>
    `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: { "webapp.video-detail": { statusCode, statusMsg: "", itemInfo: { itemStruct } } },
    })}</script></html>`;
  const cdn = (n: string) => `https://p16-sign-va.tiktokcdn.com/obj/${n}`;

  it("carrousel photo : une image par photo, le JPEG préféré au webp", () => {
    const html = page({
      id: "1",
      imagePost: { images: [{ imageURL: { urlList: [cdn("a.webp"), cdn("a.jpeg")] } }, { imageURL: { urlList: [cdn("b.webp")] } }] },
      video: { cover: cdn("cover.jpeg") },
    });
    expect(extractTikTokMedia(html)).toEqual({ kind: "photos", images: [cdn("a.jpeg"), cdn("b.webp")] });
  });

  it("vidéo : la couverture d'origine", () => {
    expect(extractTikTokMedia(page({ id: "2", video: { cover: cdn("c.jpeg"), originCover: cdn("o.jpeg") } }))).toEqual({
      kind: "video",
      images: [cdn("o.jpeg")],
    });
  });

  it("refus de TikTok, page sans payload, image hors CDN", () => {
    expect(extractTikTokMedia(page({ id: "3" }, 10204))).toMatchObject({ kind: "unreadable" });
    expect(extractTikTokMedia("<html></html>")).toMatchObject({ kind: "unreadable" });
    expect(extractTikTokMedia(page({ id: "4", video: { originCover: "https://evil.example.com/x.jpeg" } }))).toMatchObject({
      kind: "unreadable",
    });
  });

  it("auteur : nom, photo prise sur le CDN seulement, badge — de quoi dessiner un reel partagé", () => {
    const html = page({ id: "5", video: { originCover: cdn("o.jpeg") }, author: { uniqueId: "plein_astuces_", avatarMedium: cdn("av.jpeg"), verified: true } });
    expect(extractTikTokMedia(html)).toEqual({
      kind: "video",
      images: [cdn("o.jpeg")],
      author: { username: "plein_astuces_", avatar: cdn("av.jpeg"), verified: true },
    });
    const ailleurs = extractTikTokMedia(page({ id: "6", video: { originCover: cdn("o.jpeg") }, author: { uniqueId: "x", avatarMedium: "https://evil.example.com/a.jpeg" } }));
    expect(ailleurs).toEqual({ kind: "video", images: [cdn("o.jpeg")], author: { username: "x" } });
  });

  it("profil : lien reconnu, compte lu dans la page publique (forme relevée le 07/10/2026)", () => {
    expect(isTikTokProfileUrl("https://www.tiktok.com/@plein_astuces_")).toBe(true);
    expect(isTikTokProfileUrl("https://www.tiktok.com/@plein_astuces_/")).toBe(true);
    expect(isTikTokProfileUrl("https://www.tiktok.com/@a/video/123")).toBe(false);
    expect(isTikTokProfileUrl("https://tiktok.com.evil.io/@a")).toBe(false);
    const profil = (user: object, statusCode = 0) =>
      `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
        __DEFAULT_SCOPE__: { "webapp.user-detail": { statusCode, userInfo: { user } } },
      })}</script>`;
    expect(extractTikTokProfile(profil({ uniqueId: "tiktok", avatarLarger: cdn("av.jpeg"), verified: true }))).toEqual({
      username: "tiktok",
      avatar: cdn("av.jpeg"),
      verified: true,
    });
    expect(extractTikTokProfile(profil({ uniqueId: "x", avatarLarger: "https://evil.example.com/a.jpeg" }))).toEqual({ username: "x" });
    expect(extractTikTokProfile(profil({ uniqueId: "x" }, 10221))).toBeNull();
    expect(extractTikTokProfile("<html></html>")).toBeNull();
  });

  it("image donnée par Claude : data URL décodée, lien public seulement (ni IP, ni réseau local, ni http)", () => {
    const d = octetsDataUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(d && { type: d.type, debut: Array.from(d.octets.slice(0, 4)) }).toEqual({ type: "image/png", debut: [0x89, 0x50, 0x4e, 0x47] });
    expect(octetsDataUrl("data:image/gif;base64,R0lGOD")).toBeNull();
    expect(octetsDataUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(lienImagePublic("https://i.pinimg.com/originals/ab/cd/ef.jpg")).toBe(true);
    for (const refuse of ["http://exemple.com/a.jpg", "https://127.0.0.1/a.jpg", "https://[::1]/a.jpg", "https://localhost/a.jpg", "https://nas.local/a.jpg", "https://intranet/a.jpg"]) {
      expect(lienImagePublic(refuse), refuse).toBe(false);
    }
  });

  it("valide les liens de post et les hôtes d'image", () => {
    expect(isTikTokPostUrl("https://www.tiktok.com/@a/photo/123?_r=1")).toBe(true);
    expect(isTikTokPostUrl("https://vm.tiktok.com/ZNabc/")).toBe(true);
    expect(isTikTokPostUrl("https://tiktok.com.evil.io/@a")).toBe(false);
    expect(isTikTokPostUrl("http://www.tiktok.com/@a")).toBe(false);
    expect(isTikTokCdnUrl("https://p16-common-sign.tiktokcdn-eu.com/tos/x.jpeg")).toBe(true);
    expect(isTikTokCdnUrl("https://tiktokcdn.com.evil.io/x")).toBe(false);
  });
});
