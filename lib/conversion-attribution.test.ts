/**
 * Attribution de conversion par créatrice (`convex/conversionAttribution.ts`).
 *
 * Les quatre cas exigés par le chantier : idempotence du re-run, une source en
 * échec, créatrice sans ref, jour sans données — plus les bords de la fusion.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeRef,
  mergeDayRows,
  shapeConversionDay,
  refConflicts,
  type DayRefRow,
  type PosthogDayResult,
  type WhopDayResult,
} from "../convex/conversionAttribution";

const ph = (
  byRef: PosthogDayResult["byRef"],
  unattributed = { visitors: 0, signups: 0 },
): PosthogDayResult => ({ ok: true, byRef, unattributed });
const phKo: PosthogDayResult = {
  ok: false,
  byRef: {},
  unattributed: { visitors: 0, signups: 0 },
};
const wh = (
  byRef: WhopDayResult["byRef"],
  unattributed: WhopDayResult["unattributed"] = { sales: 0, revenue: 0 },
): WhopDayResult => ({ ok: true, byRef, unattributed });
const whKo: WhopDayResult = {
  ok: false,
  byRef: {},
  unattributed: { sales: 0, revenue: 0 },
};

describe("normalizeRef", () => {
  it("plie casse et bords, vide → null (jamais la chaîne vide)", () => {
    expect(normalizeRef("/Kelly/")).toBe("kelly");
    expect(normalizeRef("@sarah")).toBe("sarah");
    expect(normalizeRef("  ")).toBeNull();
    expect(normalizeRef("")).toBeNull();
    expect(normalizeRef(null)).toBeNull();
  });
});

describe("mergeDayRows — fusion champ par champ", () => {
  const jourNominal = () =>
    mergeDayRows(
      [],
      ph(
        { kelly: { visitors: 214, signups: 9 }, sarah: { visitors: 58, signups: 2 } },
        { visitors: 131, signups: 3 },
      ),
      wh(
        { kelly: { sales: 3, revenue: 87, currency: "EUR" } },
        { sales: 1, revenue: 29, currency: "EUR" },
      ),
    );

  it("jour nominal : refs mesurées + ligne « sans ref »", () => {
    const rows = jourNominal();
    const kelly = rows.find((r) => r.ref === "kelly")!;
    expect(kelly).toEqual({
      ref: "kelly",
      visitors: 214,
      signups: 9,
      sales: 3,
      revenue: 87,
      currency: "EUR",
    });
    // Sarah : mesurée par PostHog, zéro vente MESURÉ (Whop a répondu).
    const sarah = rows.find((r) => r.ref === "sarah")!;
    expect(sarah.sales).toBe(0);
    const sans = rows.find((r) => r.ref === undefined)!;
    expect(sans.visitors).toBe(131);
    expect(sans.sales).toBe(1);
  });

  it("IDEMPOTENT : rejouer la même fusion sur son résultat ne change rien", () => {
    // Le re-run du cron sur la même date doit écraser proprement, jamais
    // doubler — c'est l'exigence n°1 du chantier.
    const une = jourNominal();
    const deux = mergeDayRows(
      une,
      ph(
        { kelly: { visitors: 214, signups: 9 }, sarah: { visitors: 58, signups: 2 } },
        { visitors: 131, signups: 3 },
      ),
      wh(
        { kelly: { sales: 3, revenue: 87, currency: "EUR" } },
        { sales: 1, revenue: 29, currency: "EUR" },
      ),
    );
    const tri = (a: DayRefRow, b: DayRefRow) =>
      (a.ref ?? "").localeCompare(b.ref ?? "");
    expect([...deux].sort(tri)).toEqual([...une].sort(tri));
  });

  it("UNE SOURCE EN ÉCHEC : Whop répond, PostHog non → on stocke ce qu'on a", () => {
    const rows = mergeDayRows(
      [],
      phKo,
      wh({ kelly: { sales: 2, revenue: 58, currency: "EUR" } }),
    );
    const kelly = rows.find((r) => r.ref === "kelly")!;
    expect(kelly.sales).toBe(2);
    // Visiteurs JAMAIS collectés → undefined, pas 0.
    expect(kelly.visitors).toBeUndefined();
  });

  it("le re-run comble une source manquante SANS toucher l'autre", () => {
    // Jour J : PostHog en panne → ventes seules. Re-run : PostHog répond.
    const j1 = mergeDayRows(
      [],
      phKo,
      wh({ kelly: { sales: 2, revenue: 58, currency: "EUR" } }),
    );
    const j2 = mergeDayRows(j1, ph({ kelly: { visitors: 214, signups: 9 } }), whKo);
    const kelly = j2.find((r) => r.ref === "kelly")!;
    expect(kelly).toMatchObject({
      visitors: 214,
      signups: 9,
      sales: 2,
      revenue: 58,
    });
  });

  it("une source qui répond fait autorité : la ref disparue passe à un zéro MESURÉ", () => {
    const j1 = jourNominal();
    // Re-collecte : Kelly n'a plus de visiteurs dans la réponse PostHog.
    const j2 = mergeDayRows(j1, ph({}, { visitors: 12, signups: 0 }), whKo);
    const kelly = j2.find((r) => r.ref === "kelly")!;
    expect(kelly.visitors).toBe(0); // mesuré, pas absent
    expect(kelly.sales).toBe(3); // Whop intact
  });

  it("les DEUX sources en échec ne touchent à rien", () => {
    const j1 = jourNominal();
    expect(mergeDayRows(j1, phKo, whKo)).toEqual(j1);
  });

  it("jour sans données : deux sources OK et vides → seule la ligne « sans ref » à zéro", () => {
    const rows = mergeDayRows([], ph({}), wh({}));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      ref: undefined,
      visitors: 0,
      signups: 0,
      sales: 0,
      revenue: 0,
    });
  });

  it("les refs des sources sont pliées (casse/bords) avant fusion", () => {
    const rows = mergeDayRows(
      [],
      ph({ "/Kelly": { visitors: 10, signups: 0 } }),
      wh({ kelly: { sales: 1, revenue: 29, currency: "EUR" } }),
    );
    // UNE seule ligne portant LES DEUX moitiés : « /Kelly » (PostHog) et
    // « kelly » (Whop) sont la même ref. Sans le pliage, les visiteurs et les
    // ventes atterriraient sur deux lignes distinctes — chacune plausible
    // isolément, la jointure perdue.
    expect(rows).toHaveLength(2); // kelly + la ligne « sans ref »
    const kelly = rows.find((r) => r.ref === "kelly")!;
    expect(kelly.visitors).toBe(10);
    expect(kelly.sales).toBe(1);
    expect(rows.some((r) => r.ref === "/Kelly")).toBe(false);
  });
});

describe("shapeConversionDay — l'écran", () => {
  const creators = [
    { creatorId: "cr_kelly", name: "Kelly", refSlug: "kelly" },
    { creatorId: "cr_sarah", name: "Sarah", refSlug: "Sarah" }, // casse ≠
    { creatorId: "cr_lea", name: "Léa" }, // PAS de ref configurée
  ];
  const rows: DayRefRow[] = [
    { ref: "kelly", visitors: 214, signups: 9, sales: 3, revenue: 87, currency: "EUR" },
    { ref: "sarah", visitors: 58, signups: 2, sales: 0, revenue: 0 },
    { ref: "mystere", visitors: 33, signups: 1, sales: 0, revenue: 0 },
    { ref: undefined, visitors: 131, signups: 3, sales: 1, revenue: 29, currency: "EUR" },
  ];

  it("créatrice SANS ref → état « no-ref », jamais une ligne à zéro", () => {
    // LA réserve du chantier : sans ref dans la bio, l'attribution est aveugle —
    // afficher 0 ferait lire « elle ne convertit pas » là où on ne VOIT rien.
    const d = shapeConversionDay(rows, creators);
    const lea = d.rows.find(
      (r) => r.kind === "no-ref" && r.creatorName === "Léa",
    );
    expect(lea).toBeDefined();
    expect(
      d.rows.some((r) => r.kind === "creator" && r.creatorName === "Léa"),
    ).toBe(false);
    // …et elle est rangée EN DERNIER (état, pas performance).
    expect(d.rows[d.rows.length - 1].kind).toBe("no-ref");
  });

  it("le refSlug est plié : « Sarah » rattache la ref « sarah »", () => {
    const d = shapeConversionDay(rows, creators);
    const sarah = d.rows.find(
      (r) => r.kind === "creator" && r.creatorName === "Sarah",
    )!;
    expect(sarah).toMatchObject({ visitors: 58, sales: 0 });
  });

  it("une ref orpheline reste visible (le trafic existe, le rattachement manque)", () => {
    const d = shapeConversionDay(rows, creators);
    expect(
      d.rows.find((r) => r.kind === "ref-only" && r.ref === "mystere"),
    ).toMatchObject({ visitors: 33 });
  });

  it("ligne « sans source » + total (unattributed compris)", () => {
    const d = shapeConversionDay(rows, creators);
    expect(d.unattributed).toMatchObject({ visitors: 131, sales: 1, revenue: 29 });
    expect(d.total).toMatchObject({
      visitors: 214 + 58 + 33 + 131,
      sales: 4,
      revenue: 116,
      currency: "EUR",
    });
  });

  it("JOUR SANS DONNÉES : totaux null, jamais un 0 inventé", () => {
    const d = shapeConversionDay([], creators);
    expect(d.total.visitors).toBeNull();
    expect(d.total.revenue).toBeNull();
    expect(d.unattributed).toBeNull();
    // Les créatrices avec ref apparaissent quand même, à valeurs null (« — »).
    const kelly = d.rows.find(
      (r) => r.kind === "creator" && r.creatorName === "Kelly",
    )!;
    expect(kelly).toMatchObject({ visitors: null, revenue: null });
  });

  it("source partielle : visiteurs mesurés, ventes null → le total distingue", () => {
    const partiel: DayRefRow[] = [{ ref: "kelly", visitors: 214, signups: 9 }];
    const d = shapeConversionDay(partiel, creators);
    expect(d.total.visitors).toBe(214);
    expect(d.total.sales).toBeNull();
  });
});

/**
 * ALL-TIME — le bloc « Ce que ça a rapporté » n'affiche plus une journée mais
 * tout l'historique. Deux changements de sens en découlent.
 *
 * 1. LE VIDE. Sur UNE journée, une ref sans ligne peut vouloir dire « la source
 *    n'a rien dit » — d'où le « — ». Sur une période dont on sait combien de
 *    jours ont été collectés, c'est autre chose : les sources ont répondu, et
 *    elles n'ont rien vu pour cette ref. Une créatrice avec une ref active et
 *    zéro visiteur depuis toujours est un VRAI ZÉRO. Cas de prod : `marine`,
 *    `orlane` et `celia` ont une ref configurée et pas une seule ligne en 41
 *    jours collectés.
 *
 * 2. LE TOTAL. Il somme TOUT — refs rattachées, refs orphelines et ligne « sans
 *    source ». En vue journée l'écart passait ; en all-time il devient criant :
 *    en prod, 1 257,59 € « sans source » contre 46,32 € attribués à Kelly. Un
 *    seul « Total » sous une liste où une seule créatrice a un chiffre laisse
 *    croire à une attribution qui n'existe pas. D'où DEUX lignes : ce qui est
 *    attribué, et le total réconciliable avec Whop.
 */
