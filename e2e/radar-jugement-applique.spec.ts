import { test, expect } from "@playwright/test";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — le jugement sémantique, phase B (définitions du fondateur du 14/11/2026) : les jugements agissent.
 *  - une app qui n'est ni une app, ni un SaaS, ni un jeu mobile : en pause dans le Radar (jamais une concurrente) ;
 *  - un compte « rien à voir » : en pause ; « autre app » suivie : déplacé ; non suivie : en pause, et dès 2 comptes
 *    l'app est suivie d'office et ils la rejoignent ; « placement » : marqué, gardé, sa vidéo part vers Swarm.
 * L'appel à l'IA n'est pas joué : ses réponses sont données ; tout le reste est le vrai chemin.
 */
type Row = Record<string, unknown>;
async function exportAll(table: "apps" | "tracked"): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 500; i++) {
    const r = (await admin.mutation(api.swarmExport.e2eSwarmExport, { secret: E2E_SECRET, table, cursor })) as { rows: Row[]; cursor: string; done: boolean };
    rows.push(...r.rows);
    if (r.done) return rows;
    cursor = r.cursor;
  }
  throw new Error(`export ${table} : trop de pages`);
}

test.describe("Radar — jugement appliqué", () => {
  test("périmètre, rien à voir, autre app suivie ou non, placement : chaque verdict fait ce qui a été décidé", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2ejb${ts}`;
    const h = (n: number) => `rjb${n}_${ts}`;
    // Des identifiants de vidéo numériques (la liste d'un profil n'en lit pas d'autres), tous vieux de plus de 48 h.
    const vid = (n: number, i: number) => `${ts}${n}${i}`;
    // Six vidéos : `cites` citent l'app où le compte est rangé ; `autre`, deux autres citent l'app qu'il pousse vraiment.
    const six = (n: number, cites: number, autre?: string) =>
      [1, 2, 3, 4, 5, 6].map((i) => ({
        videoId: vid(n, i),
        ageH: 60 + i * 10,
        views: 100 * i,
        caption: i <= cites ? `astuce ${p}a` : autre && i <= cites + 2 ? `le site c'est ${autre}` : "vlog du jour",
      }));
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, {
      secret: E2E_SECRET,
      apps: [
        { slug: `${p}a`, name: `Jugee ${ts}`, rivalOf: [], strong: [`${p}a`] },
        { slug: `${p}cringe`, name: `Cringe${ts}`, rivalOf: [], strong: [`${p}cringe`] },
        { slug: `${p}shop`, name: `Shop ${ts}`, rivalOf: [], strong: [`${p}shop`] },
        { slug: `${p}rival`, name: `Rival ${ts}`, rivalOf: ["e2e-projet"], strong: [`${p}rival`] },
        { slug: `${p}vide`, name: `Vide ${ts}`, rivalOf: [], strong: [`${p}vide`] },
      ],
      accounts: [
        { handle: h(1), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(1, 2) },
        // Placement : sa vidéo payée n'est plus parmi ses dernières (10 vidéos lues, aucune ne cite l'app) — un relevé
        // le mettrait en pause « hors sujet », sauf ce jugement.
        {
          handle: h(2),
          appSlug: `${p}a`,
          fans: 900_000,
          posts7d: 1,
          videos: Array.from({ length: 10 }, (_, k) => ({ videoId: vid(2, k), ageH: 60 + k * 10, views: 1_000 * (k + 1), caption: "vlog du jour" })),
        },
        { handle: h(3), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(3, 2, `${p}cringe`) },
        { handle: h(4), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(4, 2, `${p}moka`) },
        { handle: h(5), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(5, 2, `${p}moka`) },
        { handle: h(6), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(6, 2) },
        { handle: h(7), appSlug: `${p}shop`, fans: 100, posts7d: 1, videos: [{ videoId: vid(7, 1), ageH: 70, views: 500, caption: `haul ${p}shop` }] },
        { handle: h(8), appSlug: `${p}rival`, fans: 100, posts7d: 1, videos: [{ videoId: vid(8, 1), ageH: 70, views: 500, caption: `mon avis ${p}rival` }] },
      ],
    });
    try {
      const handles = [1, 2, 3, 4, 5, 6].map(h);
      const judged = await admin.mutation(api.radarJudge.e2eJudgeAccounts, {
        secret: E2E_SECRET,
        handles,
        answers: [
          { handle: h(1), verdict: "sans_rapport", why: "vlogs sans rapport" },
          { handle: h(2), verdict: "placement", why: "une vidéo payée" },
          { handle: h(3), verdict: "autre_app", other: `Cringe${ts}`, why: "pousse Cringe" },
          { handle: h(4), verdict: "autre_app", other: `${p}moka`, why: "pousse Moka" },
          { handle: h(5), verdict: "autre_app", other: `${p}moka`, why: "pousse Moka" },
          { handle: h(6), verdict: "pousse", why: "pousse bien l'app" },
        ],
      });
      expect(judged.written).toBe(6);

      // Les apps : celle dont on ne sait rien n'est pas donnée à juger.
      const natures = await admin.mutation(api.radarJudge.e2eJudgeNatures, {
        secret: E2E_SECRET,
        slugs: [`${p}shop`, `${p}rival`, `${p}vide`],
        answers: [
          { slug: `${p}shop`, nature: { digital: true, kind: "ecommerce", aboutIt: "oui", why: "agent d'achat" } },
          { slug: `${p}rival`, nature: { digital: true, kind: "ecommerce", aboutIt: "oui", why: "boutique" } },
        ],
      });
      expect(natures.asked.map((a: { name: string }) => a.name).sort()).toEqual([`Rival ${ts}`, `Shop ${ts}`]);

      const applied = await admin.mutation(api.radarJudge.e2eApplyJudgments, { secret: E2E_SECRET, handles, slugs: [`${p}shop`, `${p}rival`] });
      // Hors périmètre : en pause ; une concurrente, jamais.
      expect(applied.perimeter).toEqual([`${p}shop`]);
      expect(applied.verdicts).toEqual({ pause: 1, placement: 1, move: 1, lead: 2, none: 1 });

      // Deux comptes désignent la même app non suivie : le suivi d'office la suit, ils la rejoignent.
      expect(await admin.mutation(api.radarAuto.e2eAutoFollow, { secret: E2E_SECRET, markers: [`${p}moka`] })).toMatchObject({ followed: 1, attached: 2 });

      const apps = new Map((await exportAll("apps")).filter((a) => (a.slug as string).startsWith(p)).map((a) => [a.slug as string, a]));
      expect(apps.get(`${p}shop`)).toMatchObject({ status: "paused", kind: "ecommerce" });
      expect(apps.get(`${p}rival`)).toMatchObject({ status: "active", kind: "ecommerce" });
      const moka = [...apps.values()].find((a) => (a.name as string).toLowerCase() === `${p}moka`);
      expect(moka).toBeDefined();
      const tracked = new Map((await exportAll("tracked")).filter((t) => (t.handle as string).endsWith(`_${ts}`)).map((t) => [t.handle as string, t]));
      // Rien à voir : en pause, ne part plus.
      expect(tracked.has(h(1))).toBe(false);
      // Placement : part quand même, marqué.
      expect(tracked.get(h(2))).toMatchObject({ status: "active", placement: true });
      expect(tracked.get(h(3))).toMatchObject({ appId: apps.get(`${p}cringe`)!.id });
      expect(tracked.get(h(4))).toMatchObject({ status: "active", appId: moka!.id });
      expect(tracked.get(h(5))).toMatchObject({ status: "active", appId: moka!.id });
      expect(tracked.get(h(6))).toMatchObject({ appId: apps.get(`${p}a`)!.id, placement: false });

      // Relevé, le placement n'est pas mis en pause faute de citer assez l'app.
      const profil = `<html><script>window.__d={"userInfo":${JSON.stringify({ uniqueId: h(2), followerCount: 900_000, signature: "lifestyle", privateAccount: false })},"videoList":${JSON.stringify(
        Array.from({ length: 10 }, (_, k) => ({ id: vid(2, k), desc: "vlog du jour", playCount: 1_000 * (k + 1) })),
      )}}</script></html>`;
      const read = await admin.mutation(api.radarNetworks.e2eFreeAccountRead, { secret: E2E_SECRET, handle: h(2), pages: [{ url: `https://www.tiktok.com/embed/@${h(2)}`, html: profil }] });
      expect(read).toMatchObject({ read: "free", status: "active" });
    } finally {
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
    }
  });
});
