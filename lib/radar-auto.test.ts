import { describe, expect, it } from "vitest";
import { AUTO_COMMON_NOTE, AUTO_SCHEMA, AUTO_SYSTEM, autoAnswer, autoPlan, autoPrompt, shortenedPattern } from "../convex/radarAutoMath";
import { AUTO_MIN_CREATORS, brandFamily, storeAutoFollow, type CreatorWhy } from "../convex/radarStoreMath";

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
    expect(autoPlan({ kind: "store", label: "Survie", store: { tag: "survie", creators: [c("zwz997"), c("le_survivaliste.fr")] } })).toEqual({ skip: "preuve insuffisante" });
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

  it("un compte mentionné ou un site cité ne sont jamais suivis d'office", () => {
    expect(autoPlan({ kind: "mention", label: "@SHEIN" })).toEqual({ skip: "pas une source suivie d'office" });
    expect(autoPlan({ kind: "domain", label: "opsion.app" })).toEqual({ skip: "pas une source suivie d'office" });
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
