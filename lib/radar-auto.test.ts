import { describe, expect, it } from "vitest";
import { autoPlan } from "../convex/radarAutoMath";
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
  it("une app des classements assez prouvée : son hashtag sans « app » pour motif", () => {
    expect(autoPlan({ kind: "store", label: "Bibly", store: { tag: "biblyapp", creators: [c("lucille_255", "bio"), c("melina8984", "bio")] } })).toEqual({ patterns: ["bibly"] });
    expect(autoPlan({ kind: "store", label: "Survie", store: { tag: "survie", creators: [c("zwz997"), c("le_survivaliste.fr")] } })).toEqual({ skip: "preuve insuffisante" });
  });

  it("un produit d'une place de marché entre dès qu'on sait le nommer", () => {
    expect(autoPlan({ kind: "market", label: "Open Road", market: { handle: "openroadapp" } })).toEqual({ patterns: ["openroad", "openroadapp"] });
    expect(autoPlan({ kind: "market", label: "Abby AI", market: { handle: "" } })).toEqual({ patterns: ["abbyai"] });
    // Un nom de trois lettres sans pseudo : pas de motif sûr.
    expect(autoPlan({ kind: "market", label: "Elb", market: { handle: "" } })).toEqual({ skip: "nom trop court" });
  });

  it("un compte mentionné ou un site cité ne sont jamais suivis d'office", () => {
    expect(autoPlan({ kind: "mention", label: "@SHEIN" })).toEqual({ skip: "pas une source suivie d'office" });
    expect(autoPlan({ kind: "domain", label: "opsion.app" })).toEqual({ skip: "pas une source suivie d'office" });
  });
});
