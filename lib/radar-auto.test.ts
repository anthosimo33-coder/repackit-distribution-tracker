import { describe, expect, it } from "vitest";
import {
  AUTO_COMMON_NOTE,
  AUTO_SCHEMA,
  AUTO_SYSTEM,
  autoAnswer,
  autoPlan,
  autoPrompt,
  listFallback,
  listKey,
  listPatterns,
  listSearches,
  shortenedPattern,
  TRIAGE_OUT_NOTE,
  TRIAGE_SYSTEM,
  triageAnswer,
  triagePatterns,
  triagePrompt,
  triageSearches,
  TRIAL_KEEP_MIN,
  TRIAL_MAX_WAIT_MS,
  TRIAL_SETTLE_MS,
  trialDecision,
} from "../convex/radarAutoMath";
import { citesApp } from "../convex/radarNetworkMath";
import { AUTO_MIN_CREATORS, brandFamily, isShopGenre, storeAutoFollow, type CreatorWhy } from "../convex/radarStoreMath";

/**
 * Radar — suivi d'office des apps trouvées (13/11/2026). Les comptes d'essai sont ceux des 46 apps que les
 * classements proposaient ce jour-là, relues une à une avec la bio de chaque compte.
 */
const c = (handle: string, why: CreatorWhy = "half") => ({ handle, why });

describe("Radar — suivi d'office : les comptes de la famille de la marque", () => {
  it("un pseudo qui COMMENCE par le nom de l'app est un compte de la marque (par pays, par boutique)", () => {
    for (const [handle, slug] of [
      ["pluxee.ve", "pluxee"],
      ["pluxee_panama", "pluxee"],
      ["woodsense.vn", "woodsense"],
      ["lydia_campus", "lydia"],
      ["lorangebleuebeaucouze", "lorangebleue"],
      ["luviduo.ro", "luviduo"],
      ["memo.sleep.app", "memo"],
    ] as const) expect(brandFamily(handle, slug)).toBe(true);
  });

  it("un compte créateur met son prénom d'abord ; un nom de moins de 4 lettres ne prouve rien", () => {
    for (const [handle, slug] of [
      ["kelsey.verso", "verso"],
      ["elisa.amenapp", "amen"],
      ["melih.diane", "dianeai"],
      ["agathe.darija", "darijai"],
      ["the.still.app", "still"],
      ["calories.fastfood", "menugo"],
    ] as const) expect(brandFamily(handle, slug)).toBe(false);
    expect(brandFamily("bpm.rencontres", "bpm")).toBe(false);
  });
});

describe("Radar — suivi d'office : une app des classements", () => {
  it("trois comptes créateurs, ou deux dont l'un la nomme dans sa bio : suivie d'office", () => {
    expect(AUTO_MIN_CREATORS).toBe(3);
    // MenuGo : le compte de la marque ne compte pas, il en reste trois.
    expect(storeAutoFollow("menugo", [c("menugo.pt", "handle"), c("calories.fastfood", "bio"), c("macros.fastfood", "bio"), c("bastien.food", "bio")])).toBe(true);
    // Darij AI, Hush : quatre comptes qui la citent dans la moitié de leurs vidéos.
    expect(storeAutoFollow("darijai", [c("agathe.darija"), c("clara.darija"), c("quentin.darija"), c("norma.darija")])).toBe(true);
    // Bibly, Deengo, FocusTown : deux comptes, la bio de chacun la nomme.
    expect(storeAutoFollow("biblyapp", [c("lucille_255", "bio"), c("melina8984", "bio")])).toBe(true);
    // Amen : deux comptes de la famille de la marque écartés, deux bios restent.
    expect(storeAutoFollow("amenapp", [c("amen_zitate", "handle"), c("amen.app1", "handle"), c("espspio", "bio"), c("elisa.amenapp", "bio")])).toBe(true);
    expect(storeAutoFollow("parkeur", [c("leaprdi"), c("studywchimene", "bio")])).toBe(true);
  });

  it("les fausses apps du 13/11/2026 restent proposées", () => {
    // Deux comptes sous un mot courant ou un gros logiciel : #survie (95 261 vidéos), #adobepremiere, #opusclip.
    expect(storeAutoFollow("survie", [c("zwz997"), c("le_survivaliste.fr")])).toBe(false);
    expect(storeAutoFollow("adobepremiere", [c("ru1xcs"), c("el123m01s3s")])).toBe(false);
    expect(storeAutoFollow("opusclip", [c("_.clipster_"), c("54kcctt77")])).toBe(false);
    // Les comptes de la marque par pays, ou deux organisations qui portent le même nom.
    expect(storeAutoFollow("pluxeeapp", [c("pluxee.ve", "handle"), c("pluxee_panama", "handle")])).toBe(false);
    expect(storeAutoFollow("lydiaapp", [c("lydia_edu", "handle"), c("lydia_campus", "handle")])).toBe(false);
    expect(storeAutoFollow("woodsense", [c("moiezsandhu"), c("woodsenseint"), c("woodsense.vn", "handle"), c("woodsenseclay")])).toBe(false);
    expect(storeAutoFollow("lorangebleue", [c("lorange.bleue.ang", "handle"), c("lorangebleuebeaucouze")])).toBe(false);
    expect(storeAutoFollow("lebunker", [c("rioobayani", "bio"), c("lebunkerfood")])).toBe(false);
  });

  it("de vraies apps moins prouvées restent proposées aussi : deux comptes sans bio qui la nomme", () => {
    expect(storeAutoFollow("ghostedapp", [c("encorelisaa"), c("lilibrtt")])).toBe(false);
    expect(storeAutoFollow("clutchapp", [c("mewen.clutch", "handle"), c("damien.rodger")])).toBe(false);
    expect(storeAutoFollow("bpmapp", [c("laure_acc"), c("rxnmchch")])).toBe(false);
    expect(storeAutoFollow("biblyapp", [c("lucille_255", "bio")])).toBe(false);
    expect(storeAutoFollow("biblyapp", [])).toBe(false);
  });
});

