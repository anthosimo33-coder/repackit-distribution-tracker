import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { ProjectQueryCtx } from "../convex/functions";
import { parisDayStart } from "../convex/managerCpm";
import { hooksRatesDe, planCore } from "../convex/pilote";
import {
  cleMediane,
  hooksRates,
  medianesDe,
  planifier,
  PILOTE,
  type CampagnePilote,
  type Etage,
  type VideoPassee,
} from "../convex/pilotePlan";
import { memoryDb, type MemoryDoc } from "./convex-memory-db";

/**
 * HOOKS RATÉS — un nouveau script du Pilote ne reprend pas chez une créatrice un
 * hook qui n'a pas marché chez elle (08/11/2026). Le tirage excluait des
 * COMBINAISONS (hook + flux + légende), si bien que Karla recevait « Amigas, el
 * contacto cero » et « Si fue él quien te dejó » avec une autre légende, après
 * les avoir tournés sous ses médianes.
 *
 * Les chiffres sont les siens, relevés sur l'export prod du 08/11 : ses douze
 * vidéos mûres donnent exactement ses médianes (parlé TikTok 323,5 / Instagram
 * 2 034 ; muet TikTok 251 / Instagram 1 326,5) et six hooks ratés — dont un à
 * 11 vues sous la médiane Instagram (1 315 / 1 326,5) et un hook sauvé de 12
 * vues TikTok (279 / 251) et 12 vues Instagram (1 338 / 1 326,5).
 */

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.parse("2026-11-08T17:51:37Z");

/** Un identifiant au format Convex (32 caractères). */
const cid = (nom: string) => `n57${nom.toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(29, "0").slice(0, 29)}`;

const PARLE = cid("campagneparlemx");
const MUET = cid("campagnemuetmx");
const KARLA = cid("karla");
const AUTRE = cid("autrecreatrice");

const HOOK = {
  amigas: cid("hookamigascontactocero"),
  sifue: cid("hooksifueelquientedejo"),
  nunca: cid("hooknuncaregresa"),
  cuando: cid("hookcuandotunovio"),
  contacto: cid("hookelcontactocerosesupone"),
  asi: cid("hookasifuecomomeentere"),
  sabado: cid("hookdesdeelsabado"),
  desdecuando: cid("hookdesdecuandoinstagram"),
  minovio: cid("hookminovollevatresdias"),
  del2006: cid("hooklasdel2006"),
  lasque: cid("hooklasquetienennovio"),
} as const;
const F_PARLE = cid("fluxparle");
const F_MUET = cid("fluxmuet");
const C1 = cid("ctaenlabio");
const C2 = cid("ctabuscasnytch");
const C3 = cid("ctamuetenlabio");
const C4 = cid("ctamuetappstore");

/** Les six hooks ratés chez Karla le 08/11 (toutes ses publications mûres sous sa médiane). */
const RATES_KARLA = [HOOK.amigas, HOOK.sifue, HOOK.nunca, HOOK.asi, HOOK.sabado, HOOK.desdecuando].sort();

let seq = 0;
/** Une vidéo publiée il y a `ilYa` jours, TikTok + Instagram (relevés du 08/11). */
function video(
  creatorId: string,
  campaignId: string,
  hook: string,
  flux: string,
  cta: string,
  ilYa: number,
  vues: Partial<Record<"TikTok" | "Instagram" | "Facebook", number | null>>,
): VideoPassee {
  seq += 1;
  const publieeA = NOW - ilYa * DAY - 5 * H;
  return {
    assignmentId: cid(`assignment${seq}`),
    creatorId,
    campaignId,
    comboKey: `${hook}:${flux}:${cta}`,
    hookId: hook,
    jour: new Date(publieeA).toISOString().slice(0, 10),
    publications: Object.entries(vues).map(([plateforme, v]) => ({
      plateforme,
      vues: v ?? null,
      publieeA,
      lien: `https://www.tiktok.com/@karla.snytch_/video/${7_570_000_000_000_000_000 + seq}`,
    })),
  };
}

