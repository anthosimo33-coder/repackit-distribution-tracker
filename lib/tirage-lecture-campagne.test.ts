import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { ProjectMutationCtx, ProjectQueryCtx } from "../convex/functions";
import { parisDayStart } from "../convex/managerCpm";
import { assignScriptCampaignCore, previewCombosCore } from "../convex/scripts";
import { memoryDb, type MemoryDoc } from "./convex-memory-db";

/**
 * Le tirage d'un script (aperçu de la modale, création par l'écran, outils MCP
 * `assigner_scripts` / `rejouer_script`) relisait TOUTES les missions du projet,
 * et la création les relisait DEUX ou TROIS fois (délai entre deux usages, notif,
 * conversation). Mesuré le 21/11/2026 : 8,3 Mo lus par `ecrireAssignation`,
 * 185 appels en une demi-journée de placement de calendriers ; 2,6 Mo par aperçu.
 *
 * Or tout ce que le tirage compare est une CLÉ de combo, et une clé n'est faite
 * que des briques de sa campagne : les missions des autres campagnes ne peuvent
 * ni bloquer ni départager un script de celle-ci (vérifié sur l'export prod du
 * 20/11 : 1 898 missions, aucune clé hors de sa campagne). Le tirage lit donc
 * les missions de SA campagne (index `by_campaign`), plus celles de la créatrice.
 *
 * Seule exception, gardée telle quelle : le message « le premier se libère le… »
 * d'un jour sans script libre se calcule sur tout le projet, comme avant.
 */

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-21T10:00:00Z");
const P = "kh7snytch0000000000000000000000";
const ADMIN = "kh7admin00000000000000000000000";
const jour = (j: string) => parisDayStart(j)!;

let seq = 0;
const doc = (table: string, champs: Record<string, unknown>): MemoryDoc => {
  seq += 1;
  return { _id: `${table}_${String(seq).padStart(6, "0")}`, _creationTime: Date.parse("2026-07-01T08:00:00Z") + seq * 41, ...champs };
};

function monde() {
  const t: Record<string, MemoryDoc[]> = {
    projects: [], users: [], creators: [], comptes: [], pricings: [], scriptCampaigns: [], scriptBricks: [],
    assignments: [], publications: [], assetFolders: [], scenarios: [],
  };
  t.projects.push({ _id: P, _creationTime: 1, slug: "snytch", name: "Snytch", status: "active", comboCooldownDays: 3, payCurrency: "eur" });
  t.users.push({ _id: ADMIN, _creationTime: 2, role: "superadmin", email: "equipe@exemple.test" });
  const bareme = doc("pricings", { projectId: P, name: "Barème FR", status: "active", currency: "eur", createdAt: 0 });
  t.pricings.push(bareme);

  const campagne = (name: string, hooks: number) => {
    const c = doc("scriptCampaigns", { projectId: P, name, status: "active", createdAt: 0 });
    t.scriptCampaigns.push(c);
    const brique = (kind: string, content: string) => {
      const b = doc("scriptBricks", { projectId: P, campaignId: c._id, kind, label: content.slice(0, 24), content, active: true, mode: "texte", createdAt: 0 });
      t.scriptBricks.push(b);
      return b._id;
    };
    return {
      id: c._id,
      hooks: Array.from({ length: hooks }, (_, i) => brique("hook", `Hook ${i} de ${name} — il m'a menti pendant trois mois`)),
      flux: [brique("flux", `Démo ${name}`)],
      ctas: [brique("cta", "Lien en bio 👀")],
    };
  };
  const petite = campagne("Quand ton mec te dit X", 4);
  const grosse = campagne("Démo muette", 6);
  const unique = campagne("Sarah « l'ex revient »", 1);

  const createatrice = (name: string) => {
    const c = doc("creators", { projectId: P, name, status: "active", userId: `users_${name}`, bonusPricingId: bareme._id, createdAt: 0 });
    t.creators.push(c);
    const tiktok = doc("comptes", { projectId: P, creatorId: c._id, plateforme: "TikTok", handle: `${name.toLowerCase()}.snytch_`, status: "actif", actif: true });
    t.comptes.push(tiktok);
    return { id: c._id, tiktok: tiktok._id };
  };
  const kelly = createatrice("Kelly");
  const juliette = createatrice("Juliette");
  const autres = ["Lorena", "Jade", "Marby", "Camila"].map(createatrice);

  const mission = (cr: { id: string; tiktok: string }, camp: { id: string; hooks: string[]; flux: string[]; ctas: string[] }, h: number, postDate: number, status = "todo") => {
    const [hook, flux, cta] = [camp.hooks[h], camp.flux[0], camp.ctas[0]];
    t.assignments.push(doc("assignments", {
      projectId: P, creatorId: cr.id, status, postDate, dueDate: postDate + DAY - 1_000, createdAt: postDate - 6 * DAY,
      contentType: "promo", remunerated: true,
      scriptCombo: { campaignId: camp.id, hookBrickId: hook, fluxBrickId: flux, ctaBrickId: cta },
      comboKey: `${hook}:${flux}:${cta}`,
      targets: [{ platform: "TikTok", accountId: cr.tiktok }],
      instructions: "Filme-toi en lumière naturelle, face caméra, et garde le texte à l'écran deux secondes. ".repeat(3),
    }));
  };
  // Le poids du projet : 600 missions de la grosse campagne, chez les autres.
  for (let k = 0; k < 600; k++) mission(autres[k % 4], grosse, k % 6, jour("2026-08-01") + (k % 100) * DAY, "published");
  // Juliette a programmé le hook 0 de la petite campagne le 10/12 : il est pris
  // pour Kelly le 11/12 (délai de 3 jours du projet).
  mission(juliette, petite, 0, jour("2026-12-10"));
  // Kelly a déjà fait les hooks 1 et 2 de la petite campagne.
  mission(kelly, petite, 1, jour("2026-10-01"), "published");
  mission(kelly, petite, 2, jour("2026-10-03"), "published");
  // Le seul script de la campagne « unique » est programmé chez Juliette le 10/12…
  mission(juliette, unique, 0, jour("2026-12-10"));
  // … et un script d'une AUTRE campagne, programmé le 09/12, se libère plus tôt :
  // c'est lui que le message « le premier se libère le… » a toujours donné.
  mission(autres[0], grosse, 5, jour("2026-12-09"));
  return { t, petite, grosse, unique, kelly, bareme };
}