describe("Radar — suivi d'office : ce qu'on fait d'une app repérée", () => {
  it("une app des classements assez prouvée : son hashtag PROUVÉ pour motif, tel quel", () => {
    expect(autoPlan({ kind: "store", label: "Bibly", store: { tag: "biblyapp", creators: [c("lucille_255", "bio"), c("melina8984", "bio")] } })).toEqual({ patterns: ["biblyapp"] });
    // Le 13/11/2026 « hushapp » entrait sous « hush », « hyperapp » sous « hyper » : 1 400 comptes sans rapport rattachés.
    const quatre = [c("squilliamfancyfan"), c("kensunfiltered"), c("nicolealiseda"), c("secretswithmady")];
    expect(autoPlan({ kind: "store", label: "Hush", store: { tag: "hushapp", creators: quatre } })).toEqual({ patterns: ["hushapp"] });
    expect(autoPlan({ kind: "store", label: "Darij AI", store: { tag: "darijai", creators: quatre } })).toEqual({ patterns: ["darijai"] });
    expect(shortenedPattern("hushapp")).toBe("hush");
    expect(shortenedPattern("guardianapp")).toBe("guardian");
    // Un hashtag qui n'a pas été raccourci n'a rien à réparer.
    expect(shortenedPattern("sideshift")).toBeNull();
    expect(shortenedPattern("myapp")).toBeNull();
    // Deux comptes créateurs : à l'essai depuis le 15/11/2026 (sa recherche décide). « survie » est un mot courant :
    // le garde « nom courant » (l'IA) la laisse proposée avant tout essai.
    expect(autoPlan({ kind: "store", label: "Survie", store: { tag: "survie", creators: [c("zwz997"), c("le_survivaliste.fr")] } })).toEqual({ patterns: ["survie"], trial: true });
  });

  it("à l'essai : deux comptes créateurs hors famille de la marque, sauf une boutique ; un seul, rien (15/11/2026)", () => {
    const deux = [c("lea.ghostedapp"), c("tom_ghostedapp")];
    expect(autoPlan({ kind: "store", label: "Ghosted", store: { tag: "ghostedapp", genre: "Lifestyle", creators: deux } })).toEqual({ patterns: ["ghostedapp"], trial: true });
    // Les comptes de la marque (pseudo qui COMMENCE par son nom) ne comptent pas.
    expect(autoPlan({ kind: "store", label: "Ghosted", store: { tag: "ghostedapp", creators: [c("ghostedapp.fr"), c("tom_ghostedapp")] } })).toEqual({ skip: "preuve insuffisante" });
    expect(autoPlan({ kind: "store", label: "Ghosted", store: { tag: "ghostedapp", creators: [c("tom_ghostedapp")] } })).toEqual({ skip: "preuve insuffisante" });
    // Une boutique (Hipobuy, The Bradery : hors périmètre) n'entre pas à l'essai ; assez prouvée, elle entre comme avant.
    for (const genre of ["Shopping", "Achats", "Compras", "Magasinage", "Zakupy", "Alışveriş", "Belanja"]) {
      expect(isShopGenre(genre)).toBe(true);
      expect(autoPlan({ kind: "store", label: "Lolobuy", store: { tag: "lolobuy", genre, creators: [c("ana.lolobuy"), c("bea.lolobuy")] } })).toEqual({ skip: "preuve insuffisante" });
    }
    const trois = [c("ana.lolobuy"), c("bea.lolobuy"), c("cleo.lolobuy")];
    expect(autoPlan({ kind: "store", label: "Lolobuy", store: { tag: "lolobuy", genre: "Shopping", creators: trois } })).toEqual({ patterns: ["lolobuy"] });
  });

  it("une app à l'essai est gardée à 3 comptes actifs ; sinon jugée une fois sa recherche faite et ses comptes contrôlés", () => {
    const now = 1_794_800_000_000;
    const essai = (searchedAgo?: number) => ({ trialSince: now - 10 * TRIAL_MAX_WAIT_MS, ...(searchedAgo === undefined ? {} : { networkSearchedAt: now - searchedAgo }) });
    expect(TRIAL_KEEP_MIN).toBe(AUTO_MIN_CREATORS);
    // Pas à l'essai : rien à décider.
    expect(trialDecision({}, { active: 0, vetting: 0 }, now)).toBeNull();
    // Trois comptes actifs : gardée, même avant sa recherche.
    expect(trialDecision(essai(), { active: 3, vetting: 0 }, now)).toBe("keep");
    // Pas encore cherchée : elle attend.
    expect(trialDecision(essai(), { active: 2, vetting: 0 }, now)).toBe("wait");
    // Cherchée il y a moins de 2 jours : ses nouveaux comptes passent leur premier relevé.
    expect(trialDecision(essai(TRIAL_SETTLE_MS - 1), { active: 2, vetting: 0 }, now)).toBe("wait");
    expect(trialDecision(essai(TRIAL_SETTLE_MS), { active: 2, vetting: 0 }, now)).toBe("pause");
    // Des comptes encore en contrôle : on les attend, 7 jours au plus.
    expect(trialDecision(essai(TRIAL_SETTLE_MS), { active: 2, vetting: 5 }, now)).toBe("wait");
    expect(trialDecision(essai(TRIAL_MAX_WAIT_MS), { active: 2, vetting: 5 }, now)).toBe("pause");
  });

  it("un produit d'une place de marché entre dès qu'on sait le nommer", () => {
    expect(autoPlan({ kind: "market", label: "Open Road", market: { handle: "openroadapp" } })).toEqual({ patterns: ["openroad", "openroadapp"] });
    expect(autoPlan({ kind: "market", label: "Abby AI", market: { handle: "" } })).toEqual({ patterns: ["abbyai"] });
    // Un nom de trois lettres sans pseudo : pas de motif sûr.
    expect(autoPlan({ kind: "market", label: "Elb", market: { handle: "" } })).toEqual({ skip: "nom trop court" });
  });

  it("une app que des comptes suivis poussent à la place de la leur (jugement de l'IA) : suivie dès 2 comptes (14/11)", () => {
    expect(autoPlan({ kind: "ia", label: "Mokascore", authorCount: 2 })).toEqual({ patterns: ["mokascore"] });
    expect(autoPlan({ kind: "ia", label: "Mokascore", authorCount: 1 })).toEqual({ skip: "un seul compte la désigne" });
    expect(autoPlan({ kind: "ia", label: "Moka", authorCount: 1 })).toEqual({ skip: "un seul compte la désigne" });
    expect(autoPlan({ kind: "ia", label: "Elb", authorCount: 3 })).toEqual({ skip: "nom trop court" });
  });

  it("un compte mentionné ou un site cité n'est suivi d'office qu'une fois trié par l'IA, et à l'essai (15/11/2026)", () => {
    expect(autoPlan({ kind: "mention", label: "@SHEIN" })).toEqual({ skip: "pas une source suivie d'office" });
    expect(autoPlan({ kind: "domain", label: "opsion.app" })).toEqual({ skip: "pas une source suivie d'office" });
    expect(autoPlan({ kind: "mention", label: "@Learna: Learn New Languages", triage: { kind: "app", name: "Learna" } })).toEqual({ patterns: ["@learna", "#learna", "learnaapp"], trial: true });
    expect(autoPlan({ kind: "domain", label: "faithmode.app", triage: { kind: "software", name: "faithmode" } })).toEqual({ patterns: ["faithmode.app"], trial: true });
    expect(autoPlan({ kind: "mention", label: "@Rohat", triage: { kind: "other", name: "" } })).toEqual({ skip: TRIAGE_OUT_NOTE });
    expect(autoPlan({ kind: "mention", label: "@Bop", triage: { kind: "app", name: "Bop" } })).toEqual({ skip: "nom trop court" });
  });
});

