/**
 * LES TERMES D'UN BARÈME, vus par les outils MCP `creer_bareme` et
 * `modifier_bareme` (convex/mcpBaremesEdition) — module PUR, testé depuis lib/.
 *
 * Les « termes » sont ce que ces deux outils écrivent, et RIEN d'autre : nom,
 * fixe, nombre de vidéos, CPM, seuil de vues du mois, minimum de vues par vidéo.
 * Les paliers de bonus, le bonus par vidéo et la devise d'un barème existant ne
 * passent pas par ici : ils restent à l'écran Barèmes, et l'écriture ne les
 * touche jamais (cf updatePricingCore, qui laisse en place tout champ absent).
 *
 * La forme JSON de ces termes est ce que le journal garde en `avant`/`apres` :
 * `defaire` ne remet l'avant que si le barème montre encore l'après — jamais
 * d'écrasement d'une modification faite depuis.
 */

/** Les termes écrits par les outils. 0 = aucune condition (seuil, minimum). */
export type TermesBareme = {
  nom: string;
  fixe: number;
  nbVideos: number;
  cpm: number;
  seuilVuesMois: number;
  minVuesParVideo: number;
};

/** Ce qu'une demande de modification change — chaque champ absent reste tel quel. */
export type ChangementsBareme = Partial<TermesBareme>;

/** Les termes d'un document `pricings` (forme minimale : pas d'import `_generated`). */
export function termesDe(p: {
  name: string;
  montantFixe: number;
  nbVideosCible: number;
  tauxCPM: number;
  seuilVuesFixe?: number;
  minVuesParVideo?: number;
}): TermesBareme {
  return {
    nom: p.name,
    fixe: p.montantFixe,
    nbVideos: p.nbVideosCible,
    cpm: p.tauxCPM,
    seuilVuesMois: Math.max(0, p.seuilVuesFixe ?? 0),
    minVuesParVideo: Math.max(0, p.minVuesParVideo ?? 0),
  };
}

/** Les termes après la demande : ce qui n'est pas demandé ne bouge pas. */
export function appliquerChangements(t: TermesBareme, c: ChangementsBareme): TermesBareme {
  return {
    nom: c.nom !== undefined ? c.nom.trim() : t.nom,
    fixe: c.fixe ?? t.fixe,
    nbVideos: c.nbVideos ?? t.nbVideos,
    cpm: c.cpm ?? t.cpm,
    seuilVuesMois: c.seuilVuesMois ?? t.seuilVuesMois,
    minVuesParVideo: c.minVuesParVideo ?? t.minVuesParVideo,
  };
}

/**
 * Les termes vers les champs du cœur d'écriture. Le seuil et le minimum sont
 * TOUJOURS envoyés (0 = retiré) : absents, `validatePricingFields` les
 * effacerait — ne changer que le CPM ferait tomber le minimum.
 */
export function versChampsPricing(t: TermesBareme) {
  return {
    name: t.nom,
    montantFixe: t.fixe,
    nbVideosCible: t.nbVideos,
    tauxCPM: t.cpm,
    seuilVuesFixe: t.seuilVuesMois,
    minVuesParVideo: t.minVuesParVideo,
  };
}

/** JSON à clés fixes — l'empreinte comparée par `defaire`. */
export function empreinteTermes(t: TermesBareme): string {
  return JSON.stringify([t.nom, t.fixe, t.nbVideos, t.cpm, t.seuilVuesMois, t.minVuesParVideo]);
}

/** Relit une empreinte écrite par `empreinteTermes`. */
export function termesDepuisEmpreinte(s: string): TermesBareme {
  const [nom, fixe, nbVideos, cpm, seuilVuesMois, minVuesParVideo] = JSON.parse(s) as [
    string,
    number,
    number,
    number,
    number,
    number,
  ];
  return { nom, fixe, nbVideos, cpm, seuilVuesMois, minVuesParVideo };
}

const nombre = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** Les termes en clair, dans la devise du barème (code ISO, `null` = inconnue). */
export function termesLisibles(t: TermesBareme, devise: string | null) {
  const D = devise ? ` ${devise.toUpperCase()}` : "";
  const parVideo = t.nbVideos > 0 ? t.fixe / t.nbVideos : 0;
  return {
    nom: t.nom,
    fixe: t.fixe > 0 ? `${nombre(t.fixe)}${D} pour ${t.nbVideos} vidéos (${nombre(parVideo)}${D} par vidéo)` : "aucun",
    cpm: t.cpm > 0 ? `${nombre(t.cpm)}${D} pour 1 000 vues` : "aucun",
    seuilVuesMois: t.seuilVuesMois > 0 ? `fixe dû à partir de ${nombre(t.seuilVuesMois)} vues cumulées dans le mois` : "aucun",
    minimumParVideo:
      t.minVuesParVideo > 0
        ? `une vidéo touche son fixe à partir de ${nombre(t.minVuesParVideo)} vues`
        : "aucun",
  };
}

/** Ce qui change, terme par terme, en une phrase courte chacun. */
export function differences(avant: TermesBareme, apres: TermesBareme, devise: string | null): string[] {
  const D = devise ? ` ${devise.toUpperCase()}` : "";
  const out: string[] = [];
  const vues = (n: number) => (n > 0 ? `${nombre(n)} vues` : "aucun");
  if (avant.nom !== apres.nom) out.push(`nom : « ${avant.nom} » → « ${apres.nom} »`);
  if (avant.fixe !== apres.fixe) out.push(`fixe : ${nombre(avant.fixe)}${D} → ${nombre(apres.fixe)}${D}`);
  if (avant.nbVideos !== apres.nbVideos) out.push(`vidéos du forfait : ${avant.nbVideos} → ${apres.nbVideos}`);
  if (avant.cpm !== apres.cpm) out.push(`CPM : ${nombre(avant.cpm)}${D} → ${nombre(apres.cpm)}${D}`);
  if (avant.seuilVuesMois !== apres.seuilVuesMois) {
    out.push(`seuil du mois : ${vues(avant.seuilVuesMois)} → ${vues(apres.seuilVuesMois)}`);
  }
  if (avant.minVuesParVideo !== apres.minVuesParVideo) {
    out.push(`minimum par vidéo : ${vues(avant.minVuesParVideo)} → ${vues(apres.minVuesParVideo)}`);
  }
  return out;
}

/**
 * La modification touche-t-elle ce qui est FIGÉ sur les vidéos à
 * l'attribution ? (tout sauf le nom). Sur un barème déjà attribué, ses vidéos
 * gardent les anciens termes : l'outil le dit, et renvoie vers `changer_bareme`.
 */
export function toucheLesTermesFiges(avant: TermesBareme, apres: TermesBareme): boolean {
  return differences({ ...avant, nom: "" }, { ...apres, nom: "" }, null).length > 0;
}