describe("shapeConversionDay — all-time", () => {
  const creators = [
    { creatorId: "cr_kelly", name: "Kelly", refSlug: "kelly" },
    { creatorId: "cr_marine", name: "Marine", refSlug: "marine" },
    { creatorId: "cr_lea", name: "Léa" }, // pas de ref
  ];
  // Chiffres de prod (cumuls au 2026-08-27) — pas des nombres ronds.
  const rows: DayRefRow[] = [
    { ref: "kelly", visitors: 236, signups: 13, sales: 5, revenue: 46.32, currency: "EUR" },
    { ref: "gio", visitors: 146, signups: 4, sales: 1, revenue: 9.27, currency: "EUR" },
    { ref: undefined, visitors: 6107, signups: 3405, sales: 172, revenue: 1257.59, currency: "EUR" },
  ];

  it("ref active sans aucune ligne sur des jours COLLECTÉS → un vrai zéro", () => {
    const d = shapeConversionDay(rows, creators, { collectedDays: 41 });
    const marine = d.rows.find(
      (r) => r.kind === "creator" && r.creatorName === "Marine",
    )!;
    expect(marine).toMatchObject({ visitors: 0, signups: 0, sales: 0, revenue: 0 });
  });

  it("aucun jour collecté → « — » maintenu (on ne mesure rien, on n'invente rien)", () => {
    // Contrôle OPPOSÉ du précédent : le zéro ne doit pas apparaître par défaut.
    const d = shapeConversionDay(rows, creators, { collectedDays: 0 });
    const marine = d.rows.find(
      (r) => r.kind === "creator" && r.creatorName === "Marine",
    )!;
    expect(marine).toMatchObject({ visitors: null, revenue: null });
  });

  it("« pas de ref configurée » reste un état, jamais un zéro", () => {
    const d = shapeConversionDay(rows, creators, { collectedDays: 41 });
    expect(d.rows.some((r) => r.kind === "no-ref" && r.creatorName === "Léa")).toBe(true);
    expect(d.rows.some((r) => r.kind === "creator" && r.creatorName === "Léa")).toBe(false);
  });

  it("Total attribué = les refs RATTACHÉES ; le Total garde tout", () => {
    const d = shapeConversionDay(rows, creators, { collectedDays: 41 });
    // Attribué : Kelly seule (gio est orpheline, « sans source » n'est à personne).
    expect(d.attributed).toMatchObject({ visitors: 236, sales: 5, revenue: 46.32 });
    // Total : tout, donc réconciliable avec Whop. Le revenu est ARRONDI au
    // centime — la somme brute des flottants donne 1313,1799999999998, et la
    // base de prod porte déjà des valeurs comme 46,31999999999999.
    expect(d.total).toMatchObject({
      visitors: 236 + 146 + 6107,
      sales: 5 + 1 + 172,
      revenue: 1313.18,
    });
  });

  it("le revenu d'une ref orpheline entre dans le Total, jamais dans l'attribué", () => {
    const d = shapeConversionDay(rows, creators, { collectedDays: 41 });
    expect(d.total.revenue! - d.attributed.revenue!).toBeCloseTo(9.27 + 1257.59, 2);
  });

  it("sans données du tout : attribué et total restent null, jamais 0", () => {
    const d = shapeConversionDay([], creators, { collectedDays: 41 });
    expect(d.total.revenue).toBeNull();
    expect(d.attributed.revenue).toBeNull();
  });
});

