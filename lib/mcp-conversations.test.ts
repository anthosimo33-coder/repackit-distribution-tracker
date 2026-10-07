import { describe, expect, it } from "vitest";
import {
  appliquerChampsMcp,
  conversationPourMcp,
  elementsDeMcp,
} from "../convex/mcpConversationsArgs";
import { conversationDeData, defaultConversation, parseConversation } from "../convex/instaConvModel";
import { extractTikTokMedia, isTikTokCdnUrl, isTikTokPostUrl } from "../convex/tiktokMedia";

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

  it("valide les liens de post et les hôtes d'image", () => {
    expect(isTikTokPostUrl("https://www.tiktok.com/@a/photo/123?_r=1")).toBe(true);
    expect(isTikTokPostUrl("https://vm.tiktok.com/ZNabc/")).toBe(true);
    expect(isTikTokPostUrl("https://tiktok.com.evil.io/@a")).toBe(false);
    expect(isTikTokPostUrl("http://www.tiktok.com/@a")).toBe(false);
    expect(isTikTokCdnUrl("https://p16-common-sign.tiktokcdn-eu.com/tos/x.jpeg")).toBe(true);
    expect(isTikTokCdnUrl("https://tiktokcdn.com.evil.io/x")).toBe(false);
  });
});
