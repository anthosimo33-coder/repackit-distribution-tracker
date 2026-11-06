import { describe, expect, it } from "vitest";
import {
  MEDIAN_FLOOR,
  SEED_APPS,
  citesApp,
  findApp,
  medianViews,
  multiplierOf,
  nextReadAt,
  searchKind,
  shouldPromote,
} from "../convex/radarNetworkMath";

const app = (slug: string) => SEED_APPS.find((a) => a.slug === slug)!;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 6, 15, 0);

/** Légendes et pseudos relevés sur TikTok le 06/11/2026. */
describe("rattachement d'un compte à une app", () => {
  it("The Ick : cité par son site, ou « theick » avec un mot de contexte ; jamais l'argot « the ick »", () => {
    const ick = app("theick");
    expect(citesApp("I was in shock… theick.io #fyp #insta #stalker #ig #following", "s.ecrettacc.vero", ick)).toBe(true);
    expect(citesApp("Como? #theickio #fyp #theick", "catarinasecretaccount", ick)).toBe(true);
    expect(citesApp("Dinguerie #insta #tromperie #theick #crush #trompeur", "the.ickapp", ick)).toBe(true);
    expect(citesApp("the last one is my favourite #theick #datingproblems #dating #datinglife", "chiaraking", ick)).toBe(false);
    expect(citesApp("If you get the ick over every little thing it's actually a fear of intimacy", "healwithjaclyn", ick)).toBe(false);
    // Le pseudo seul ne suffit pas.
    expect(citesApp("", "margotheick", ick)).toBe(false);
  });

  it("CheatLove : « cheatlove » ne compte qu'avec un mot de contexte qui n'est pas lui-même", () => {
    const cl = app("cheatlove");
    expect(citesApp("Juste imagine une relation gâchée… 💔💔 #decu #tromperiecouple #ex #cheatlove", "lola.stalk", cl)).toBe(true);
    expect(citesApp("Heureusement que j'ai fait ça ! 💔😭#cheatlove #tromperie", "celia.stalk", cl)).toBe(true);
    expect(citesApp("Two faces of scout🫡 #biggboss  #cheatlove  #fakelove  #trending", "immalloo0", cl)).toBe(false);
  });

  it("RecentFollow et What Brandon Thinks : cités en un mot ou en plusieurs", () => {
    expect(citesApp("Recent Follow me ayudó a abrir los ojos 👀 #hombres #parejas", "mari279785", app("recentfollow"))).toBe(true);
    expect(citesApp("and this is why i always use RecentFollow #foryoupage", "kas.girltea", app("recentfollow"))).toBe(true);
    expect(citesApp("je sais pas si je dois rire ou pleurer 💀💀#whatbrandonthinks", "laure.acc1", app("whatbrandonthinks"))).toBe(true);
    expect(citesApp("Desde cuándo WHATSAPP tiene esto?? 😭", "maris_ecret4", app("whatbrandonthinks"))).toBe(false);
  });

  it("The Cringe : « the cringe » seulement à côté d'une app, d'une conv ou de WhatsApp", () => {
    const tc = app("thecringe");
    expect(citesApp("The cringe, nu pot sa cred🫩🫩 #thecringe #app #couples #omg", "andra_privateacc", tc)).toBe(true);
    expect(citesApp("über die Funktion WhatsApp Chat exportieren soll man mit der App the Cringe", "thehandyman2go", tc)).toBe(true);
    expect(citesApp("that's the cringe part lol #fyp", "random", tc)).toBe(false);
  });

  it("la première app citée l'emporte, et rien n'est rattaché sans citation", () => {
    expect(findApp("#cheatlove #tromperie", "flo.stalk", SEED_APPS)?.name).toBe("CheatLove");
    expect(findApp("Voici toutes les applications qu'il faut installer", "arpegesauvage", SEED_APPS)).toBeUndefined();
  });

  it("les apps de départ : 3 concurrentes de Snytch, 2 de BLUSH", () => {
    expect(SEED_APPS.filter((a) => a.rivalOf.includes("snytch")).map((a) => a.name)).toEqual(["The Ick", "CheatLove", "RecentFollow"]);
    expect(SEED_APPS.filter((a) => a.rivalOf.includes("blush")).map((a) => a.name)).toEqual(["What Brandon Thinks", "The Cringe"]);
    // Aucun mot de contexte n'est contenu dans un motif faible de la même app.
    for (const a of SEED_APPS) {
      for (const w of a.weak ?? []) expect((a.context ?? []).filter((c) => w.includes(c.trim()))).toEqual([]);
    }
  });
});

describe("médiane et multiplicateur", () => {
  it("pas de médiane avant 5 vidéos ; impaire ou paire", () => {
    expect(medianViews([1_204, 980, 55_310, 612])).toBeUndefined();
    expect(medianViews([1_204, 980, 55_310, 612, 3_371])).toBe(1_204);
    expect(medianViews([1_204, 980, 55_310, 612, 3_371, 2_206])).toBe((1_204 + 2_206) / 2);
  });

  it("le multiplicateur compte la médiane au moins pour 200 vues", () => {
    expect(multiplierOf(160_700, 1_204)).toBeCloseTo(133.5, 1);
    expect(multiplierOf(38_383, 41)).toBe(38_383 / MEDIAN_FLOOR);
    expect(multiplierOf(38_383, undefined)).toBeUndefined();
  });

  it("promue dans Signaux : 10 000 vues et 3× la médiane, ou 10× les abonnés sans médiane", () => {
    expect(shouldPromote(9_999, 40, 99)).toBe(false);
    expect(shouldPromote(12_181, 3.2, 0.5)).toBe(true);
    expect(shouldPromote(12_181, 2.9, 99)).toBe(false);
    expect(shouldPromote(12_181, undefined, 10.2)).toBe(true);
    expect(shouldPromote(12_181, undefined, 9.8)).toBe(false);
  });
});

describe("rythme des relevés", () => {
  it("chaque jour si actif, tous les 3 jours si calme, chaque semaine s'il dort", () => {
    expect(nextReadAt(NOW - 1 * DAY, NOW)).toBe(NOW + DAY);
    expect(nextReadAt(NOW - 3 * DAY, NOW)).toBe(NOW + DAY);
    expect(nextReadAt(NOW - 5 * DAY, NOW)).toBe(NOW + 3 * DAY);
    expect(nextReadAt(NOW - 20 * DAY, NOW)).toBe(NOW + 7 * DAY);
    expect(nextReadAt(undefined, NOW)).toBe(NOW + 3 * DAY);
  });

  it("« #thecringe » est une recherche de hashtag, le reste des mots-clés", () => {
    expect(searchKind("#thecringe")).toEqual({ kind: "hashtag", value: "thecringe" });
    expect(searchKind("theick tromperie")).toEqual({ kind: "keyword", value: "theick tromperie" });
  });
});
