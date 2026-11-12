/**
 * NOUVEAU RADAR — la langue lue sur le TEXTE À L'ÉCRAN des vidéos d'un compte
 * (leurs textes incrustés, le « hook »). Règles pures, serveur seul.
 *
 * Pourquoi : TikTok ne donne aucune langue à une légende faite de hashtags
 * (« #lycee #bac #knowunity »). Le 12/11/2026, 399 comptes suivis actifs sur
 * 1 980 n'avaient donc aucune langue, et n'étaient dans aucune langue de
 * l'onglet Créateurs — alors que le texte à l'écran de leurs vidéos se lit.
 *
 * Comment : on compte les MOTS-OUTILS propres à chaque langue (« je », « avec »,
 * « the », « pero », « você »…). Les mots communs à plusieurs langues (« de »,
 * « que », « la », « no », « me »…) n'y sont pas : ils ne départagent rien. Une
 * langue l'emporte quand elle a assez de mots à elle et domine nettement la
 * suivante ; sinon, pas de langue (un compte sans langue vaut mieux qu'un compte
 * rangé dans la mauvaise).
 *
 * Mesuré le 12/11/2026 sur les 994 comptes actifs dont TikTok donne la langue
 * et dont on a des vidéos récentes : la règle tranche pour 394, d'accord avec
 * TikTok pour 388 (98,5 %). Des 6 désaccords, 4 sont des erreurs de TikTok (un
 * texte à l'écran tout en français, en anglais ou en espagnol), 2 des comptes
 * qui écrivent en deux langues. Des 399 comptes sans langue, 150 avaient au
 * moins un texte à l'écran relevé : 20 reçoivent une langue (9 le français),
 * relus un par un.
 *
 * Essayé et RETIRÉ ce jour-là : compter aussi les mots-outils d'autres langues
 * (allemand, italien, polonais…) pour écarter un texte qui n'est dans aucune
 * des nôtres. L'italien partage « una », « con », « del » avec l'espagnol :
 * 11 vrais comptes hispanophones ou lusophones n'étaient plus tranchés, pour 3
 * écartés à raison. Ce qui protège, ce sont les seuils ci-dessous.
 *
 * La langue de TikTok reste la première : celle-ci ne sert qu'aux comptes qui
 * n'en ont pas (convex/radarNetworks, le relevé d'un compte).
 */
import { langBucket } from "./radarSignalsMath";

export type TextLang = "fr" | "en" | "es" | "pt";
export const TEXT_LANGS: readonly TextLang[] = ["fr", "en", "es", "pt"];

const words = (s: string): ReadonlySet<string> => new Set(s.split(/\s+/).filter(Boolean));

/**
 * Les mots-outils de chaque langue de l'onglet. Une élision garde son apostrophe
 * (« j' », « qu' », « don' ») : c'est la marque la plus sûre du français, et de
 * l'anglais. N'y sont PAS, exprès : « ai » (« Astra AI »), « comment » (« comment
 * below »), « com » (les adresses), « do » (anglais et portugais), « mais »
 * (français et portugais), « son », « es », « no », « on », « a », « o », « e »,
 * « y ».
 */
const MARKERS: Readonly<Record<TextLang, ReadonlySet<string>>> = {
  fr: words(`
    je il elle nous vous ils elles les une des du et est pas qui pour dans avec mon mes tes ses ce cette ces cet
    quand pourquoi où donc ne très trop au aux sur chez suis sont était faire fait vraiment toujours jamais aussi
    alors comme tout tous toute moi toi lui leur ça être avoir ont à parce sans sous encore déjà peu quoi rien
    chaque votre notre voici voilà meuf mec c' j' l' d' qu' n' t' m' s' jusqu' lorsqu' puisqu'
  `),
  en: words(`
    the and is are was were you your my this that these those with for not what when why how who have had does did
    it its she we they them his her our their be been to of in at if but so because just like can will would should
    about from all i by up out get got know here there than then too very which while after before more most some
    any only also now i' don' it' you' that' can' doesn' didn' what' he' she' we' they' let' isn' won' there' im dont
  `),
  es: words(`
    el los las una unos unas con pero muy también mi mis su sus esto eso ese esa cuando cómo qué quién yo tú él ella
    nosotros ellos ellas usted ustedes del al lo más ya hay soy eres están estoy fue tiene tengo tienes hacer hace
    puede puedes quiero así aquí ahora siempre mucho muchos donde dónde desde hasta sin otro otra cuál porqué
  `),
  pt: words(`
    os um uma é não das na nas pra em muito muita também tudo meu minha seu sua isso isto esse essa quando você
    vocês voce vc eu ele ela eles elas nós já tem têm tenho tinha ter estão estou tá tô foi fazer faz fez pode posso
    quero assim aqui agora sempre onde até sem nem só bem depois então ao aos
  `),
};

