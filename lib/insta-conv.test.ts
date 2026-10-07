import { describe, expect, it } from "vitest";
import {
  applyReading,
  fromLlmItems,
  toLlmItems,
  emojiOnlyCount,
  isJumbo,
  outGradientCss,
  parseConversation,
  planConversation,
  defaultConversation,
  THEMES,
  type ConvItem,
  type PlannedMessage,
} from "./insta-conv";

const msg = (id: string, side: "in" | "out", text: string, extra: object = {}): ConvItem => ({
  id,
  kind: "message",
  side,
  text,
  ...extra,
});

const messages = (items: ConvItem[]) =>
  planConversation(items).filter((p): p is PlannedMessage => p.kind === "message");

describe("emojis en grand", () => {
  it("compte les emojis d'un message qui n'en contient que", () => {
    expect(emojiOnlyCount("😂😂😂")).toBe(3);
    expect(emojiOnlyCount("🤣 🤣")).toBe(2);
    expect(emojiOnlyCount("👌🏼")).toBe(1); // modificateur de teinte = un seul emoji
    expect(emojiOnlyCount("❤️")).toBe(1);
    expect(emojiOnlyCount("🇫🇷")).toBe(1);
  });

  it("renvoie 0 dès qu'il y a du texte", () => {
    expect(emojiOnlyCount("khoya 😂")).toBe(0);
    expect(emojiOnlyCount("1")).toBe(0);
    expect(emojiOnlyCount("")).toBe(0);
  });

  it("au-delà de 5, plus d'affichage en grand (non observé sur capture)", () => {
    expect(isJumbo("🤣🤣🤣🤣🤣")).toBe(true);
    expect(isJumbo("🤣🤣🤣🤣🤣🤣")).toBe(false);
  });
});

describe("planConversation — groupes", () => {
  it("groupe les messages consécutifs du même auteur, avatar sur le dernier reçu", () => {
    const [a, b, c, d] = messages([
      msg("a", "in", "salut"),
      msg("b", "in", "ça va ?"),
      msg("c", "out", "oui"),
      msg("d", "out", "et toi"),
    ]);
    expect([a.joinedTop, a.joinedBottom, a.showAvatar]).toEqual([false, true, false]);
    expect([b.joinedTop, b.joinedBottom, b.showAvatar]).toEqual([true, false, true]);
    expect([c.joinedTop, c.joinedBottom, c.showAvatar]).toEqual([false, true, false]);
    expect([d.joinedTop, d.joinedBottom]).toEqual([true, false]);
    expect([a.gapBefore, b.gapBefore, c.gapBefore, d.gapBefore]).toEqual([0, 2, 12, 2]);
  });

  it("« Modifié » coupe le groupe (le label s'intercale)", () => {
    const [, b] = messages([msg("a", "out", "un"), msg("b", "out", "deux", { edited: true })]);
    expect(b.joinedTop).toBe(false);
    expect(b.gapBefore).toBe(0); // l'écart est porté par le label
  });

  it("une réaction termine le groupe et éloigne le message suivant", () => {
    const [a, b] = messages([msg("a", "in", "un", { reaction: "😂" }), msg("b", "in", "deux")]);
    expect(a.joinedBottom).toBe(false);
    expect(a.showAvatar).toBe(true);
    expect(b.joinedTop).toBe(false);
    expect(b.gapBefore).toBe(14);
  });

  it("un emoji en grand garde son propre avatar", () => {
    const [a, b] = messages([msg("a", "in", "j'étais dans un embargo"), msg("b", "in", "😂😂😂")]);
    expect(a.showAvatar).toBe(true);
    expect(b.jumbo).toBe(true);
    expect(b.showAvatar).toBe(true);
  });

  it("une date sépare et remet l'écart à zéro pour le message qui suit", () => {
    const plan = planConversation([
      msg("a", "in", "un"),
      { id: "d", kind: "date", text: "25 AUG AT 22:14" },
      msg("b", "in", "deux"),
    ]);
    expect(plan[1]).toMatchObject({ kind: "date", gapBefore: 21 });
    expect(plan[2]).toMatchObject({ joinedTop: false, gapBefore: 0 });
    expect(plan[0]).toMatchObject({ joinedBottom: false, showAvatar: true });
  });
});

describe("thèmes", () => {
  it("le dégradé sombre suit la hauteur de l'écran, arrêts croissants", () => {
    const ys = THEMES.dark.outStops.map(([y]) => y);
    expect([...ys].sort((p, q) => p - q)).toEqual(ys);
    expect(outGradientCss(THEMES.dark)).toContain("rgb(148,52,234) 325px");
  });
});

describe("parseConversation", () => {
  it("relit un brouillon valide à l'identique", () => {
    const c = defaultConversation();
    expect(parseConversation(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it("refuse un brouillon d'une autre forme et borne les valeurs", () => {
    expect(parseConversation(null)).toBeNull();
    expect(parseConversation({ themeId: "inconnu" })).toBeNull();
    const c = { ...defaultConversation(), status: { time: "1", battery: 140, lowPower: 1, signal: 9 } };
    expect(parseConversation(c)?.status).toEqual({ time: "1", battery: 100, lowPower: true, signal: 4 });
  });
});

describe("échanges avec l'IA", () => {
  it("aller-retour éditeur → modèle → éditeur sans perte (ids neufs)", () => {
    const items: ConvItem[] = [
      { id: "d", kind: "date", text: "AUJOURD'HUI 21:43" },
      msg("a", "out", "t'es où", { edited: true }),
      msg("b", "in", "chez moi", { reaction: "❤️" }),
    ];
    const back = fromLlmItems(toLlmItems(items));
    const sansId = (list: ConvItem[]) => list.map((it) => ({ ...it, id: "" }));
    expect(sansId(back)).toEqual(sansId(items));
    expect(back.every((it, i) => it.id !== items[i].id)).toBe(true);
  });

  it("une capture recadrée (sans en-tête) garde le contact et la barre d'état en place", () => {
    const conv = { ...defaultConversation(), themeId: "hearts" as const, scroll: 120 };
    const next = applyReading(conv, {
      theme: "custom",
      locale: "fr",
      contact: { name: "", username: "" },
      status: { time: null, battery: null, lowPower: false, signal: null },
      items: [{ kind: "message", side: "in", text: "emma", edited: false, reaction: null }],
    });
    expect(next.contact).toEqual(conv.contact);
    expect(next.status).toEqual(conv.status);
    expect(next.themeId).toBe("hearts");
    expect(next.scroll).toBe(0);
    expect(next.items).toMatchObject([{ kind: "message", side: "in", text: "emma" }]);
  });

  it("une capture plein écran reprend nom, pseudo, heure, batterie et thème sombre", () => {
    const next = applyReading({ ...defaultConversation(), themeId: "ocean" }, {
      theme: "dark",
      locale: "en",
      contact: { name: "Jeremy", username: "jeremy_viers" },
      status: { time: "11:52", battery: 44, lowPower: true, signal: 2 },
      items: [],
    });
    expect(next).toMatchObject({
      themeId: "dark",
      locale: "en",
      contact: { name: "Jeremy", username: "jeremy_viers" },
      status: { time: "11:52", battery: 44, lowPower: true, signal: 2 },
    });
  });
});