/** La base en mémoire, avec les écritures d'une mutation (insertions visibles aux lectures suivantes). */
function base(t: Record<string, MemoryDoc[]>) {
  const m = memoryDb(t, { limit: null });
  let n = 0;
  const db = new Proxy(m.db as Record<string, unknown>, {
    get(target, prop) {
      if (prop === "insert") {
        return async (table: string, v: Record<string, unknown>) => {
          const id = `${table}_neuf${++n}`;
          (t[table] ??= []).push({ _id: id, _creationTime: NOW + n, ...v });
          return id;
        };
      }
      if (prop === "patch" || prop === "replace" || prop === "delete") return async () => undefined;
      return target[prop as string];
    },
  });
  const ctx = { db, userId: ADMIN, projectId: P, scheduler: { runAfter: async () => null, runAt: async () => null } };
  return { m, ctx };
}

/**
 * Le plafond de ce que le tirage doit lire, en octets JSON : les missions de la
 * campagne et celles de la créatrice, chacune UNE fois (deux index distincts :
 * ses missions dans cette campagne sont lues par les deux).
 */
function poidsUtile(t: Record<string, MemoryDoc[]>, campaignId: string, creatorId: string) {
  const poids = (lignes: MemoryDoc[]) => lignes.reduce((s, a) => s + JSON.stringify(a).length, 0);
  return (
    poids(t.assignments.filter((a) => (a.scriptCombo as { campaignId?: string } | undefined)?.campaignId === campaignId)) +
    poids(t.assignments.filter((a) => a.creatorId === creatorId))
  );
}

describe("tirage d'un script — les missions de SA campagne, pas tout le projet", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("l'aperçu ne lit que la campagne et la créatrice, et tire le même script", async () => {
    const { t, petite, kelly } = monde();
    const { m, ctx } = base(t);
    const plafond = poidsUtile(t, petite.id, kelly.id);
    const apercu = await previewCombosCore(ctx as unknown as ProjectQueryCtx, {
      campaignId: petite.id as Id<"scriptCampaigns">,
      creatorId: kelly.id as Id<"creators">,
      targets: [{ platform: "TikTok", accountId: kelly.tiktok as Id<"comptes"> }],
      videosPerCreator: 1,
      postDates: [jour("2026-12-11")],
    });
    // Hook 0 : pris chez Juliette le 10/12 ; hooks 1 et 2 : déjà faits par
    // Kelly. Reste le hook 3, jamais fait.
    expect(apercu.combos.map((c) => c.hookBrickId)).toEqual([petite.hooks[3]]);
    expect(m.bytesByTable().assignments).toBeLessThanOrEqual(plafond);
  });

  it("la création lit les missions de la campagne une seule fois", async () => {
    const { t, petite, kelly, bareme } = monde();
    const { m, ctx } = base(t);
    const plafond = poidsUtile(t, petite.id, kelly.id);
    const res = await assignScriptCampaignCore(ctx as unknown as ProjectMutationCtx, {
      campaignId: petite.id as Id<"scriptCampaigns">,
      creatorId: kelly.id as Id<"creators">,
      targets: [{ platform: "TikTok", accountId: kelly.tiktok as Id<"comptes"> }],
      videosPerCreator: 1,
      dueDate: jour("2026-12-12") - 1_000,
      pricingId: bareme._id as Id<"pricings">,
      postDates: [jour("2026-12-11")],
    }, { email: false });
    expect(res.created).toBe(1);
    const creee = t.assignments.find((a) => a._id === res.assignmentIds[0])!;
    expect((creee.scriptCombo as { hookBrickId: string }).hookBrickId).toBe(petite.hooks[3]);
    expect(m.bytesByTable().assignments).toBeLessThanOrEqual(plafond);
  });

  it("jour sans script libre : la date de libération se calcule toujours sur tout le projet", async () => {
    const { t, unique, kelly, bareme } = monde();
    const { ctx } = base(t);
    const essai = assignScriptCampaignCore(ctx as unknown as ProjectMutationCtx, {
      campaignId: unique.id as Id<"scriptCampaigns">,
      creatorId: kelly.id as Id<"creators">,
      targets: [{ platform: "TikTok", accountId: kelly.tiktok as Id<"comptes"> }],
      videosPerCreator: 1,
      dueDate: jour("2026-12-12") - 1_000,
      pricingId: bareme._id as Id<"pricings">,
      postDates: [jour("2026-12-11")],
    }, { email: false });
    // Le script de la grosse campagne (09/12) se libère le 12/12, celui de la
    // campagne visée (10/12) le 13/12 : le message a toujours donné le 12/12.
    await expect(essai).rejects.toMatchObject({ data: { params: { freeAt: jour("2026-12-09") + 3 * DAY } } });
  });
});
