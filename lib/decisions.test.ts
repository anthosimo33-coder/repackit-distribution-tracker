/**
 * Moteur de décision du dashboard (`convex/decisions.ts`).
 *
 * Les entrées ont la forme de la prod : des vues à 4-5 chiffres qui ne tombent
 * pas rondes, des taux voisins des seuils, des handles suffixés, et des dates
 * ancrées sur un soir de relevé (23h30 Paris) plutôt que sur « maintenant ».
 */
import { describe, it, expect } from "vitest";
import {
  detectOpenDoor,
  detectDeadHooks,
  detectAccountAlarms,
  verdictOf,
  likeRateTone,
  saveRateTone,
  accountStateOf,
  rateOf,
  computeDelta24h,
  computeFollowersDelta,
  freshestReading,
  type PostSignal,
} from "../convex/decisions";
import {
  OPEN_DOOR_MIN_VIEWS,
  OPEN_DOOR_MIN_LIKE_RATE,
  ACCOUNT_ALARM_RUN_LENGTH,
  ACCOUNT_ALARM_RESCUE_VIEWS,
  PENDING_POST_MAX_AGE_MS,
  savesAvailability,
} from "../convex/decisionThresholds";

const HOUR = 3_600_000;
/** Soir de relevé : 17/08/2026 23h30 Paris = 21:30 UTC. */
const NOW = Date.UTC(2026, 7, 17, 21, 30);

const post = (o: Partial<PostSignal> = {}): PostSignal => ({
  publicationId: "pub_1",
  compte: "@thekellychapters_",
  plateforme: "TikTok",
  creatorId: "cr_kelly",
  creatorName: "Kelly",
  postedAt: NOW - 20 * HOUR,
  vues: 18_432,
  likes: 1_732, // ~9,4 %
  saves: 312,
  delta24h: 6_100,
  followersDelta: 143,
  hookBrickId: "hook_1",
  ...o,
});

describe("detectOpenDoor — les quatre conditions ENSEMBLE", () => {
  it("un post récent qui explose et convertit ouvre la porte", () => {
    const d = detectOpenDoor(post(), NOW);
    expect(d?.kind).toBe("open-door");
    expect(d?.likeRate).toBeCloseTo(1_732 / 18_432, 6);
  });

  it("trop vieux → pas de porte, même excellent", () => {
    expect(detectOpenDoor(post({ postedAt: NOW - 50 * HOUR }), NOW)).toBeNull();
  });

  it("des vues sans engagement, c'est une poussée d'algorithme", () => {
    expect(
      detectOpenDoor(post({ vues: 212_400, likes: 4_100 }), NOW),
    ).toBeNull();
  });

  it("un engagement sans abonnés gagnés ne convertit pas", () => {
    expect(detectOpenDoor(post({ followersDelta: 0 }), NOW)).toBeNull();
  });

  it("saves NON MESURÉES → dormante, jamais satisfaite par défaut", () => {
    // Le cœur du chantier : tant que la collecte ne peuple pas, la décision ne
    // se déclenche PAS. Traiter null comme « franchi » proposerait des frappes
    // sur du vide.
    expect(detectOpenDoor(post({ saves: null }), NOW)).toBeNull();
    // Contre-épreuve : le même post avec la mesure ouvre bien la porte.
    expect(detectOpenDoor(post({ saves: 1 }), NOW)).not.toBeNull();
  });

  it("delta d'abonnés NON MESURÉ → dormante aussi (deux nuits requises)", () => {
    expect(detectOpenDoor(post({ followersDelta: null }), NOW)).toBeNull();
  });

  it("saves mesurées à ZÉRO refusent (c'est une mesure, elle est mauvaise)", () => {
    expect(detectOpenDoor(post({ saves: 0 }), NOW)).toBeNull();
  });

  it("bornes exactes : au seuil ça passe, un cran dessous non", () => {
    const likesAuSeuil = Math.ceil(OPEN_DOOR_MIN_VIEWS * OPEN_DOOR_MIN_LIKE_RATE);
    const pile = post({ vues: OPEN_DOOR_MIN_VIEWS, likes: likesAuSeuil });
    expect(detectOpenDoor(pile, NOW)).not.toBeNull();
    expect(detectOpenDoor({ ...pile, vues: pile.vues - 1 }, NOW)).toBeNull();
    expect(detectOpenDoor({ ...pile, likes: likesAuSeuil - 1 }, NOW)).toBeNull();
  });
});

