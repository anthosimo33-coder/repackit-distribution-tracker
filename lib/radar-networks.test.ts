import { describe, expect, it } from "vitest";
import {
  MAX_OTHER_TOTAL,
  MAX_PER_OTHER_APP,
  MAX_TRACKED,
  MEDIAN_FLOOR,
  SEED_APPS,
  canTrack,
  candidatesOf,
  citesApp,
  domainsIn,
  findApp,
  hookKey,
  medianViews,
  multiplierOf,
  nextReadAt,
  patternsOfCandidate,
  searchKind,
  shouldPromote,
} from "../convex/radarNetworkMath";
import { SEED_ACCOUNTS } from "../convex/radarSeedAccounts";
import { parseScVideo } from "../convex/radarSignalsMath";

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

  it("les apps de départ : 13 concurrentes de Snytch, 6 de BLUSH, puis les autres", () => {
    expect(SEED_APPS.filter((a) => a.rivalOf.includes("snytch")).map((a) => a.name)).toEqual([
      "The Ick", "CheatLove", "RecentFollow", "Stalkie", "FollowSpy", "Snitchy", "Shady", "Lurk", "Katch", "Susly", "Snitch", "Crush Tracker", "Sunsay",
    ]);
    expect(SEED_APPS.filter((a) => a.rivalOf.includes("blush")).map((a) => a.name)).toEqual([
      "What Brandon Thinks", "The Cringe", "Rizz App", "Plug AI", "Rizz Master", "Flert Now",
    ]);
    // Les concurrentes d'abord : `findApp` prend la première citée.
    const firstOther = SEED_APPS.findIndex((a) => a.rivalOf.length === 0);
    expect(SEED_APPS.slice(firstOther).every((a) => a.rivalOf.length === 0)).toBe(true);
    expect(new Set(SEED_APPS.map((a) => a.slug)).size).toBe(SEED_APPS.length);
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

describe("les apps ajoutées le 06/11/2026", () => {
  it("légendes et pseudos réels : cités, et l'argot ou le vocabulaire courant ne l'est pas", () => {
    expect(citesApp("Mirá sus seguidores y seguidos⬇️ Followspy.ai", "liana.chisme", app("followspy"))).toBe(true);
    expect(citesApp("Gracias Follow Spy por abrirme los ojos 🥺", "lolii_023", app("followspy"))).toBe(true);
    expect(citesApp("Conviértete en Embajador 👇 🔗creators.stalkie.io", "isabellaai2m9e", app("stalkie"))).toBe(true);
    expect(citesApp("Tu stalker fav 🤫", "valen.lurk", app("lurk"))).toBe(true);
    expect(citesApp("lurking on my ex's insta again #stalk", "jane.doe", app("lurk"))).toBe(false);
    expect(citesApp("Ojo que te stalkeo con Shady 👀", "charlottebarry_8", app("shady"))).toBe(true);
    expect(citesApp("that's so shady lol #fyp", "mike", app("shady"))).toBe(false);
    expect(citesApp("@rizz.app knows exactly what to say 💍 Link in Bio", "susanaxv5a1", app("rizzapp"))).toBe(true);
    expect(citesApp("@RIZZ APP Link in bio #rizzapp #textstory", "universe.texts", app("rizzapp"))).toBe(true);
    expect(citesApp("Engaged for one time... @Plug AI Link in Bio #textingstory #chats", "ameero058", app("plugai"))).toBe(true);
    expect(citesApp("Five ChatGPT plugins to explore: Record and Replay", "skyeluai", app("plugai"))).toBe(false);
    expect(citesApp("plug ai into your workflow #productivity", "dylgpt", app("plugai"))).toBe(false);
    expect(citesApp("Tracking what I eat just got so much easier with Cal AI. 💗 @Cal AI", "itsnada305", app("calai"))).toBe(true);
    // « lo-cal-ai » : sans mot de repas, ce n'est pas Cal AI.
    expect(citesApp("the best local AI models you can run", "mattfarmerai", app("calai"))).toBe(false);
    expect(citesApp("eu nao esperava por essa 😭", "giovanna.vocaai", app("vocaai"))).toBe(true);
    // Le lien des ambassadrices Snitchy reste à Snitchy.
    expect(findApp("Deviens ambassadrice 👉 creators.getsnitchy.app", "lilimystery", SEED_APPS)?.name).toBe("Snitchy");
    expect(citesApp("Stalke-le avec get.snitchapp.io 👀", "x", app("snitch"))).toBe(true);
    expect(citesApp("Creed (2015) best boxing movie ever", "filmbuff", app("creed"))).toBe(false);
    expect(citesApp("Minha oração de hoje com o Creed 🙏", "ana.prayer", app("creed"))).toBe(true);
  });

  it("les comptes de départ : chacun dans UNE app de départ, en pseudo nu", () => {
    const slugs = new Set(SEED_APPS.map((a) => a.slug));
    const seen = new Set<string>();
    for (const [slug, handles] of Object.entries(SEED_ACCOUNTS)) {
      expect(slugs.has(slug)).toBe(true);
      for (const h of handles) {
        expect(h).toMatch(/^[a-z0-9._]+$/);
        expect(seen.has(h)).toBe(false);
        seen.add(h);
      }
    }
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe("places dans le réseau", () => {
  const counts = (total: number, ofApp: number, others: number) => ({ total, ofApp, others });
  it("une concurrente prend toutes les places jusqu'au plafond", () => {
    expect(canTrack(counts(MAX_TRACKED - 1, 500, MAX_OTHER_TOTAL), true, false)).toBe(true);
    expect(canTrack(counts(MAX_TRACKED, 0, 0), true, false)).toBe(false);
  });
  it("une autre app : 40 comptes au plus, et 600 pour toutes ; ajout à la main et liste de départ passent outre", () => {
    expect(canTrack(counts(100, MAX_PER_OTHER_APP - 1, 10), false, false)).toBe(true);
    expect(canTrack(counts(100, MAX_PER_OTHER_APP, 10), false, false)).toBe(false);
    expect(canTrack(counts(700, 3, MAX_OTHER_TOTAL), false, false)).toBe(false);
    expect(canTrack(counts(700, MAX_PER_OTHER_APP, MAX_OTHER_TOTAL), false, true)).toBe(true);
    expect(canTrack(counts(MAX_TRACKED, 0, 0), false, true)).toBe(false);
  });
});

/** Deux vidéos réelles de @giovanna.vocaai (réponse non allégée du 06/11/2026), réduites aux champs lus. */
const VOCA_1 = {"aweme_id": "7636813100406050056", "desc": "@Voca AI vivendo e aprendendo novos vocabularios ne \n\n#vocaai #inglesfacil #speakingenglish #inglesparatodos #studyenglish ", "create_time": 1778084116, "region": "BR", "desc_language": "pt", "author": {"uid": "7623781099194041352", "unique_id": "giovanna.vocaai", "nickname": "giovanna.vocaai", "follower_count": 6629, "signature": "🗣️ Voca AI Ambassador"}, "music": {"id": 7636813180069334000, "id_str": "7636813180069333767", "title": "original sound - giovanna.vocaai", "owner_handle": "giovanna.vocaai", "is_original_sound": true}, "statistics": {"play_count": 1114008, "digg_count": 58067, "comment_count": 272, "share_count": 1360, "collect_count": 4910}, "text_extra": [{"start": 0, "end": 8, "type": 0, "user_id": "7504863753483240490"}, {"start": 53, "end": 60, "type": 1, "hashtag_name": "vocaai"}], "interaction_stickers": [{"type": 18, "text_info": "Consegui fazer a IA me xingar 🥲"}, {"type": 20}], "video": {"duration": 38634}};
const VOCA_2 = {"aweme_id": "7704431333652712711", "desc": "Ainda bem que tenho a @Voca AI pra me salvar @giovanna.vocaai #vocaai #inglesparatodos ", "create_time": 1793827722, "region": "BR", "desc_language": "pt", "author": {"uid": "7623781099194041352", "unique_id": "giovanna.vocaai", "follower_count": 6629, "signature": "🗣️ Voca AI Ambassador"}, "music": {"id": 7255694393607212000, "id_str": "7255694393607211822", "title": "original sound - soundcentral21", "owner_handle": "soundcentral21", "is_original_sound": true}, "statistics": {"play_count": 635, "digg_count": 45, "comment_count": 6, "share_count": 1, "collect_count": 6}, "text_extra": [{"start": 22, "end": 30, "type": 0, "user_id": "7504863753483240490"}, {"start": 45, "end": 61, "type": 0, "user_id": "7623781099194041352"}], "interaction_stickers": [{"type": 18, "text_info": "Pov: você achou que estava preparada para a imigração 🤡🫣🇺🇸"}], "video": {"duration": 39900}};

describe("lecture d'une réponse non allégée", () => {
  it("le hook (texte à l'écran), le son par son id EXACT, les mentions et la bio", () => {
    const v = parseScVideo(VOCA_1)!;
    expect(v.hook).toBe("Consegui fazer a IA me xingar 🥲");
    // `music.id` est un nombre qui a perdu sa précision : seul `id_str` est juste.
    expect(v.musicId).toBe("7636813180069333767");
    expect(v.musicTitle).toBe("original sound - giovanna.vocaai");
    expect(v.musicOwner).toBe("giovanna.vocaai");
    expect(v.mentions).toEqual([{ id: "7504863753483240490", label: "@Voca AI" }]);
    expect(v.authorBio).toBe("🗣️ Voca AI Ambassador");
  });
  it("une mention au milieu de la légende, et jamais le compte lui-même", () => {
    const v = parseScVideo(VOCA_2)!;
    expect(v.mentions).toEqual([{ id: "7504863753483240490", label: "@Voca AI" }]);
    expect(v.musicOwner).toBe("soundcentral21");
  });
  it("une réponse allégée n'a ni hook, ni son, ni mention", () => {
    const trimmed: Record<string, unknown> = { ...VOCA_1 };
    for (const k of ["interaction_stickers", "music", "text_extra"]) delete trimmed[k];
    const v = parseScVideo(trimmed)!;
    expect([v.hook, v.musicId, v.mentions]).toEqual([undefined, undefined, undefined]);
  });
});

describe("formats et apps repérées", () => {
  it("un hook : mêmes mots = même format, quelle que soit la casse, l'accent ou l'emoji", () => {
    expect(hookKey("Pov: você achou que estava preparada para a imigração 🤡🫣🇺🇸")).toBe(
      hookKey("POV : Voce achou que estava PREPARADA para a imigração !!"),
    );
    expect(hookKey("IA me chamou de lixo? 😱")).toBe("ia me chamou de lixo");
    expect(hookKey("Oi 👋")).toBeNull();
    expect(hookKey(undefined)).toBeNull();
  });

  it("les domaines d'app cités, sans les e-mails ni les liens de bio", () => {
    expect(domainsIn("Mirá sus seguidores y seguidos⬇️ Followspy.ai")).toEqual(["followspy.ai"]);
    expect(domainsIn("Conviértete en Embajador 👇 🔗creators.stalkie.io")).toEqual(["stalkie.io"]);
    expect(domainsIn("50% off 👉🏻 https://try.praktika.ai/?via=daiana")).toEqual(["praktika.ai"]);
    expect(domainsIn("baixe pelo link joinkairo.app/gabi10")).toEqual(["joinkairo.app"]);
    expect(domainsIn("Prueba theick.io🙊 vapimecolab@gmail.com")).toEqual(["theick.io"]);
    expect(domainsIn("Pr.matildebatalha@outook.com · pr@theick.io")).toEqual([]);
    expect(domainsIn("tous mes liens beacons.ai/lea · example.com")).toEqual([]);
  });

  it("ce qu'un compte cite : ses mentions (pas lui-même), les domaines de ses légendes et de sa bio", () => {
    const v = parseScVideo(VOCA_2)!;
    expect(candidatesOf({ ...v, authorBio: "Embaixador 👇 🔗creators.stalkie.io" })).toEqual([
      { key: "@7504863753483240490", kind: "mention", label: "@Voca AI" },
      { key: "stalkie.io", kind: "domain", label: "stalkie.io" },
    ]);
    expect(patternsOfCandidate({ kind: "domain", label: "stalkie.io" })).toEqual(["stalkie.io", "stalkie"]);
    expect(patternsOfCandidate({ kind: "mention", label: "@RIZZ APP" })).toEqual(["rizzapp"]);
  });
});