describe("Radar — le tri des mentions et des sites par l'IA (15/11/2026)", () => {
  it("l'IA reçoit le nom affiché ou le site, combien de comptes le citent, et ce qu'ils poussent d'autre", () => {
    const p = triagePrompt([
      { id: "a", kind: "mention", label: "@Learna: Learn New Languages", authors: 12, apps: ["Praktika", "Vocabulary"] },
      { id: "b", kind: "domain", label: "faithmode.app", authors: 6, apps: [] },
    ]);
    expect(p).toContain("mentioned account: @Learna: Learn New Languages");
    expect(p).toContain("cited by: 12 accounts (they also promote: Praktika, Vocabulary)");
    expect(p).toContain("website: faithmode.app");
    expect(TRIAGE_SYSTEM).toContain("When unsure, answer other");
  });

  it("une ligne par élément demandé ; nature inconnue ou produit sans nom : autre", () => {
    const batch = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const raw = {
      items: [
        { id: "a", kind: "app", name: "  Learna  " },
        { id: "a", kind: "other", name: "" },
        { id: "z", kind: "app", name: "Inventée" },
        { id: "b", kind: "app", name: "" },
        { id: "c", kind: "console", name: "Valorant" },
        { id: "d", kind: "game", name: "Bop" },
      ],
    };
    expect(triageAnswer(raw, batch)).toEqual([
      { id: "a", kind: "app", name: "Learna" },
      { id: "b", kind: "other", name: "" },
      { id: "c", kind: "other", name: "" },
      { id: "d", kind: "other", name: "" },
    ]);
    expect(triageAnswer("illisible", batch)).toEqual([]);
  });

  it("jamais le nom compacté seul : « learna » est dans « learn a new language »", () => {
    const learna = { strong: triagePatterns({ kind: "mention", label: "@Learna" }, "Learna") };
    expect(citesApp("learn a new language every day", "prof.anglais", learna)).toBe(false);
    expect(citesApp("I use @learna every morning", "x", learna)).toBe(true);
    expect(citesApp("day 12 #learna", "x", learna)).toBe(true);
    expect(citesApp("the Learna app is free", "x", learna)).toBe(true);
    // Un nom qui finit déjà par « app » ne prend pas « appapp ».
    expect(triagePatterns({ kind: "mention", label: "@DitchApp" }, "DitchApp")).toEqual(["@ditchapp", "#ditchapp"]);
    // Un site : son domaine entier ; trop court ou pas un domaine, rien.
    expect(triagePatterns({ kind: "domain", label: "tented.ai" }, "Tented")).toEqual(["tented.ai"]);
    expect(triagePatterns({ kind: "domain", label: "x.io" }, "X")).toEqual([]);
  });

  it("ce qu'on cherche : le nom, son hashtag, « nom app » ; le site tel quel", () => {
    expect(triageSearches({ kind: "mention", label: "@Learna" }, "Learna")).toEqual(["learna", "#learna", "learna app"]);
    expect(triageSearches({ kind: "mention", label: "@HealthMeter" }, "Health Meter")).toEqual(["health meter", "#healthmeter", "health meter app"]);
    expect(triageSearches({ kind: "domain", label: "faithmode.app" }, "faithmode")).toEqual(["faithmode.app", "#faithmode", "faithmode app"]);
  });
});

