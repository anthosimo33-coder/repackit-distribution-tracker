import { describe, expect, it } from "vitest";
import {
  MAX_OTHER_TOTAL,
  MAX_PER_OTHER_APP,
  MAX_TRACKED,
  MEDIAN_FLOOR,
  SEED_APPS,
  canTrack,
  candidateName,
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
  effectiveRivalOf,
  withRivalChoice,
  seedRemoval,
  seedSync,
  shadowingApp,
  suggestedAppName,
  formatSuccess,
  isOffTopic,
  videoApp,
  nextReadAtFor,
  rivalElsewhere,
  shouldPromote,
  videoCitesApp,
} from "../convex/radarNetworkMath";
import { NETWORK_SEARCH_STALE_MS, networkSearchOutcome, networkSearchPhase } from "../convex/radarNetworkSearch";
import { SEED_ACCOUNTS, SEED_REMOVED } from "../convex/radarSeedAccounts";
import { cleanText, mentionLabel, parseScVideo } from "../convex/radarSignalsMath";

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

  it("les apps de départ : 11 concurrentes de Snytch (FollowOtter à part, les jeux d'enquête déclassés), 8 de BLUSH (WRizz et Wing AI depuis le 10/11), puis les autres", () => {
    expect(SEED_APPS.filter((a) => a.rivalOf.includes("snytch")).map((a) => a.name)).toEqual([
      "The Ick", "CheatLove", "RecentFollow", "FollowSpy", "FollowOtter", "Lurk", "Katch", "Susly", "Snitch", "Crush Tracker", "Sunsay",
    ]);
    // Stalkie, Snitchy et Shady (jeux d'enquête) : toujours suivies, plus concurrentes (09/11/2026).
    for (const slug of ["stalkie", "snitchy", "shady"]) expect(app(slug).rivalOf).toEqual([]);
    expect(SEED_APPS.filter((a) => a.rivalOf.includes("blush")).map((a) => a.name)).toEqual([
      "What Brandon Thinks", "The Cringe", "WRizz", "Wing AI", "Rizz App", "Plug AI", "Rizz Master", "Flert Now",
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

/** Légendes et pseudos relevés en prod le 09/11/2026 (comptes suivis, export du soir). */
describe("WRizz et Wing AI, concurrentes de BLUSH (10/11/2026)", () => {
  const wrizz = app("wrizz");
  const wing = app("wingaiapp");
  const rizzApp = app("rizzapp");

  it("WRizz : l'arobase, le dièse ou le site — pas « W rizz », « new rizz » ni @shadowrizzler70", () => {
    expect(citesApp("I used this app @WRizz #mentalists #Relationship #munipulation #thementalist #patrickjane", "rizzly.puff", wrizz)).toBe(true);
    expect(citesApp("How to rizz on text 💕 #beautiful #girlfriend #text #wrizz #wrizzapp #explore", "x", wrizz)).toBe(true);
    expect(citesApp("Shorting the best rizz that I have to my girlfriend using wrizz app. #reels #fyp", "rizz_master4", wrizz)).toBe(true);
    // Ses propres comptes, par le pseudo.
    for (const handle of ["wrizz_app", "wrizz.app", "wrizzz.app"]) expect(citesApp("Texting baddies on Instagram", handle, wrizz)).toBe(true);
    // L'argot « W rizz » (une victoire), « new rizz », et un pseudo qui contient les lettres.
    expect(citesApp("w rizz? #pledgetok #bamarush #viral #fyp #universityoforegon", "uoanthropologyclu", wrizz)).toBe(false);
    expect(citesApp("W rizz?", "oliverkastell", wrizz)).toBe(false);
    expect(citesApp("The new rizz line 🔥 @plug_ai #datingtips #plugai #textstory #rizz #aura", "kaihoun", wrizz)).toBe(false);
    expect(citesApp("The ending was unexpected 😭 😂 @Plug AI #rizz #pickupline #fyp", "shadowrizzler70", wrizz)).toBe(false);
  });

  it("Wing AI : « @WingAI », « #wingai » ou « @wingai_app » — le motif d'avant (« wingaiapp ») en ratait 105 vidéos sur 156", () => {
    expect(citesApp("@WingAIcame in CLUTCH with that line.💀😈#wingaicwj #texting #wingai #wingai #textstory", "textoinkk", wing)).toBe(true);
    expect(citesApp("@WingAI came in CLUTCH with that line.😂🙏", "sigmatext97", wing)).toBe(true);
    expect(citesApp("Finisce sempre nel... 😭 #messaggi #wingai #emotional", "messaggi.italia", wing)).toBe(true);
    expect(citesApp("@wingai_app Tira e molla ogni volta... 💔 #messaggi #emotional", "lestorieita", wing)).toBe(true);
    // Sans arobase ni dièse, « wingai » est dans « following AI ».
    expect(citesApp("following AI trends so you don't have to", "x", wing)).toBe(false);
    expect(citesApp("@Plug AI always come in clutch. 🙏😭 #plugaicwj #plugai #textstories", "textbulbb", wing)).toBe(false);
  });

  it("Rizz App ne lit plus les citations de WRizz (« wrizz.app » et « #wrizzapp » contiennent ses motifs)", () => {
    expect(citesApp("How to rizz on text 💕 #beautiful #girlfriend #text #wrizz #wrizzapp #explore", "wrizz.app", rizzApp)).toBe(false);
    expect(citesApp("Texting fine baddie on Instagram #rizz #rizzler #wrizzapp #textingstory", "wrizzz.app", rizzApp)).toBe(false);
    expect(citesApp("Shorting the best rizz that I have to my girlfriend using wrizz app.", "x", rizzApp)).toBe(false);
    // Les siennes tiennent, y compris à côté d'une citation de WRizz.
    expect(citesApp("it's a cold world we live in 😤 @Plug AI #plugairizz #textstories #rizzapp", "x", rizzApp)).toBe(true);
    expect(citesApp("get it on rizz.app", "x", rizzApp)).toBe(true);
    expect(citesApp("How to rizz on text 💕 #wrizz #rizzapp #explore", "x", rizzApp)).toBe(true);
    // Rangée sous la bonne app, dans l'ordre de la liste comme dans celui de la prod (Rizz App créée avant).
    expect(findApp("#wrizz #wrizzapp", "wrizz.app", SEED_APPS)?.name).toBe("WRizz");
    expect(findApp("#wrizz #wrizzapp", "wrizz.app", [rizzApp, wrizz])?.name).toBe("WRizz");
  });

  it("les comptes suivent : 3 de Plug AI vers Wing AI, 3 de Rizz App vers WRizz, 5 « W rizz » hors sujet", () => {
    const sauf = (slug: string) => SEED_APPS.filter((a) => a.slug !== slug);
    // @sigmatext97 : rangé sous Plug AI, ne cite plus que Wing AI.
    const sigma = Array.from({ length: 9 }, () => ({ caption: "@WingAI came in CLUTCH with that line.😈💀#wingaicwj #textstories #wingai #wingai #texting" }));
    const v = accountVerdict("caption", sigma, "sigmatext97", app("plugai"), sauf("plugai"));
    expect(v.kind === "move" && v.to.name).toBe("Wing AI");
    // @wrizz.app, rangé sous Rizz App sur son pseudo.
    const sien = Array.from({ length: 10 }, () => ({ caption: "How to rizz on text 💕 #beautiful #girlfriend #text #wrizz #wrizzapp #explore" }));
    const w = accountVerdict("caption", sien, "wrizz.app", rizzApp, sauf("rizzapp"));
    expect(w.kind === "move" && w.to.name).toBe("WRizz");
    // @uoanthropologyclu, entré chez WRizz sur « w rizz? » : aucune vidéo ne la cite.
    const fac = [{ caption: "w rizz? #pledgetok #bamarush #viral #fyp #universityoforegon" }, ...Array.from({ length: 9 }, (_, i) => ({ caption: `my favorite ferd ${i} #pledgetok #bamarush #viral #fyp` }))];
    expect(accountVerdict("caption", fac, "uoanthropologyclu", wrizz, sauf("wrizz"))).toEqual({ kind: "offTopic" });
  });

  it("le texte des vidéos prime sur le pseudo : @rizz_master4 écrit « using wrizz app », c'est un compte WRizz, pas Rizz Master", () => {
    const sauf = SEED_APPS.filter((a) => a.slug !== "rizzapp");
    const videos = [
      ...Array.from({ length: 6 }, () => ({ caption: "Shorting the best rizz that I have to my girlfriend using wrizz app. #reels #fyp #rizz #edit #follow" })),
      { caption: "Thank you. #milestone" },
      ...Array.from({ length: 3 }, (_, i) => ({ caption: `rizz of the day ${i} #reels` })),
    ];
    // Son pseudo contient « rizzmaster » : Rizz Master est « citée » par les 10 vidéos, WRizz par 6.
    expect(videos.filter((x) => citesApp(x.caption, "rizz_master4", app("rizzmaster")))).toHaveLength(10);
    const v = accountVerdict("caption", videos, "rizz_master4", rizzApp, sauf);
    expect(v).toMatchObject({ kind: "move", cited: 6 });
    expect(v.kind === "move" && v.to.name).toBe("WRizz");
    // Quand le texte ne cite rien, le pseudo décide toujours (« prénom.lurk » rangé ailleurs).
    const muet = Array.from({ length: 9 }, (_, i) => ({ caption: `pov ${i} 😭 #fyp` }));
    const l = accountVerdict("caption", muet, "ana.lurk", app("followspy"), SEED_APPS.filter((a) => a.slug !== "followspy"));
    expect(l.kind === "move" && l.to.name).toBe("Lurk");
    // Une app citée une seule fois dans un texte ne bloque pas celle du pseudo.
    const uneFois = [{ caption: "saw this on followotter lol" }, ...muet];
    const l2 = accountVerdict("caption", uneFois, "ana.lurk", app("followspy"), SEED_APPS.filter((a) => a.slug !== "followspy"));
    expect(l2.kind === "move" && l2.to.name).toBe("Lurk");
  });

  it("une app ajoutée à la main qui entre dans la liste de départ est adoptée ; les autres cas ne changent pas", () => {
    expect(seedSync(null, false)).toBe("create");
    // WRizz et Wing AI en prod le 10/11 : source « manual », sans concurrence.
    expect(seedSync({ source: "manual" }, false)).toBe("adopt");
    expect(seedSync({ source: "manual" }, true)).toBe("adopt");
    expect(seedSync({ source: "seed" }, false)).toBe("align");
    expect(seedSync({ source: "seed" }, true)).toBe("keep");
  });
});

/** Légendes et textes à l'écran relevés en prod le 10/11/2026 (vidéos de la découverte). */
describe("Love8, app de couple suivie depuis le 10/11/2026", () => {
  const love8 = app("love8");

  it("suivie comme Loverzz, sans être une concurrente ; ses 4 comptes de départ la citent tous", () => {
    expect(love8).toMatchObject({ name: "Love8", rivalOf: [] });
    // Les 4 du premier relevé, en tête ; la recherche approfondie du 10/11/2026 en a ajouté 19.
    expect(SEED_ACCOUNTS.love8.slice(0, 4)).toEqual(["bontlelove8", "johan_love8", "saraf.love8", "lour.love8"]);
    expect(SEED_ACCOUNTS.love8).toHaveLength(23);
    // Chaque compte de départ, sur sa vraie vidéo : étiquetée Love8, donc visible dans la file.
    const vraies = [
      { handle: "bontlelove8", caption: "❤️😫! @Love8  . . . #love8 #foryoupage #trendingvideo #fyp #couple " },
      { handle: "johan_love8", caption: "Pour vous amuser un peu à distance, testez ça ! 😝❤️ #love8app #relation #copine #couple", hook: "Les couples à distance cette astuce est pour vous · App : Love8" },
      { handle: "saraf.love8", caption: "Vai me atender SIM 😅🤯 #relationship #love #namoro #casal #fyp", hook: "Escrevo na tela dele 😅 · Quando meu namorado não me atende, eu faço isso: · Love8 APP" },
      // Ni la légende ni l'écran ne la nomment : le pseudo « prénom.love8 » suffit.
      { handle: "lour.love8", caption: "Amor de lejos #fyp #parati #tiktok #Viral #amoradistancia", hook: "\"Pero el vive lejos\" y se siente más presente que cualquiera persona que esté a mi lado" },
    ];
    expect(vraies.map((v) => v.handle)).toEqual(SEED_ACCOUNTS.love8.slice(0, 4));
    for (const v of vraies) expect(videoCitesApp(v, love8)).toBe(true);
    expect(findApp(vraies[0].caption, "bontlelove8", SEED_APPS)?.name).toBe("Love8");
  });

  it("chaque façon de l'écrire, seule ; « love8 » sans arobase, dièse ni « app » ne suffit pas", () => {
    expect(citesApp("❤️😫! @Love8", "x", love8)).toBe(true);
    expect(citesApp("#love8 #couple", "x", love8)).toBe(true);
    expect(citesApp("Quando meu namorado não me atende · Love8 APP", "x", love8)).toBe(true);
    expect(citesApp("cette astuce est pour vous · App : Love8", "x", love8)).toBe(true);
    // « I love 8… », collé par la lecture sans espaces, n'est pas l'app.
    expect(citesApp("things I love 8 times more about my boyfriend #couple #ldr", "x", love8)).toBe(false);
    // @magglove8 ne nomme jamais l'app (« grateful to have found this app ») et son pseudo n'a pas de séparateur.
    expect(videoCitesApp({ handle: "magglove8", caption: "#trend #ilovemygf #couple #gf", hook: "grateful to have found this app · Luckiest boy on earth beacuse you are my girlfriend" }, love8)).toBe(false);
  });

  it("Loverzz reste Loverzz : même idée (écrire sur l'écran de l'autre), autre app", () => {
    const cami = { handle: "loveby_cami", caption: "Soy tan tierna y así  App: Loverzz  #amor #parejas #novios #relacionadistancia #couplegoals", hook: "Yo bien tóxica escribiendo en su pantalla para que no se le acerquen 🥹🤍" };
    expect(videoCitesApp(cami, love8)).toBe(false);
    expect(videoCitesApp(cami, app("loverzz"))).toBe(true);
    expect(videoApp(cami, SEED_APPS)?.name).toBe("Loverzz");
    expect(citesApp("Cutest App ever #couple #loverzzapp #ldr #widget", "julie.vorin", love8)).toBe(false);
  });
});

/** Légendes lues le 10/11/2026 sur les pages TikTok #astraai et #retaincards. */
describe("Astra AI et Retain Cards, apps de révision suivies depuis le 10/11/2026", () => {
  const astra = app("astraai");
  const retain = app("retaincards");

  it("suivies sans être des concurrentes ; les comptes du premier relevé citent leur app dans leur vraie légende", () => {
    expect(astra).toMatchObject({ name: "Astra AI", rivalOf: [] });
    expect(retain).toMatchObject({ name: "Retain Cards", rivalOf: [] });
    const astraVraies = [
      { handle: "study.with.doina", caption: "Si tu étudies dans ces universités, tu peux obtenir les notes GRATUITEMENT 🤫‼️ #studytips #etudiant #université #astraai #3803" },
      { handle: "study_with_chlox", caption: "tous vos thèmes de bac de CHAQUE matière au même endroit !! 🙌🏼 || #etudiant #studytok #astraai #bac #4402 " },
      { handle: "an.lle3.study", caption: "Partage à tes amis avant que je supprime !🤫 #revision #etudes #etudiants #astraai #4502 (collaboration commerciale)" },
      { handle: "learnwithmarine", caption: "Cette appli est à bannir de ton programme de révision !🤯 #studytok #study #studytips #astraai #4503 " },
      { handle: "studywithl0u", caption: "Est-ce que c’est de la triche⁉️#studytips #studytok #triche #astraai #4002 " },
      { handle: "loussshacks", caption: "la clé c’est gagner du temps pour bien retenir !! 📚💯 #studytok #studytips #hack #astraai #4403 " },
      { handle: "tips_revision_calli", caption: "c est pas une dinguerie ???? #pourtoii #studytok #medecine #astraai #9999" },
      { handle: "studyblondie", caption: "Vous avez trop de chance les ptits 2009 🫶🏻 #studytips #studytok #bac #astraai #4402 " },
      { handle: "joanaritastudy", caption: "Esta dica devia ser conhecida por todos os estudantes… 🤫📚 Guarda para o próximo exame! #AstraAI #StudyTok #DicasDeEstudo #4502" },
      { handle: "matildediaries", caption: "só espero que este vídeo não chegue a ela!! ❌❌ #estudos #dicas #astraai #4303 " },
      { handle: "studywithyaniree", caption: "el mejor método de estudio para 🥚🥚🥚🥚s #greenscreenvideo #studytips #studytok #astraai #4525" },
      { handle: "learnwithmariaa_", caption: "#publiiii CHICOS ya me contais que nota sacáis ‼️‼️‼️‼️ Seguro que un 14 ❤️ #4402 #astraai #studytok #estudiantes " },
      { handle: "learnwnevia", caption: "Trinkt ihr gerne Kaffee?☕️ #schule #astraai #studytok #lerntipps #studytips Anzeige" },
      { handle: "studywithsophiatalea", caption: "Was ist eure Meinung? 👀 #lerntipps #studytok #astraai #lernen #schulfächer Anzeige " },
      { handle: "ssai741", caption: "il primo posto è imbattibile 👏📚 #studytok #school #perte #astraai #math " },
      { handle: "studymetem", caption: "zooo chill #astraai #studytips #leren #6001 " },
      { handle: "learnwithanne6", caption: "Evaluarea națională din 2027 va fi cea mai ușoară  de până acum ‼️ #examen#en#astraai#ad#4402" },
      { handle: "rociotips_", caption: "cualquier duda en comentarios!! @Astra AI ES #app #estudio #tutorial #studytok #studytips" },
      { handle: "studytipslaia", caption: "Respuesta a @Agus 🌻🇦🇷 Explicación del funcionamiento de @Astra AI ES. Espero que os haya quedado más o menos claro y cualquier duda ecribidme!! #estudio #ia #examen #universidad #studytok" },
    ];
    const retainVraies = [
      { handle: "learnwithlanto", caption: "Comment je fais mes fiches en 5mn 🕦📚 #fichesderevisions #flashcards #rentree #retaincards #brevet publicité " },
      { handle: "arno.revisions", caption: "Le secret bien gardé des profs… #retaincards #revisions #etudes #tuto #reussite  Publicité" },
      { handle: "julie.tipsetudes", caption: "Qui sera la prochaine ? #retaincards #revisions #studytok #studytips publicité" },
      { handle: "etudie.avec.marin", caption: "T’es obligé d’être malin si tu veux garder du temps pour chiller sur Netflix ! #retaincards #rentreescolaire #lycee #bac #fac publicité " },
      { handle: "etudie.avec.ema", caption: "essayer cette application pour reviser #studytips #retaincards #etudesuperieures #studyhacks  #creatorsearchinsights " },
      { handle: "study.withcharlie", caption: "Arrête de perdre ton temps bêtement à scroller sur TikTok #astucederevision #astuce #etudiant #retain #retaincards  Publicité " },
      { handle: "linda.studytips", caption: "Sergeant Blake is working overtime on Retain Cards #retaincards #studying #college #studyapp #studywithme " },
      { handle: "amandasstudier0", caption: "Ladda ner appen Retain Cards!!! Du får inte missa detta! Samarbete med Retain  " },
    ];
    // Les comptes de la marque citent l'app par leur pseudo, quelle que soit la légende.
    const marque = { astraai: ["astra_ai_official", "astra_ai_es", "astra_ai_si"], retaincards: ["retain.cards", "retain.cards.offi", "retain.cards8"] };
    for (const h of [...marque.astraai, ...astraVraies.map((v) => v.handle)]) expect(SEED_ACCOUNTS.astraai).toContain(h);
    for (const h of [...marque.retaincards, ...retainVraies.map((v) => v.handle)]) expect(SEED_ACCOUNTS.retaincards).toContain(h);
    for (const v of astraVraies) expect(videoApp(v, SEED_APPS)?.name).toBe("Astra AI");
    for (const v of retainVraies) expect(videoApp(v, SEED_APPS)?.name).toBe("Retain Cards");
    for (const h of marque.astraai) expect(videoCitesApp({ handle: h, caption: "We all been there before 😭" }, astra)).toBe(true);
    for (const h of marque.retaincards) expect(videoCitesApp({ handle: h, caption: "Major life hack #finals" }, retain)).toBe(true);
    // Aucune vidéo de l'une n'est rangée sous l'autre.
    for (const v of astraVraies) expect(videoCitesApp(v, retain)).toBe(false);
    for (const v of retainVraies) expect(videoCitesApp(v, astra)).toBe(false);
  });

  it("pages de hashtag déroulées en entier : toutes les langues, sans recruteurs ni homonymes", () => {
    // 209 et 86 au premier relevé ; la recherche approfondie en a retiré 3 et 2, puis ajouté 59 et 16.
    expect(SEED_ACCOUNTS.astraai).toHaveLength(265);
    expect(SEED_ACCOUNTS.retaincards).toHaveLength(100);
    // Astra AI hors des langues du premier relevé : le mot d'étude est dans la légende, ou le pseudo est « learnwith… ».
    const astraAilleurs = [
      { handle: "belajarbarengbening", caption: "Gen Z kalau belajar sat set #astraai #tipskuliah #mahasiswa " },
      { handle: "learnwithdorcsy", caption: "Hihetetlen😨Mentsd el ezt a videót késöbbre…#AstraAI #tanulás #learnwithme #reklám #4402 " },
      { handle: "learnwithtamara", caption: "Koliko dobro#ucenje #fyp #4401 #loveisland #astraai " },
      { handle: "learnwithemilia0", caption: "#zodiacsigns #zodiactiktok #ad #astraai #zodiii " },
      { handle: "anniopiskelee", caption: "(mainos Astra Ai) Miten Astra toimii ja onks se oikeesti hyvä sovellus☝🏼 #opiskelu #opiskeluvinkit #astraai #koulu #suomitiktok " },
      { handle: "nadegellg", caption: "Antwort auf @Josie_1504 So könnt ihr mündlich geprüft werden 🤩| Tutorial💓 AI#astraai #mündlicheprüfung #prüfung #tipps " },
      { handle: "kristudyy", caption: "Пишу шпору на А4 за 5 годин до іспиту✍️ А в кінці станеться треш🤦🏼‍♀️ #навчання #studywithme #школа #astraai #університет " },
      { handle: "rebeccarevise", caption: "Je supprime cette vidéo dans 24h 🤫 L'astuce qu'on m'a donnée pour réviser : j'importe mes fiches dans Astra AI, il me fait un planning de révision puis un examen blanc. " },
      { handle: "siiri_astraai", caption: "astra-ai.de rettet euer Abi, ich meins ernst ! #mathematics#oberstufe#goviral#foryoupage#astraai" },
      // La légende ne la nomme pas : c'est écrit à l'écran.
      { handle: "estudiaconambardelol", caption: "Comenta para que te vaya bien en todos tus exámenes #bachillerato #universidad #tips #instituto", hook: "Astra Ai · La app se llama:" },
      { handle: "studywithsumeyyee", caption: "kesinlikle denenmesi gereken bi uygulama🤌🏻🫶🏻 #ders #studytok #yks #kpss #1501 reklam", hook: "ASTRA AI HAKKINDA  GERÇEKÇİ YORUMUM" },
    ];
    for (const v of astraAilleurs) {
      // @nadegellg cite bien l'app, mais sur une seule vidéo d'un compte « lifestyle » : retirée le 10/11/2026.
      if (v.handle === "nadegellg") expect(SEED_REMOVED).toContain(v.handle);
      else expect(SEED_ACCOUNTS.astraai).toContain(v.handle);
      expect(videoApp(v, SEED_APPS)?.name).toBe("Astra AI");
    }
    expect(citesApp("astra-ai.de rettet euer Abi", "x", astra)).toBe(true);
    // « learn what… » n'est pas le pseudo « learnwith… ».
    expect(citesApp("learn what your soulmate looks like with Astra AI #astraai #soulmate", "luna.reads", astra)).toBe(false);
    // Relevés sous #astraai et laissés dehors : un homonyme, un autre compte d'IA, le recrutement.
    expect(videoCitesApp({ handle: "illuma.amulli", caption: "What a crazy timeline 😭😂 Anybody else find this kinda reassuring?! 😅 #AIsentience #OpenAI #chatGPT #AstraAI #whatatimetobealive " }, astra)).toBe(false);
    expect(videoCitesApp({ handle: "astraa_ai", caption: "PART 3 #aitiktok #aitrend #foryou #foryoupage" }, astra)).toBe(false);
    for (const h of ["illuma.amulli", "astraa_ai", "lisa_aicreatorclub"]) expect(SEED_ACCOUNTS.astraai).not.toContain(h);
    // Écarté à tort au premier relevé (« #album #mundial2026 ») : sa bio dit « Cuenta dedicada al estudio ».
    expect(SEED_ACCOUNTS.astraai).toContain("jcstudio50");

    const retainAilleurs = [
      { handle: "studyingwithlaura", caption: "Die App heißt übrigens RetainCards - mega zum Lernen!😳 #retaincards #studytips #studentproblems" },
      { handle: "study.mit.sophia", caption: "Soo viel leichter mit Retain.cards zu lernen 📖 #retaincards #viral #trend #prüfungsvorbereitung " },
      // La légende ne la nomme pas : c'est écrit à l'écran.
      { handle: "klausurphase.laura", caption: "🤫 #lerntipps #studytok Anzeige", hook: "Wenn du das hier siehst, ist das ein Zeichen, dass du deine Prüfungen bestehst · Mein Geheimtipp: Retain Cards" },
      { handle: "etudie.avec.manal", caption: "J’ai une mémoire visuelle donc ca m’aide bien ! #studytok #studytips #examen #revisions #universite ", hook: "J'ai trouvé un logiciel qui me fait des cartes mentales · Tape Retaincards sur Google" },
      { handle: "studywith.kat", caption: "#schule #studytips #lerntipps #lernen #studytok ", hook: "angefangen hast, nach der Retain-Cards-Methode zu lernen" },
    ];
    for (const v of retainAilleurs) {
      expect(SEED_ACCOUNTS.retaincards).toContain(v.handle);
      expect(videoApp(v, SEED_APPS)?.name).toBe("Retain Cards");
    }
    // Sous #retaincards sans que la légende ni l'écran la nomment, ou avec « #retain » seul : pas pris.
    expect(citesApp("(Anzeige) Finde das so krass! #retain #karteikarten #studytok ", "laraemilyofficial", retain)).toBe(false);
    for (const h of ["study_byerinn", "study.with.amino", "laraemilyofficial"]) expect(SEED_ACCOUNTS.retaincards).not.toContain(h);
    // Le recrutement de créateurs et les comptes généralistes (160 000 abonnés, beauté) ne sont pas des comptes de format.
    for (const h of ["retaincards.criadores", "marine.talentscoutretain", "dunja.nfs"]) expect(SEED_ACCOUNTS.retaincards).not.toContain(h);
    // Écartés à tort au premier relevé : leur bio nomme Retain Cards (« Révisions avec Retain Cards », « Lerntipps »).
    for (const h of ["minimum20.study", "ugc.marou"]) expect(SEED_ACCOUNTS.retaincards).toContain(h);
    // Personne dans les deux réseaux.
    expect(SEED_ACCOUNTS.astraai.filter((h) => SEED_ACCOUNTS.retaincards.includes(h))).toEqual([]);
  });

  it("Astra AI : nommée en clair avec un mot d'étude, ou par son site ; jamais ses homonymes", () => {
    expect(citesApp("Luckily Astra AI has my back ❤️ #gcse #studytok #alevels", "x", astra)).toBe(true);
    expect(citesApp("You should check out Astra AI if you’re having math problems 🤝", "x", astra)).toBe(true);
    expect(citesApp("👇Start for free astra-ai.co", "x", astra)).toBe(true);
    // Le texte à l'écran ou ce qui est dit suffit, la légende n'a pas à la nommer.
    expect(videoCitesApp({ handle: "ele.vs.uni", caption: "mandalo a quell’amico che cerca sempre gli appunti 🎀 #studytok #università", hook: "gli appunti di tutti i corsi · Astra AI" }, astra)).toBe(true);
    // Les autres « Astra AI » : portrait d'âme sœur, avatars vidéo, assistant. Aucun mot d'étude.
    expect(citesApp("Astra AI drew my soulmate and I'm shook 😳 #soulmate #astraai #fyp", "luna.reads", astra)).toBe(false);
    expect(citesApp("the universe sent me this #astraai #astrology #tutorial", "x", astra)).toBe(false);
    expect(citesApp("Opel Astra air suspension install #opel #astra", "garage.tom", astra)).toBe(false);
    // Un compte d'étude qui ne la nomme pas n'est pas rangé sous elle.
    expect(videoCitesApp({ handle: "study_byerinn", caption: "Tu me diras t’as eu combien à ton prochain contrôle 🙂‍↔️ #revision #flashcards #etudes #focus #college" }, astra)).toBe(false);
  });

  it("Retain Cards : le nom au pluriel, le site ou le pseudo ; au singulier il faut un mot d'étude", () => {
    expect(citesApp("Mit Retain Cards lädst du deinen Stoff hoch und bekommst Karteikarten", "ugc.marou", retain)).toBe(true);
    expect(citesApp("Suche 👉🏻 \"Retain Cards\" 👈🏻 im App Store", "x", retain)).toBe(true);
    expect(citesApp("www.retain.cards", "x", retain)).toBe(true);
    expect(citesApp("Retain card : comment utiliser les flashcards pour réviser", "x", retain)).toBe(true);
    expect(citesApp("how to retain cardio fitness after 40 #gym #running", "coach.max", retain)).toBe(false);
    // « retain » seul est un mot anglais courant, et une légende qui ne nomme pas l'app ne compte pas.
    expect(citesApp("How to retain everything you study #studytok #flashcards", "x", retain)).toBe(false);
    expect(videoCitesApp({ handle: "etudie.avec.manal", caption: "J’ai une mémoire visuelle donc ca m’aide bien ! #studytok #studytips #examen #revisions #universite " }, retain)).toBe(false);
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

/** Recherche approfondie du 10/11/2026 : 85 pages de hashtag, 2 331 comptes vus, une page vidéo lue par compte. */
describe("comptes de départ après la recherche approfondie", () => {
  const tous = Object.values(SEED_ACCOUNTS).flat();
  const liste = (slug: string) => SEED_ACCOUNTS[slug] ?? [];

  it("1 142 comptes sur 38 apps, chacun une seule fois", () => {
    expect(Object.keys(SEED_ACCOUNTS)).toHaveLength(38);
    expect(tous).toHaveLength(1142);
    expect(new Set(tous).size).toBe(1142);
    expect(liste("fluencify")).toHaveLength(125);
    expect(liste("stalkie")).toHaveLength(63);
    expect(liste("theick")).toHaveLength(38);
    // Des apps sans liste jusque-là.
    expect(liste("wingaiapp")).toHaveLength(13);
    expect(liste("plugai")).toHaveLength(23);
  });

  it("entrent : pseudo ou bio au nom de l'app, ou plusieurs vidéos d'un compte de la niche", () => {
    // Bio « Ambasciatore Stalkie », pseudo « ali.airbuds », bio « Ambassadeur THEICKAPP ».
    expect(liste("stalkie")).toContain("sofiat7f1sp");
    expect(liste("airbuds")).toContain("ali.airbuds");
    expect(liste("theick")).toContain("johansecretaccount");
    // Bio « Daily New stories @Plug AI » : rangé sous Plug AI, pas sous l'app d'une légende de passage.
    expect(liste("plugai")).toContain("momyrizzler");
    expect(liste("calai")).not.toContain("momyrizzler");
    // 303 000 abonnés, mais c'est un compte d'histoires de textos : la niche des apps de réponses.
    expect(liste("wingaiapp")).toContain("historias.texteadas");
  });

  it("n'entrent pas : gros comptes généralistes, recrutement, marque", () => {
    // Deux ou quatre vidéos sponsorisées sur des comptes de 136 000 à 23,8 millions d'abonnés.
    for (const h of ["andreecuadros", "alim_kh0", "jeremydruaux", "55dakid"]) expect(tous).not.toContain(h);
    // « FashionNova ambassador » n'est pas l'ambassadrice d'une app suivie.
    expect(tous).not.toContain("4kmarieee");
    for (const h of ["lauraretaintalentscout", "marine.talentscoutretain", "franzi.retain", "lisa_aicreatorclub", "retaincards.criadores"]) expect(tous).not.toContain(h);
    expect(tous.filter((h) => /talent|scout|recrut|recruit|criadores|creatorclub|casting|hiring/.test(h.replace(/[._]/g, "")))).toEqual([]);
    // Les comptes de marque trouvés ce jour-là ne sont pas ajoutés (ceux d'avant restent).
    for (const h of ["vocaai_official", "biblechatofficial", "trycalai", "knowunity.de", "praktika.app", "sweatcoin"]) expect(tous).not.toContain(h);
  });

  it("un compte retiré de la liste est mis en pause, seulement s'il y était entré par elle", () => {
    expect([...SEED_REMOVED]).toEqual(["nadegellg", "luca.lss", "chiara23091", "lauraretain", "mar.retainmx"]);
    expect(tous.filter((h) => SEED_REMOVED.includes(h))).toEqual([]);
    expect(seedRemoval({ matchedBy: "seed", status: "active" })).toBe(true);
    // Déjà en pause : rien à réécrire, la synchro passe toutes les heures.
    expect(seedRemoval({ matchedBy: "seed", status: "paused" })).toBe(false);
    // Ajouté à la main, ou retrouvé par une légende : il est là pour une autre raison.
    expect(seedRemoval({ matchedBy: "manual", status: "active" })).toBe(false);
    expect(seedRemoval({ matchedBy: "caption", status: "active" })).toBe(false);
    expect(seedRemoval(null)).toBe(false);
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
  it("une mention après un emoji : TikTok compte en caractères, pas en unités UTF-16 (« @Voca A », 09/11/2026)", () => {
    // La légende réelle de @daiana.vocaai : « @ » est le 9e caractère, la 10e unité UTF-16.
    const unEmoji = { ...VOCA_2, desc: "Nossa 🫪 @Voca AI #aprenderingles #vocaai", text_extra: [{ start: 8, end: 16, type: 0, user_id: "7504863753483240490" }] };
    expect(parseScVideo(unEmoji)!.mentions).toEqual([{ id: "7504863753483240490", label: "@Voca AI" }]);
    // Lue en UTF-16, c'était « @Voca A » : le nom proposé comme une app nouvelle.
    expect(unEmoji.desc.slice(8, 16).trim()).toBe("@Voca A");
    // Deux emojis avant : la mention était perdue (la coupe commençait au milieu d'un emoji).
    const deux = { ...VOCA_2, desc: "DIOS MÍO 😱😱 @What Brandon Thinks #whatsapp", text_extra: [{ start: 12, end: 32, type: 0, user_id: "7647235265945928726" }] };
    expect(parseScVideo(deux)!.mentions).toEqual([{ id: "7647235265945928726", label: "@What Brandon Thinks" }]);
    // Collée à l'emoji, sans espace (@WRizz).
    expect(mentionLabel("POV: you only get one shot 🎯@WRizz #rizz", 28, 34)).toBe("@WRizz");
    // Des positions en UTF-16 restent lues ; ce qui n'est pas une mention ne l'est pas.
    expect(mentionLabel("Nossa 🫪 @Voca AI", 9, 17)).toBe("@Voca AI");
    expect(mentionLabel("Nossa 🫪 Voca AI", 0, 5)).toBeNull();
    expect(mentionLabel("", 3, 9)).toBeNull();
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

  it("le nom et le motif d'une app repérée s'arrêtent au slogan du pseudo (« Serializd | TV tracking app », 09/11/2026)", () => {
    expect(candidateName("@Serializd | TV tracking app")).toBe("Serializd");
    expect(candidateName("@Leaked DMs || Detective game")).toBe("Leaked DMs");
    expect(candidateName("@Finch: Self Care Pet")).toBe("Finch");
    expect(candidateName("@Fit AI")).toBe("Fit AI");
    expect(candidateName("@wingai_app")).toBe("wingai_app");
    expect(candidateName("@L’Oréal Paris")).toBe("L’Oréal Paris");
    // Un tiret dans un nom n'est pas un slogan ; un nom trop court reste entier.
    expect(candidateName("@Coca-Cola")).toBe("Coca-Cola");
    expect(candidateName("@AI | app")).toBe("AI | app");
    // Le motif d'avant, « serializd|tvtrackingapp », n'était écrit par personne.
    expect(patternsOfCandidate({ kind: "mention", label: "@Serializd | TV tracking app" })).toEqual(["serializd"]);
    expect(patternsOfCandidate({ kind: "mention", label: "@Leaked DMs || Detective game" })).toEqual(["leakeddms"]);
    // Le nom proposé à l'écran : le pseudo sans slogan, ou le domaine sans extension.
    expect(suggestedAppName({ kind: "mention", label: "@Serializd | TV tracking app" })).toBe("Serializd");
    expect(suggestedAppName({ kind: "domain", label: "stalkie.io" })).toBe("Stalkie");
  });

  it("un motif contenu dans celui d'une app suivie est un doublon ; l'inverse est une autre app", () => {
    expect(shadowingApp("vocaa", SEED_APPS)?.name).toBe("Voca AI");
    expect(shadowingApp("whatbrandonthink", SEED_APPS)?.name).toBe("What Brandon Thinks");
    // Le même motif, avec ou sans arobase.
    expect(shadowingApp("plugai", SEED_APPS)?.name).toBe("Plug AI");
    expect(shadowingApp("#followspy", SEED_APPS)?.name).toBe("FollowSpy");
    // Un motif plus long que celui d'une app suivie n'est pas pris : WRizz contre Rizz App.
    expect(shadowingApp("wrizzapp", [app("rizzapp")])).toBeUndefined();
    expect(shadowingApp("letterboxd", SEED_APPS)).toBeUndefined();
    expect(shadowingApp("fitai", SEED_APPS)).toBeUndefined();
  });

  it("les doublons et les noms à slogan du 09/11/2026 sont repris par la liste de départ", () => {
    expect(app("vocaai").formerSlugs).toEqual(["vocaa"]);
    expect(app("whatbrandonthinks").formerSlugs).toEqual(["whatbrandonthink"]);
    expect(app("serializd")).toMatchObject({ name: "Serializd", rivalOf: [], strong: ["serializd"], formerSlugs: ["serializdtvtrackingapp"] });
    expect(app("leakeddms")).toMatchObject({ name: "Leaked DMs", rivalOf: [], strong: ["leakeddms"], formerSlugs: ["leakeddmsdetectivegame"] });
    // Un ancien slug n'est celui d'aucune app de la liste, et n'est repris qu'une fois.
    const former = SEED_APPS.flatMap((a) => a.formerSlugs ?? []);
    expect(new Set(former).size).toBe(former.length);
    expect(former.filter((f) => SEED_APPS.some((a) => a.slug === f))).toEqual([]);
    // Serializd et Leaked DMs, telles que les comptes les citent.
    expect(citesApp("My latest obsession!!! It’s like Letterboxd but for TV shows! @Serializd | TV tracking app", "christinetannn", app("serializd"))).toBe(true);
    expect(citesApp("#currentrotation #letterboxd #serializd #filmtok", "sonderspacee", app("serializd"))).toBe(true);
    expect(citesApp("Definitivamente Leaked é o melhor jogo de investigação 😍 @Leaked DMs || Detective game", "sara.detective", app("leakeddms"))).toBe(true);
    // « Leaked » seul, chez un compte de Stalkie : il reste à Stalkie.
    const lu = { caption: "se llama Leaked! #StalkieSecretSpy #app #juegos #detective #chismecito", handle: "lustalkerrr" };
    expect(videoCitesApp(lu, app("leakeddms"))).toBe(false);
    expect(videoCitesApp(lu, app("stalkie"))).toBe(true);
    // Le compte entré chez « Voca A » sur #vocaa (un lycée mexicain) ne cite pas Voca AI.
    expect(citesApp("Me proyecto #voca5 #vocaa #voca #cecyt5 #cecyt", "ovn1ch_6767", app("vocaai"))).toBe(false);
    expect(citesApp("Desisto de aprender inglês depois dessa 😂 @Voca AI #inglesparatodos", "daiana.vocaai", app("vocaai"))).toBe(true);
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

describe("classer une app à la main (10/11/2026)", () => {
  it("la décision d'une équipe l'emporte sur la liste de départ, pour son projet seulement", () => {
    // WRizz avant le 10/11 : concurrente de personne dans la liste ; BLUSH la classe concurrente.
    expect(effectiveRivalOf([], [{ project: "blush", rival: true }])).toEqual(["blush"]);
    // Snitchy : la liste la disait concurrente de Snytch ; Snytch la retire, BLUSH n'a rien décidé.
    expect(effectiveRivalOf(["snytch"], [{ project: "snytch", rival: false }])).toEqual([]);
    // Une app concurrente de Snytch que BLUSH classe aussi : les deux, la liste d'abord.
    expect(effectiveRivalOf(["snytch"], [{ project: "blush", rival: true }])).toEqual(["snytch", "blush"]);
    // Une décision qui dit comme la liste ne change rien, et ne double rien.
    expect(effectiveRivalOf(["blush"], [{ project: "blush", rival: true }])).toEqual(["blush"]);
    expect(effectiveRivalOf([], [{ project: "blush", rival: false }])).toEqual([]);
    expect(effectiveRivalOf(["snytch", "blush"], [])).toEqual(["snytch", "blush"]);
    // Rejouée sur son propre résultat (la mutation part de `rivalOf`, la synchronisation de la liste) : même chose.
    const choix = [{ project: "blush", rival: true }, { project: "snytch", rival: false }];
    expect(effectiveRivalOf(effectiveRivalOf(["snytch"], choix), choix)).toEqual(effectiveRivalOf(["snytch"], choix));
    expect(effectiveRivalOf(["snytch"], choix)).toEqual(["blush"]);
  });

  it("la dernière décision d'un projet remplace la précédente ; celles des autres restent", () => {
    const un = withRivalChoice([], { project: "blush", rival: true });
    expect(un).toEqual([{ project: "blush", rival: true }]);
    const deux = withRivalChoice(un, { project: "snytch", rival: false });
    const trois = withRivalChoice(deux, { project: "blush", rival: false });
    expect(trois).toEqual([{ project: "snytch", rival: false }, { project: "blush", rival: false }]);
    expect(effectiveRivalOf(["snytch", "blush"], trois)).toEqual([]);
    // Elle ne modifie pas la liste qu'on lui donne.
    expect(un).toEqual([{ project: "blush", rival: true }]);
  });
});
