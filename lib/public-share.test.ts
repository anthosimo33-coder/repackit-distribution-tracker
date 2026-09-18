import { describe, expect, it } from "vitest";
import {
  PUBLIC_POSTS_LIMIT,
  SHARE_BLOCKS,
  blocksForAudience,
  effectiveFilters,
  newShareToken,
  projectPublicTracker,
  sanitizeBlocks,
  shareStatus,
  shareWindow,
  type InternalSharePost,
  type ProjectionConfig,
} from "../convex/publicShare";

/**
 * Un lien public sort des chiffres de l'app vers quelqu'un SANS compte. Ces
 * tests ne vérifient pas ce que la page affiche : ils vérifient ce que la
 * RÉPONSE contient, parce qu'un visiteur lit la réponse, pas la page.
 *
 * Les entrées ont la forme de la prod : noms complets, handles suffixés, vraies
 * URL TikTok qui portent le @handle, dates de septembre et pas « aujourd'hui ».
 */

const SEPT_3 = Date.UTC(2026, 8, 3, 16, 42);
const SEPT_9 = Date.UTC(2026, 8, 9, 19, 5);

function post(p: Partial<InternalSharePost> & { id: string }): InternalSharePost {
  return {
    label: "POV : tu découvres enfin pourquoi ton skincare ne marche pas",
    plateforme: "TikTok",
    compte: "kelly.snytch_fr",
    datePubli: SEPT_3,
    vues: 41_237,
    likes: 2_914,
    comments: 87,
    isWarmup: false,
    creatorId: "k57a1creatorkelly",
    creatorName: "Kelly Martinez",
    postUrl: "https://www.tiktok.com/@kelly.snytch_fr/video/7412345678901234567",
    ...p,
  };
}

const POSTS: InternalSharePost[] = [
  post({ id: "p1" }),
  post({
    id: "p2",
    compte: "ines.snytch_us2",
    creatorId: "k57a1creatorines",
    creatorName: "Inès Benali",
    vues: 198_402,
    likes: 11_380,
    comments: 402,
    datePubli: SEPT_9,
    plateforme: "Instagram",
    postUrl: "https://www.instagram.com/reel/C9xYzAbCdEf/",
  }),
  post({
    id: "p3",
    compte: "sarah.lefevre.ugc",
    creatorId: "k57a1creatorsarah",
    creatorName: "Sarah Lefèvre",
    vues: 8_761,
    likes: 391,
    comments: 12,
    isWarmup: true,
    postUrl: "https://www.tiktok.com/@sarah.lefevre.ugc/video/7413999888777666555",
  }),
];

const BRAND: ProjectionConfig = {
  audience: "brand",
  blocks: [...SHARE_BLOCKS],
  showCreatorNames: false,
  postLinks: false,
  warmup: "all",
};

const json = (x: unknown) => JSON.stringify(x);

