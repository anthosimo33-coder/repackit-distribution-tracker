import { describe, expect, it } from "vitest";
import { BLUSH, blushEcrit, composerHeight, decouperSeparateur, initialeDe, ondeBlush, planBlush, visibleHeight } from "./blush-conv";
import { defaultBlushConversation, type ConvItem, type ConvMessage } from "../convex/instaConvModel";

const m = (id: string, side: "in" | "out", extra: Partial<ConvMessage> = {}): ConvMessage => ({ id, kind: "message", side, text: id, ...extra });

describe("chat BLUSH — le plan du fil", () => {
  it("un séparateur, puis les messages consécutifs d'un même côté en un groupe, coins comme l'app", () => {
    const items: ConvItem[] = [{ id: "d", kind: "date", text: "Aujourd’hui 21:40" }, m("a", "out"), m("b", "in"), m("c", "in"), m("e", "in"), m("f", "out")];
    const plan = planBlush(items, "21:47");
    expect(plan.map((l) => (l.kind === "day" ? `jour:${l.jour}|${l.heure}` : `${l.side}:${l.bulles.map((b) => b.place).join(",")}`))).toEqual([
      "jour:Aujourd’hui|21:40",
      "out:single",
      "in:first,middle,last",
      "out:single",
    ]);
  });

  it("l'heure d'un groupe : son dernier message qui en a une, sinon celle d'avant, sinon la barre d'état", () => {
    const heures = (items: ConvItem[]) => planBlush(items, "23:05").flatMap((l) => (l.kind === "group" ? [l.heure] : []));
    expect(heures([m("a", "out"), m("b", "in")])).toEqual(["23:05", "23:05"]);
    expect(heures([{ id: "d", kind: "date", text: "Hier 21h40" }, m("a", "out"), m("b", "in", { time: "21:42" }), m("c", "in"), m("e", "out")])).toEqual(["21:40", "21:42", "21:42"]);
  });

  it("« BLUSH écrit » ferme le groupe à la place de l'heure ; le fil qui finit dessus range les idées", () => {
    const items = [m("a", "out"), m("b", "in"), m("t", "in", { typing: true })];
    const [, groupe] = planBlush(items, "21:00");
    expect(groupe).toMatchObject({ kind: "group", side: "in", typing: { index: 2 } });
    expect(groupe.kind === "group" && groupe.bulles.map((b) => b.item.id)).toEqual(["b"]);
    expect(blushEcrit(items)).toBe(true);
    expect(blushEcrit(items.slice(0, 2))).toBe(false);
    expect(blushEcrit(defaultBlushConversation().items)).toBe(true);
    // Plus haut dans le fil (la slide suivante d'une série), il a laissé place à la réponse.
    const suite = planBlush([...items, m("r", "in")], "21:00");
    expect(suite.map((l) => (l.kind === "group" ? `${l.side}:${l.bulles.map((x) => x.item.id).join(",")}:${l.typing ? "écrit" : ""}` : ""))).toEqual(["out:a:", "in:b,r:"]);
  });

  it("séparateurs : le jour en gras, l'heure à part (ou rien)", () => {
    expect(decouperSeparateur("dim. 19 oct. 17:00")).toEqual({ jour: "dim. 19 oct.", heure: "17:00" });
    expect(decouperSeparateur("Hier")).toEqual({ jour: "Hier", heure: null });
  });

  it("cotes : barre de saisie (filet, idées, indicateur d'accueil) et hauteur visible du fil", () => {
    expect(composerHeight(false)).toBe(91);
    expect(composerHeight(true)).toBe(138);
    expect(visibleHeight(false)).toBe(896 - BLUSH.statusBar - BLUSH.header - 91 - 16);
  });

  it("onde du vocal : 28 barres, la même à chaque rendu ; initiale comme l'app", () => {
    const a = ondeBlush("i1");
    expect(a).toHaveLength(28);
    expect(ondeBlush("i1")).toEqual(a);
    expect(a.every((p) => p >= 0.15 && p <= 1)).toBe(true);
    expect(initialeDe(" théo")).toBe("T");
    expect(initialeDe("")).toBe("?");
  });
});