/**
 * INFLUENCEUSES — des refs qui appartiennent à quelqu'un de nommé sans être des
 * créatrices. Elles n'entrent ni dans le moteur de paie, ni dans le portail :
 * leur seule existence dans le produit est cette ligne d'attribution.
 *
 * Cas de prod : `gio`, `asly`, `paredes`, `sabrina` et `hilary` ont du trafic et
 * des ventes, et aucune fiche `creators` — l'écran les étiquetait « ref sans
 * créatrice rattachée », ce qui se lit comme une donnée à corriger alors que
 * c'est une catégorie normale.
 *
 * CONSÉQUENCE ASSUMÉE : « Total attribué » ne veut plus dire « rattaché à une
 * créatrice » mais « rattaché à quelqu'un de NOMMÉ ». C'est la question qui
 * compte — sait-on qui a amené ce revenu ? — et pas le statut contractuel de la
 * personne.
 */
describe("shapeConversionDay — influenceuses", () => {
  const creators = [{ creatorId: "cr_kelly", name: "Kelly", refSlug: "kelly" }];
  const influencers = [
    { ref: "gio", name: "Gio" },
    { ref: "paredes", name: "Paredes" },
  ];
  const rows: DayRefRow[] = [
    { ref: "kelly", visitors: 274, signups: 17, sales: 6, revenue: 55.59, currency: "EUR" },
    { ref: "gio", visitors: 146, signups: 4, sales: 1, revenue: 9.27, currency: "EUR" },
    { ref: "inconnue", visitors: 12, signups: 0, sales: 0, revenue: 0 },
    { ref: undefined, visitors: 7105, signups: 3992, sales: 190, revenue: 1409.99, currency: "EUR" },
  ];

  it("une ref d'influenceuse est NOMMÉE, plus « sans créatrice rattachée »", () => {
    const d = shapeConversionDay(rows, creators, { collectedDays: 42, influencers });
    const gio = d.rows.find((r) => r.kind === "influencer" && r.ref === "gio")!;
    expect(gio).toMatchObject({ name: "Gio", visitors: 146, sales: 1, revenue: 9.27 });
  });

  it("son revenu entre dans le Total ATTRIBUÉ (on sait qui l'a amené)", () => {
    const d = shapeConversionDay(rows, creators, { collectedDays: 42, influencers });
    expect(d.attributed.revenue).toBeCloseTo(55.59 + 9.27, 2);
    expect(d.attributed.sales).toBe(7);
  });

  it("une ref que PERSONNE ne revendique reste orpheline — le signal survit", () => {
    // Contrôle OPPOSÉ : si tout devenait « nommé », la catégorie ne servirait
    // plus à rien. `inconnue` doit rester visible ET hors de l'attribué.
    const d = shapeConversionDay(rows, creators, { collectedDays: 42, influencers });
    expect(d.rows.some((r) => r.kind === "ref-only" && r.ref === "inconnue")).toBe(true);
    expect(d.attributed.visitors).toBe(274 + 146); // 12 visiteurs d'`inconnue` exclus
  });

  it("une influenceuse déclarée SANS données apparaît quand même, à zéro", () => {
    const d = shapeConversionDay(rows, creators, { collectedDays: 42, influencers });
    const paredes = d.rows.find((r) => r.kind === "influencer" && r.ref === "paredes")!;
    expect(paredes).toMatchObject({ name: "Paredes", visitors: 0, revenue: 0 });
  });

  it("sans influenceuses déclarées, le comportement d'avant est INTACT", () => {
    const d = shapeConversionDay(rows, creators, { collectedDays: 42 });
    expect(d.rows.some((r) => r.kind === "ref-only" && r.ref === "gio")).toBe(true);
    expect(d.attributed.revenue).toBeCloseTo(55.59, 2);
  });
});