describe("detectDeadHooks", () => {
  const faible = (hook: string, vues: number, id: string) =>
    post({ hookBrickId: hook, vues, likes: Math.round(vues * 0.03), publicationId: id });

  it("deux runs tous sous le seuil → hook mort", () => {
    const morts = detectDeadHooks([
      faible("hook_mort", 412, "p1"),
      faible("hook_mort", 738, "p2"),
    ]);
    expect(morts).toEqual([
      { kind: "dead-hook", hookBrickId: "hook_mort", runs: 2, bestViews: 738 },
    ]);
  });

  it("UN seul run faible ne condamne pas (hook ≠ hasard d'une sortie)", () => {
    expect(detectDeadHooks([faible("hook_neuf", 220, "p1")])).toEqual([]);
  });

  it("un seul run correct sauve le hook", () => {
    expect(
      detectDeadHooks([
        faible("hook_ok", 412, "p1"),
        faible("hook_ok", 24_800, "p2"),
      ]),
    ).toEqual([]);
  });

  it("les posts sans hook connu sont ignorés", () => {
    expect(detectDeadHooks([post({ hookBrickId: null, vues: 12 })])).toEqual([]);
  });
});

describe("detectAccountAlarms", () => {
  const mauvais = (i: number) =>
    post({ publicationId: `p${i}`, vues: 1_240 + i, likes: 38 + i }); // ~3 %

  it("cinq posts consécutifs sous les seuils → alarme", () => {
    const map = new Map([
      ["@compte_plat", Array.from({ length: 5 }, (_, i) => mauvais(i))],
    ]);
    expect(detectAccountAlarms(map)).toEqual([
      {
        kind: "account-alarm",
        compte: "@compte_plat",
        creatorName: "Kelly",
        streak: 5,
      },
    ]);
  });

  it("quatre suffisent pas", () => {
    const map = new Map([
      ["@compte_plat", Array.from({ length: 4 }, (_, i) => mauvais(i))],
    ]);
    expect(detectAccountAlarms(map)).toEqual([]);
  });

  it("une FENÊTRE ouverte en parallèle annule l'alarme", () => {
    // Le piège que la garde évite : un compte qui cartonne sur une vidéo et
    // rame sur cinq autres n'est pas mourant — l'arrêter serait la mauvaise
    // décision.
    const map = new Map([
      [
        "@compte_mixte",
        [
          ...Array.from({ length: 5 }, (_, i) => mauvais(i)),
          post({ publicationId: "hit", vues: ACCOUNT_ALARM_RESCUE_VIEWS }),
        ],
      ],
    ]);
    expect(detectAccountAlarms(map)).toEqual([]);
    // Contre-épreuve : un cran sous le seuil de sauvetage, l'alarme revient.
    const map2 = new Map([
      [
        "@compte_mixte",
        [
          ...Array.from({ length: 5 }, (_, i) => mauvais(i)),
          post({ publicationId: "presque", vues: ACCOUNT_ALARM_RESCUE_VIEWS - 1, likes: 20 }),
        ],
      ],
    ]);
    expect(detectAccountAlarms(map2)).toHaveLength(1);
  });

  it("la série se lit depuis le PLUS RÉCENT et s'interrompt au premier bon", () => {
    const map = new Map([
      [
        "@compte",
        [
          mauvais(1),
          mauvais(2),
          post({ publicationId: "bon", vues: 8_400, likes: 900 }), // coupe
          mauvais(3),
          mauvais(4),
          mauvais(5),
        ],
      ],
    ]);
    expect(detectAccountAlarms(map)).toEqual([]);
  });

  it("le seuil de série suit ACCOUNT_ALARM_RUN_LENGTH", () => {
    const map = new Map([
      [
        "@c",
        Array.from({ length: ACCOUNT_ALARM_RUN_LENGTH }, (_, i) => mauvais(i)),
      ],
    ]);
    expect(detectAccountAlarms(map)).toHaveLength(1);
  });
});

