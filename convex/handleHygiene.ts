/**
 * AUDIT du pseudo d'un compte déclaré — aide à la décision, JAMAIS un gate.
 *
 * Module PUR (aucun import `_generated`) → une seule définition, importable
 * serveur, client et depuis `lib/` pour les tests. Même patron que
 * `convex/accountPhase.ts` et `convex/roles.ts` — pas de paire `lib/` à
 * surveiller par un test de parité.
 *
 * ─── POURQUOI ────────────────────────────────────────────────────────────────
 * Un pseudo qui annonce la marque ou le talent est un compte publicitaire
 * déclaré : le viewer le lit en une seconde et le hook ne peut plus fonctionner.
 * Mais c'est un JUGEMENT HUMAIN — « snytchfan » n'est pas « snytch_officiel », et
 * un talent qui s'appelle « Marine » ne rend pas « marine.bn07 » suspect au même
 * titre. On signale, l'admin tranche. Aucun appelant ne doit transformer ce
 * retour en refus automatique.
 */

/** Ce que l'audit a repéré. Aucun verdict : deux constats, pas une décision. */
export interface HandleAudit {
  /** Le pseudo contient un des noms du produit. */
  mentionsProduct: string | null;
  /** Le pseudo contient le nom d'un talent du projet. */
  mentionsTalent: string | null;
}

/**
 * Forme comparable d'une chaîne : minuscules, accents retirés, et surtout
 * SÉPARATEURS SUPPRIMÉS.
 *
 * Les séparateurs sont exactement ce qu'un pseudo utilise pour disperser un mot
 * (`s.n.y.t.c.h`, `snytch_off`, `snytch-fr`). Comparer sans les retirer laisserait
 * passer la moitié des cas que l'audit existe pour attraper.
 */
function comparable(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Un terme est-il assez long pour être cherché ? En dessous de 3 caractères, une
 * sous-chaîne se retrouve partout par accident (un talent prénommé « Ana »
 * signalerait « banana.clips ») et l'audit ne serait plus lu.
 */
const MIN_TERM_LENGTH = 3;

/**
 * Formes cherchables d'un terme : le terme ENTIER **et chacun de ses mots**.
 *
 * Un talent est enregistré sous son nom complet (« Marine Dupont »), alors qu'un
 * pseudo n'en reprend qu'un morceau (« @marine.bn07 »). Ne chercher que la chaîne
 * entière rendait l'audit muet sur le cas le plus courant — défaut invisible tant
 * qu'on ne le teste qu'avec des prénoms nus.
 *
 * Les jetons purement NUMÉRIQUES sont écartés : une suite de chiffres dans un nom
 * ne désigne rien, et elle collerait au hasard sur n'importe quel pseudo qui en
 * contient.
 */
function searchableTokens(term: string): { affiche: string; cle: string }[] {
  const out: { affiche: string; cle: string }[] = [];
  const pousser = (affiche: string) => {
    const cle = comparable(affiche);
    if (cle.length < MIN_TERM_LENGTH) return;
    if (/^\d+$/.test(cle)) return;
    if (out.some((o) => o.cle === cle)) return;
    out.push({ affiche, cle });
  };
  pousser(term);
  for (const mot of term.split(/[\s,;/|]+/)) pousser(mot);
  return out;
}

/**
 * Premier jeton trouvé dans le pseudo. Rend le JETON, pas le terme d'origine :
 * annoncer « contient “Marine Dupont” » sur un pseudo qui ne dit que « marine »
 * ferait douter de l'audit.
 */
function findTerm(haystack: string, terms: readonly string[]): string | null {
  for (const term of terms) {
    for (const { affiche, cle } of searchableTokens(term)) {
      if (haystack.includes(cle)) return affiche;
    }
  }
  return null;
}

/**
 * Audite un pseudo contre les noms du produit et ceux des talents du projet.
 *
 * `productNames` : le nom du projet et son slug (« Snytch », « snytch »), pas une
 * liste saisie — une liste à maintenir à la main serait périmée au premier
 * renommage.
 */
export function auditCompteHandle(
  handle: string,
  ctx: { productNames: readonly string[]; talentNames: readonly string[] },
): HandleAudit {
  const h = comparable(handle);
  return {
    mentionsProduct: findTerm(h, ctx.productNames),
    mentionsTalent: findTerm(h, ctx.talentNames),
  };
}

/** L'audit a-t-il quelque chose à dire ? (sinon l'écran n'affiche rien). */
export function hasHandleWarning(audit: HandleAudit): boolean {
  return audit.mentionsProduct !== null || audit.mentionsTalent !== null;
}

/**
 * Phrase d'avertissement, ou `null` si rien à signaler. Formulée comme une
 * observation et sa conséquence — jamais comme un refus, que l'admin seul décide.
 */
export function handleWarningMessage(audit: HandleAudit): string | null {
  if (audit.mentionsProduct !== null) {
    return `Ce pseudo contient « ${audit.mentionsProduct} » : un compte qui annonce la marque se lit en une seconde, et le hook ne peut plus fonctionner.`;
  }
  if (audit.mentionsTalent !== null) {
    return `Ce pseudo contient « ${audit.mentionsTalent} », le nom d'un talent : le compte est rattachable à sa personne.`;
  }
  return null;
}
