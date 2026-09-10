import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { isoCountryLabel } from "./country-name";

/**
 * CODES PAYS → NOMS EN CLAIR.
 *
 * Whop rend `billing_address.country` en ISO 3166-1 alpha-2 — mesuré sur les 319
 * paiements couverts du 30/08 : onze valeurs, toutes de longueur 2. La doc de
 * l'API ne le spécifiait pas ; c'est l'observation qui tranche.
 *
 * La correspondance vient d'`Intl.DisplayNames`, adossé à ICU : aucune liste
 * écrite à la main à maintenir, et les territoires gardent leur identité — « RE »
 * est La Réunion et non la France, « MQ » la Martinique. Ils n'ont pas le même
 * marché que la métropole et doivent rester séparés.
 *
 * Un code inconnu s'affiche BRUT : mieux vaut « XK » qu'un vide, qui se lirait
 * comme une donnée manquante alors que le pays est bien là.
 */
describe("isoCountryLabel", () => {
  it("traduit les onze codes réellement observés en prod", () => {
    expect(isoCountryLabel("FR")).toBe("France");
    expect(isoCountryLabel("CH")).toBe("Suisse");
    expect(isoCountryLabel("BE")).toBe("Belgique");
    expect(isoCountryLabel("CA")).toBe("Canada");
    expect(isoCountryLabel("MA")).toBe("Maroc");
    expect(isoCountryLabel("LU")).toBe("Luxembourg");
    expect(isoCountryLabel("US")).toBe("États-Unis");
    expect(isoCountryLabel("MC")).toBe("Monaco");
    expect(isoCountryLabel("ID")).toBe("Indonésie");
  });

  it("les territoires restent DISTINCTS de la métropole", () => {
    // Exigence produit : La Réunion et la Martinique n'ont pas le même marché.
    expect(isoCountryLabel("RE")).toBe("La Réunion");
    expect(isoCountryLabel("MQ")).toBe("Martinique");
    expect(isoCountryLabel("RE")).not.toBe(isoCountryLabel("FR"));
    expect(isoCountryLabel("MQ")).not.toBe(isoCountryLabel("FR"));
  });

  it("un code inconnu s'affiche BRUT, jamais vide", () => {
    // Codes NON ATTRIBUÉS de la norme. Attention en choisissant l'exemple :
    // « XK » a l'air libre mais ICU le résout en « Kosovo » — vérifié.
    expect(isoCountryLabel("QQ")).toBe("QQ");
    expect(isoCountryLabel("ZY")).toBe("ZY");
  });

  it("une entrée mal formée ne fait pas planter l'écran", () => {
    // `Intl.DisplayNames.of` lève un RangeError sur « F », « FRA », « 12 ».
    expect(isoCountryLabel("F")).toBe("F");
    expect(isoCountryLabel("FRA")).toBe("FRA");
    expect(isoCountryLabel("12")).toBe("12");
  });

  it("la casse de la donnée n'empêche pas la résolution", () => {
    // On stocke la valeur BRUTE de Whop ; si elle arrivait en minuscules un
    // jour, l'écran ne doit pas afficher « fr ».
    expect(isoCountryLabel("fr")).toBe("France");
    expect(isoCountryLabel(" fr ")).toBe("France");
  });

  it("absence de valeur → libellé explicite, pas une chaîne vide", () => {
    expect(isoCountryLabel(null)).toBe("Pays non renseigné");
    expect(isoCountryLabel(undefined)).toBe("Pays non renseigné");
    expect(isoCountryLabel("")).toBe("Pays non renseigné");
  });
});

/**
 * LE PIÈGE DES DEUX VOCABULAIRES.
 *
 * Les codes langue et les codes pays se ressemblent : « fr » est une langue ET
 * le code de la France. `isoCountryLabel("fr")` rend donc « France », et
 * `isoCountryLabel("en")` rend « EN ». Appliquer cette fonction au tableau des
 * LANGUES afficherait « France » en face du trafic francophone — un libellé
 * faux qui ne se verrait pas, puisqu'il est plausible.
 *
 * D'où le libellé passé PAR CARTE et non appliqué globalement.
 */