describe("verdictOf", () => {
  it("un post jeune SANS relevé est « en attente », pas « sous les seuils »", () => {
    // Juger un post de 3 h qui n'a encore aucun relevé le condamnerait avant
    // qu'il ait vécu. `vues: 0` = pas de snapshot (vuesLatest dénormalisé).
    expect(
      verdictOf(post({ postedAt: NOW - 3 * HOUR, vues: 0, likes: 0, saves: null, delta24h: 0 }), NOW),
    ).toBe("pending");
    // Juste au-delà de la borne, même sans relevé, il est jugeable.
    expect(
      verdictOf(
        post({
          postedAt: NOW - PENDING_POST_MAX_AGE_MS - 1,
          vues: 0,
          likes: 0,
          delta24h: 0,
          saves: null,
        }),
        NOW,
      ),
    ).not.toBe("pending");
  });

  it("un post jeune AVEC relevé n'est JAMAIS « en attente » — la donnée parle", () => {
    // Le mensonge d'écran à éliminer : un post de 2 h qu'un relevé manuel montre
    // à 105 000 vues s'affichait « en attente » jusqu'au lendemain 02 h. Avec
    // des vues, tout son delta est récent → « monte », ou « porte ouverte ».
    const jeuneEtEnorme = post({
      postedAt: NOW - 2 * HOUR,
      vues: 105_000,
      likes: 9_800, // 9,3 %
      saves: null, // saves pas encore collectées → pas de porte, mais pas « en attente »
      followersDelta: null,
      delta24h: 105_000,
    });
    expect(verdictOf(jeuneEtEnorme, NOW)).toBe("rising");
    // Même un petit relevé compte : 210 vues à 3 h, tout est récent → monte.
    expect(
      verdictOf(post({ postedAt: NOW - 3 * HOUR, vues: 210, likes: 20, saves: null, delta24h: 210 }), NOW),
    ).toBe("rising");
    // Et si les quatre conditions sont là, la porte s'ouvre malgré l'âge.
    expect(
      verdictOf(post({ postedAt: NOW - 2 * HOUR, vues: 105_000, likes: 9_800, saves: 1_400, followersDelta: 312, delta24h: 105_000 }), NOW),
    ).toBe("open-door");
  });

  it("la porte ouverte prime sur la tendance", () => {
    expect(verdictOf(post(), NOW)).toBe("open-door");
  });

  it("« monte » quand une grosse part des vues est arrivée en 24 h", () => {
    expect(
      verdictOf(
        post({ vues: 40_000, likes: 800, saves: null, delta24h: 15_000 }),
        NOW,
      ),
    ).toBe("rising");
  });

  it("« s'éteint » quand le delta devient marginal", () => {
    expect(
      verdictOf(
        post({ vues: 400_000, likes: 8_000, saves: null, delta24h: 2_000 }),
        NOW,
      ),
    ).toBe("fading");
  });

  it("le MÊME delta absolu monte ou s'éteint selon le volume", () => {
    // C'est pourquoi le seuil est un RATIO : 2 000 vues sur 5 000, c'est une
    // montée ; sur 400 000, c'est l'extinction.
    const petit = post({ vues: 5_000, likes: 100, saves: null, delta24h: 2_000 });
    const gros = post({ vues: 400_000, likes: 8_000, saves: null, delta24h: 2_000 });
    expect(verdictOf(petit, NOW)).toBe("rising");
    expect(verdictOf(gros, NOW)).toBe("fading");
  });

  it("sans delta calculable, on retombe sur le constat de niveau", () => {
    expect(
      verdictOf(post({ vues: 900, likes: 20, saves: null, delta24h: null }), NOW),
    ).toBe("below");
  });
});

describe("teintes de lecture", () => {
  it("like rate : rouge < 5 %, vert > 8 %, neutre entre", () => {
    expect(likeRateTone(0.03)).toBe("bad");
    expect(likeRateTone(0.065)).toBe("neutral");
    expect(likeRateTone(0.094)).toBe("good");
  });

  it("save rate : vert > 1 %, jamais « mauvais »", () => {
    expect(saveRateTone(0.017)).toBe("good");
    expect(saveRateTone(0.004)).toBe("neutral");
    expect(saveRateTone(0)).toBe("neutral");
  });

  it("une mesure ABSENTE n'est ni bonne ni mauvaise", () => {
    // Sans ce troisième état, un save rate non collecté s'afficherait rouge —
    // une contre-performance qui n'a pas été mesurée.
    expect(likeRateTone(null)).toBe("unknown");
    expect(saveRateTone(null)).toBe("unknown");
  });
});

