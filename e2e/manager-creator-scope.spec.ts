import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { defaultManagerPermissions } from "../convex/permissions";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * PÉRIMÈTRE DE CRÉATRICES D'UN MANAGER — sur qui il a la main.
 *
 * Ce qui est vérifié est ce que le manager VOIT et ce que le serveur le laisse
 * FAIRE, depuis une vraie session manager — pas que la mutation d'écriture
 * réussit. Un périmètre bien enregistré mais ignoré par les listes serait vert
 * sur l'écriture et faux partout ailleurs.
 *
 * Chaque absence est doublée d'une PRÉSENCE (règle de #47/#49) : « Inès absente »
 * ne prouve rien si la liste est vide pour une autre raison.
 */

/** Code d'une ConvexError levée, ou le texte si la charge n'en porte pas. */
async function codeDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "PAS DE REFUS";
  } catch (e) {
    if (e instanceof ConvexError) {
      const d = e.data as { code?: string } | string;
      return typeof d === "object" && d.code ? d.code : String(d);
    }
    return String(e);
  }
}

/** Une créatrice partenaire au nom de forme réelle (prénom + nom + suffixe). */
async function creatrice(nom: string, ts: number) {
  const { creatorId } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${nom} ${ts}`,
    email: `e2e-scope-${nom.toLowerCase().replace(/\s+/g, ".")}-${ts}@repackit.test`,
  });
  return creatorId;
}

/** Un manager avec les blocs par défaut, et sa session. */
async function manager(ts: number) {
  const email = `e2e-scope-manager-${ts}@repackit.test`;
  const password = `scope-${ts}`;
  const { token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] Manager Balkans ${ts}`,
    email,
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  client.setAuth(res.tokens!.token);
  const projectId = await admin.getProjectId();
  await admin.mutation(api.permissionProbe.e2eSetMembershipRole, {
    secret: E2E_SECRET,
    email,
    projectId,
    role: "manager",
    permissions: defaultManagerPermissions(),
  });
  const rows = await admin.query(api.team.listMembers, {});
  const row = rows.find((r) => r.email === email);
  if (!row) throw new Error(`Manager absent de listMembers : ${email}`);
  return { email, client, projectId, membershipId: row.membershipId, userId: row.userId };
}

/** La garde « voir son espace » exécutée AS ce manager, sans lever. */
async function voirComme(email: string, projectId: Id<"projects">, creatorId: Id<"creators">) {
  return admin.mutation(api.creators.e2eAssertViewAsAccess, {
    secret: E2E_SECRET,
    email,
    projectId,
    creatorId,
  });
}

async function perimetre(membershipId: Id<"memberships">, scope: Id<"creators">[] | null) {
  return admin.mutation(api.team.setMemberCreatorScope, {
    membershipId,
    creatorScope: scope,
  });
}

