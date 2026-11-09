/**
 * PAGE SPOTLIGHT DE LA FORME SERVIE DEPUIS LE 02/11/2026 (relevée le 09/11 sur
 * les Spotlight de @thekellychapter) : plus de `__NEXT_DATA__`, un flux RSC en
 * morceaux `self.__next_f.push([1,"…"])` — le premier `push([0])` ouvre le flux.
 *
 * Ce qui fait la forme prod, et que les tests doivent garder :
 * - les morceaux sont coupés N'IMPORTE OÙ, y compris au milieu d'un objet ;
 * - le composant principal porte `videoId` et `video` ; le fil « à suivre »
 *   porte des `"video":{…}` d'AUTRES autrices (id « 35::… », rawSnapId
 *   distinct), aux compteurs bien plus gros ;
 * - compteurs en NOMBRES, horodatage en CHAÎNE, `"$undefined"` en chaîne ;
 * - des accolades dans les légendes (chaînes), qu'un lecteur naïf compterait.
 */

export const ID_KELLY = "W7_EDlXWTBiXAEEniNoMPwAAYb290ZGx4bW5hAaGifpXNAaGiforGAAAAAA";

export type RscVideo = Record<string, unknown> & { id: string; rawSnapId: string };

export function rscVideo(o: {
  id: string;
  rawSnapId?: string;
  username: string;
  viewCount: number;
  likeCount: number;
}): RscVideo {
  return {
    id: o.id,
    rawSnapId: o.rawSnapId ?? o.id,
    postingUsername: o.username,
    postingBusinessProfileId: "eaae23f8-27d3-4eac-991a-5358ea1cd767",
    isAttributed: true,
    creatorName: "Kelly",
    caption: "personne m'avait dit {qu'on} pouvait voir ça sur insta #instagram",
    uploadTimestampMs: "1793458546876",
    posterUrl: "https://bolt-gcdn.sc-cdn.net/br/yDvYX0N4W6WPQI54QJ8pP.256.IRZXSOY?mo=GlAa%3D&uc=46",
    videoUrl: "https://bolt-gcdn.sc-cdn.net/br/yDvYX0N4W6WPQI54QJ8pP.27.IRZXSOY?mo=GmYa%3D&uc=46",
    transcriptUrl: "$undefined",
    viewCount: o.viewCount,
    likeCount: o.likeCount,
    commentCount: 3,
    recommendCount: 23,
    shareCount: 24,
  };
}

/** Le Spotlight de Kelly du 31/10 tel que lu le 09/11 : 12 467 vues, 275 j'aime. */
export const KELLY = rscVideo({
  id: ID_KELLY,
  username: "thekellychapter",
  viewCount: 12_467,
  likeCount: 275,
});

/** Deux vidéos du fil « à suivre », d'autres autrices. */
export const FIL: RscVideo[] = [
  rscVideo({
    id: "35::90affc723e0887e74275::1779672722935",
    rawSnapId: "W7_EDlXWTBiXAEEniNoMPwAAYZHljeXdhbXdpAZ_IEJF8AZ_IEEf6AAAAAw",
    username: "jemmacrawford14",
    viewCount: 31_228_877,
    likeCount: 155_711,
  }),
  rscVideo({
    id: "35::eb5835a7abaf208e9ac6::1781317474759",
    rawSnapId: "W7_EDlXWTBiXAEEniNoMPwAAYc3NjZG1pd2ZxAZ_xrpClAZ_xrdgEAAAAAw",
    username: "shaakilaaaayyes",
    viewCount: 40_458_818,
    likeCount: 3_565_244,
  }),
];

/**
 * HTML d'une page Spotlight. `video: null` = la page servie SANS la vidéo
 * (Spotlight retiré ou pas public). `filDabord` place le fil AVANT le composant
 * principal : lire « la première vidéo venue » rendrait alors celle d'une autre.
 */
export function pageRsc(opts: {
  videoId?: string;
  video?: RscVideo | null;
  fil?: RscVideo[];
  filDabord?: boolean;
}): string {
  const videoId = opts.videoId ?? ID_KELLY;
  const video = opts.video === undefined ? KELLY : opts.video;
  const fil = opts.fil ?? FIL;

  const route =
    "0:" +
    JSON.stringify({
      P: null,
      c: ["", "@thekellychapter", "spotlight", `${videoId}?type=t1&locale=fr_FR`],
      f: [[["", { children: [["videoId", videoId, "d", null], {}] }]]],
    });
  const principal =
    "5:" +
    JSON.stringify([
      "$",
      "main",
      null,
      {
        "data-testid": "spotlight-page",
        children: [
          [
            "$",
            "$L1e",
            null,
            {
              username: "thekellychapter",
              videoId,
              ...(video === null ? {} : { video }),
              context: "$undefined",
              upNext: {
                items: fil.map((v) => ({
                  tile: { id: v.id, viewCount: v.viewCount, likeCount: v.likeCount },
                })),
              },
            },
          ],
        ],
      },
    ]);
  const suite =
    "1f:" + JSON.stringify(["$", "$L20", null, { items: fil.map((v) => ({ video: v })) }]);

  const lignes = opts.filDabord ? [route, suite, principal] : [route, principal, suite];
  const flux = lignes.join("\n") + "\n";

  // Coupures au milieu de NOTRE vidéo (dans son id, puis entre deux compteurs).
  const i = flux.indexOf(`"id":"${videoId}"`);
  const j = flux.indexOf('"likeCount"', Math.max(0, i));
  const coupes = [0, ...(i > 0 ? [i + 9] : []), ...(j > 0 ? [j + 4] : []), flux.length];
  const morceaux = coupes.slice(1).map((fin, k) => flux.slice(coupes[k], fin));

  return (
    `<!DOCTYPE html><html><head><title>Snapchat</title>` +
    `<script id="sc-com-boot" type="application/json">{"runtime":{"stage":"prod"}}</script>` +
    `</head><body><script>(self.__next_f=self.__next_f||[]).push([0])</script>` +
    morceaux
      .map((m) => `<script>self.__next_f.push(${JSON.stringify([1, m])})</script>`)
      .join("") +
    `</body></html>`
  );
}
