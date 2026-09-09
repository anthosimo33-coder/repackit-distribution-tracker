import { describe, it, expect } from "vitest";
import { buildPerfMap, comptePerfKey } from "../convex/comptes";
import type { Doc } from "../convex/_generated/dataModel";

/**
 * PERF D'UN COMPTE — la clé est (handle, plateforme), jamais le handle seul.
 *
 * Jeux d'essai à la FORME de la production (projet Snytch, export du
 * 2026-09-09) : les vrais handles, les vrais volumes, et le vrai partage
 * 19 posts TikTok / 18 posts Instagram de `@ja.deotn`. Un jeu de handles
 * distincts n'aurait rien prouvé — c'est justement le handle PARTAGÉ entre deux
 * plateformes qui était mal mesuré.
 */
function pub(
  compte: string,
  plateforme: string,
  vues: number,
  opts: { datePubli?: number; isWarmup?: boolean; postUrl?: string } = {},
): Doc<"publications"> {
  return {
    compte,
    plateforme,
    vuesLatest: vues,
    // Une publication PUBLIÉE porte une postUrl (cf isPublishedDoc).
    postUrl: opts.postUrl ?? `https://www.tiktok.com/@x/video/${vues}`,
    // Jamais « aujourd'hui » : une date figée du mois d'août.
    datePubli: opts.datePubli ?? Date.parse("2026-08-14T22:00:00Z"),
    isWarmup: opts.isWarmup,
  } as unknown as Doc<"publications">;
}

/** Les 37 publications de @ja.deotn, réparties comme en production. */
const JA_DEOTN: Doc<"publications">[] = [
  ...Array.from({ length: 19 }, (_, i) =>
    pub("@ja.deotn", "TikTok", 640 + i, {
      datePubli: Date.parse("2026-08-14T22:00:00Z") + i * 86_400_000,
    }),
  ),
  ...Array.from({ length: 18 }, (_, i) =>
    pub("@ja.deotn", "Instagram", 197 + i, {
      datePubli: Date.parse("2026-08-02T22:00:00Z") + i * 86_400_000,
    }),
  ),
];

const TT = (h: string) => comptePerfKey(h, "TikTok");
const IG = (h: string) => comptePerfKey(h, "Instagram");

describe("comptePerfKey", () => {
  it("sépare deux plateformes du même pseudo", () => {
    expect(comptePerfKey("@ja.deotn", "TikTok")).not.toBe(
      comptePerfKey("@ja.deotn", "Instagram"),
    );
  });

  it("replie la casse du handle, sans toucher à la plateforme", () => {
    expect(comptePerfKey("@Cintia_secretacc", "Instagram")).toBe(
      comptePerfKey("@cintia_secretacc", "Instagram"),
    );
    // La plateforme, elle, reste distinctive — sinon on recollerait deux
    // comptes bien réels en un seul.
    expect(comptePerfKey("@cintia_secretacc", "Instagram")).not.toBe(
      comptePerfKey("@cintia_secretacc", "TikTok"),
    );
  });
});

describe("buildPerfMap — un handle sur deux plateformes", () => {
  const map = buildPerfMap(JA_DEOTN);

  it("mesure chaque plateforme pour elle-même", () => {
    // 19 posts TikTok, vues 640..658.
    expect(map.get(TT("@ja.deotn"))).toEqual({
      vuesCumulees: 12_331,
      nbPublies: 19,
      dernierPost: Date.parse("2026-08-14T22:00:00Z") + 18 * 86_400_000,
    });
    // 18 posts Instagram, vues 197..214.
    expect(map.get(IG("@ja.deotn"))).toEqual({
      vuesCumulees: 3_699,
      nbPublies: 18,
      dernierPost: Date.parse("2026-08-02T22:00:00Z") + 17 * 86_400_000,
    });
  });

  it("ne sert PLUS le même total aux deux comptes", () => {
    // Le défaut d'origine : agrégée sur le handle seul, la mesure rendait
    // 16 030 vues et 37 posts sur CHACUNE des deux lignes — la ligne Instagram
    // annonçait 4,3 fois ses vraies vues.
    const tt = map.get(TT("@ja.deotn"))!;
    const ig = map.get(IG("@ja.deotn"))!;
    expect(tt.vuesCumulees).not.toBe(ig.vuesCumulees);
    expect(tt.nbPublies).not.toBe(ig.nbPublies);
    // Assertion de PRÉSENCE en regard des deux absences ci-dessus : la somme
    // des deux comptes reste le total du handle, rien n'a été perdu en route.
    expect(tt.vuesCumulees + ig.vuesCumulees).toBe(16_030);
    expect(tt.nbPublies + ig.nbPublies).toBe(37);
  });

  it("n'invente pas de compte sous le handle nu", () => {
    expect(map.get("@ja.deotn")).toBeUndefined();
    // Présence : les deux vraies clés, elles, existent bien.
    expect(map.has(TT("@ja.deotn"))).toBe(true);
    expect(map.has(IG("@ja.deotn"))).toBe(true);
  });
});

