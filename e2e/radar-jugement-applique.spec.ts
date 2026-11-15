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
        // Une seule vidéo cite l'app où ils sont rangés : ils poussent l'autre « à la place ».
        { handle: h(3), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(3, 1, `${p}cringe`) },
        { handle: h(4), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(4, 1, `${p}moka`) },
        { handle: h(5), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(5, 1, `${p}moka`) },
        // v3 : deux vidéos citent son app ET deux l'autre (il pousse les deux), ou l'IA le dit « pousse » avec une autre app.
        { handle: h(12), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(12, 2, `${p}moka`) },
        { handle: h(13), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(13, 2, `${p}moka`) },
        { handle: h(6), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(6, 2) },
        { handle: h(7), appSlug: `${p}shop`, fans: 100, posts7d: 1, videos: [{ videoId: vid(7, 1), ageH: 70, views: 500, caption: `haul ${p}shop` }] },
        { handle: h(8), appSlug: `${p}rival`, fans: 100, posts7d: 1, videos: [{ videoId: vid(8, 1), ageH: 70, views: 500, caption: `mon avis ${p}rival` }] },
        // Gardes v2 : 3 vidéos sur 6 citent l'app (un partenaire, pas un placement) ; la bio nomme l'app ; jugé en v1.
        {
          handle: h(9),
          appSlug: `${p}a`,
          fans: 100,
          posts7d: 1,
          videos: Array.from({ length: 8 }, (_, k) => ({ videoId: vid(9, k), ageH: 60 + k * 10, views: 100 * (k + 1), caption: k < 3 ? `code promo ${p}a` : "vlog du jour" })),
        },
        { handle: h(10), appSlug: `${p}a`, fans: 100, posts7d: 1, bio: `Ambassadrice officielle ${p}a`, videos: six(10, 0) },
        { handle: h(11), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(11, 0) },
        // La relecture (15/11) : non relu ; relu autrement que l'IA ; appliqué avant la relecture puis contredit.
        ...[14, 15, 16, 17, 18].map((n) => ({ handle: h(n), appSlug: `${p}a`, fans: 100, posts7d: 1, videos: six(n, 1) })),
      ],
    });
    try {
      const handles = [1, 2, 3, 4, 5, 6, 9, 10, 12, 13, 14, 15, 16, 17, 18].map(h);
      // Un « pousse » v1 : ni il n'agit, ni il ne relie le compte à son app pour Swarm.
      await admin.mutation(api.radarJudge.e2eLegacyJudgment, { secret: E2E_SECRET, handle: h(11), verdict: "pousse" });
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
          { handle: h(9), verdict: "placement", why: "quelques vidéos payées" },
          { handle: h(10), verdict: "sans_rapport", why: "vlogs" },
          { handle: h(12), verdict: "autre_app", other: `${p}moka`, why: "pousse Moka" },
          { handle: h(13), verdict: "pousse", other: `${p}moka`, why: "pousse les deux" },
          ...[14, 15, 16].map((n) => ({ handle: h(n), verdict: "sans_rapport" as const, why: "vlogs" })),
          { handle: h(17), verdict: "placement", why: "une vidéo" },
          { handle: h(18), verdict: "pousse", other: `${p}moka2`, why: "pousse les deux" },
        ],
      });
      expect(judged.written).toBe(15);
      // Ce que l'IA avait appliqué seule avant la relecture (le 15/11 à 10 h 06), et une app mise hors périmètre.
      await admin.mutation(api.radarJudge.e2eAppliedBefore, { secret: E2E_SECRET, handle: h(16), applied: "pause" });
      await admin.mutation(api.radarJudge.e2eAppliedBefore, { secret: E2E_SECRET, handle: h(17), applied: "placement" });
      await admin.mutation(api.radarJudge.e2eAppliedBefore, { secret: E2E_SECRET, handle: h(18), applied: "note", other: `${p}moka2` });
      await admin.mutation(api.radarJudge.e2eAppliedBefore, { secret: E2E_SECRET, pausedApp: `${p}vide` });

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

      // Seuls les verdicts RELUS agissent. h(14) n'est pas relu ; h(11) (un « pousse » v1) non plus.
      const a = `${p}a`;
      const review = [
        { handle: h(1), app: a, verdict: "sans_rapport" as const },
        { handle: h(2), app: a, verdict: "placement" as const },
        { handle: h(3), app: a, verdict: "autre_app" as const, other: `Cringe${ts}` },
        { handle: h(4), app: a, verdict: "autre_app" as const, other: `${p}moka` },
        { handle: h(5), app: a, verdict: "autre_app" as const, other: `${p}moka` },
        { handle: h(6), app: a, verdict: "pousse" as const },
        { handle: h(9), app: a, verdict: "placement" as const },
        { handle: h(10), app: a, verdict: "sans_rapport" as const },
        { handle: h(12), app: a, verdict: "autre_app" as const, other: `${p}moka` },
        { handle: h(13), app: a, verdict: "pousse" as const, other: `${p}moka` },
        // Relu autrement que l'IA : c'est la relecture qui agit.
        { handle: h(15), app: a, verdict: "placement" as const },
        // Appliqué avant la relecture, que la relecture contredit : défait.
        { handle: h(16), app: a, verdict: "placement" as const },
        { handle: h(17), app: a, verdict: "pousse" as const },
        { handle: h(18), app: a, verdict: "sans_rapport" as const },
      ];
      const scope = [
        { slug: `${p}shop`, scope: "dehors" as const },
        { slug: `${p}rival`, scope: "dehors" as const },
      ];
      const slugs = [`${p}shop`, `${p}rival`, `${p}vide`];
      const applied = await admin.mutation(api.radarJudge.e2eApplyJudgments, { secret: E2E_SECRET, review, apps: scope, slugs });
      // Hors périmètre relu : en pause ; une concurrente, jamais ; une app mise en pause sans relecture : remise en route.
      expect(applied.perimeter).toEqual({ paused: [`${p}shop`], resumed: [`${p}vide`] });
      // h(9) (3 vidéos) n'est pas un placement, h(10) (sa bio nomme l'app) n'est pas mis en pause ; h(12) et h(13)
      // poussent les deux : l'autre app est notée, eux restent ; h(17) n'est plus un placement ; h(18) passe en pause.
      expect(applied.verdicts).toEqual({ pause: 2, placement: 3, move: 1, lead: 2, note: 2, none: 4 });
      // Relu, déjà appliqué : rien à refaire.
      expect((await admin.mutation(api.radarJudge.e2eApplyJudgments, { secret: E2E_SECRET, review, apps: scope, slugs })).verdicts).toEqual({});
      // Un lot de plus (nouvelle version de la liste) : les comptes déjà appliqués se sautent sans compter, et le passage
      // s'arrête après sa part d'actions réelles — ici une : h(14) en pause, h(11) attend le passage suivant.
      const lot2 = await admin.mutation(api.radarJudge.e2eApplyJudgments, {
        secret: E2E_SECRET,
        review: [...review, { handle: h(14), app: a, verdict: "sans_rapport" as const }, { handle: h(11), app: a, verdict: "sans_rapport" as const }],
        apps: scope,
        slugs,
        maxActs: 1,
      });
      expect(lot2).toMatchObject({ verdicts: { pause: 1 }, read: review.length + 1 });

      // La piste compte les 4 comptes qui la désignent : 2 « à la place » (en pause), 2 qui poussent les deux (actifs).
      expect(await admin.mutation(api.radarSignals.e2eCandidates, { secret: E2E_SECRET, marker: `${p}moka` })).toEqual([{ key: `ia:${p}moka`, kind: "ia", authorCount: 4 }]);
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
      expect(tracked.get(h(9))).toMatchObject({ status: "active", placement: false });
      expect(tracked.get(h(10))).toMatchObject({ status: "active" });
      expect(tracked.get(h(11))).toMatchObject({ status: "paused" });
      // Relu au lot 2 « sans rapport » : en pause, ne part plus.
      expect(tracked.has(h(14))).toBe(false);
      expect(tracked.get(h(15))).toMatchObject({ status: "active", placement: true });
      // Mis en pause avant la relecture, relu placement : remis en route, étiqueté.
      expect(tracked.get(h(16))).toMatchObject({ status: "active", placement: true });
      // Étiqueté placement avant la relecture, relu « pousse » : plus de placement, relié à son app par la relecture.
      expect(tracked.get(h(17))).toMatchObject({ status: "active", placement: false });
      // Noté pour une autre app avant la relecture, relu sans rapport : en pause, et la piste n'existe plus.
      expect(tracked.has(h(18))).toBe(false);
      expect(await admin.mutation(api.radarSignals.e2eCandidates, { secret: E2E_SECRET, marker: `${p}moka2` })).toEqual([]);
      expect(apps.get(`${p}vide`)).toMatchObject({ status: "active" });
      // Moka suivie d'office (4 comptes la désignent) : seuls les 2 mis en pause par la piste la rejoignent.
      expect(tracked.get(h(12))).toMatchObject({ status: "active", appId: apps.get(`${p}a`)!.id });
      expect(tracked.get(h(13))).toMatchObject({ status: "active", appId: apps.get(`${p}a`)!.id });

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
