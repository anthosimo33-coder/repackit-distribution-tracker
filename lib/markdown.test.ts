import { describe, it, expect } from "vitest";
import { sanitizeHref, parseInline, parseMarkdown } from "./markdown";

describe("sanitizeHref", () => {
  it("autorise http / https / mailto / tel", () => {
    expect(sanitizeHref("https://example.com")).toBe("https://example.com");
    expect(sanitizeHref("http://example.com/a?b=1")).toBe(
      "http://example.com/a?b=1",
    );
    expect(sanitizeHref("mailto:hi@repackit.test")).toBe(
      "mailto:hi@repackit.test",
    );
    expect(sanitizeHref("tel:+33123456789")).toBe("tel:+33123456789");
  });

  it("autorise les liens relatifs et ancres", () => {
    expect(sanitizeHref("/app/guide")).toBe("/app/guide");
    expect(sanitizeHref("#section")).toBe("#section");
  });

  it("bloque javascript: (et variantes de casse)", () => {
    expect(sanitizeHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeHref("JavaScript:alert(1)")).toBeNull();
    expect(sanitizeHref("  javascript:alert(1)")).toBeNull();
  });

  it("bloque javascript: obfusqué par des caractères de contrôle", () => {
    expect(sanitizeHref("java\tscript:alert(1)")).toBeNull();
    expect(sanitizeHref("java\nscript:alert(1)")).toBeNull();
    expect(sanitizeHref("\u0000javascript:alert(1)")).toBeNull();
  });

  it("bloque data:, vbscript:, file:", () => {
    expect(sanitizeHref("data:text/html,<script>")).toBeNull();
    expect(sanitizeHref("vbscript:msgbox(1)")).toBeNull();
    expect(sanitizeHref("file:///etc/passwd")).toBeNull();
  });

  it("renvoie null pour une URL vide", () => {
    expect(sanitizeHref("")).toBeNull();
    expect(sanitizeHref("   ")).toBeNull();
  });
});

describe("parseInline", () => {
  it("découpe gras, italique, code et texte", () => {
    expect(parseInline("a **b** c *d* `e`")).toEqual([
      { type: "text", value: "a " },
      { type: "bold", value: "b" },
      { type: "text", value: " c " },
      { type: "italic", value: "d" },
      { type: "text", value: " " },
      { type: "code", value: "e" },
    ]);
  });

  it("gère __gras__ et _italique_", () => {
    expect(parseInline("__x__ _y_")).toEqual([
      { type: "bold", value: "x" },
      { type: "text", value: " " },
      { type: "italic", value: "y" },
    ]);
  });

  it("parse un lien avec href assaini", () => {
    expect(parseInline("[doc](https://a.test)")).toEqual([
      { type: "link", label: "doc", href: "https://a.test" },
    ]);
  });

  it("neutralise un lien javascript: (href null → rendu en texte)", () => {
    expect(parseInline("[x](javascript:bad)")).toEqual([
      { type: "link", label: "x", href: null },
    ]);
  });

  it("ne confond pas **gras** avec *italique*", () => {
    expect(parseInline("**bold**")).toEqual([{ type: "bold", value: "bold" }]);
  });
});

describe("parseMarkdown", () => {
  it("parse les titres #, ##, ###", () => {
    const blocks = parseMarkdown("# T1\n## T2\n### T3");
    expect(blocks).toEqual([
      { type: "heading", level: 1, content: [{ type: "text", value: "T1" }] },
      { type: "heading", level: 2, content: [{ type: "text", value: "T2" }] },
      { type: "heading", level: 3, content: [{ type: "text", value: "T3" }] },
    ]);
  });

  it("parse une liste à puces", () => {
    const blocks = parseMarkdown("- a\n- b");
    expect(blocks).toEqual([
      {
        type: "ul",
        items: [[{ type: "text", value: "a" }], [{ type: "text", value: "b" }]],
      },
    ]);
  });

  it("parse une liste numérotée", () => {
    const blocks = parseMarkdown("1. un\n2. deux");
    expect(blocks).toEqual([
      {
        type: "ol",
        items: [
          [{ type: "text", value: "un" }],
          [{ type: "text", value: "deux" }],
        ],
      },
    ]);
  });

  it("regroupe les lignes consécutives en un paragraphe, séparé par les lignes vides", () => {
    const blocks = parseMarkdown("ligne un\nligne deux\n\nautre para");
    expect(blocks).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", value: "ligne un ligne deux" }],
      },
      { type: "paragraph", content: [{ type: "text", value: "autre para" }] },
    ]);
  });

  it("sépare une liste numérotée d'une liste à puces", () => {
    const blocks = parseMarkdown("1. a\n- b");
    expect(blocks.map((b) => b.type)).toEqual(["ol", "ul"]);
  });

  it("ignore le markdown vide", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n   \n")).toEqual([]);
  });
});