/** Les douze vidéos mûres de Karla au 08/11, vues TikTok / Instagram. */
function videosKarla(): VideoPassee[] {
  return [
    video(KARLA, PARLE, HOOK.amigas, F_PARLE, C1, 16, { TikTok: 212, Instagram: 1_528 }),
    video(KARLA, PARLE, HOOK.sifue, F_PARLE, C1, 15, { TikTok: 279, Instagram: 1_265 }),
    video(KARLA, PARLE, HOOK.nunca, F_PARLE, C1, 14, { TikTok: 221, Instagram: 1_308 }),
    video(KARLA, PARLE, HOOK.cuando, F_PARLE, C1, 13, { TikTok: 368, Instagram: 5_804 }),
    video(KARLA, PARLE, HOOK.cuando, F_PARLE, C2, 9, { TikTok: 751, Instagram: 2_540 }),
    video(KARLA, PARLE, HOOK.contacto, F_PARLE, C1, 8, { TikTok: 620, Instagram: 3_108 }),
    video(KARLA, MUET, HOOK.asi, F_MUET, C3, 16, { TikTok: 37, Instagram: 1_315 }),
    video(KARLA, MUET, HOOK.sabado, F_MUET, C3, 15, { TikTok: 202, Instagram: 1_183 }),
    video(KARLA, MUET, HOOK.desdecuando, F_MUET, C3, 14, { TikTok: 223, Instagram: 1_265 }),
    video(KARLA, MUET, HOOK.minovio, F_MUET, C3, 12, { TikTok: 845, Instagram: 2_563 }),
    video(KARLA, MUET, HOOK.del2006, F_MUET, C3, 11, { TikTok: 279, Instagram: 1_338 }),
    video(KARLA, MUET, HOOK.lasque, F_MUET, C3, 10, { TikTok: 2_802, Instagram: 2_218 }),
  ];
}

const ETAGE: Record<string, Etage> = { [PARLE]: "tofu", [MUET]: "bofu" };
const etageDe = (id: string) => ETAGE[id] ?? null;
const ratesDe = (videos: VideoPassee[]) => hooksRates(videos, medianesDe(videos, NOW, etageDe), etageDe, NOW);

// ─── La règle ───────────────────────────────────────────────────────────────

describe("hooksRates — un hook est raté quand TOUTES ses publications mûres sont sous sa médiane", () => {
  it("ses médianes du 08/11, par étage et plateforme", () => {
    const m = medianesDe(videosKarla(), NOW, etageDe);
    expect(m[cleMediane("tofu", "TikTok")]).toBe(323.5);
    expect(m[cleMediane("tofu", "Instagram")]).toBe(2_034);
    expect(m[cleMediane("bofu", "TikTok")]).toBe(251);
    expect(m[cleMediane("bofu", "Instagram")]).toBe(1_326.5);
  });

  it("ses six hooks ratés — et pas les cinq qui ont tenu une fois au moins", () => {
    const rates = ratesDe(videosKarla());
    expect(rates).toEqual(RATES_KARLA);
    // Présence de l'autre côté : sauvé de peu (279 > 251 TikTok, 1 338 > 1 326,5 Instagram).
    expect(rates).not.toContain(HOOK.del2006);
    // Deux passages, deux légendes : jugé sur le hook, pas sur la combinaison.
    expect(rates).not.toContain(HOOK.cuando);
  });

  it("un seul passage au-dessus de sa médiane, sur une autre légende, sauve le hook", () => {
    const v = [...videosKarla(), video(KARLA, PARLE, HOOK.amigas, F_PARLE, C2, 5, { TikTok: 410, Instagram: 1_402 })];
    expect(ratesDe(v)).not.toContain(HOOK.amigas);
    expect(ratesDe(v)).toContain(HOOK.sifue);
  });

  it("à la médiane exacte, le hook n'est pas « sous » sa médiane", () => {
    // Jugé contre ses médianes du 08/11, figées : changer ses vues déplacerait
    // aussi la médiane qu'elles composent.
    const medianes = medianesDe(videosKarla(), NOW, etageDe);
    const v = videosKarla();
    v[1].publications[0].vues = 323.5; // « Si fue él » TikTok
    v[1].publications[1].vues = 2_034; // et Instagram
    expect(hooksRates(v, medianes, etageDe, NOW)).not.toContain(HOOK.sifue);
    v[1].publications[1].vues = 2_033;
    expect(hooksRates(v, medianes, etageDe, NOW)).not.toContain(HOOK.sifue);
    v[1].publications[0].vues = 323;
    expect(hooksRates(v, medianes, etageDe, NOW)).toContain(HOOK.sifue);
  });

  it("seules les publications mûres (72 h) TikTok / Instagram relevées comptent", () => {
    const v = videosKarla();
    // Un post de 36 h à 30 000 vues ne sauve pas un hook raté…
    v.push(video(KARLA, PARLE, HOOK.amigas, F_PARLE, C2, 0, { TikTok: 30_000 }));
    v[v.length - 1].publications[0].publieeA = NOW - 36 * H;
    // … ni un Facebook à 52 000 vues, ni un relevé manquant.
    v[0].publications.push({ plateforme: "Facebook", vues: 52_000, publieeA: v[0].publications[0].publieeA, lien: null });
    v[1].publications.push({ plateforme: "TikTok", vues: null, publieeA: v[1].publications[0].publieeA, lien: null });
    expect(ratesDe(v)).toEqual(RATES_KARLA);
    // Un hook qui n'a QUE des posts trop jeunes n'est pas jugé.
    const jeune = video(KARLA, PARLE, cid("hookjeune"), F_PARLE, C1, 0, { TikTok: 12, Instagram: 40 });
    jeune.publications.forEach((p) => (p.publieeA = NOW - 48 * H));
    expect(ratesDe([...videosKarla(), jeune])).not.toContain(cid("hookjeune"));
  });

  it("sans médiane (moins de 3 vidéos mûres à cet étage), rien n'est raté", () => {
    const recrue = videosKarla().filter((v) => v.campaignId === PARLE).slice(0, 2);
    expect(medianesDe(recrue, NOW, etageDe)[cleMediane("tofu", "TikTok")]).toBeNull();
    expect(ratesDe(recrue)).toEqual([]);
  });
});

