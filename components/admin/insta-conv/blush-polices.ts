/**
 * Les polices du chat BLUSH — Nunito (l'interface) et Figtree (les vrais
 * messages, cités ou à envoyer) —, servies par Jarvia (`public/fonts/blush`,
 * licence SIL OFL 1.1), découpées par alphabet comme dans l'app BLUSH.
 *
 * À l'écran, une feuille `@font-face` ordinaire. À l'EXPORT, la capture se
 * rastérise dans une image SVG qui ne charge aucune ressource : les fichiers
 * y sont donc embarqués en data URL (`cssPolicesEmbarquees`), sinon le PNG
 * sortirait en police système.
 */

export const NUNITO = "'Blush Nunito', system-ui, sans-serif"; // i18n-exempt: pile de polices CSS
export const FIGTREE = "'Blush Figtree', system-ui, sans-serif"; // i18n-exempt: pile de polices CSS

const LATIN = // i18n-exempt: plages Unicode CSS (celles de Google Fonts)
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT = // i18n-exempt: plages Unicode CSS (celles de Google Fonts)
  "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF";

const POLICES = [
  { famille: "Blush Nunito", fichier: "nunito-latin-ext.woff2", graisse: "600 900", plage: LATIN_EXT }, // i18n-exempt: nom de police CSS
  { famille: "Blush Nunito", fichier: "nunito-latin.woff2", graisse: "600 900", plage: LATIN }, // i18n-exempt: nom de police CSS
  { famille: "Blush Figtree", fichier: "figtree-latin-ext.woff2", graisse: "700 800", plage: LATIN_EXT }, // i18n-exempt: nom de police CSS
  { famille: "Blush Figtree", fichier: "figtree-latin.woff2", graisse: "700 800", plage: LATIN }, // i18n-exempt: nom de police CSS
] as const;

const DOSSIER = "/fonts/blush/";

function feuille(src: (fichier: string) => string): string {
  return POLICES.map(
    (p) =>
      `@font-face{font-family:"${p.famille}";src:url("${src(p.fichier)}") format("woff2");font-weight:${p.graisse};font-style:normal;font-display:block;unicode-range:${p.plage}}`,
  ).join("\n");
}

/** La feuille de l'écran (fichiers servis par Jarvia). */
export const CSS_POLICES_BLUSH = feuille((f) => DOSSIER + f);

let embarquees: Promise<string> | null = null;

/** La même feuille, fichiers embarqués (une fois par page) : ce que l'export met dans le PNG. */
export function cssPolicesEmbarquees(): Promise<string> {
  embarquees ??= Promise.all(
    POLICES.map(async (p) => {
      const r = await fetch(DOSSIER + p.fichier);
      if (!r.ok) throw new Error(`police ${p.fichier} : ${r.status}`); // i18n-exempt: erreur interne, message générique à l'écran
      const octets = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode(...octets.subarray(i, i + 0x8000));
      return [p.fichier, `data:font/woff2;base64,${btoa(bin)}`] as const;
    }),
  ).then((urls) => {
    const parFichier = new Map<string, string>(urls);
    return feuille((f) => parFichier.get(f) ?? "");
  });
  embarquees.catch(() => (embarquees = null));
  return embarquees;
}