describe("savesAvailability — « en cours » vs « — » définitif", () => {
  it("mesurée → measured, même à zéro", () => {
    expect(savesAvailability(312, "TikTok")).toBe("measured");
    expect(savesAvailability(0, "TikTok")).toBe("measured");
  });

  it("absente sur TikTok → collecte en cours (la donnée arrivera)", () => {
    expect(savesAvailability(null, "TikTok")).toBe("collecting");
    expect(savesAvailability(undefined, "TikTok")).toBe("collecting");
  });

  it("absente sur Instagram/YouTube → indisponible, DÉFINITIF", () => {
    // Promettre « en cours de collecte » sur une métrique que la plateforme
    // n'expose pas ferait attendre une donnée qui n'arrivera jamais.
    expect(savesAvailability(null, "Instagram")).toBe("unavailable");
    expect(savesAvailability(null, "YouTube")).toBe("unavailable");
  });

  it("absente sur Facebook/Snapchat → indisponible : ni l'une ni l'autre n'expose de saves", () => {
    expect(savesAvailability(null, "Facebook")).toBe("unavailable");
    expect(savesAvailability(null, "Snapchat")).toBe("unavailable");
  });
});

describe("accountStateOf", () => {
  it("une fenêtre ouverte PRIME sur l'alarme", () => {
    const posts = [post({ vues: ACCOUNT_ALARM_RESCUE_VIEWS + 400 })];
    expect(accountStateOf(posts, true)).toBe("window");
  });

  it("alarme si signalée et aucune fenêtre", () => {
    expect(accountStateOf([post({ vues: 900, likes: 20 })], true)).toBe("alarm");
  });

  it("croisière par défaut", () => {
    expect(accountStateOf([post({ vues: 4_200, likes: 300 })], false)).toBe(
      "cruise",
    );
  });
});

describe("rateOf", () => {
  it("null si non mesurable, jamais une division par zéro", () => {
    expect(rateOf(null, 1_000)).toBeNull();
    expect(rateOf(50, 0)).toBeNull();
    expect(rateOf(312, 18_432)).toBeCloseTo(0.01693, 5);
  });
});

describe("computeDelta24h — la colonne importante du tableau 48 h", () => {
  const snaps = [
    { capturedAt: NOW - 44 * HOUR, vues: 3_100 },
    { capturedAt: NOW - 25 * HOUR, vues: 12_400 },
    { capturedAt: NOW - 2 * HOUR, vues: 18_432 },
  ];

  it("post > 24 h : vues actuelles − dernier relevé antérieur à now−24 h", () => {
    // La référence est le relevé de −25 h (12 400), PAS celui de −44 h.
    expect(computeDelta24h(NOW - 40 * HOUR, 18_432, snaps, NOW)).toBe(
      18_432 - 12_400,
    );
  });

  it("post < 24 h : toutes ses vues sont récentes", () => {
    expect(computeDelta24h(NOW - 9 * HOUR, 5_215, [], NOW)).toBe(5_215);
  });

  it("post > 24 h sans relevé assez ancien → null, jamais une approximation", () => {
    // Le trou de collecte typique : la sync nocturne vient d'être branchée.
    expect(
      computeDelta24h(
        NOW - 40 * HOUR,
        18_432,
        [{ capturedAt: NOW - 2 * HOUR, vues: 18_432 }],
        NOW,
      ),
    ).toBeNull();
  });

  it("recomptage plateforme à la baisse → clampé à zéro", () => {
    expect(
      computeDelta24h(
        NOW - 40 * HOUR,
        11_900,
        [{ capturedAt: NOW - 25 * HOUR, vues: 12_400 }],
        NOW,
      ),
    ).toBe(0);
  });
});

describe("computeFollowersDelta — le delta qui demande deux nuits", () => {
  const releve = (hAgo: number, followers: number | null) => ({
    capturedAt: NOW - hAgo * HOUR,
    followers,
  });

  it("deux relevés espacés d'une nuit → delta", () => {
    expect(
      computeFollowersDelta([releve(26, 18_430), releve(2, 18_573)]),
    ).toBe(143);
  });

  it("UN seul relevé → null (première nuit de collecte)", () => {
    // Le cas des premiers jours : afficher 0 ferait lire « le compte stagne »
    // là où la collecte n'a simplement pas encore deux points.
    expect(computeFollowersDelta([releve(2, 18_430)])).toBeNull();
  });

  it("deux relevés de la MÊME nuit → null (pas d'écart exploitable)", () => {
    expect(
      computeFollowersDelta([releve(3, 18_430), releve(2, 18_431)]),
    ).toBeNull();
  });

  it("les relevés sans compteur (profil masqué) sont ignorés", () => {
    expect(
      computeFollowersDelta([
        releve(26, 18_430),
        releve(14, null),
        releve(2, 18_573),
      ]),
    ).toBe(143);
  });

  it("le delta couvre TOUTE la fenêtre, pas juste la dernière nuit", () => {
    // Trois nuits chargées : la référence est la plus ancienne espacée, pas
    // l'avant-dernière — sinon un compte qui monte lentement afficherait +2.
    expect(
      computeFollowersDelta([
        releve(50, 18_200),
        releve(26, 18_430),
        releve(2, 18_573),
      ]),
    ).toBe(373);
  });

  it("une PERTE d'abonnés est rendue telle quelle (pas clampée)", () => {
    expect(
      computeFollowersDelta([releve(26, 18_430), releve(2, 18_390)]),
    ).toBe(-40);
  });
});