describe("isoCountryLabel — ne pas confondre langue et pays", () => {
  it("« fr » est lu comme la FRANCE, pas comme une langue", () => {
    // Ce test ne demande pas de changer le comportement : il DOCUMENTE le piège
    // et échouerait si quelqu'un croyait pouvoir appliquer isoCountryLabel partout.
    expect(isoCountryLabel("fr")).toBe("France");
    expect(isoCountryLabel("en")).toBe("EN");
  });

  it("un nom déjà en clair traverse intact — le repli sur le nom PostHog", () => {
    // La requête prend le code ISO avec repli sur le nom : si le code n'est pas
    // peuplé, un nom anglais arrive ici et doit ressortir tel quel.
    expect(isoCountryLabel("Belgium")).toBe("Belgium");
    expect(isoCountryLabel("Switzerland")).toBe("Switzerland");
    expect(isoCountryLabel("United Arab Emirates")).toBe("United Arab Emirates");
    expect(isoCountryLabel("(inconnu)")).toBe("(inconnu)");
  });
});

/**
 * GARDE — aucun composant ne rend un code pays brut.
 *
 * Le défaut vécu : le dépliable affichait « FR, RS, BE, BA, CH, MK » dans le
 * groupe « par pays de connexion », parce que le rendu décidait de traduire en
 * reniflant un préfixe de clé React. Écrit quand ces pays étaient des NOMS
 * anglais, ce test est devenu faux le jour où la requête est passée au CODE ISO
 * — et rien ne l'a signalé.
 *
 * La règle tenue ici : un champ portant un code pays ne s'affiche pas
 * directement. Soit il est humanisé dans le module pur (lib/day-detail), soit le
 * composant appelle `isoCountryLabel`.
 *
 * ⚠️ Et JAMAIS sur les langues : « fr » y rendrait « France ».
 */
describe("garde-fou : aucun code pays brut à l'écran", () => {
  const ROOT = process.cwd();
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".tsx")) out.push(p);
    }
    return out;
  }
  /**
   * Un champ pays RENDU comme texte JSX — et non passé en prop.
   *
   * Le `(^|[^=])` est ce qui sépare les deux : `country={country}` passe une
   * prop, `{r.country}` affiche un code. Sans lui, la garde criait sur quatre
   * passages de props parfaitement légitimes, et une garde qui crie à tort finit
   * désactivée.
   */
  const CHAMPS = /(^|[^=])\{\s*[\w.]*\b(billingCountry|country)\b\s*\}/;

  it("un champ pays n'est jamais rendu tel quel dans du JSX", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "components"))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!CHAMPS.test(line)) return;
          if (/isoCountryLabel\(|countryLabel\(|countryFlag\(/.test(line)) return;
          offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1} — ${line.trim()}`);
        });
    }
    expect(
      offenders,
      `Codes pays rendus bruts :\n  ${offenders.join("\n  ")}\n` +
        `Passe par isoCountryLabel (lib/country-name), ou humanise dans le module pur.`,
    ).toEqual([]);
  });

  it("la carte des LANGUES ne reçoit aucun libellé pays", () => {
    // Contrôle OPPOSÉ : « fr » y deviendrait « France », « en » « EN ».
    const src = readFileSync(
      join(ROOT, "components/analytics/hub/ParcoursTab.tsx"),
      "utf8",
    );
    const i = src.indexOf('title="Trafic par langue"');
    expect(i, "carte des langues introuvable").toBeGreaterThan(-1);
    const carte = src.slice(i, src.indexOf("/>", i));
    expect(carte).not.toContain("libelle");
    expect(carte).not.toContain("isoCountryLabel");
  });

  it("la carte des PAYS, elle, en reçoit un", () => {
    const src = readFileSync(
      join(ROOT, "components/analytics/hub/ParcoursTab.tsx"),
      "utf8",
    );
    const i = src.indexOf('title="Trafic par pays de connexion"');
    const carte = src.slice(i, src.indexOf("/>", i));
    expect(carte).toContain("libelle={isoCountryLabel}");
  });
});