/** Les mots d'un texte, en minuscules ; une élision reste entière (« j'ai » → « j' », « ai »). Les adresses sont retirées. */
export function textWords(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/\S+\.[a-z]{2,}\S*/g, " ")
    .replace(/'/g, "' ")
    .split(/[^\p{L}']+/u)
    .filter((w) => w.length > 0 && w !== "'");
}

/**
 * Ce que des textes disent de leur langue : pour chaque langue de l'onglet, ses mots-outils comptés (`fr`, `en`…)
 * et combien de mots-outils DIFFÉRENTS (`kinds`).
 */
export type LangScores = Record<TextLang, number> & { kinds: Record<TextLang, number> };

export function langScores(texts: readonly (string | undefined)[]): LangScores {
  const scores: Record<TextLang, number> = { fr: 0, en: 0, es: 0, pt: 0 };
  const seen: Record<TextLang, Set<string>> = { fr: new Set(), en: new Set(), es: new Set(), pt: new Set() };
  for (const t of texts) {
    if (!t) continue;
    for (const w of textWords(t)) {
      for (const lang of TEXT_LANGS) {
        if (!MARKERS[lang].has(w)) continue;
        scores[lang]++;
        seen[lang].add(w);
      }
    }
  }
  return { ...scores, kinds: { fr: seen.fr.size, en: seen.en.size, es: seen.es.size, pt: seen.pt.size } };
}

/** Il faut au moins ce nombre de mots-outils de la langue : en dessous, trop peu de texte pour trancher. */
export const TEXT_LANG_MIN = 5;
/**
 * Dont au moins ce nombre de mots DIFFÉRENTS : un seul mot répété ne dit rien (le « i » du polonais, « et », se lit
 * comme le « I » de l'anglais ; « for you » répété sur un texte en portugais).
 */
export const TEXT_LANG_MIN_KINDS = 3;
/** Et au moins ce multiple de la langue suivante : un texte à deux langues ne tranche pas. */
export const TEXT_LANG_RATIO = 3;

/** La langue de ces textes, ou rien quand ils ne tranchent pas. */
export function textLang(texts: readonly (string | undefined)[]): TextLang | undefined {
  const scores = langScores(texts);
  const [best, second] = [...TEXT_LANGS].sort((a, b) => scores[b] - scores[a]);
  if (scores[best] < TEXT_LANG_MIN || scores.kinds[best] < TEXT_LANG_MIN_KINDS) return undefined;
  if (scores[best] < TEXT_LANG_RATIO * scores[second]) return undefined;
  return best;
}

/**
 * La langue d'un compte lue sur le texte à l'écran de ses vidéos, dans les langues de l'onglet Créateurs.
 * L'espagnol se coupe en deux marchés, comme partout (radarSignalsMath.langBucket) : l'Espagne quand la
 * plupart de ses vidéos y sont publiées (`regions`, le pays que TikTok donne à chaque vidéo), l'Amérique sinon.
 */
export function screenLang(texts: readonly (string | undefined)[], regions: readonly (string | undefined)[]): "fr" | "en" | "pt" | "es-am" | "es-es" | undefined {
  const lang = textLang(texts);
  if (lang === undefined) return undefined;
  const known = regions.filter((r): r is string => !!r).map((r) => r.toUpperCase());
  const spain = known.filter((r) => r === "ES").length * 2 > known.length;
  const bucket = langBucket(lang, spain ? "ES" : undefined);
  return bucket === "autre" ? undefined : bucket;
}