test.describe("Manager — périmètre de créatrices", () => {
  test("sans périmètre il voit tout ; restreint, il ne voit et ne touche que les siennes", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const kelly = await creatrice("Kelly Moreau", ts);
    const ines = await creatrice("Ines Petrovic", ts);
    const m = await manager(ts);
    const noms = async () =>
      (await m.client.query(api.creators.listCreators, { projectId: m.projectId })).map(
        (c) => c._id,
      );

    // ── 1. Défaut : AUCUN périmètre écrit ⇒ toutes. C'est l'état des managers de
    // prod au déploiement, et il ne doit rien leur retirer.
    expect((await admin.query(api.team.listMembers, {})).find((r) => r.email === m.email)
      ?.creatorScope).toBeNull();
    expect(await noms()).toEqual(expect.arrayContaining([kelly, ines]));

    // ── 2. Restreint à Kelly.
    const res = await perimetre(m.membershipId, [kelly]);
    expect(res.creatorScope).toEqual([kelly]);

    const visibles = await noms();
    expect(visibles).toContain(kelly); // présence…
    expect(visibles).not.toContain(ines); // …et absence

    // La fiche : null hors périmètre (pas de levée, l'écran ne doit pas mourir).
    expect(await m.client.query(api.creators.getCreator, { projectId: m.projectId, id: kelly }))
      .not.toBeNull();
    expect(await m.client.query(api.creators.getCreator, { projectId: m.projectId, id: ines }))
      .toBeNull();

    // Le geste : accepté sur Kelly, refusé sur Inès avec SON code.
    await m.client.mutation(api.creators.updateCreator, {
      projectId: m.projectId,
      id: kelly,
      adminNotes: "suivie par le marché FR",
    });
    expect(
      await codeDe(
        m.client.mutation(api.creators.updateCreator, {
          projectId: m.projectId,
          id: ines,
          adminNotes: "tentative hors périmètre",
        }),
      ),
    ).toBe("ERR_CREATOR_OUT_OF_SCOPE");

    // Le sélecteur d'assignation suit la même règle.
    const assignables = (
      await m.client.query(api.assignments.listAssignableCreatorsWithAccounts, {
        projectId: m.projectId,
      })
    ).map((c) => c._id);
    expect(assignables).not.toContain(ines);

    // Observer son espace : refusé hors périmètre, sinon c'est le contournement
    // exact de la restriction. Présence d'abord : Kelly reste observable.
    expect((await voirComme(m.email, m.projectId, kelly)).allowed).toBe(true);
    const refusVoirComme = await voirComme(m.email, m.projectId, ines);
    expect(refusVoirComme.allowed).toBe(false);
    // Le texte rendu est « <CODE> <message> » : on asserte le code, pas la phrase.
    expect(refusVoirComme.error).toMatch(/^ERR_CREATOR_OUT_OF_SCOPE\b/);

    // ── 3. Le journal raconte le geste, par le NOM.
    const journal = await admin.query(api.team.listChanges, { userId: m.userId });
    const lignes = journal.map((l) => `${l.granted ? "+" : "-"} ${l.permission}`);
    expect(lignes).toContain("- Périmètre : toutes les créatrices");
    expect(lignes).toContain(`+ Périmètre : [E2E_TEST] Kelly Moreau ${ts}`);

    // ── 4. Retour à « toutes » : Inès revient.
    await perimetre(m.membershipId, null);
    expect(await noms()).toEqual(expect.arrayContaining([kelly, ines]));
  });

  test("une liste VIDE ferme tout, et n'est jamais lue comme « toutes »", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const kelly = await creatrice("Kelly Moreau", ts);
    const m = await manager(ts);

    // Présence d'abord : sans périmètre, la liste n'est pas vide.
    const avant = await m.client.query(api.creators.listCreators, { projectId: m.projectId });
    expect(avant.map((c) => c._id)).toContain(kelly);

    await perimetre(m.membershipId, []);
    expect(await m.client.query(api.creators.listCreators, { projectId: m.projectId })).toEqual([]);
    expect(
      (await admin.query(api.team.listMembers, {})).find((r) => r.email === m.email)?.creatorScope,
    ).toEqual([]);
  });

  test("les comptes d'une créatrice hors périmètre sont invisibles et intouchables", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const kelly = await creatrice("Kelly Moreau", ts);
    const ines = await creatrice("Ines Petrovic", ts);
    const m = await manager(ts);

    // Deux comptes à des handles de forme réelle, un par créatrice.
    const compteKelly = await admin.mutation(api.comptes.createCompte, {
      handle: `@kelly.moreau_${ts}`,
      plateforme: "TikTok",
      notes: "",
    });
    await admin.mutation(api.comptes.updateCompte, { id: compteKelly, creatorId: kelly });
    const compteInes = await admin.mutation(api.comptes.createCompte, {
      handle: `@ines.petrovic.rs_${ts}`,
      plateforme: "TikTok",
      notes: "",
    });
    await admin.mutation(api.comptes.updateCompte, { id: compteInes, creatorId: ines });

    await perimetre(m.membershipId, [kelly]);

    const ids = (
      await m.client.query(api.comptes.listComptes, { projectId: m.projectId })
    ).map((c) => c._id);
    expect(ids).toContain(compteKelly);
    expect(ids).not.toContain(compteInes);

    expect(
      await codeDe(
        m.client.mutation(api.comptes.archiveCompte, { projectId: m.projectId, id: compteInes }),
      ),
    ).toBe("ERR_CREATOR_OUT_OF_SCOPE");
    // Réassigner SON compte à une créatrice hors périmètre : refusé aussi.
    expect(
      await codeDe(
        m.client.mutation(api.comptes.updateCompte, {
          projectId: m.projectId,
          id: compteKelly,
          creatorId: ines,
        }),
      ),
    ).toBe("ERR_CREATOR_OUT_OF_SCOPE");
    // Un compte interne n'appartient à aucun périmètre.
    expect(
      await codeDe(
        m.client.mutation(api.comptes.createCompte, {
          projectId: m.projectId,
          handle: `@repackit.team_${ts}`,
          plateforme: "TikTok",
          notes: "",
        }),
      ),
    ).toBe("ERR_CREATOR_OUT_OF_SCOPE");
    // Et le geste permis passe bien : ce n'est pas un refus général.
    await m.client.mutation(api.comptes.archiveCompte, { projectId: m.projectId, id: compteKelly });
  });

  test("une créatrice invitée par un manager restreint entre dans SON périmètre", async () => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const kelly = await creatrice("Kelly Moreau", ts);
    const m = await manager(ts);
    await perimetre(m.membershipId, [kelly]);

    const { creatorId: lea } = await m.client.mutation(api.creators.inviteCreator, {
      projectId: m.projectId,
      name: `[E2E_TEST] Léa Dubois-Martin ${ts}`,
      email: `e2e-scope-lea-${ts}@repackit.test`,
    });

    const ids = (
      await m.client.query(api.creators.listCreators, { projectId: m.projectId })
    ).map((c) => c._id);
    expect(ids).toEqual(expect.arrayContaining([kelly, lea]));
    const scope = (await admin.query(api.team.listMembers, {})).find(
      (r) => r.email === m.email,
    )?.creatorScope;
    expect(scope).toEqual([kelly, lea]);
  });

  test("le périmètre ne se pose que sur un manager", async () => {
    const rows = await admin.query(api.team.listMembers, {});
    const unAdmin = rows.find((r) => r.roles.includes("admin"));
    expect(unAdmin).toBeDefined();
    await expect(perimetre(unAdmin!.membershipId, [])).rejects.toThrow(/manager/);
  });

  test("une créatrice SUPPRIMÉE ne bloque plus sa liste ; une d'un autre projet est refusée NOMMÉMENT", async () => {
    // Cas de la prod (18/09/2026) : une fiche supprimée restait dans la liste d'un
    // manager, invisible à l'écran (« 11 cochées » pour 10 affichées), et tout
    // enregistrement était refusé par « Une des créatrices choisies n'est pas
    // dans ce projet. », sans dire laquelle.
    test.setTimeout(120_000);
    const ts = Date.now();
    const partie = await creatrice("Lea Fontaine", ts);
    const restee = await creatrice("Ixquic Morales", ts);
    const m = await manager(ts);
    await perimetre(m.membershipId, [partie, restee]);
    const scopeDe = async () =>
      (await admin.query(api.team.listMembers, {})).find((r) => r.email === m.email)!
        .creatorScope;
    expect(await scopeDe()).toEqual([partie, restee]); // présence avant suppression

    // ── 1. Supprimer la fiche la retire du périmètre des managers ────────────
    await admin.mutation(api.creators.deleteCreator, { id: partie });
    expect(await scopeDe()).toEqual([restee]);

    // ── 2. Un écran ouvert AVANT la suppression renvoie encore son id : accepté,
    // l'id mort est retiré, la vivante reste.
    const res = await perimetre(m.membershipId, [partie, restee]);
    expect(res.retirees).toBe(1);
    expect(res.creatorScope).toEqual([restee]);
    expect(await scopeDe()).toEqual([restee]);

    // ── 3. Une créatrice d'un AUTRE projet : refus, et le message la NOMME ───
    const { projectId: autreProjet } = await admin.mutation(
      api.projects.e2eEnsureProjectBySlug,
      { secret: E2E_SECRET, slug: `e2e-scope-autre-${ts}`, name: `Autre ${ts}` },
    );
    const { creatorId: etrangere } = await admin.mutation(api.creators.inviteCreator, {
      projectId: autreProjet,
      name: `[E2E_TEST] Paula Ribeiro ${ts}`,
      email: `e2e-scope-paula-${ts}@repackit.test`,
    });
    let message = "";
    try {
      await perimetre(m.membershipId, [restee, etrangere]);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain(`Paula Ribeiro ${ts}`);
    expect(message).toContain(`Autre ${ts}`);
    expect(await scopeDe()).toEqual([restee]); // rien n'a été écrit
  });
});
