import { describe, expect, it } from "vitest";
import type { ProjectQueryCtx } from "../convex/functions";
import { listAssignmentsCore } from "../convex/assignments";
import { memoryDb, type MemoryDoc } from "./convex-memory-db";
import { debutDesMissionsRecentes, fusionnerPilotage } from "./pilotage-parts";

/**
 * L'écran Missions relisait toute la liste (3,6 Mo sur Snytch, dont 0,82 Mo de
 * briques) à chaque écriture d'une mission : 497 fois le 21/11/2026, 1,78 Go.
 * Il la lit désormais en deux parts — récentes, anciennes — et ne lit plus que
 * les briques que ses missions citent. Ce que l'écran montre ne change pas :
 * mêmes lignes, même ordre, mêmes résumés de combo.
 */

const DAY = 86_400_000;
const P = "projects_snytch";
const ADMIN = "users_admin";
const T0 = Date.parse("2026-08-03T08:00:00Z");

let seq = 0;
const doc = (table: string, champs: Record<string, unknown>, creation?: number): MemoryDoc => {
  seq += 1;
  return { _id: `${table}_${String(seq).padStart(6, "0")}`, _creationTime: creation ?? T0 + seq * 1_000, ...champs };
};

function monde() {
  const t: Record<string, MemoryDoc[]> = {
    projects: [], users: [], creators: [], formats: [], comptes: [], scriptCampaigns: [], scriptBricks: [],
    assetFolders: [], assets: [], assignments: [],
  };
  t.projects.push({ _id: P, _creationTime: 1, slug: "snytch", name: "Snytch" });
  t.projects.push({ _id: "projects_blush", _creationTime: 2, slug: "blush", name: "BLUSH" });
  t.users.push({ _id: ADMIN, _creationTime: 3, role: "superadmin", email: "equipe@exemple.test" });
  const dossier = doc("assetFolders", { projectId: P, name: "FOND C" });
  t.assetFolders.push(dossier);
  t.assets.push(doc("assets", { projectId: P, folderId: dossier._id, name: "fond.mp4" }));
  const format = doc("formats", { projectId: P, name: "Démo muette" });
  t.formats.push(format);
  const campagne = doc("scriptCampaigns", { projectId: P, name: "Quand ton mec te dit X", status: "active" });
  t.scriptCampaigns.push(campagne);
  const brique = (kind: string, label: string) => {
    const b = doc("scriptBricks", { projectId: P, campaignId: campagne._id, kind, label, content: `${label} — ${"texte de brique ".repeat(40)}`, active: true });
    t.scriptBricks.push(b);
    return b._id;
  };
  const hooks = [0, 1, 2, 3].map((i) => brique("hook", `Hook ${i}`));
  const flux = brique("flux", "Démo");
  const cta = brique("cta", "Lien en bio");
  // Le poids mort : des briques qu'aucune mission ne cite.
  for (let i = 0; i < 60; i++) brique("hook", `Hook jamais tiré ${i}`);
  // Une brique d'un AUTRE projet, citée par erreur : son libellé ne doit pas sortir.
  const etrangere = doc("scriptBricks", { projectId: "projects_blush", campaignId: "x", kind: "hook", label: "BLUSH", content: "…", active: true });
  t.scriptBricks.push(etrangere);

  const kelly = doc("creators", { projectId: P, name: "Kelly", status: "active" });
  t.creators.push(kelly);
  const compte = doc("comptes", { projectId: P, creatorId: kelly._id, handle: "kelly.snytch_", plateforme: "TikTok", targetCountry: "FR" });
  t.comptes.push(compte);

  // 40 missions sur 100 jours. `createdAt` ne suit pas toujours l'ordre des
  // documents (une mission importée, des égalités) : la fusion doit refaire
  // l'ordre exact de la liste entière.
  for (let k = 0; k < 40; k++) {
    const creation = T0 + k * 2.5 * DAY;
    // Égalités par paires (k = 20 et 25 : à cheval sur la coupure de J+61).
    const createdAt = k % 7 === 3 ? creation - 9 * DAY : k % 5 === 0 ? T0 + Math.floor(k / 10) * 30 * DAY : creation;
    t.assignments.push(doc("assignments", {
      projectId: P, creatorId: kelly._id, status: k < 30 ? "published" : "todo", createdAt,
      dueDate: createdAt + 5 * DAY, postDate: createdAt + 4 * DAY,
      ...(k % 4 === 0
        ? { formatId: format._id }
        : { scriptCombo: { campaignId: campagne._id, hookBrickId: k === 9 ? etrangere._id : hooks[k % 4], fluxBrickId: flux, ctaBrickId: cta }, comboKey: `${hooks[k % 4]}:${flux}:${cta}` }),
      targets: [{ platform: "TikTok", accountId: compte._id }],
      ...(k % 3 === 0 ? { assetFolderIds: [dossier._id] } : {}),
    }, creation));
  }
  return t;
}