/**
 * GARDE-FOU — deux fiches ne peuvent pas porter la même ref.
 *
 * Ni l'interface (`updateCreator`) ni le CLI (`setCreatorRefSlugBySlug`) ne le
 * vérifiaient. Deux créatrices avec `gio` afficheraient TOUTES DEUX les chiffres
 * de `gio` : le « Total attribué » resterait juste (il somme les refs, pas les
 * fiches), donc rien ne signalerait l'erreur — c'est exactement le genre de
 * défaut qui ne se voit jamais.
 */
describe("refConflicts — une ref appartient à une seule personne", () => {
  it("deux créatrices sur la même ref → conflit nommé", () => {
    const c = refConflicts(
      [
        { creatorId: "a", name: "Kelly", refSlug: "kelly" },
        { creatorId: "b", name: "Kelly B.", refSlug: "Kelly" }, // casse ≠, même ref
      ],
      [],
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ ref: "kelly" });
    expect(c[0].holders).toEqual(["Kelly", "Kelly B."]);
  });

  it("une créatrice et une influenceuse sur la même ref → conflit aussi", () => {
    const c = refConflicts(
      [{ creatorId: "a", name: "Gio C.", refSlug: "gio" }],
      [{ ref: "gio", name: "Gio" }],
    );
    expect(c).toHaveLength(1);
    expect(c[0].holders).toContain("Gio C.");
    expect(c[0].holders).toContain("Gio");
  });

  it("aucun doublon → aucun conflit (le cas de la prod aujourd'hui)", () => {
    expect(
      refConflicts(
        [
          { creatorId: "a", name: "Kelly", refSlug: "kelly" },
          { creatorId: "b", name: "Sarah", refSlug: "sarah" },
          { creatorId: "c", name: "Léa", refSlug: null },
        ],
        [{ ref: "gio", name: "Gio" }],
      ),
    ).toEqual([]);
  });

  it("les fiches sans ref ne collisionnent jamais entre elles", () => {
    expect(
      refConflicts(
        [
          { creatorId: "a", name: "A", refSlug: null },
          { creatorId: "b", name: "B", refSlug: "  " },
        ],
        [],
      ),
    ).toEqual([]);
  });
});