describe("Radar — suivi d'office : le garde « nom courant »", () => {
  const batch = [
    { id: "a", name: "Hush", what: "Style de vie app by Blyynd", patterns: ["hushapp"] },
    { id: "b", name: "EQUALS", what: "Musique app by Equals Collective", patterns: ["equals"] },
    { id: "c", name: "Open Road", what: "mobile app", patterns: ["openroad", "openroadapp"] },
    { id: "d", name: "Aisance", what: "", patterns: ["aisance"] },
  ];

  it("l'IA reçoit, pour chaque app qui entrerait, son nom, ce qu'elle est et le motif qu'on chercherait", () => {
    expect(autoPrompt(batch)).toBe(
      "id: a\nproduct: Hush (Style de vie app by Blyynd)\nterm: hushapp\n\nid: b\nproduct: EQUALS (Musique app by Equals Collective)\nterm: equals\n\nid: c\nproduct: Open Road (mobile app)\nterm: openroad, openroadapp\n\nid: d\nproduct: Aisance\nterm: aisance",
    );
    // Elle ne peut répondre que par oui ou non, et dans le doute c'est non.
    expect(AUTO_SCHEMA.properties.items.items.properties.distinctive.type).toBe("boolean");
    expect(AUTO_SYSTEM).toContain("When unsure, answer false.");
    expect(AUTO_COMMON_NOTE).toBe("nom courant : à suivre à la main avec un motif précis");
  });

  it("seul un « distinctif » franc fait entrer l'app ; une app sans verdict n'est pas regardée à ce passage", () => {
    const got = autoAnswer(
      {
        items: [
          { id: "a", distinctive: true },
          { id: "b", distinctive: false },
          // Ni oui ni non : c'est non.
          { id: "c", distinctive: "yes" },
          // Répétée, inventée, illisible : écartées.
          { id: "a", distinctive: false },
          { id: "zz", distinctive: true },
          null,
        ],
      },
      batch,
    );
    expect(got).toEqual([
      { id: "a", common: false },
      { id: "b", common: true },
      { id: "c", common: true },
    ]);
    // « d » n'a pas de verdict : elle attendra le passage suivant.
    expect(got.map((g) => g.id)).not.toContain("d");
    for (const raw of [null, "texte", {}, { items: "non" }]) expect(autoAnswer(raw, batch)).toEqual([]);
  });
});

