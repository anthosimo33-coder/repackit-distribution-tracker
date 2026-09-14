/**
 * Variables d'un message ICU : `Map<nom, Set<type>>` (`simple`, `plural`,
 * `select`…). Un vrai parcours et pas une regex : une branche d'un seul mot
 * (`one {ligne}`) a exactement la forme d'une variable simple.
 */
export function icuArgs(message) {
  const src = String(message);
  const args = new Map();
  const add = (name, type) => {
    if (!args.has(name)) args.set(name, new Set());
    args.get(name).add(type);
  };
  // Parcourt un TEXTE jusqu'à l'accolade fermante qui le termine (ou la fin).
  function text(i) {
    while (i < src.length) {
      const c = src[i];
      if (c === "'" && (src[i + 1] === "{" || src[i + 1] === "}")) {
        const close = src.indexOf("'", i + 1);
        i = close === -1 ? src.length : close + 1;
      } else if (c === "{") i = argument(i + 1);
      else if (c === "}") return i;
      else i++;
    }
    return i;
  }
  // `i` est juste après `{` : nom, puis `}` ou `, type` et ses options.
  function argument(i) {
    const m = /^\s*(\w+)\s*/.exec(src.slice(i));
    if (!m) return i;
    const name = m[1];
    i += m[0].length;
    if (src[i] === "}") {
      add(name, "simple");
      return i + 1;
    }
    if (src[i] !== ",") return i;
    const t = /^,\s*(\w+)\s*/.exec(src.slice(i));
    const type = t ? t[1] : "?";
    i += t ? t[0].length : 1;
    add(name, type);
    if (!/^(plural|select|selectordinal)$/.test(type)) {
      // `{n, number}` : on saute jusqu'à la fermeture.
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
      }
      return i;
    }
    if (src[i] === ",") i++;
    // options : `sélecteur {message}` répétés, jusqu'à `}`.
    while (i < src.length) {
      while (/\s/.test(src[i] ?? "")) i++;
      if (src[i] === "}") return i + 1;
      const sel = /^[^\s{}]+/.exec(src.slice(i));
      if (!sel) return i + 1;
      i += sel[0].length;
      while (/\s/.test(src[i] ?? "")) i++;
      if (src[i] !== "{") return i;
      i = text(i + 1) + 1;
    }
    return i;
  }
  text(0);
  return args;
}