// ─── RELEVÉ RAPIDE dans le dashboard — le relevé le plus récent, ENTIER ──────
// Relevés réels de prod (30/09/2026) : le relevé rapide TikTok porte vues,
// likes, saves ; l'Instagram masque les likes une fois sur deux et n'a jamais
// de saves. Un post publié à 13 h restait « en attente de relevé » jusqu'à
// 23 h 30 alors qu'il avait été relu trois fois.
describe("freshestReading — vues, likes et saves d'un SEUL relevé", () => {
  // Nuit du 29/09, 23 h 33 Paris ; relevé rapide du 30/09, 15 h 12 Paris.
  const nuit = { at: Date.UTC(2026, 8, 29, 21, 33), vues: 1_784, likes: 5, saves: 4 };
  const rapideTikTok = { at: Date.UTC(2026, 8, 30, 13, 12), vues: 8_976, likes: 51, saves: 14 };
  const rapideInstaSansLikes = { at: Date.UTC(2026, 8, 30, 13, 12), vues: 2_240, likes: null, saves: null };

  it("un relevé rapide plus récent l'emporte, compteurs compris", () => {
    expect(freshestReading(nuit, rapideTikTok)).toEqual({ ...rapideTikTok, source: "rapide" });
  });

  it("likes masqués sur le relevé retenu : NON MESURÉS, jamais ceux de la veille", () => {
    const r = freshestReading(nuit, rapideInstaSansLikes)!;
    expect(r.source).toBe("rapide");
    expect(r.vues).toBe(2_240);
    expect(r.likes).toBeNull();
    expect(r.saves).toBeNull();
    // Le like rate devient inconnu, pas 5 ÷ 2 240 = 0,2 % — un faux « mauvais ».
    expect(rateOf(r.likes, r.vues)).toBeNull();
  });

  it("la nuit plus récente l'emporte (le relevé rapide s'arrête à 36 h)", () => {
    const vieuxRapide = { ...rapideTikTok, at: nuit.at - 2 * HOUR };
    expect(freshestReading(nuit, vieuxRapide)).toEqual({ ...nuit, source: "nuit" });
  });

  it("à égalité d'instant, la nuit (le relevé de référence)", () => {
    expect(freshestReading(nuit, { ...rapideTikTok, at: nuit.at })?.source).toBe("nuit");
  });

  it("un seul relevé, ou aucun", () => {
    expect(freshestReading(null, rapideTikTok)?.source).toBe("rapide");
    expect(freshestReading(nuit, null)?.source).toBe("nuit");
    expect(freshestReading(null, null)).toBeNull();
  });

  it("likes non mesurés : jamais de porte ouverte (non mesuré ≠ satisfait)", () => {
    expect(detectOpenDoor(post({ likes: null }), NOW)).toBeNull();
    // PRÉSENCE : le même post avec ses likes mesurés ouvre bien la porte.
    expect(detectOpenDoor(post(), NOW)).not.toBeNull();
  });
});

describe("computeDelta24h — les relevés rapides comme points de référence", () => {
  it("un post de 30 h sans relevé de nuit vieux de 24 h : le relevé rapide fournit la référence", () => {
    const publie = NOW - 30 * HOUR;
    // Relevé de nuit il y a 22 h seulement (moins de 24 h) : pas de référence.
    const nuitSeule = [{ capturedAt: NOW - 22 * HOUR, vues: 9_100 }];
    expect(computeDelta24h(publie, 12_400, nuitSeule, NOW)).toBeNull();
    // Relevé rapide de 26 h, à 4 h de vie : 3 050 vues.
    const avecRapide = [...nuitSeule, { capturedAt: NOW - 26 * HOUR, vues: 3_050 }];
    expect(computeDelta24h(publie, 12_400, avecRapide, NOW)).toBe(9_350);
  });
});
