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
  MIN_READ_GAP_MS,
  OFF_TOPIC_MIN_VIDEOS,
  SECOND_LOOK_MS,
  accountVerdict,
  formatSuccess,
  isOffTopic,
  videoApp,
  nextReadAtFor,
  rivalElsewhere,
  shouldPromote,
  videoCitesApp,
} from "../convex/radarNetworkMath";
import { NETWORK_SEARCH_STALE_MS, networkSearchOutcome, networkSearchPhase } from "../convex/radarNetworkSearch";
import { SEED_ACCOUNTS } from "../convex/radarSeedAccounts";
import { cleanText, parseScVideo } from "../convex/radarSignalsMath";

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

  it("les apps de départ : 11 concurrentes de Snytch (FollowOtter à part, les jeux d'enquête déclassés), 6 de BLUSH, puis les autres", () => {
    expect(SEED_APPS.filter((a) => a.rivalOf.includes("snytch")).map((a) => a.name)).toEqual([
      "The Ick", "CheatLove", "RecentFollow", "FollowSpy", "FollowOtter", "Lurk", "Katch", "Susly", "Snitch", "Crush Tracker", "Sunsay",
    ]);
    // Stalkie, Snitchy et Shady (jeux d'enquête) : toujours suivies, plus concurrentes (09/11/2026).
    for (const slug of ["stalkie", "snitchy", "shady"]) expect(app(slug).rivalOf).toEqual([]);
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

/** Vidéos relevées en prod le 09/11/2026 chez des comptes des réseaux. */
describe("une vidéo n'est de l'app que si elle la cite (09/11/2026)", () => {
  it("l'extrait Disney d'un compte du réseau The Ick, le tuto allemand d'un compte du réseau The Cringe : non", () => {
    expect(
      videoCitesApp(
        { caption: "How Moseby’s Unforgettable Accent Was Really Created#DylanSprouse #ColeSprouse #PhillLewis #SuiteLifeOfZackAndCody #DisneyChannel #DisneyNostalgia", handle: "banginout009" },
        app("theick"),
      ),
    ).toBe(false);
    expect(
      videoCitesApp({ caption: "", hook: "Illegales Streaming: Es ist nicht mehr die Frage ob sondern wann ihr erwischt werdet‼️", handle: "thehandyman2go" }, app("thecringe")),
    ).toBe(false);
  });

  it("la légende, le texte à l'écran, ce qui est dit ou le pseudo qui la cite : oui", () => {
    expect(videoCitesApp({ caption: "Luego uno se anda enterando en recentfollow \n\n#fyp #infidelidad", handle: "soysarahi303" }, app("recentfollow"))).toBe(true);
    expect(videoCitesApp({ caption: "Recent Follow me abrió los ojos y duele pero es lo mejor.", handle: "mari279785" }, app("recentfollow"))).toBe(true);
    expect(videoCitesApp({ caption: "#fyp", hook: "C'est cheatlove.io si vous voulez y jeter un œil", handle: "x" }, app("cheatlove"))).toBe(true);
    expect(videoCitesApp({ caption: "", transcript: "allez voir recentfollow ça m'a ouvert les yeux", handle: "x" }, app("recentfollow"))).toBe(true);
    expect(videoCitesApp({ caption: "", handle: "the.recentfollow.girl" }, app("recentfollow"))).toBe(true);
  });
});

/** Les 10 dernières légendes de @banginout009 (réseau The Ick), relevées en prod le 09/11/2026. */
const BANGINOUT = [
  "One Tequila Shot, One Massage, and an Embarrassing Podcast Confession#PodcastClips #FunnyPodcast #GayPodcast #LGBTQTikTok #DatingStories #StorytimeTikTok",
  "Dating Sounds Fun—Until Work Leaves You Too Tired to Talk#PodcastClips #FunnyPodcast #GayPodcast #LGBTQTikTok #DatingStories #StorytimeTikTok",
  "WeHo Nights, Bad Run-Ins & Why We Love Being Single#PodcastClips #FunnyPodcast #GayPodcast #LGBTQTikTok #DatingStories #StorytimeTikTok",
  "The Obamas, Matt Damon, and My First Glasses #DylanSprouse #ColeSprouse #PhillLewis #SuiteLifeOfZackAndCody #DisneyChannel #DisneyNostalgia",
  "The Baby-Safe Pillowcase Gift That Helps Everyone Sleep Better#DylanSprouse #ColeSprouse #PhillLewis #SuiteLifeOfZackAndCody #DisneyChannel #DisneyNostalgia",
  "Mom Thought the Bulldog Was a Goblin—Then She Fell in Love#DylanSprouse #ColeSprouse #PhillLewis #SuiteLifeOfZackAndCody #DisneyChannel #DisneyNostalgia",
  "He Refused to Change the Channel During His Friends Episode#DylanSprouse #ColeSprouse #PhillLewis #SuiteLifeOfZackAndCody #DisneyChannel #DisneyNostalgia",
  "How Moseby’s Unforgettable Accent Was Really Created#DylanSprouse #ColeSprouse #PhillLewis #SuiteLifeOfZackAndCody #DisneyChannel #DisneyNostalgia",
  "How Phil Lewis Inspired Him to Return to Acting#DylanSprouse #ColeSprouse #PhillLewis #SuiteLifeOfZackAndCody #DisneyChannel #DisneyNostalgia #PodcastClips",
  "From Benson’s Influence to Getting Recognized as Mr. Moseby#DylanSprouse #ColeSprouse #PhillLewis #SuiteLifeOfZackAndCody #DisneyChannel #DisneyNostalgia",
].map((caption) => ({ caption }));

describe("compte qui ne cite jamais son app : plus relevé (09/11/2026)", () => {
  it("@banginout009, entré par une légende, 10 vidéos sans The Ick : hors sujet", () => {
    expect(isOffTopic("caption", BANGINOUT, "banginout009", app("theick"))).toBe(true);
  });

  it("une seule vidéo qui cite l'app suffit à le garder ; trop peu de vidéos lues, on attend", () => {
    expect(isOffTopic("caption", [...BANGINOUT.slice(0, 9), { caption: "bon j'ai testé theick.io ce soir" }], "banginout009", app("theick"))).toBe(false);
    expect(isOffTopic("caption", BANGINOUT.slice(0, OFF_TOPIC_MIN_VIDEOS - 1), "banginout009", app("theick"))).toBe(false);
    // Les Reels Instagram (sans légende lue) ne comptent pas ; les vidéos sans texte lu non plus.
    expect(isOffTopic("caption", [...BANGINOUT.slice(0, 8), { hook: "x", platform: "instagram" }, {}], "banginout009", app("theick"))).toBe(false);
  });

  it("un compte choisi à la main ou de la liste de départ n'est jamais jugé", () => {
    expect(isOffTopic("manual", BANGINOUT, "banginout009", app("theick"))).toBe(false);
    expect(isOffTopic("seed", BANGINOUT, "banginout009", app("theick"))).toBe(false);
  });
});

describe("un format réussi se lit sur ses reprises (09/11/2026)", () => {
  it("« new obsession » : 1,8 M au mieux, mais 3 reprises réussies sur 23 → pas réussi", () => {
    const reprises = [257.3, 12, 4.1, ...Array.from({ length: 20 }, () => 1)].map((multiplier) => ({ multiplier }));
    expect(formatSuccess(reprises)).toMatchObject({ measured: 23, wins: 3, median: 1, winning: false });
  });

  it("RAMPAGE - SLOWED (Umax) : 3 sur 4 → réussi ; moins de 3 reprises mesurées → on ne juge pas", () => {
    expect(formatSuccess([{ multiplier: 14 }, { multiplier: 11.9 }, { multiplier: 10.7 }, { multiplier: 1.2 }])).toMatchObject({ measured: 4, wins: 3, winning: true });
    expect(formatSuccess([{ multiplier: 286 }, { multiplier: 1.4 }]).winning).toBe(false);
    // Une reprise non mesurée (compte sans médiane) ne compte ni pour ni contre.
    expect(formatSuccess([{ multiplier: 5 }, { multiplier: 4 }, {}, { multiplier: 1 }])).toMatchObject({ measured: 3, wins: 2, winning: true });
  });
});

// Les vraies légendes et textes à l'écran relevés en prod le 09/11/2026.
const LILY_GIRLTEA = [
  { caption: "i should’ve checked his follow otter sooner #breakup #relationships #situationship", hook: "Intuition is real because why did I literally spend weeks trying to convince myself I was overthinking" },
  { caption: "He doesn’t know that I saw EVERYTHING on followotter.com 🙃 #cheater #toxic #redflags" },
  { caption: "i forgave him 1000 times even after what followotter.com showed me #redflags #breakup #dating" },
  { caption: "check his following followotter.com #cheater #toxic #heartbroken", hook: "Being cheated on in your first serious relationship will haunt you forever" },
  { caption: "what i saw on his follow otter ruined it all #toxicrelationship #breakup #exboyfriend" },
  { caption: "i literally found everything on follow otter #cheater #toxic #redflags" },
  { caption: "followotter.com showed me everything #toxicrelationship #breakup #dating" },
  { caption: "check his followotter girl #cheater #toxic #redflags" },
  { caption: "i found out about his wife on followotter.com #toxicrelationship #breakup #exboyfriend" },
  { caption: "Let me go check who he follows on followotter.com #cheater #toxic #redflags" },
  { caption: "follow otter showed me everything #cheater #dating #toxic" },
  { caption: "Link in my bio 👀 #cheater #redflags #toxic", hook: "How to view your man’s recent following on ig👀" },
  { caption: "Follows.ai if you wanna try! Link in my bio 🕵🏻 #cheater #exboyfriend #heartbroken" },
];
const WYATT = [
  { caption: "Stopped resenting her and started j checking FollowOtter to save myself the time 🫠 #cheatinggf" },
  { caption: "Stopped resenting her and started j checking FollowSpy 🫠 #cheatinggf #relatable" },
  { caption: "The craziest part is she almost got away with it.. almost and then i checked FollowOtter 🫩" },
  { caption: "The craziest part is she almost got away with it … almost and then i checked Follow Otter 🫠🫠" },
  { caption: "Thank god for FollowOtter or I’d probably still be in the dark 🫩🫩 #truth" },
];

describe("un compte va dans le réseau de l'app qu'il cite le plus (09/11/2026)", () => {
  const others = SEED_APPS.filter((a) => a.slug !== "followspy");

  it("@lily.girltea, rangée sous FollowSpy, 11 vidéos FollowOtter sur 13 : elle change de réseau au lieu d'être « hors sujet »", () => {
    const v = accountVerdict("caption", LILY_GIRLTEA, "lily.girltea", app("followspy"), others);
    expect(v).toMatchObject({ kind: "move", cited: 11 });
    expect(v.kind === "move" && v.to.name).toBe("FollowOtter");
    // Tant que FollowOtter n'est pas suivie, elle ne cite « aucune app » : c'était la mise en pause à tort.
    expect(accountVerdict("caption", LILY_GIRLTEA, "lily.girltea", app("followspy"), others.filter((a) => a.slug !== "followotter"))).toEqual({ kind: "offTopic" });
  });

  it("@wyattsocialhacks cite FollowSpy une fois et FollowOtter quatre : il change aussi ; à égalité ou sous 3 vidéos, il reste", () => {
    const v = accountVerdict("caption", WYATT, "wyattsocialhacks", app("followspy"), others);
    expect(v).toMatchObject({ kind: "move", cited: 4 });
    // 2 vidéos FollowOtter seulement : pas assez pour le bouger.
    expect(accountVerdict("caption", WYATT.slice(0, 3), "wyattsocialhacks", app("followspy"), others)).toEqual({ kind: "keep" });
    // Autant de vidéos pour chacune : il reste où il est.
    const egal = [...WYATT.slice(0, 1), ...WYATT.slice(2, 4), { caption: "FollowSpy again" }, { caption: "followspy.ai link in bio" }, WYATT[1]];
    expect(accountVerdict("caption", egal, "wyattsocialhacks", app("followspy"), others)).toEqual({ kind: "keep" });
  });

  it("un compte choisi à la main ou de la liste de départ ne bouge jamais ; @banginout009 reste hors sujet", () => {
    expect(accountVerdict("manual", LILY_GIRLTEA, "lily.girltea", app("followspy"), others)).toEqual({ kind: "keep" });
    expect(accountVerdict("seed", LILY_GIRLTEA, "lily.girltea", app("followspy"), others)).toEqual({ kind: "keep" });
    expect(accountVerdict("caption", BANGINOUT, "banginout009", app("theick"), SEED_APPS.filter((a) => a.slug !== "theick"))).toEqual({ kind: "offTopic" });
  });

  it("un compte Flert Now qui met #rizzapp sous chaque vidéo reste chez Flert Now : il faut 3 fois plus de citations", () => {
    // Les vraies légendes de @gustavo_gomes677 (09/11/2026).
    const gustavo = Array.from({ length: 10 }, (_, i) => ({
      caption: `Link do App na bio 🤒 #Cantadas #CantadaSparaCrush #story #rizzapp #flerte${i % 4 === 2 ? "" : " @Flert now - Cantadas e flertes"}`,
    }));
    expect(accountVerdict("caption", gustavo, "gustavo_gomes677", app("flertnow"), SEED_APPS.filter((a) => a.slug !== "flertnow"))).toEqual({ kind: "keep" });
  });

  it("« his recent following » n'est pas l'app RecentFollow ; son nom, son hashtag et « recent follow app » le sont", () => {
    const rf = app("recentfollow");
    expect(citesApp("I literally just found out how to see my boyfriends recent following on IG🤡", "x", rf)).toBe(false);
    expect(citesApp("Checking his recent follows on followpeek.com #cheating", "x", rf)).toBe(false);
    expect(citesApp("who he recently followed 👀", "x", rf)).toBe(false);
    expect(citesApp("RecentFollow showed me everything", "x", rf)).toBe(true);
    expect(citesApp("Recent Follow showed me everything", "x", rf)).toBe(true);
    expect(citesApp("the recent follow app is crazy #recentfollow", "x", rf)).toBe(true);
    expect(citesApp("recentfollow.com 👀", "x", rf)).toBe(true);
  });

  it("une vidéo est rangée sous l'app suivie qu'elle cite, en deux mots comme en un", () => {
    expect(videoApp({ caption: "what i saw on his follow otter ruined it all", handle: "lily.girltea" }, SEED_APPS)?.name).toBe("FollowOtter");
    expect(videoApp({ caption: "Link in my bio 👀 #cheater", hook: "How to view your man’s recent following on ig👀", handle: "lily.girltea" }, SEED_APPS)).toBeUndefined();
    expect(citesApp("check his following followotter.com", "lily.girltea", app("followspy"))).toBe(false);
  });
});

describe("relevé calé sur la dernière publication + 18 h (09/11/2026)", () => {
  const H = 3_600_000;
  it("une vidéo vue à moins de 12 h a son second regard à H+18", () => {
    expect(nextReadAtFor(NOW - 3 * H, NOW)).toBe(NOW - 3 * H + SECOND_LOOK_MS);
    expect(nextReadAtFor(NOW - 12 * H, NOW)).toBe(NOW + MIN_READ_GAP_MS);
  });

  it("au-delà, le relevé suivant tombe 18 h après l'heure où le compte publie, jamais à moins de 6 h", () => {
    // Dernière vidéo il y a 13 h : H+18 serait dans 5 h, trop près → le lendemain à la même heure.
    expect(nextReadAtFor(NOW - 13 * H, NOW)).toBe(NOW + 29 * H);
    // Il y a 20 h : relevé dans 22 h, quand la vidéo du lendemain (même heure) aura 18 h.
    expect(nextReadAtFor(NOW - 20 * H, NOW)).toBe(NOW + 22 * H);
    // Il y a 2,9 jours : toujours calé, dans moins de 30 h.
    const next = nextReadAtFor(NOW - 69.6 * H, NOW);
    expect((next - (NOW - 69.6 * H) - SECOND_LOOK_MS) % DAY).toBe(0);
    expect(next - NOW).toBeGreaterThanOrEqual(MIN_READ_GAP_MS);
    expect(next - NOW).toBeLessThan(30 * H);
  });

  it("un compte qui publie deux fois par jour : chaque vidéo a son second regard, la plus ancienne des neuves d'abord", () => {
    // Vidéos il y a 10 h et il y a 1 h : relevé dans 8 h (la première à H+18), pas dans 17 h.
    expect(nextReadAtFor(NOW - 1 * H, NOW, NOW - 10 * H)).toBe(NOW + 8 * H);
    // Une vidéo de 11,9 h : son H+18 tombe dans 6,1 h.
    expect(nextReadAtFor(NOW - 11.9 * H, NOW, NOW - 11.9 * H)).toBe(NOW + 6.1 * H);
    // Plus de vidéo neuve à suivre (12 h ou plus) : retour au calage sur la dernière publication.
    expect(nextReadAtFor(NOW - 13 * H, NOW, NOW - 13 * H)).toBe(NOW + 29 * H);
  });

  it("un compte calme, dormant ou jamais vu garde son rythme : plus de relevé toutes les 6 h", () => {
    expect(nextReadAtFor(NOW - 5 * DAY, NOW)).toBe(nextReadAt(NOW - 5 * DAY, NOW));
    expect(nextReadAtFor(NOW - 20 * DAY, NOW)).toBe(NOW + 7 * DAY);
    expect(nextReadAtFor(undefined, NOW)).toBe(NOW + 3 * DAY);
  });
});

describe("concurrente d'un autre projet", () => {
  it("The Ick (Snytch) vue de BLUSH : oui ; vue de Snytch, ou une app neutre : non", () => {
    expect(rivalElsewhere(["snytch"], "blush")).toBe(true);
    expect(rivalElsewhere(["snytch"], "snytch")).toBe(false);
    expect(rivalElsewhere(["snytch", "blush"], "blush")).toBe(false);
    expect(rivalElsewhere([], "blush")).toBe(false);
  });
});

describe("recherche du réseau d'une app, vue de l'écran (09/11/2026)", () => {
  const base = { requestedAt: NOW, step: 0, steps: 6, attached: 0, signals: 0 };

  it("en cours dès la demande, finie à son issue, et jamais en cours pour toujours", () => {
    expect(networkSearchPhase(undefined, NOW)).toBe("idle");
    expect(networkSearchPhase(null, NOW)).toBe("idle");
    // Demandée, pas encore partie : déjà « en cours » (l'écran tourne dès le clic).
    expect(networkSearchPhase(base, NOW + 1_000)).toBe("running");
    expect(networkSearchPhase({ ...base, startedAt: NOW + 2_000, step: 3 }, NOW + 60_000)).toBe("running");
    expect(networkSearchPhase({ ...base, startedAt: NOW, finishedAt: NOW + 40_000, outcome: "done" }, NOW + 50_000)).toBe("finished");
    // Une tâche tombée en route : passé 15 min, on peut relancer.
    expect(networkSearchPhase({ ...base, startedAt: NOW }, NOW + NETWORK_SEARCH_STALE_MS - 1)).toBe("running");
    expect(networkSearchPhase({ ...base, startedAt: NOW }, NOW + NETWORK_SEARCH_STALE_MS)).toBe("stale");
    // Jamais partie (planificateur perdu) : comptée depuis la demande.
    expect(networkSearchPhase(base, NOW + NETWORK_SEARCH_STALE_MS)).toBe("stale");
  });

  it("l'issue dit pourquoi elle s'est arrêtée : crédits, budget, pages en échec", () => {
    expect(networkSearchOutcome({ complete: true, noCredits: false, calls: 12, failures: 0 })).toBe("done");
    // Quelques pages en échec n'empêchent pas une recherche d'aboutir.
    expect(networkSearchOutcome({ complete: true, noCredits: false, calls: 12, failures: 3 })).toBe("done");
    expect(networkSearchOutcome({ complete: true, noCredits: false, calls: 6, failures: 6 })).toBe("error");
    expect(networkSearchOutcome({ complete: false, noCredits: false, calls: 4, failures: 0 })).toBe("budget");
    // Budget épuisé avant le premier appel.
    expect(networkSearchOutcome({ complete: false, noCredits: false, calls: 0, failures: 0 })).toBe("budget");
    expect(networkSearchOutcome({ complete: false, noCredits: true, calls: 3, failures: 1 })).toBe("no-credits");
    // Une app sans recherche (aucun motif) : rien à lire, c'est fini.
    expect(networkSearchOutcome({ complete: true, noCredits: false, calls: 0, failures: 0 })).toBe("done");
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

describe("textes coupés sans moitié d'emoji (bug de prod du 07/11/2026)", () => {
  /** Une valeur avec une moitié d'emoji seule : Convex la refuse et le passage entier tombe. */
  const loneHalf = (x: string) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(x);

  it("un hook de 200 caractères pile sur un emoji est coupé AVANT l'emoji", () => {
    const hook = "a".repeat(199) + "😭 fin";
    const v = parseScVideo({ ...VOCA_1, interaction_stickers: [{ type: 18, text_info: hook }] })!;
    expect(loneHalf(v.hook!)).toBe(false);
    expect(v.hook).toBe("a".repeat(199));
    // Et la vidéo entière passe en JSON sans erreur.
    expect(() => JSON.parse(JSON.stringify(v))).not.toThrow();
  });

  it("bio, titre du son et libellé de mention aussi ; une moitié déjà seule devient « � »", () => {
    const bio = "b".repeat(299) + "🔥";
    const v = parseScVideo({ ...VOCA_1, author: { ...VOCA_1.author, signature: bio }, music: { ...VOCA_1.music, title: "t".repeat(119) + "🎵" } })!;
    expect([loneHalf(v.authorBio!), loneHalf(v.musicTitle!)]).toEqual([false, false]);
    expect(cleanText("ok \ud83d fin")).toBe("ok \ufffd fin");
    expect(cleanText("😭😭", 3)).toBe("😭");
    expect(cleanText("sans coupe")).toBe("sans coupe");
  });
});
