import { describe, it, expect } from "vitest";
import {
  scanSpans,
  stripInterpolations,
  looksLikeSentence,
} from "./i18n-detect.mjs";

/** Texte JSX d'une étendue, tel que le détecteur le voit. */
const textOf = (src) =>
  scanSpans(src)
    .map((s) => stripInterpolations(s.raw))
    .filter((t) => t !== "" && looksLikeSentence(t));

/**
 * LE DÉTECTEUR i18n, TESTÉ — parce qu'il a menti trois fois.
 *
 * À chaque fois il annonçait « 0 chaîne » sur des écrans qui affichaient du
 * français, et à chaque fois le trou n'a été trouvé qu'en regardant l'écran.
 * Ces tests figent les trois motifs, ET les fragments de code qu'il doit
 * continuer d'écarter — desserrer un garde-fou sans contrôle, c'est échanger un
 * faux négatif contre une pluie de faux positifs.
 */
describe("détecteur i18n — trou 1 : texte voisin d'une interpolation", () => {
  it("voit le texte COLLÉ à une interpolation", () => {
    // « Bonjour Ladidi » s'affichait au milieu d'un écran anglais.
    expect(textOf('<h1 className="x">\n  Bonjour{name ? ` ${name}` : ""}\n</h1>')).toContain(
      "Bonjour",
    );
  });

  it("voit le texte COUPÉ par une interpolation", () => {
    expect(
      textOf('<p className="x">\n  Ce que tu as à faire pour {current.name}.\n</p>'),
    ).toContain("Ce que tu as à faire pour .");
  });

  it("voit le texte SÉPARÉ par {\" \"} et une balise", () => {
    const out = textOf('<p className="x">\n  Plus que{" "}\n  <span>{v}</span>{" "}\n  vues.\n</p>');
    expect(out.join(" | ")).toMatch(/Plus que/);
  });

  it("voit le texte qui SUIT une interpolation", () => {
    expect(
      textOf('<span\n  data-testid="cumul"\n>\n  {fmt(x)} vues cumulées\n</span>'),
    ).toContain("vues cumulées");
  });
});

describe("détecteur i18n — trou 2 : la prose qui ouvre par un décor", () => {
  it("accepte une phrase précédée d'un emoji", () => {
    // C'était MON garde-fou anti-fragment qui la rejetait.
    expect(looksLikeSentence("🏆 Paliers de récompense")).toBe(true);
    expect(looksLikeSentence("✓ Compte cohérent")).toBe(true);
    expect(looksLikeSentence("⚠️ Ce lien pointe vers un autre compte")).toBe(true);
  });

  it("accepte une phrase précédée d'une puce ou d'un tiret long", () => {
    expect(looksLikeSentence("— l'équipe publie ce contenu")).toBe(true);
    expect(looksLikeSentence("· débloqué le")).toBe(true);
  });

  it("CONTRE-ÉPREUVE : les fragments de code restent écartés", () => {
    // Ceux que le garde-fou d'origine écartait à raison. Les desserrer sans
    // vérifier ce point aurait échangé un faux négatif contre 10 faux positifs
    // — mesuré : 65 détections dont 10 fausses avant ce filtre, 54 dont 0 après.
    for (const fragment of [
      ") : done ? (",
      ", id: Id",
      "[number]; const MEDAL: Record",
      "0 && !meRanked; return (",
      "0, ); return (",
      "(null); function patch(localId: string, next: Partial",
      '") && part.endsWith("',
      "= Omit",
      "& VariantProps",
    ]) {
      expect(looksLikeSentence(fragment), fragment).toBe(false);
    }
  });

  it("le point-virgule FRANÇAIS ne fait pas rejeter la phrase", () => {
    // Faux négatif déjà corrigé une fois : la ponctuation française emploie le
    // point-virgule avec des espaces. Ce sont les MOTS-CLÉS qui discriminent.
    expect(
      looksLikeSentence("Un admin la relit ; une fois validée, tu publies."),
    ).toBe(true);
  });
});

describe("détecteur i18n — étendues et interpolations", () => {
  it("n'ouvre pas d'étendue sur une flèche ou une comparaison", () => {
    expect(textOf("const f = (x) => x < 2 && x > 1;\n")).toEqual([]);
  });

  it("ignore une accolade non refermée (ce n'est pas une étendue de texte)", () => {
    expect(textOf("<div>\n  {items.map((i) => (\n")).toEqual([]);
  });

  it("retire les interpolations imbriquées", () => {
    expect(stripInterpolations("Payé{p.at ? ` le ${fmt(p.at)}` : \"\"}")).toBe(
      "Payé",
    );
  });
});