describe("planifier — ses hooks ratés ne lui reviennent pas par les gagnants des autres", () => {
  const CAMPAGNES: CampagnePilote[] = [
    { id: PARLE, etage: "tofu", active: true, tirable: true },
    { id: MUET, etage: "bofu", active: true, tirable: true },
  ];
  const HOOK_AUTRE = cid("hookvaaregresarperonocuando");
  const autre = () => [
    video(AUTRE, PARLE, HOOK.contacto, F_PARLE, C2, 13, { TikTok: 2_900 }),
    video(AUTRE, PARLE, HOOK.cuando, F_PARLE, C2, 12, { TikTok: 3_100 }),
    video(AUTRE, PARLE, HOOK.nunca, F_PARLE, C2, 11, { TikTok: 3_400 }),
    // Ses deux gagnants : un sur un hook raté chez Karla, un sur un hook neuf pour elle.
    video(AUTRE, PARLE, HOOK.amigas, F_PARLE, C2, 7, { TikTok: 18_400 }),
    video(AUTRE, PARLE, HOOK_AUTRE, F_PARLE, C1, 6, { TikTok: 15_200 }),
  ];

  it("le gagnant d'une autre sur « Amigas » n'est pas proposé à Karla ; l'autre gagnant l'est", () => {
    const videos = [...videosKarla(), ...autre()];
    const [plan] = planifier({
      createatrices: [{ id: KARLA, cadence: 2 }],
      videos,
      missions: videos.map((v) => ({ creatorId: v.creatorId, jour: v.jour, campaignId: v.campaignId, comboKey: v.comboKey })),
      campagnes: CAMPAGNES,
      jours: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"],
      maintenant: NOW,
      aujourdhui: "2026-11-08",
      exploration: 0,
      seuil: PILOTE.seuilDefaut,
      delaiCombo: 1,
    });
    expect(plan.hooksRates).toEqual(RATES_KARLA);
    const proposes = plan.creneaux.flatMap((c) => [
      ...(c.source?.kind === "rejeu" ? [c.source] : []),
      ...c.alternatives,
    ]);
    const deLAutre = proposes.filter((s) => s.creatorId === AUTRE).map((s) => s.comboKey.split(":")[0]);
    expect(deLAutre).toContain(HOOK_AUTRE);
    expect(deLAutre).not.toContain(HOOK.amigas);
  });
});

// ─── Le câblage : plan → aperçu du tirage, et l'assignation ────────────────

/**
 * Le VRAI planCore sur une base qui suit les index du schéma. Les campagnes de
 * Karla ont leurs briques dans l'ordre de création réel : les hooks ratés
 * d'abord. Le tirage « least-used » départage dans cet ordre, si bien qu'avant
 * le correctif il retombait sur eux dès qu'une combinaison restait libre.
 */