const ctxDe = (db: unknown) => ({ db, userId: ADMIN, projectId: P }) as unknown as ProjectQueryCtx;
const poids = (docs: MemoryDoc[]) => docs.reduce((s, d) => s + JSON.stringify(d).length, 0);

describe("écran Missions en deux parts", () => {
  it("la coupure tombe un lundi 0 h UTC, quatre semaines avant la semaine en cours", () => {
    const d = debutDesMissionsRecentes(Date.parse("2026-11-21T16:15:00Z")); // un samedi
    expect(new Date(d).toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(new Date(d).getUTCDay()).toBe(1);
    // Même coupure toute la semaine, puis une semaine plus tard.
    expect(debutDesMissionsRecentes(Date.parse("2026-11-17T00:00:00Z"))).toBe(d);
    expect(debutDesMissionsRecentes(Date.parse("2026-11-23T00:00:00Z"))).toBe(d + 7 * DAY);
  });

  it("les deux parts fusionnées redonnent la liste entière, ligne pour ligne et dans l'ordre", async () => {
    const t = monde();
    const entiere = await listAssignmentsCore(ctxDe(memoryDb(t).db));
    expect(entiere).toHaveLength(40);
    for (const coupure of [T0, T0 + 30 * DAY, T0 + 61 * DAY, T0 + 200 * DAY]) {
      const recentes = await listAssignmentsCore(ctxDe(memoryDb(t).db), { depuis: coupure, part: "recentes" });
      const anciennes = await listAssignmentsCore(ctxDe(memoryDb(t).db), { depuis: coupure, part: "anciennes" });
      expect(recentes.length + anciennes.length).toBe(40);
      expect(fusionnerPilotage(recentes, anciennes)).toEqual(entiere);
    }
    // Les cas qui piègent une fusion naïve sont bien là : égalités de createdAt
    // et createdAt dans le désordre des documents.
    const dates = entiere.map((a) => a.createdAt);
    expect(new Set(dates).size).toBeLessThan(dates.length);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("la part récente ne lit que les missions récentes", async () => {
    const t = monde();
    const coupure = T0 + 61 * DAY;
    const m = memoryDb(t);
    await listAssignmentsCore(ctxDe(m.db), { depuis: coupure, part: "recentes" });
    expect(m.bytesByTable().assignments).toBe(poids(t.assignments.filter((a) => a._creationTime >= coupure)));
  });

  it("seules les briques citées par les missions sont lues, et pas celles d'un autre projet", async () => {
    const t = monde();
    const m = memoryDb(t);
    const lignes = await listAssignmentsCore(ctxDe(m.db));
    const citees = new Set(
      t.assignments.flatMap((a) => {
        const c = a.scriptCombo as { hookBrickId: string; fluxBrickId: string; ctaBrickId: string } | undefined;
        return c ? [c.hookBrickId, c.fluxBrickId, c.ctaBrickId] : [];
      }),
    );
    expect(m.bytesByTable().scriptBricks).toBeLessThanOrEqual(poids(t.scriptBricks.filter((b) => citees.has(b._id))));
    // Le résumé du combo est celui d'avant : le libellé des briques du projet,
    // « ? » pour celle d'un autre projet.
    expect(lignes.find((l) => l.comboSummary?.startsWith("?"))?.comboSummary).toBe("? · Démo · Lien en bio");
    expect(lignes.filter((l) => l.comboSummary?.startsWith("Hook 1 ·")).length).toBeGreaterThan(0);
  });
});