describe("buildPerfMap — graphies", () => {
  it("recolle deux graphies sur la MÊME plateforme", () => {
    const map = buildPerfMap([
      pub("@Sophia_secretacc1", "TikTok", 1_200),
      pub("@sophia_secretacc1", "TikTok", 800),
    ]);
    expect(map.size).toBe(1);
    expect(map.get(TT("@sophia_secretacc1"))?.vuesCumulees).toBe(2_000);
  });

  it("ne recolle PAS deux graphies sur deux plateformes différentes", () => {
    // Le cas Cintia : la différence de majuscule coïncide avec la différence de
    // plateforme. Ce sont deux comptes réels, ils doivent le rester.
    const map = buildPerfMap([
      pub("@Cintia_secretacc", "Instagram", 6_532),
      pub("@cintia_secretacc", "TikTok", 1_640),
    ]);
    expect(map.size).toBe(2);
    expect(map.get(IG("@cintia_secretacc"))?.vuesCumulees).toBe(6_532);
    expect(map.get(TT("@cintia_secretacc"))?.vuesCumulees).toBe(1_640);
  });
});

describe("buildPerfMap — ce qui compte dans quel compteur", () => {
  it("exclut le warmup des VUES, mais pas des posts publiés", () => {
    // TD-019 : un post de chauffe est bien publié, il n'est simplement pas
    // compté dans la performance.
    const map = buildPerfMap([
      pub("@kelly.leydie", "TikTok", 14_700),
      pub("@kelly.leydie", "TikTok", 9_300, { isWarmup: true }),
    ]);
    const perf = map.get(TT("@kelly.leydie"))!;
    expect(perf.vuesCumulees).toBe(14_700);
    expect(perf.nbPublies).toBe(2);
  });

  it("ne compte comme publié que ce qui porte une postUrl", () => {
    const map = buildPerfMap([
      pub("@withorlane", "TikTok", 5_000),
      pub("@withorlane", "TikTok", 0, { postUrl: "" }),
    ]);
    const perf = map.get(TT("@withorlane"))!;
    expect(perf.nbPublies).toBe(1);
    // Un post non publié n'annule pas les vues déjà relevées des autres.
    expect(perf.vuesCumulees).toBe(5_000);
  });

  it("garde la date du DERNIER post publié", () => {
    const aout = Date.parse("2026-08-03T22:00:00Z");
    const septembre = Date.parse("2026-09-01T22:00:00Z");
    const map = buildPerfMap([
      pub("@askcinthia", "TikTok", 900, { datePubli: septembre }),
      pub("@askcinthia", "TikTok", 700, { datePubli: aout }),
    ]);
    expect(map.get(TT("@askcinthia"))?.dernierPost).toBe(septembre);
  });

  it("laisse un compte sans publication hors de la carte", () => {
    const map = buildPerfMap([pub("@askcinthia", "TikTok", 900)]);
    expect(map.get(TT("@comptesecretemilie_"))).toBeUndefined();
    // Présence : le compte qui a bien publié, lui, est là.
    expect(map.get(TT("@askcinthia"))?.nbPublies).toBe(1);
  });
});