describe("Radar — les apps d'une liste importée (15/11/2026)", () => {
  it("chacune entre à l'essai sous son nom collé, avec son nom, son hashtag et « nom app » pour recherches", () => {
    expect(listPatterns("Blow Up")).toEqual(["blowup"]);
    expect(listPatterns("Higgsfield AI")).toEqual(["higgsfieldai"]);
    expect(listPatterns("99")).toEqual([]);
    expect(autoPlan({ kind: "liste", label: "Higgsfield AI" })).toEqual({ patterns: ["higgsfieldai"], trial: true });
    // Trois lettres : seulement « nomapp » ; moins, rien.
    expect(autoPlan({ kind: "liste", label: "Tab" })).toEqual({ patterns: ["tabapp"], trial: true });
    expect(autoPlan({ kind: "liste", label: "99" })).toEqual({ skip: "nom trop court" });
    // L'import pose les noms de trois lettres (ils entrent sous « nomapp »), pas en dessous.
    expect(listKey("Tab")).toBe("liste:tab");
    expect(listKey("TBN+")).toBe("liste:tbn");
    expect(listKey("Blow Up")).toBe("liste:blowup");
    expect(listKey("99")).toBeNull();
    expect(listKey("美团")).toBeNull();
    expect(listSearches("Blow Up")).toEqual(["blow up", "#blowup", "blow up app"]);
  });

  it("un nom courant entre sous « nomapp », sans les tournures où « app » ouvre un autre mot", () => {
    const fb = listFallback("Simple")!;
    expect(fb.patterns).toEqual(["simpleapp"]);
    expect(fb.searches).toEqual(["simple app", "#simpleapp"]);
    const simple = { strong: fb.patterns, not: fb.not };
    expect(citesApp("the Simple app helped me lose 5kg #simpleapp", "x", simple)).toBe(true);
    expect(citesApp("a simple approach to life", "x", simple)).toBe(false);
    expect(citesApp("simple apple pie recipe", "x", simple)).toBe(false);
    expect(citesApp("keep it simple appreciate the little things", "x", simple)).toBe(false);
    expect(citesApp("so simple", "x", simple)).toBe(false);
    // Un nom qui finit déjà par « app » : rien de plus sûr, il reste proposé.
    expect(listFallback("Recime App")).toBeNull();
  });
});
