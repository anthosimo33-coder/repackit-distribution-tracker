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
  angleFamily: "vérification",
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
    const pile = post({
      vues: OPEN_DOOR_MIN_VIEWS,
      likes: Math.ceil(OPEN_DOOR_MIN_VIEWS * OPEN_DOOR_MIN_LIKE_RATE),
    });
    expect(detectOpenDoor(pile, NOW)).not.toBeNull();
    expect(detectOpenDoor({ ...pile, vues: pile.vues - 1 }, NOW)).toBeNull();
    expect(detectOpenDoor({ ...pile, likes: pile.likes - 1 }, NOW)).toBeNull();
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
  it("un post trop jeune est « en attente », pas « sous les seuils »", () => {
    // Juger un post de 3 h le condamnerait avant qu'il ait vécu.
    expect(verdictOf(post({ postedAt: NOW - 3 * HOUR, vues: 210 }), NOW)).toBe(
      "pending",
    );
    // Juste au-delà de la borne, il est jugeable.
    expect(
      verdictOf(
        post({
          postedAt: NOW - PENDING_POST_MAX_AGE_MS - 1,
          vues: 210,
          likes: 4,
          delta24h: 3,
          saves: 0,
        }),
        NOW,
      ),
    ).not.toBe("pending");
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