describe("projection — ce qui n'est pas coché ne sort pas", () => {
  it("un lien marque anonymisé ne contient AUCUN nom ni AUCUN handle", () => {
    const out = json(projectPublicTracker(POSTS, BRAND));
    // Contrôle de présence : la réponse porte bien des données de ces posts.
    expect(out).toContain("198402");
    for (const secret of [
      "Kelly", "Martinez", "Inès", "Benali", "Sarah", "Lefèvre",
      "kelly.snytch_fr", "ines.snytch_us2", "sarah.lefevre.ugc",
      "k57a1creator", // les identifiants internes non plus
    ]) {
      expect(out, secret).not.toContain(secret);
    }
  });

  it("la même créatrice porte la même lettre dans « par créatrice » et dans les posts", () => {
    const v = projectPublicTracker(POSTS, BRAND);
    // Inès a le plus de vues → A ; Kelly → B ; Sarah → C.
    expect(v.byCreator?.map((r) => r.creator)).toEqual([
      { kind: "anonymous", index: 0 },
      { kind: "anonymous", index: 1 },
      { kind: "anonymous", index: 2 },
    ]);
    const ines = v.posts?.find((p) => p.vues === 198_402);
    expect(ines?.creator).toEqual({ kind: "anonymous", index: 0 });
    const kelly = v.posts?.find((p) => p.vues === 41_237);
    expect(kelly?.creator).toEqual({ kind: "anonymous", index: 1 });
  });

  it("les vrais noms ne sortent que si on les demande, pour une marque", () => {
    const v = projectPublicTracker(POSTS, { ...BRAND, showCreatorNames: true });
    expect(json(v)).toContain("Inès Benali");
    // …et jamais le handle, même dans ce cas.
    expect(json(v)).not.toContain("ines.snytch_us2");
  });

  it("les liens vers les posts ne sortent que cochés — et portent alors le handle", () => {
    const sans = projectPublicTracker(POSTS, BRAND);
    expect(sans.posts?.every((p) => p.url === null)).toBe(true);
    expect(json(sans)).not.toContain("tiktok.com");

    const avec = projectPublicTracker(POSTS, { ...BRAND, postLinks: true });
    expect(avec.posts?.map((p) => p.url)).toContain(
      "https://www.tiktok.com/@kelly.snytch_fr/video/7412345678901234567",
    );
  });

  it("un chiffre clé décoché n'est pas dans la réponse, même si ses voisins y sont", () => {
    const v = projectPublicTracker(POSTS, {
      ...BRAND,
      blocks: ["kpi_engagement"],
    });
    expect(v.kpi).not.toBeNull();
    expect(Object.keys(v.kpi ?? {})).toEqual(["engagement"]);
    // Aucun total de vues ne fuit par un autre bloc.
    expect(v.byPlatform).toBeNull();
    expect(v.byCreator).toBeNull();
    expect(v.posts).toBeNull();
    expect(json(v)).not.toContain("248400"); // Σ vues = 41 237 + 198 402 + 8 761
  });

  it("aucun bloc de chiffres clés coché → kpi null, pas un objet vide", () => {
    const v = projectPublicTracker(POSTS, { ...BRAND, blocks: ["posts"] });
    expect(v.kpi).toBeNull();
    expect(v.posts).toHaveLength(3);
  });

  it("aucune clé de la réponse ne peut porter un montant", () => {
    const keys = new Set<string>();
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x !== null && typeof x === "object") {
        for (const [k, val] of Object.entries(x)) {
          keys.add(k);
          walk(val);
        }
      }
    };
    walk(projectPublicTracker(POSTS, { ...BRAND, showCreatorNames: true, postLinks: true }));
    expect(keys.size).toBeGreaterThan(5);
    for (const k of keys) {
      expect(k).not.toMatch(/amount|montant|pay|gain|earn|cost|cout|price|prix|cpm|rpm|revenue|bonus/i);
      expect(k).not.toMatch(/compte|handle|account/i);
    }
  });
});

describe("chiffres clés — même formule que le Tracker", () => {
  it("engagement = (Σlikes + Σcomm) / Σvues, HORS chauffe même quand les sommes l'incluent", () => {
    const v = projectPublicTracker(POSTS, BRAND);
    expect(v.kpi?.views).toBe(41_237 + 198_402 + 8_761);
    // Le post de chauffe (Sarah) est dans les sommes mais pas dans le taux.
    const attendu = (2_914 + 87 + 11_380 + 402) / (41_237 + 198_402);
    expect(v.kpi?.engagement).toBeCloseTo(attendu, 12);
    const naif = (2_914 + 87 + 11_380 + 402 + 391 + 12) / (41_237 + 198_402 + 8_761);
    expect(v.kpi?.engagement).not.toBeCloseTo(naif, 6);
  });

  it("en mode « chauffe seulement », le taux se lit SUR la chauffe", () => {
    const v = projectPublicTracker(POSTS.filter((p) => p.isWarmup), {
      ...BRAND,
      warmup: "only",
    });
    expect(v.kpi?.engagement).toBeCloseTo((391 + 12) / 8_761, 12);
  });

  it("aucune vue → engagement null, pas 0", () => {
    const v = projectPublicTracker([], BRAND);
    expect(v.kpi?.engagement).toBeNull();
    expect(v.postCount).toBe(0);
  });
});

