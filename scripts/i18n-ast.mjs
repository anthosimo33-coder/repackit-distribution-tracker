/**
 * PASSE SYNTAXIQUE DU DÉTECTEUR i18n — le texte RENDU, lu par le compilateur
 * TypeScript plutôt que par des expressions régulières.
 *
 * POURQUOI ELLE EXISTE. Le 2026-09-14, un balayage de l'espace créatrice en
 * anglais a trouvé une dizaine de libellés français que la garde déclarait
 * absents (175/175 fichiers « extraits ») :
 *
 *   - un écran ENTIER (`FichiersScreen`) : la ligne `accept: "video/*,image/*"`
 *     contient `/*`, que le retrait des commentaires prenait pour l'ouverture
 *     d'un bloc jamais refermé — tout le reste du fichier devenait invisible ;
 *   - « Je commence », « Copier » : du texte JSX d'un seul mot, sans accent ;
 *   - `{readOnly ? "Avancement" : …}` : un mot seul dans un ternaire ;
 *   - `badge="Lien"` : un attribut de libellé hors de la liste connue.
 *
 * Chaque trou se bouchait par une regex de plus, et chaque regex a ouvert le
 * suivant. Un arbre syntaxique ne confond ni une chaîne avec un commentaire, ni
 * un générique avec une balise : il sait ce qui est RENDU.
 *
 * CE QUI EST SIGNALÉ — trois positions, et seulement elles :
 *   1. le texte JSX entre balises ;
 *   2. un littéral qui ARRIVE dans le rendu depuis une accolade JSX, en
 *      traversant ternaires, `&&`, `||`, `??`, parenthèses et templates — mais
 *      jamais un appel (`t("…")`, `cn("…")`), une comparaison ou un index ;
 *   3. la valeur littérale d'un attribut JSX qui n'est pas technique.
 *
 * Le critère est `isDisplayText` : du TEXTE, pas une langue. Dans un périmètre
 * traduit, un libellé en dur est une faute quelle que soit sa langue — seules
 * les marques et la donnée s'exemptent, ligne à ligne.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

/**
 * Attributs dont la valeur n'est jamais de la copie. Liste FERMÉE : un attribut
 * inconnu est présumé afficher son texte (`badge=`, `body=`, `emptyLabel=`) —
 * se tromper en signalant coûte une exemption, se tromper en taisant coûte un
 * écran français.
 */
const TECHNICAL_ATTR = new Set([
  "className", "key", "href", "src", "id", "type", "name", "variant", "size",
  "side", "align", "role", "target", "rel", "htmlFor", "accept", "inputMode",
  "autoComplete", "mode", "orientation", "method", "lang", "dir", "as", "value",
  "defaultValue", "sizes", "loading", "decoding", "tabIndex", "form", "pattern",
  "allow", "referrerPolicy", "sandbox", "fill", "stroke", "viewBox", "d",
  "xmlns", "points", "transform", "fillRule", "clipRule", "strokeLinecap",
  "strokeLinejoin", "locale", "currency", "format", "platform", "status",
  "icon", "color", "tone", "kind", "testId", "sideOffset", "step", "min", "max",
  "width", "height", "encType", "action", "slot", "path", "route", "accent",
  "position", "placement", "justify", "items", "gap", "cols", "wrap",
  "labelKey", "i18nKey", "namespace", "defaultChecked", "enterKeyHint",
  "capture", "crossOrigin", "download", "media", "poster", "preload",
]);

const isTechnicalAttr = (name) =>
  TECHNICAL_ATTR.has(name) ||
  /^(data-|aria-(hidden|live|current|controls|expanded|haspopup|describedby|labelledby|selected|checked|pressed|disabled|invalid|atomic|busy|modal|orientation|sort))/.test(
    name,
  ) ||
  /(ClassName|Class|Id|Key|Href|Url|Src|Variant|Size|Mode|Type)$/.test(name);

/**
 * Est-ce du texte d'interface ? Mêmes exclusions que la garde historique, plus
 * celles qu'un littéral d'attribut rend nécessaires (couleurs, dimensions,
 * sélecteurs).
 */
