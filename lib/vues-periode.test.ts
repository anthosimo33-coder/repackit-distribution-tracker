import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import {
  calculerVuesGagnees,
  fenetreVues,
  postsVuesCore,
  relevesVuesPage,
  relevesVuesParPages,
  VUES_RELEVES_PAR_PAGE,
} from "../convex/trackerData";
import type { SnapshotPoint } from "../convex/viewsDaily";
import { memoryDb, type MemoryDoc } from "./convex-memory-db";

/**
 * Outil MCP `vues` — la lecture d'une période passe par PAGES de relevés.
 *
 * Le 19/11/2026, l'outil lisait toute la fenêtre de relevés en une seule query
 * et tombait en production dès 15 jours (« Function execution timed out », 1 s
 * de calcul, 13 831 documents lus). Ces tests tiennent les deux promesses du
 * correctif : aucune query ne lit plus d'une page, quel que soit le volume ; et
 * la période de comparaison, lue dans la même passe que la période, compte
 * exactement ce qu'une lecture de sa seule fenêtre compterait.
 */

const PROJET = "p1" as Id<"projects">;
const HEURE = 3_600_000;
const utc = (y: number, m: number, d: number, h: number) => Date.UTC(y, m - 1, d, h);

function publication(i: number, datePubli: number): MemoryDoc {
  return {
    _id: `pub${i}`,
    _creationTime: datePubli,
    projectId: PROJET,
    compte: `@compte${i % 3}`,
    plateforme: i % 2 === 0 ? "TikTok" : "Instagram",
    postUrl: `https://www.tiktok.com/@c/video/${i}`,
    datePubli,
    hookText: `post ${i}`,
    notes: "",
  };
}

function base(publications: MemoryDoc[], releves: SnapshotPoint[]) {
  return memoryDb({
    publications,
    metricSnapshots: releves.map((r, k) => ({
      _id: `s${k}`,
      _creationTime: r.capturedAt,
      projectId: PROJET,
      publicationId: r.publicationId,
      capturedAt: r.capturedAt,
      vues: r.vues,
    })),
  });
}

/** Ce que fait l'outil : les posts, puis les relevés par pages, puis le calcul. */
async function lirePeriode(
  mem: ReturnType<typeof memoryDb>,
  du: string,
  au: string,
  lectures: number[],
) {
  const ctx = { db: mem.db, projectId: PROJET } as never;
  mem.resetReads();
  const posts = await postsVuesCore(ctx, { par: "plateforme" });
  lectures.push(mem.reads());
  const { de, a } = fenetreVues(du, au);
  const releves = await relevesVuesParPages(async (cursor) => {
    mem.resetReads();
    const page = await relevesVuesPage(ctx, { de, a, cursor });
    lectures.push(mem.reads());
    return page;
  }, new Set(posts.map((p) => p.publicationId)));
  return { posts, releves };
}

describe("outil vues — relevés lus par pages", () => {
  it("un mois relevé toutes les heures : aucune query ne lit plus d'une page, le total est juste", async () => {
    // 31 posts relevés chaque heure sur toute la fenêtre lue de mars 2025 :
    // 33 449 relevés, plus que les 32 000 documents d'une query Convex.
    const pubs = Array.from({ length: 31 }, (_, i) => publication(i, utc(2025, 2, 10, 12)));
    const releves: SnapshotPoint[] = [];
    for (const p of pubs) {
      for (let k = 0; k < 1079; k++) {
        releves.push({ publicationId: p._id, capturedAt: utc(2025, 2, 21, 23) + k * HEURE, vues: 10 * k });
      }
    }
    const lectures: number[] = [];
    const { posts, releves: lus } = await lirePeriode(base(pubs, releves), "2025-03-01", "2025-03-31", lectures);

    expect(lus).toHaveLength(33_449);
    // Une borne FIXE, pas la constante : relever la taille des pages au-delà
    // de ce qu'une query tient en production doit faire rougir ce test. 4 000
    // relevés de Snytch ≈ 2,7 Mo lus, loin de la seconde de calcul.
    expect(VUES_RELEVES_PAR_PAGE).toBeLessThanOrEqual(5_000);
    expect(Math.max(...lectures)).toBeLessThanOrEqual(5_000);
    expect(lectures.length).toBeGreaterThan(2); // la fenêtre a bien demandé plusieurs pages
    const r = calculerVuesGagnees(posts, lus, { du: "2025-03-01", au: "2025-03-31" });
    // 743 heures en mars à Paris (passage à l'heure d'été le 30) × 10 vues × 31 posts.
    expect(r.total).toBe(743 * 10 * 31);
    expect(r.repartition.reduce((s, l) => s + l.vues, 0)).toBe(r.total);
  });

  it("la période de comparaison lue dans la passe de la période compte comme lue seule", async () => {
    // Relevés IRRÉGULIERS : trous de plusieurs jours, posts publiés en cours de
    // route. Un relevé hors de la fenêtre d'une période y changerait la
    // référence d'un post, ou y poserait un départ qui n'y est pas.
    const pubs = Array.from({ length: 12 }, (_, i) => publication(i, utc(2025, 1, 5 + 4 * i, 9)));
    const releves: SnapshotPoint[] = [];
    pubs.forEach((p, i) => {
      let t = (p.datePubli as number) + (3 + i) * HEURE;
      let vues = 0;
      for (let k = 0; t < utc(2025, 4, 10, 0); k++) {
        vues += 50 + ((k * 37 + i * 11) % 400);
        releves.push({ publicationId: p._id, capturedAt: t, vues });
        t += (k % 5 === 4 ? 9 * 24 : 20 + ((k + i) % 9)) * HEURE; // parfois 9 jours sans relevé
      }
    });
    const mem = base(pubs, releves);
    const periode = { du: "2025-03-01", au: "2025-03-31" };
    const avant = { du: "2025-01-29", au: "2025-02-28" };

    // Ce que fait l'outil avec `comparer` : UNE lecture, de la fenêtre de la
    // période précédente jusqu'à la fin de celle de la période.
    const posts = await postsVuesCore({ db: mem.db, projectId: PROJET } as never, { par: "compte" });
    const ensemble = releves.filter(
      (s) => s.capturedAt >= fenetreVues(avant.du, avant.au).de && s.capturedAt < fenetreVues(periode.du, periode.au).a,
    );
    for (const p of [periode, avant]) {
      const { de, a } = fenetreVues(p.du, p.au);
      const seule = releves.filter((s) => s.capturedAt >= de && s.capturedAt < a);
      const lueSeule = calculerVuesGagnees(posts, seule, p);
      expect(lueSeule.total).toBeGreaterThan(0);
      expect(calculerVuesGagnees(posts, ensemble, p)).toEqual(lueSeule);
    }
  });
});
