import { describe, expect, it } from "vitest";
import { TEXT_LANG_MIN, TEXT_LANG_MIN_KINDS, TEXT_LANG_RATIO, langScores, screenLang, textLang, textWords } from "../convex/radarTextLang";

/**
 * Radar — la langue lue sur le texte à l'écran (12/11/2026). Les textes ci-dessous sont ceux relevés en prod ce
 * jour-là sur les vidéos de comptes suivis (le texte incrusté, tel que TikTok le rend). Mesure d'ensemble, sur
 * les 994 comptes actifs dont TikTok donne la langue : la règle tranche pour 394, d'accord avec TikTok pour 388.
 */
describe("Radar — la langue du texte à l'écran", () => {
  it("le français de comptes aux légendes faites de hashtags, que TikTok laissait sans langue", () => {
    // @kayllis8 (Knowunity).
    expect(textLang(["Mes notes l’année dernière vs cette année", "« Beaucoup d’élèves se trompent là-dessus » · Les phrases de prof qui veulent dire « ça tombe au contrôle » · Phrase n°3 · « Retenez bien ça » · Phrase n°1", "comment voir le contrôle de ton prof avant l'exam", "Comment avoir une bonne note peu importe quand tu commences à réviser"])).toBe("fr");
    // @langlaisavecbouch (Praktika) : elle apprend l'anglais, son texte est en français.
    expect(textLang(["Aujourd'hui, j'ai décidé de faire taire mon lA en chinois🇨🇳 😂💀", "La phrase anglaise la plus utile de tous les temps🔥😂", "Mon lA va finir par me bloquer😭😂", "Pourquoi l'anglais est-il aussi difficile?🇺🇸😭💔"])).toBe("fr");
    // @english_with_asma3 (Praktika).
    expect(textLang(["Mon IA regrette de m’apprendre l’anglais et l’espagnol 😂💀", "Je joue à pierre-feuille-ciseaux avec mon IA 😂😭", "J’ai appris un nouveau mot en anglais 😭🇫🇷", "Wtf pourquoi l’anglais est difficile 😭🇫🇷"])).toBe("fr");
  });

  it("une seule phrase suffit quand elle a assez de mots-outils différents", () => {
    // @asma.stalke (Snitchy) : « cette », « et », « pour », « qui », « l' ».
    const texte = "POV: Cette fille a disparu et tu dois fouiller son tel pour découvrir qui l'a enlevée";
    expect(langScores([texte])).toMatchObject({ fr: 5, en: 0, es: 0, pt: 0, kinds: { fr: 5 } });
    expect(TEXT_LANG_MIN).toBe(5);
    expect(textLang([texte])).toBe("fr");
    // Un mot-outil de moins : trop peu pour trancher.
    expect(textLang(["POV: Cette fille a disparu et tu dois fouiller son tel pour découvrir qui la retient"])).toBeUndefined();
  });

  it("l'anglais, l'espagnol, le portugais", () => {
    // @lovenotes.yara (Loverzz).
    expect(textLang(["pov: you have a ldr and your bf needs words of affirmation 🥹❤️", "when your bf likes to surprise you with a date night 🥹❤️", "the sweet way me and my ldr bf talk to each other 😂❤️"])).toBe("en");
    // @iara.con.fe (Creed).
    expect(textLang(["Porque Dios confundió los idiomas de todos en la torre de Babel?", "Es pecado hacerle una promesa a Dios cuando estás desesperado y cuando estás bien no cumplirla?", "Porque el pecado contra el Espíritu Santo no será perdonado?"])).toBe("es");
    // @hada.prayer (Creed).
    expect(textLang(["Imagine que você está em um avião... e de repente o piloto anuncia que ele vai cair. O avião inteiro entra em pânico.", "Eu não me importo com isso. Eu enfrentaria o frio congelante só para assistir aos seus jogos. Cuidaria de você quando estivesse doente"])).toBe("pt");
  });

  // Une autre langue n'est pas prise pour l'une des nôtres : elle n'a que quelques-uns de nos mots-outils, un seul
  // répété, ou autant de l'une que de l'autre de nos langues.
  it.each([
    // @bongyeu.love8 : « em » (« dans », en portugais) y revient neuf fois, et lui seul.
    ["du vietnamien", ['Nyc đã từng biến tôi thành 1 cô gái "tự lập" Em tự lái xe Em tự mua Em đi ăn 1 mình được Em sẽ tự về Em có tiền rồi Em sẽ tự mình làm ... · "Để anh dẫn em đi ăn Để anh làm cho em Anh đặt đồ cho em nhé']],
    // @glauben.mitalin : « du » se lit comme du français.
    ["de l'allemand", ["Du musst nicht jeden Tag stark sein 🤍", "Der Teufel möchte das du weiterscrollst", "Das ist meine kleine Erinnerung am Abend 🌙", "Was, wenn du gerade keine Antwort bekommst? ✝️🕊️"]],
    // @maria_flo_app_ : « das » se lit comme du portugais.
    ["de l'allemand encore", ["Mädels haben wir diesen Monat irgendwie alle eine Chaosperiode oder bin das nur ich!?", "Das Leben wurde so ernst, dass ich meine Periode verloren habe", "Heb deine Hand, wenn du auch noch auf deine November Periode wartest"]],
    // @sofiat7f1sp : « una » se lit comme de l'espagnol.
    ["de l'italien", ["la mia ragazza sta giocando ad un gioco in cui deve aiutare una ragazza che è stata tradita", "quando il gioco è fatto così bene che impari a stalkerare livello detective", "La mia ragazza sta giocando un gioco dove deve aiutare una ragazza che è stata tradita"]],
    // @angielski.z.iza : « i », « to » se lisent comme de l'anglais.
    ["du polonais", ["kiedy rodzice dają ci coś do przetłumaczenia z angielskiego i nie wiesz jak to jest po polsku", "kiedy mam wyższe oceny z angielskiego niż z polskiego", "POV: kiedy wreszcie nauczyłam się angielskiego i ktoś się mnie zapyta, czy chce z nim gdzieś pojechać za granicę"]],
  ])("%s n'est pas pris pour l'une de nos langues", (_nom, textes) => {
    const scores = langScores(textes);
    // Il a bien quelques-uns de nos mots-outils : ce sont les seuils et l'écart exigé qui l'écartent.
    expect(scores.fr + scores.en + scores.es + scores.pt).toBeGreaterThan(0);
    expect(textLang(textes)).toBeUndefined();
  });

  it("un seul mot répété ne dit rien, même vingt fois", () => {
    expect(TEXT_LANG_MIN_KINDS).toBe(3);
    // @estudiaconmaja : des intitulés en polonais, où « i » (« et ») se lit comme le « I » anglais.
    const polonais = "statystyka stosowana i wizualizacja danych · finanse osobiste i behawioralne · statystyka stosowana i wizualizacja danych · finanse osobiste i behawioralne · psychologia i inteligencja";
    expect(langScores([polonais])).toMatchObject({ en: 5, kinds: { en: 1 } });
    expect(textLang([polonais])).toBeUndefined();
    // @dienita.fy : un texte en portugais, « for you » trois fois.
    expect(textLang(["renda extra · renda extra · garotas apoiam garotas · garotas apoiam garotas · for you · for you · for you"])).toBeUndefined();
    // « is », neuf fois.
    expect(textLang(Array.from({ length: 3 }, () => "Distance is temporary. Distance is temporary. Distance is temporary."))).toBeUndefined();
  });

  it("deux langues à parts proches : pas de langue", () => {
    expect(TEXT_LANG_RATIO).toBe(3);
    const fr = "Je joue avec mon IA et elle est trop forte pour moi";
    const en = "this is what my girlfriend sends me when she goes to college";
    expect(textLang([fr, en])).toBeUndefined();
    // Trois fois plus de l'une que de l'autre : elle l'emporte.
    expect(textLang([fr, fr, fr, fr, en])).toBe("fr");
  });

  it("sans texte, ou sans mot-outil : pas de langue", () => {
    expect(textLang([])).toBeUndefined();
    expect(textLang([undefined, "", "🥇 🥈 🥉"])).toBeUndefined();
    expect(textLang(["#lycee #etude #prt #bac #knowunity"])).toBeUndefined();
  });

  it("les mots lus : minuscules, élisions gardées avec leur apostrophe, adresses retirées", () => {
    expect(textWords("J’ai appris qu'il y a l'IA")).toEqual(["j'", "ai", "appris", "qu'", "il", "y", "a", "l'", "ia"]);
    expect(textWords("I don't know, it's on www.retain.cards et apps.apple.com/app !")).toEqual(["i", "don'", "t", "know", "it'", "s", "on", "et"]);
    // Une lettre accentuée écrite en deux signes (décomposée) reste une lettre.
    expect(textWords("très bien")).toEqual(["très", "bien"]);
  });

  it("« AI » n'est pas « j'ai », « comment » n'est pas du français, « .com » n'est pas du portugais", () => {
    expect(langScores(["Astra AI AI AI · comment below · www.astra.com"])).toMatchObject({ fr: 0, pt: 0 });
  });
});

