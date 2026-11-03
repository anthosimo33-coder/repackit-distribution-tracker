/**
 * Vidéos exemples d'une mission qui CHANGE DE CAMPAGNE (`reecrire_mission`
 * avec `campagne_briques`) — logique pure, testée Vitest
 * (lib/videos-exemples-campagne.test.ts).
 *
 * Les vidéos exemples d'une campagne sont RECOPIÉES sur la mission à
 * l'assignation (#436). Changer le script de campagne sans elles laissait à la
 * créatrice les exemples de l'ancien format : le 03/11, 17 missions passées en
 * « Collage » montraient encore les démos de « Reaction + Demo MUET ».
 *
 * Comparées par URL, comme au rattrapage des vidéos d'une campagne :
 *  - celles de l'ancienne campagne partent, sauf si la nouvelle les a aussi ;
 *  - celles jointes à la main (à aucune des deux campagnes) restent ;
 *  - celles de la nouvelle campagne s'ajoutent à la fin, avec leur id d'origine.
 * Si les ajouts dépasseraient le plafond, rien n'est ajouté (`plafond`) plutôt
 * que tronqué en silence ; les retraits, eux, se font.
 */

export type VideoExemple = {
  id: string;
  url: string;
  title?: string;
  note?: string;
  addedAt: number;
};

export function videosApresChangementDeCampagne(
  mission: readonly VideoExemple[],
  ancienne: readonly VideoExemple[],
  nouvelle: readonly VideoExemple[],
  max: number,
): { next: VideoExemple[]; retirees: number; ajoutees: number; plafond: boolean } {
  const restent = new Set(nouvelle.map((mv) => mv.url));
  const partent = new Set(ancienne.map((mv) => mv.url).filter((url) => !restent.has(url)));
  const gardees = mission.filter((mv) => !partent.has(mv.url));
  const deja = new Set(gardees.map((mv) => mv.url));
  const manquantes = nouvelle.filter((mv) => !deja.has(mv.url));
  const plafond = gardees.length + manquantes.length > max;
  return {
    next: plafond ? gardees : [...gardees, ...manquantes],
    retirees: mission.length - gardees.length,
    ajoutees: plafond ? 0 : manquantes.length,
    plafond,
  };
}
