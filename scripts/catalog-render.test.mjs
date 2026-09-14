import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { icuArgs } from "./i18n-icu.mjs";

/**
 * CHAQUE MESSAGE DOIT SE RENDRE — dans les deux langues.
 *
 * Un message ICU n'est compilé qu'au moment où l'écran l'affiche. Une valeur
 * mal formée ne casse donc ni la compilation, ni les tests unitaires : elle
 * lève EN PRODUCTION, au premier rendu, et emporte l'écran entier.
 *
 * C'est arrivé le 2026-09-14 : « le chemin court snytch.co/<ref> » — next-intl
 * lit `<ref>` comme une balise de texte riche et lève `UNCLOSED_TAG`. Le
 * dashboard d'équipe ne s'affichait plus du tout, et seule la suite e2e l'a vu.
 *
 * Ce test rend TOUTES les valeurs des catalogues (socle + espace d'équipe) avec
 * des paramètres factices. Il ne juge pas le texte, il prouve qu'il se rend.
 */
const ROOT = new URL("..", import.meta.url).pathname;

function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function catalog(locale) {
  const base = JSON.parse(readFileSync(join(ROOT, `messages/${locale}.json`), "utf8"));
  const dir = join(ROOT, `messages/admin/${locale}`);
  const admin = {};
  for (const f of readdirSync(dir)) {
    admin[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, f), "utf8"));
  }
  return { ...base, admin };
}

// Chaque variable du message reçoit « 1 » : un nombre satisfait aussi bien
// `{count}` que `{count, plural, …}`, et une branche `select` retombe sur
// `other`. Les noms viennent du message lui-même (cf `icuArgs`).
const valuesFor = (message) =>
  Object.fromEntries([...icuArgs(message)].map(([name]) => [name, 1]));

describe.each(["fr", "en"])("catalogue %s — tout se rend", (locale) => {
  const messages = catalog(locale);
  const t = createTranslator({ locale, messages });
  const flat = flatten(messages, "", {});
  const keys = Object.keys(flat);

  it(`rend les ${keys.length} messages sans lever`, () => {
    const broken = [];
    for (const key of keys) {
      try {
        const out = t(key, valuesFor(flat[key]));
        // next-intl rend la CLÉ quand il échoue silencieusement.
        if (out === key) broken.push(`${key} → rendu vide / clé brute`);
      } catch (e) {
        broken.push(`${key} → ${String(e.message).slice(0, 120)}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