describe("planCore — l'aperçu des nouveaux scripts écarte ses hooks ratés", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  const PROJET = "kh7snytch0000000000000000000000" as Id<"projects">;
  const ADMIN = "kh7admin00000000000000000000000" as Id<"users">;
  const TIKTOK = cid("comptekarlatiktok");
  const INSTA = cid("comptekarlainsta");
  const FACEBOOK = cid("comptekarlafacebook");
  const NUEVO = cid("hookvaaregresarpero");

  function base() {
    let n = 0;
    const cree = () => Date.parse("2026-10-01T08:00:00Z") + ++n * 1_000;
    const t: Record<string, MemoryDoc[]> = {
      projects: [{ _id: PROJET, _creationTime: 1, slug: "snytch", name: "Snytch", status: "active", comboCooldownDays: 1 }],
      users: [{ _id: ADMIN, _creationTime: 2, role: "superadmin", email: "equipe@snytch.co" }],
      pricings: [],
      creators: [],
      comptes: [],
      scriptCampaigns: [],
      scriptBricks: [],
      assignments: [],
      publications: [],
    };
    const bareme = cid("baremeMX");
    t.pricings.push({ _id: bareme, _creationTime: cree(), projectId: PROJET, name: "Barème MX", status: "active", currency: "MXN", createdAt: 0 });
    t.creators.push({ _id: KARLA, _creationTime: cree(), projectId: PROJET, name: "Karla Martinez", status: "active", bonusPricingId: bareme, locale: "es", createdAt: 0 });
    for (const [id, plateforme, handle] of [
      [TIKTOK, "TikTok", "karla.snytch_"],
      [INSTA, "Instagram", "karla.verif.mx"],
      [FACEBOOK, "Facebook", "Karla Snytch"],
    ] as const) {
      t.comptes.push({ _id: id, _creationTime: cree(), projectId: PROJET, creatorId: KARLA, plateforme, handle, status: "actif", actif: true });
    }
    const brique = (campaignId: string, id: string, kind: string, content: string) =>
      t.scriptBricks.push({ _id: id, _creationTime: cree(), projectId: PROJET, campaignId, kind, label: content.slice(0, 60), content, active: true, mode: "texte", createdAt: 0 });
    t.scriptCampaigns.push({ _id: PARLE, _creationTime: cree(), projectId: PROJET, name: "Format parlé 🇲🇽", status: "active", funnelStage: "tofu", createdAt: 0 });
    t.scriptCampaigns.push({ _id: MUET, _creationTime: cree(), projectId: PROJET, name: "Reaction + Demo MUET 🇲🇽", status: "active", funnelStage: "bofu", createdAt: 0 });
    brique(PARLE, HOOK.amigas, "hook", "Amigas, el contacto cero es la única técnica que de verdad funciona para que regrese.");
    brique(PARLE, HOOK.sifue, "hook", "Si fue él quien te dejó, va a regresar. Cien por ciento.");
    brique(PARLE, HOOK.nunca, "hook", "Nunca regresa cuando estás llorando. Regresa la noche que dejas de esperarlo.");
    brique(PARLE, HOOK.cuando, "hook", "Cuando tu novio te dice “ten, revisa mi celular”, es porque ya borró todo.");
    brique(PARLE, HOOK.contacto, "hook", "El contacto cero se supone que es la mejor técnica para que regrese.");
    brique(PARLE, NUEVO, "hook", "Va a regresar, pero no cuando tú crees.");
    brique(PARLE, F_PARLE, "flux", "Y si quieres saber con quién habla, Snytch te lo dice.");
    brique(PARLE, C1, "cta", "Link en mi bio 👀");
    brique(PARLE, C2, "cta", "Busca « snytch » en la App Store");
    brique(MUET, HOOK.asi, "hook", "ASÍ fue como me enteré ANTES de que él siquiera lo admitiera");
    brique(MUET, HOOK.sabado, "hook", "Desde el sábado pone su celular boca abajo en la mesa");
    brique(MUET, HOOK.desdecuando, "hook", "¿¿DESDE CUÁNDO INSTAGRAM TIENE ESTA FUNCIÓN???");
    brique(MUET, HOOK.minovio, "hook", "Mi novio lleva tres días bien raro, y hoy por fin entendí por qué");
    brique(MUET, HOOK.del2006, "hook", "¡¡LAS DEL 2006 QUE TIENEN NOVIO YA VALIERON JAJAJA!!!!");
    brique(MUET, HOOK.lasque, "hook", "¡¡LAS QUE TIENEN NOVIO YA VALIERON JAJAJA!!");
    brique(MUET, F_MUET, "flux", "Démo : recherche du @jeremieltvt");
    brique(MUET, C3, "cta", "👆 La app en mi bio");
    brique(MUET, C4, "cta", "Snytch en la App Store");

    // Ses missions publiées : la plus ancienne d'abord (« Amigas » porte en
    // plus un Facebook à 52 000 vues, hors règle comme celui de Kelly). Un
    // « Si fue él » d'il y a 40 jours à 9 000 vues : hors de la fenêtre que le
    // plan lit (35 jours), il ne le sauve pas — l'assignation non plus.
    const parAnciennete = [
      video(KARLA, PARLE, HOOK.sifue, F_PARLE, C2, 40, { TikTok: 9_000, Instagram: 6_100 }),
      ...videosKarla(),
    ].sort((a, b) => a.publications[0].publieeA - b.publications[0].publieeA);
    for (const [i, v] of parAnciennete.entries()) {
      const publieeA = v.publications[0].publieeA;
      const [hook, flux, cta] = v.comboKey.split(":");
      const pubs = v.publications.map((p) => ({ ...p }));
      if (hook === HOOK.amigas) pubs.push({ plateforme: "Facebook", vues: 52_000, publieeA, lien: null });
      const compte = { TikTok: TIKTOK, Instagram: INSTA, Facebook: FACEBOOK } as Record<string, string>;
      const targets = pubs.map((p) => {
        const id = cid(`publication${i}${p.plateforme}`);
        t.publications.push({
          _id: id, _creationTime: cree(), projectId: PROJET, plateforme: p.plateforme, compte: "karla.snytch_",
          datePubli: publieeA, vuesLatest: p.vues ?? undefined, postUrl: p.lien ?? undefined, isWarmup: false,
          scriptCombo: { campaignId: v.campaignId, hookBrickId: hook, fluxBrickId: flux, ctaBrickId: cta },
        });
        return { platform: p.plateforme, accountId: compte[p.plateforme], publicationId: id, publishedAt: publieeA };
      });
      const postDate = parisDayStart(new Date(publieeA).toISOString().slice(0, 10))!;
      t.assignments.push({
        _id: v.assignmentId, _creationTime: cree(), projectId: PROJET, creatorId: KARLA, status: "published",
        postDate, dueDate: postDate + DAY - 1_000, createdAt: postDate - 3 * DAY, contentType: "promo", remunerated: true,
        scriptCombo: { campaignId: v.campaignId, hookBrickId: hook, fluxBrickId: flux, ctaBrickId: cta, assembledScript: "…" },
        comboKey: v.comboKey,
        targets,
      });
    }
    return t;
  }

  const ctxDe = (db: unknown) => ({ db, userId: ADMIN, projectId: PROJET }) as unknown as ProjectQueryCtx;
  const argsPlan = {
    createatrices: [{ creatorId: KARLA as Id<"creators">, cadence: 2 }],
    du: "2026-11-09",
    jours: 2,
    exploration: 1,
    seuil: PILOTE.seuilDefaut,
    retires: [],
    choix: [],
    exclusions: [],
  };

  it("aucun nouveau script sur un hook raté ; les autres hooks sont tirés", async () => {
    const plan = await planCore(ctxDe(memoryDb(base()).db), argsPlan);
    const [karla] = plan.createatrices;
    expect(karla.hooksEcartes.map((h) => h.id).sort()).toEqual(RATES_KARLA);

    const nouveaux = karla.creneaux.map((c) => (c.source?.kind === "nouveau" ? c.source.apercu?.cle ?? null : null));
    // Présence : chaque créneau a son script, tiré dans l'ordre « least-used ».
    expect(nouveaux).toEqual([
      `${NUEVO}:${F_PARLE}:${C2}`,
      `${HOOK.minovio}:${F_MUET}:${C4}`,
      `${HOOK.contacto}:${F_PARLE}:${C2}`,
      `${HOOK.del2006}:${F_MUET}:${C4}`,
    ]);
    // Absence : aucun hook raté chez elle.
    expect(nouveaux.filter((k) => k !== null && RATES_KARLA.includes(k.split(":")[0]))).toEqual([]);
  });

  it("l'assignation relit en base les mêmes hooks ratés que le plan", async () => {
    const tables = base();
    const plan = await planCore(ctxDe(memoryDb(tables).db), argsPlan);
    const sesMissions = tables.assignments.filter((a) => a.creatorId === KARLA) as never[];
    const relus = await hooksRatesDe(ctxDe(memoryDb(tables).db), sesMissions, NOW);
    expect([...relus].sort()).toEqual(plan.createatrices[0].hooksEcartes.map((h) => h.id).sort());
    expect(relus.size).toBe(6);
  });
});
