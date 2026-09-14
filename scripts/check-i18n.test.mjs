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

// ─── Passe syntaxique (2026-09-14) ──────────────────────────────────────────
// Chaque motif ci-dessous s'affichait EN FRANÇAIS dans l'espace créatrice
// anglais alors que la garde annonçait 175/175 fichiers extraits.
import { astFindings, stripLineComments } from "./i18n-ast.mjs";

const astTexts = (src) => astFindings(src).map((f) => f.text);

describe("détecteur i18n — trou 5 : `/*` dans une chaîne", () => {
  it("ne prend pas `video/*` pour l'ouverture d'un commentaire", () => {
    const r = stripLineComments('  accept: "video/*,image/*,.mov",', false);
    expect(r.inBlock).toBe(false);
    expect(r.code).toContain("video/*");
  });

  it("retire toujours un vrai bloc, et en reporte l'état", () => {
    expect(stripLineComments("a /* b */ c", false)).toEqual({ code: "a  c", inBlock: false });
    expect(stripLineComments("x /* ouvert", false).inBlock).toBe(true);
    expect(stripLineComments("fin */ y", true)).toEqual({ code: " y", inBlock: false });
  });

  it("garde une URL entière (le `//` d'une chaîne n'est pas un commentaire)", () => {
    expect(stripLineComments('const u = "https://x.fr"; // note', false).code).toBe(
      'const u = "https://x.fr"; ',
    );
  });

  it("voit le texte d'un fichier APRÈS une chaîne contenant `/*`", () => {
    const src = 'const A = { accept: "video/*" };\nexport const X = () => <h1>Dépôt de contenu</h1>;';
    expect(astTexts(src)).toContain("Dépôt de contenu");
  });
});

describe("détecteur i18n — passe syntaxique : ce qui est RENDU", () => {
  it("voit un mot seul, sans accent, entre balises", () => {
    expect(astTexts("const X = () => <Button>\n  <Icon />\n  Copier\n</Button>;")).toEqual(["Copier"]);
  });

  it("voit un mot seul dans un ternaire rendu", () => {
    expect(astTexts('const X = () => <p>{ro ? "Avancement" : t("mine")}</p>;')).toEqual([
      "Avancement",
    ]);
  });

  it("voit un attribut de libellé hors de la liste connue", () => {
    expect(astTexts('const X = () => <Card badge="Lien" variant="outline" />;')).toEqual(["Lien"]);
  });

  it("voit le fragment de template et le texte voisin d'une interpolation", () => {
    expect(astTexts("const X = () => <b title={`${a} · entre ${b}`}>+ {m} débloqués</b>;")).toEqual(
      expect.arrayContaining(["· entre", "débloqués"]),
    );
  });

  it("n'entre pas dans un appel, une comparaison ni un index", () => {
    expect(
      astTexts(
        'const X = () => <p className={cn("Grand", x)}>{t("Titre")}{s === "Actif" ? n : m}{L["Clé"]}</p>;',
      ),
    ).toEqual([]);
  });

  it("ignore les attributs techniques et les jetons", () => {
    expect(
      astTexts(
        'const X = () => <iframe allow="autoplay; encrypted-media" src="/x" data-state="Open" style={{ a: "var(--r)" }} />;',
      ),
    ).toEqual([]);
  });

  it("respecte l'exemption ligne à ligne", () => {
    expect(
      astTexts("const X = () => (\n  <p>\n    {/* i18n-exempt: marque */}\n    TikTok\n  </p>\n);"),
    ).toEqual([]);
  });
});

describe("détecteur i18n — tables de libellés et locale date-fns", () => {
  it("voit une table de libellés d'un mot (`WEEKDAYS`)", () => {
    expect(astTexts('const W = ["Lun", "Mar", "Mer"];\nconst X = () => <p>{W[0]}</p>;')).toEqual([
      "Lun",
      "Mar",
      "Mer",
    ]);
  });

  it("laisse passer une liste de plateformes", () => {
    expect(astTexts('const P = ["TikTok", "Instagram", "YouTube"] as const;')).toEqual([]);
  });

  it("refuse une locale date-fns importée en dur", () => {
    expect(astTexts('import { fr } from "date-fns/locale";')).toHaveLength(1);
  });
});

// ─── Variables ICU (2026-09-14) ──────────────────────────────────────────────
import { icuArgs } from "./i18n-icu.mjs";

const argsOf = (m) => Object.fromEntries([...icuArgs(m)].map(([k, v]) => [k, [...v].sort()]));

describe("icuArgs — les variables d'un message, pas ses branches", () => {
  it("ne prend pas une branche d'un seul mot pour une variable", () => {
    // `{ligne}` a exactement la forme d'une variable simple : c'est ce qu'une
    // regex confondait.
    expect(argsOf("{n} {n, plural, one {ligne} other {lignes}} de paie")).toEqual({
      n: ["plural", "simple"],
    });
  });

  it("descend dans les branches imbriquées", () => {
    expect(
      argsOf("{unit, select, days {{count, plural, one {# jour} other {# jours}}} other {{name}}}"),
    ).toEqual({ unit: ["select"], count: ["plural"], name: ["simple"] });
  });

  it("ignore les accolades citées", () => {
    expect(argsOf("Tape '{'nom'}' puis {valeur}")).toEqual({ valeur: ["simple"] });
  });
});