describe("Radar — la langue d'un compte lue à l'écran, dans les langues de l'onglet", () => {
  const es = ["Porque Dios confundió los idiomas de todos en la torre de Babel?", "Es pecado hacerle una promesa a Dios cuando estás desesperado y cuando estás bien no cumplirla?", "Porque el pecado contra el Espíritu Santo no será perdonado?"];
  const fr = ["Mon IA regrette de m’apprendre l’anglais et l’espagnol", "Je joue à pierre-feuille-ciseaux avec mon IA", "J’ai appris un nouveau mot en anglais"];

  it("l'espagnol se coupe en deux marchés : l'Espagne quand la plupart de ses vidéos y sont publiées, l'Amérique sinon", () => {
    expect(screenLang(es, ["ES", "ES", "MX"])).toBe("es-es");
    expect(screenLang(es, ["es", "ES"])).toBe("es-es");
    expect(screenLang(es, ["MX", "ES", "AR"])).toBe("es-am");
    // À égalité, ou sans pays connu : l'Amérique (comme pour une vidéo, radarSignalsMath.langBucket).
    expect(screenLang(es, ["ES", "MX"])).toBe("es-am");
    expect(screenLang(es, [undefined, undefined])).toBe("es-am");
    expect(screenLang(es, [])).toBe("es-am");
  });

  it("les autres langues ne dépendent pas du pays", () => {
    expect(screenLang(fr, ["ES", "ES"])).toBe("fr");
    expect(screenLang(fr, [])).toBe("fr");
  });

  it("un texte qui ne tranche pas ne donne pas de langue au compte", () => {
    expect(screenLang(["#lycee #bac"], ["FR"])).toBeUndefined();
    expect(screenLang([], ["FR"])).toBeUndefined();
  });
});