describe("lien de créatrice", () => {
  const CREATOR: ProjectionConfig = { ...BRAND, audience: "creator", showCreatorNames: true };

  it("le périmètre est verrouillé sur elle, quoi qu'on ait stocké", () => {
    const f = effectiveFilters(
      {
        audience: "creator",
        creatorId: "k57a1creatorkelly",
        perimeter: {
          period: { kind: "all" },
          // Écrit de travers : une autre créatrice, ou « toutes » (vide).
          creatorIds: ["k57a1creatorines"],
          warmup: "exclude",
        },
      },
      SEPT_9,
    );
    expect(f.creatorIds).toEqual(["k57a1creatorkelly"]);
  });

  it("sans créatrice désignée, le lien ne montre personne — jamais tout le monde", () => {
    const f = effectiveFilters(
      { audience: "creator", creatorId: null, perimeter: { period: { kind: "all" }, warmup: "exclude" } },
      SEPT_9,
    );
    expect(f.creatorIds).toHaveLength(1);
    expect(f.creatorIds?.[0]).not.toMatch(/^k57/);
  });

  it("une marque sans filtre de créatrice les voit toutes (liste vide = pas de filtre)", () => {
    const f = effectiveFilters(
      { audience: "brand", perimeter: { period: { kind: "all" }, creatorIds: [], warmup: "exclude" } },
      SEPT_9,
    );
    expect(f.creatorIds).toBeUndefined();
  });

  it("pas de bloc « par créatrice », et aucun nom répété sur les posts", () => {
    const mine = POSTS.filter((p) => p.creatorId === "k57a1creatorkelly");
    const v = projectPublicTracker(mine, CREATOR);
    expect(v.byCreator).toBeNull();
    expect(v.posts).toHaveLength(1);
    expect(v.posts?.[0].creator).toBeNull();
    expect(json(v)).not.toContain("Martinez");
  });
});

describe("blocs", () => {
  it("le quadrant n'est pas partageable, même écrit à la main", () => {
    expect(SHARE_BLOCKS as readonly string[]).not.toContain("quadrant");
    expect(sanitizeBlocks(["quadrant", "posts", "posts", "by_format"])).toEqual(["posts"]);
  });

  it("l'ordre canonique est rendu, pas celui de la saisie", () => {
    expect(sanitizeBlocks(["posts", "kpi_views"])).toEqual(["kpi_views", "posts"]);
  });

  it("« par créatrice » disparaît pour une créatrice, reste pour une marque", () => {
    expect(blocksForAudience(["by_creator", "posts"], "creator")).toEqual(["posts"]);
    expect(blocksForAudience(["by_creator", "posts"], "brand")).toEqual(["by_creator", "posts"]);
  });

  it(`les posts sont limités aux ${PUBLIC_POSTS_LIMIT} plus vus`, () => {
    const many = Array.from({ length: 35 }, (_, i) =>
      post({ id: `p${i}`, vues: 1_000 + i * 17 }),
    );
    const v = projectPublicTracker(many, BRAND);
    expect(v.posts).toHaveLength(PUBLIC_POSTS_LIMIT);
    expect(v.posts?.[0].vues).toBe(1_000 + 34 * 17);
    expect(v.postCount).toBe(35);
  });
});

describe("période et statut", () => {
  it("glissante = les N derniers jours jusqu'à l'instant du SERVEUR", () => {
    expect(shareWindow({ kind: "rolling", days: 30 }, SEPT_9)).toEqual({
      from: SEPT_9 - 30 * 86_400_000,
      to: SEPT_9,
    });
    expect(shareWindow({ kind: "fixed", from: SEPT_3, to: SEPT_9 }, SEPT_9)).toEqual({
      from: SEPT_3,
      to: SEPT_9,
    });
    expect(shareWindow({ kind: "all" }, SEPT_9)).toEqual({ from: undefined, to: undefined });
  });

  it("révoqué ou expiré → invalide ; expiré À la seconde près compris", () => {
    expect(shareStatus({}, SEPT_9)).toBe("valid");
    expect(shareStatus({ expiresAt: SEPT_9 + 1 }, SEPT_9)).toBe("valid");
    expect(shareStatus({ expiresAt: SEPT_9 }, SEPT_9)).toBe("invalid");
    expect(shareStatus({ revokedAt: SEPT_3 }, SEPT_9)).toBe("invalid");
    expect(shareStatus(null, SEPT_9)).toBe("invalid");
  });

  it("jeton : 22 caractères base62, jamais deux fois le même", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const t = newShareToken();
      expect(t).toMatch(/^[0-9A-Za-z]{22}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(500);
  });
});
