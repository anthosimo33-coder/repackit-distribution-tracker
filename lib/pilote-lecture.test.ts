import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { ProjectQueryCtx } from "../convex/functions";
import { parisDayStart } from "../convex/managerCpm";
import { planCore } from "../convex/pilote";
import { previewCombosCore } from "../convex/scripts";
import { CONVEX_READ_LIMIT, memoryDb, type MemoryDoc } from "./convex-memory-db";

/**
 * L'outil MCP `piloter_missions` et l'écran /pilote passent par `planCore`. Le
 * 2026-11-08, il répondait « Erreur interne » dès qu'on lui passait beaucoup de
 * créatrices : chaque aperçu de tirage (une créatrice × une campagne à nouveau
 * script) relisait les 1 239 missions du projet Snytch — 43 641 lectures pour
 * 20 créatrices sur l'export prod, limite Convex 32 000.
 *
 * Le projet simulé a la forme de Snytch : ~1 250 missions sur quatre mois,
 * chaque créatrice sur une campagne parlée et une muette que d'autres tournent
 * aussi, des publications avec leurs vues, une campagne non classée, des
 * campagnes archivées, et un autre projet à côté.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-08T17:51:37Z");
const SNYTCH = "kh7snytch0000000000000000000000" as Id<"projects">;
const BLUSH = "kh7blush00000000000000000000000" as Id<"projects">;
const ADMIN = "kh7admin00000000000000000000000" as Id<"users">;

const PRENOMS = [
  "Juliette Chetrit", "Sarah Da Costa", "Thania Moreira", "Lorena Vidal", "Camila Herrera",
  "Laís Fernandes", "Karla Martinez", "Marby Ruiz", "Maria Eduarda Lima", "Jade Rouby",
  "Elisa Ferrand", "Beyda Ortega", "Naia Etxeberria", "Jimena Salas", "Clara Cappe",
  "Ilona Mercier", "Charlyse N'Diaye", "Erine Lacombe", "Lou-Anne Petit", "Kelly Martins",
  "Mewen Le Gall", "Bruna de Sousa", "Tainara Garcia", "Cintia Brandão",
];

let seq = 0;
const doc = (table: string, champs: Record<string, unknown>): MemoryDoc => {
  seq += 1;
  return { _id: `${table}_${String(seq).padStart(6, "0")}`, _creationTime: Date.parse("2026-07-01T08:00:00Z") + seq * 41, ...champs };
};

function projetSnytch() {
  const t: Record<string, MemoryDoc[]> = {
    projects: [], users: [], creators: [], comptes: [], pricings: [],
    scriptCampaigns: [], scriptBricks: [], assignments: [], publications: [],
  };
  t.projects.push({ _id: SNYTCH, _creationTime: 1, slug: "snytch", name: "Snytch", status: "active", comboCooldownDays: 1 });
  t.projects.push({ _id: BLUSH, _creationTime: 2, slug: "blush", name: "BLUSH", status: "active" });
  t.users.push({ _id: ADMIN, _creationTime: 3, role: "superadmin", email: "equipe@snytch.co" });

  const bareme = doc("pricings", { projectId: SNYTCH, name: "Barème FR 400 €/30", status: "active", currency: "EUR", createdAt: 0 });
  t.pricings.push(bareme);

  const campagne = (projectId: string, name: string, funnelStage: "tofu" | "bofu" | undefined, status = "active") => {
    const c = doc("scriptCampaigns", { projectId, name, status, funnelStage, createdAt: 0 });
    t.scriptCampaigns.push(c);
    const brique = (kind: string, content: string) => {
      const b = doc("scriptBricks", { projectId, campaignId: c._id, kind, label: content.slice(0, 24), content, active: true, mode: "texte", createdAt: 0 });
      t.scriptBricks.push(b);
      return b._id;
    };
    return {
      id: c._id,
      hooks: [
        brique("hook", `Quand ton mec te dit « j'étais à la salle » (${name})`),
        brique("hook", `Il est bizarre depuis 3 semaines (${name})`),
        brique("hook", `POV : tu retrouves son 2e compte (${name})`),
        brique("hook", `Elle like tout ce qu'il poste (${name})`),
      ],
      flux: [brique("flux", "Démo Snytch — recherche du @jeremieltvt"), brique("flux", "Réaction écran partagé")],
      ctas: [brique("cta", "Lien en bio 👀"), brique("cta", "Tape « snytch » sur l'App Store")],
    };
  };
  const parlees = [
    campagne(SNYTCH, "Quand ton mec te dit X 🇫🇷", "tofu"),
    campagne(SNYTCH, "Bizarre depuis X 🇲🇽", "tofu"),
    campagne(SNYTCH, "Reaction + Demo LAB 🇫🇷", "tofu"),
  ];
  const muettes = [
    campagne(SNYTCH, "Démo muette 🇫🇷", "bofu"),
    campagne(SNYTCH, "Démo muette 🇧🇷", "bofu"),
    campagne(SNYTCH, "Notif muette 🇪🇸", "bofu"),
  ];
  const nonClassee = campagne(SNYTCH, "Sarah « l'ex revient » 🇫🇷", undefined);
  campagne(SNYTCH, "CRUSH conversations (archivée)", "tofu", "archived");

  const createatrices = PRENOMS.map((name, i) => {
    const c = doc("creators", { projectId: SNYTCH, name, status: "active", bonusPricingId: bareme._id, locale: "fr", createdAt: 0 });
    t.creators.push(c);
    const pseudo = name.split(" ")[0].toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    const tiktok = doc("comptes", { projectId: SNYTCH, creatorId: c._id, plateforme: "TikTok", handle: `${pseudo}.snytch_`, status: "actif", actif: true });
    const insta = doc("comptes", { projectId: SNYTCH, creatorId: c._id, plateforme: "Instagram", handle: `${pseudo}.verif.fr`, status: "actif", actif: true });
    t.comptes.push(tiktok, insta);
    return { id: c._id, rang: i, tiktok: tiktok._id, insta: insta._id };
  });

  // 52 missions par créatrice, une tous les deux jours, parlé et muet en
  // alternance ; ses combos tournent depuis un décalage à elle, ses
  // campagnes sont partagées avec d'autres.
  const debut = Date.parse("2026-07-14T10:00:00Z");
  for (const cr of createatrices) {
    const parlee = parlees[cr.rang % 3];
    const muette = muettes[(cr.rang >> 1) % 3];
    for (let k = 0; k < 52; k++) {
      const camp = cr.rang === 1 && k % 5 === 0 ? nonClassee : k % 2 === 0 ? parlee : muette;
      const n = k + cr.rang * 3;
      const hook = camp.hooks[n % 4];
      const flux = camp.flux[Math.floor(n / 4) % 2];
      const cta = camp.ctas[Math.floor(n / 8) % 2];
      const postDate = parisDayStart(new Date(debut + (k * 2 + (cr.rang % 2)) * DAY).toISOString().slice(0, 10))!;
      const passee = postDate < NOW - DAY;
      const status = !passee ? "todo" : k % 17 === 3 ? "cancelled" : k % 23 === 5 ? "video_rejected" : "published";
      const targets: Record<string, unknown>[] = [
        { platform: "TikTok", accountId: cr.tiktok },
        { platform: "Instagram", accountId: cr.insta },
      ];
      if (status === "published") {
        for (const target of targets) {
          const datePubli = postDate + 19 * 3_600_000 + cr.rang * 60_000;
          const vues = target.platform === "TikTok" ? 1_200 + ((n * 7_919) % 9_000) + (n % 13 === 0 ? 41_000 : 0) : 380 + ((n * 3_571) % 4_100);
          const p = doc("publications", {
            projectId: SNYTCH,
            plateforme: target.platform,
            compte: target.platform === "TikTok" ? `${cr.rang}.snytch_` : `${cr.rang}.verif.fr`,
            datePubli,
            vuesLatest: vues,
            postUrl: `https://www.tiktok.com/@x/video/${7_412_000_000 + seq}`,
            scriptCombo: { campaignId: camp.id, hookBrickId: hook, fluxBrickId: flux, ctaBrickId: cta },
          });
          t.publications.push(p);
          target.publicationId = p._id;
          target.publishedAt = datePubli;
        }
      }
      t.assignments.push(
        doc("assignments", {
          projectId: SNYTCH,
          creatorId: cr.id,
          status,
          postDate,
          dueDate: postDate + DAY - 1_000,
          createdAt: postDate - 6 * DAY,
          contentType: "promo",
          remunerated: true,
          scriptCombo: { campaignId: camp.id, hookBrickId: hook, fluxBrickId: flux, ctaBrickId: cta, assembledScript: `Script ${n}` },
          comboKey: `${hook}:${flux}:${cta}`,
          targets,
        }),
      );
    }
  }

  // Un autre projet, qui ne doit rien coûter à Snytch.
  const blush = campagne(BLUSH, "BLUSH conversations", "tofu");
  const lea = doc("creators", { projectId: BLUSH, name: "Léa Marchetti", status: "active", createdAt: 0 });
  t.creators.push(lea);
  for (let k = 0; k < 120; k++) {
    t.assignments.push(
      doc("assignments", {
        projectId: BLUSH, creatorId: lea._id, status: "published", postDate: debut + k * DAY, createdAt: debut + k * DAY,
        scriptCombo: { campaignId: blush.id, hookBrickId: blush.hooks[k % 4], fluxBrickId: blush.flux[0], ctaBrickId: blush.ctas[0] },
        comboKey: `${blush.hooks[k % 4]}:${blush.flux[0]}:${blush.ctas[0]}`, targets: [],
      }),
    );
  }
  return { tables: t, createatrices };
}

const argsPlan = (creatorIds: string[]) => ({
  createatrices: creatorIds.map((id) => ({ creatorId: id as Id<"creators">, cadence: 2 })),
  du: "2026-11-09",
  jours: 7,
  exploration: 0.3,
  seuil: 1.5,
  retires: [],
  choix: [],
  exclusions: [],
});

describe("planCore — les missions du projet lues une fois, pas une fois par aperçu", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  const { tables, createatrices } = projetSnytch();
  const vingt = createatrices.slice(0, 20).map((c) => c.id);
  const ctxDe = (db: unknown) => ({ db, userId: ADMIN, projectId: SNYTCH }) as unknown as ProjectQueryCtx;

  it("le jeu a la forme de Snytch : ~1 250 missions, des campagnes partagées", () => {
    expect(tables.assignments.filter((a) => a.projectId === SNYTCH).length).toBe(1_248);
  });

  it("20 créatrices : sous la limite Convex, chaque nouveau script a son aperçu", async () => {
    const m = memoryDb(tables, { limit: null });
    const plan = await planCore(ctxDe(m.db), argsPlan(vingt));

    expect(m.reads()).toBeLessThanOrEqual(CONVEX_READ_LIMIT);
    const creneaux = plan.createatrices.flatMap((c) => c.creneaux);
    const nouveaux = creneaux.filter((c) => c.source?.kind === "nouveau");
    // Présence : le plan tire bien des nouveaux scripts, et des rejeux.
    expect(nouveaux.length).toBeGreaterThan(100);
    expect(creneaux.some((c) => c.source?.kind === "rejeu")).toBe(true);
    // Un aperçu tombé (limite, erreur avalée) laisserait un créneau « à court ».
    expect(creneaux.filter((c) => c.vide === "aCourt")).toEqual([]);
    expect(nouveaux.every((c) => c.source?.kind === "nouveau" && c.source.apercu !== null)).toBe(true);
  });

  it("même tirage qu'un aperçu seul, y compris pour une campagne tirée chez plusieurs créatrices", async () => {
    const m = memoryDb(tables, { limit: null });
    const plan = await planCore(ctxDe(m.db), argsPlan(vingt));
    const compteId = new Map(tables.comptes.map((c) => [`${c.handle}|${c.plateforme}`, c._id]));

    const createatricesParCampagne = new Map<string, Set<string>>();
    let compares = 0;
    for (const cr of plan.createatrices) {
      const parCampagne = new Map<string, { jour: string; cle: string | null }[]>();
      for (const c of cr.creneaux) {
        if (c.source?.kind !== "nouveau") continue;
        const l = parCampagne.get(c.source.campaignId) ?? [];
        l.push({ jour: c.jour, cle: c.source.apercu?.cle ?? null });
        parCampagne.set(c.source.campaignId, l);
      }
      for (const [campaignId, slots] of parCampagne) {
        createatricesParCampagne.set(campaignId, (createatricesParCampagne.get(campaignId) ?? new Set()).add(cr.creatorId));
        // L'aperçu SEUL, comme la modale d'assignation : il lit ses missions.
        const seul = await previewCombosCore(ctxDe(memoryDb(tables).db), {
          campaignId: campaignId as Id<"scriptCampaigns">,
          creatorId: cr.creatorId,
          targets: cr.comptes.map((c) => ({
            platform: c.plateforme as "TikTok" | "Instagram",
            accountId: compteId.get(`${c.handle}|${c.plateforme}`) as Id<"comptes">,
          })),
          videosPerCreator: slots.length,
          postDates: slots.map((s) => parisDayStart(s.jour)!),
        });
        expect(slots.map((s) => s.cle)).toEqual(seul.combos.map((c) => c.comboKey));
        compares += 1;
      }
    }
    expect(compares).toBeGreaterThan(30);
    // Le cas qui piège un cache mal clé : une même campagne chez plusieurs
    // créatrices, chacune avec ses propres scripts déjà tournés.
    expect(Math.max(...[...createatricesParCampagne.values()].map((s) => s.size))).toBeGreaterThanOrEqual(5);
  });
});
