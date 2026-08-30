/**
 * CODES PAYS → NOMS EN CLAIR, monde OUVERT.
 *
 * ⚠️ À NE PAS CONFONDRE avec `countryLabel` de `lib/countries`, qui sert les
 * SÉLECTEURS ADMIN : liste FERMÉE de dix pays, avec drapeau, tenue en phase avec
 * `convex/countries.SUPPORTED_COUNTRIES` qui la valide côté serveur. Elle rend
 * le code brut pour tout ce qui n'y figure pas — c'est-à-dire la plupart des
 * pays vus par l'analytics (BE, CH, RS, BA, MK…). D'où deux fonctions, et deux
 * noms distincts pour qu'on n'importe pas l'une pour l'autre.
 *
 * Whop rend `billing_address.country` en ISO 3166-1 alpha-2. La doc de l'API ne
 * le spécifiait pas (`string | null`, sans exemple) : c'est la MESURE qui a
 * tranché — sur les 319 paiements couverts du 30/08, onze valeurs distinctes,
 * toutes de longueur 2.
 *
 * La correspondance vient d'`Intl.DisplayNames`, adossé à ICU et livré avec le
 * runtime : aucune liste à écrire ni à maintenir, et elle suit les évolutions du
 * standard sans qu'on y touche.
 *
 * DEUX CHOIX QUI COMPTENT :
 *
 *  - les TERRITOIRES gardent leur identité. « RE » rend « La Réunion » et non
 *    « France », « MQ » rend « Martinique ». Ils n'ont pas le même marché que la
 *    métropole et doivent se lire séparément — les replier sur FR effacerait
 *    précisément ce qu'on veut voir ;
 *  - un code INCONNU s'affiche BRUT. « XK » vaut mieux qu'un vide, qui se
 *    lirait comme une donnée manquante alors que le pays est bien là.
 */

/** Résolveur ICU, construit une fois — l'instancier par ligne coûte cher. */
let resolver: Intl.DisplayNames | null = null;
function displayNames(): Intl.DisplayNames | null {
  if (resolver === null) {
    try {
      resolver = new Intl.DisplayNames(["fr"], { type: "region" });
    } catch {
      return null; // runtime sans ICU : on retombera sur le code brut
    }
  }
  return resolver;
}

/** Libellé lisible d'un code pays ISO 3166-1 alpha-2. */
export function isoCountryLabel(code: string | null | undefined): string {
  const brut = (code ?? "").trim();
  if (brut === "") return "Pays non renseigné";
  const dn = displayNames();
  if (dn === null) return brut;
  try {
    // `of` exige deux lettres MAJUSCULES : « fr » rendrait « fr » tel quel, et
    // « F » / « FRA » / « 12 » lèvent un RangeError.
    const nom = dn.of(brut.toUpperCase());
    // ICU rend DÉJÀ le code lui-même pour un code non attribué (« QQ » → « QQ »).
    // Ce repli est donc défensif, pas porteur : ce qui protège réellement, c'est
    // le `catch` — `of` lève un RangeError sur « F », « FRA » ou « 12 ».
    return nom !== undefined && nom !== "" ? nom : brut;
  } catch {
    return brut;
  }
}