export function isDisplayText(v) {
  const t = String(v).replace(/\s+/g, " ").trim();
  if (t.length < 2) return false;
  if (!/[A-Za-zÀ-ÿ]{2}/.test(t)) return false;
  if (/^&[a-z]+;$/i.test(t)) return false;
  if (/^(https?:|mailto:|\/|#[0-9a-f]{3,8}$|var\(|calc\(|rgba?\(|env\()/i.test(t)) return false;
  // Identifiant technique : pas d'espace, et ni majuscule initiale ni accent.
  if (!/\s/.test(t) && !/^[A-ZÀ-Ý]/.test(t) && !/[À-ÿ]/.test(t)) return false;
  // Suite de classes utilitaires ou de jetons en minuscules.
  if (/^[a-z0-9\s:_/[\]().%#,;\-]+$/.test(t) && !/[À-ÿ]/.test(t)) return false;
  // Format de date / motif (`yyyy-MM-dd`, `HH:mm`).
  if (/^[yMdHhms\s:/.\-]+$/.test(t)) return false;
  return true;
}

const EXEMPT_RE = /(?:\/\/|\{?\/\*)\s*i18n-exempt:\s*\S+/;

/**
 * Littéraux qui ARRIVENT dans le rendu depuis `node`. On descend dans ce qui
 * transmet sa valeur telle quelle ; on s'arrête sur tout ce qui la transforme
 * ou la consomme (appel, comparaison, accès, objet, fonction).
 */
function renderedLiterals(node, out) {
  if (!node) return;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push(node);
  } else if (ts.isTemplateExpression(node)) {
    out.push(node.head);
    for (const span of node.templateSpans) {
      out.push(span.literal);
      renderedLiterals(span.expression, out);
    }
  } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    renderedLiterals(node.expression, out);
  } else if (ts.isConditionalExpression(node)) {
    renderedLiterals(node.whenTrue, out);
    renderedLiterals(node.whenFalse, out);
  } else if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      renderedLiterals(node.right, out);
    } else if (
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.PlusToken
    ) {
      renderedLiterals(node.left, out);
      renderedLiterals(node.right, out);
    }
  }
}

/**
 * Libellés en dur d'un fichier `.tsx`, dans les trois positions de l'en-tête.
 * Rend `{ line, text }`, lignes numérotées à partir de 1.
 */
export function astFindings(src, fileName = "x.tsx") {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = src.split("\n");
  const found = [];
  const push = (node, raw) => {
    const text = String(raw).replace(/\s+/g, " ").trim();
    if (!isDisplayText(text)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    if (EXEMPT_RE.test(lines[line] ?? "") || EXEMPT_RE.test(lines[line - 1] ?? "")) return;
    found.push({ line: line + 1, text });
  };

  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      push(node, node.getText(sf));
    } else if (ts.isJsxExpression(node) && node.expression) {
      const parent = node.parent;
      const inChildren = ts.isJsxElement(parent) || ts.isJsxFragment(parent);
      const inAttr = ts.isJsxAttribute(parent) && !isTechnicalAttr(parent.name.getText(sf));
      if (inChildren || inAttr) {
        const lits = [];
        renderedLiterals(node.expression, lits);
        for (const l of lits) push(l, l.text);
      }
    } else if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      !isTechnicalAttr(node.name.getText(sf))
    ) {
      push(node.initializer, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * Retire les commentaires d'une ligne SANS toucher aux chaînes. Rend la ligne
 * nettoyée et l'état « dans un bloc » à reporter sur la suivante.
 *
 * C'est le correctif du trou `accept: "video/*"` : l'ancien retrait cherchait
 * `/*` n'importe où, y compris entre guillemets.
 */
export function stripLineComments(line, inBlock) {
  let out = "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const next = line[i + 1];
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
      } else if (c === quote) {
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && next === "*") {
      // `{/* … */}` : on retire aussi l'accolade ouvrante collée.
      if (out.endsWith("{")) out = out.slice(0, -1);
      inBlock = true;
      i++;
      continue;
    }
    if (c === "/" && next === "/") break;
    out += c;
  }
  return { code: out, inBlock };
}
