import { test, expect } from "./fixtures/auth-fixture";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { availableTarget } from "./helpers/targets";
import { config } from "dotenv";

config({ path: ".env.local" });
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * CHANGEMENT DE POPULATION — corriger une invitation faite avec le mauvais
 * `kind`, sans jamais déplacer d'historique.
 *
 * Ce n'est pas un menu déroulant : la bascule touche l'ancre de paie, le modèle
 * de chauffe des comptes (D3) et le portail auquel la personne accède. La garde
 * « fiche vierge » est ce qui rend les trois sûrs — et le test du membership est
 * celui sans lequel la bascule serait cosmétique ET enfermante : la personne
 * resterait renvoyée vers l'ancien portail tout en étant rejetée du nouveau.
 */
async function inscrire(kind: "talent" | "clipper" | "partner", ts: number, sfx = "") {
  const email = `e2e-creator-${kind}-switch${sfx}-${ts}@repackit.test`;
  const password = `switch-${ts}`;
  const { creatorId, token } = await admin.mutation(api.creators.inviteCreator, {
    name: `[E2E_TEST] ${kind} switch${sfx} ${ts}`,
    email,
    kind,
  });
  const client = new ConvexHttpClient(convexUrl!);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: { email, password, flow: "signUp", inviteToken: token },
  });
  client.setAuth(res.tokens!.token);
  return { creatorId, client };
}

test.describe("Créateurs — changement de population", () => {
  test("fiche vierge : bascule autorisée, portail et ancre suivent", async () => {
    const ts = Date.now();
    const p = await inscrire("partner", ts);

    // Le partenaire est bien sur SON portail avant la bascule.
    expect((await p.client.query(api.creators.getMyPortal, {})).role).toBe("creator");

    await admin.mutation(api.creators.updateCreator, {
      id: p.creatorId,
      kind: "talent",
      status: "active",
    });

    const fiche = (await admin.query(api.creators.getCreator, { id: p.creatorId }))!;
    expect(fiche.kind).toBe("talent");
    // L'ancre est posée AU BASCULEMENT : sans elle, ce talent déjà actif
    // n'apparaîtrait dans aucun cycle et markCyclePaid jetterait.
    expect(fiche.payStartAt).toBeTruthy();

    // Et le portail a suivi — sans ça la bascule enfermerait la personne.
    expect((await p.client.query(api.creators.getMyPortal, {})).role).toBe("talent");
  });

  test("quitter la population talent retire l'ancre", async () => {
    const ts = Date.now();
    const t = await inscrire("talent", ts, "retour");
    await admin.mutation(api.creators.updateCreator, { id: t.creatorId, status: "active" });
    expect(
      (await admin.query(api.creators.getCreator, { id: t.creatorId }))!.payStartAt,
    ).toBeTruthy();

    await admin.mutation(api.creators.updateCreator, { id: t.creatorId, kind: "clipper" });
    const apres = (await admin.query(api.creators.getCreator, { id: t.creatorId }))!;
    expect(apres.kind).toBe("clipper");
    expect(apres.payStartAt).toBeUndefined();
    expect((await t.client.query(api.creators.getMyPortal, {})).role).toBe("clipper");
  });

  test("fiche NON vierge : refus qui NOMME ce qui bloque", async () => {
    const ts = Date.now();
    const c = await inscrire("clipper", ts, "compte");
    await availableTarget({
      e2eClient: admin,
      creatorId: c.creatorId,
      platform: "TikTok",
      handle: `@e2eswitch${ts}`,
      validatedAt: ts,
    });

    await expect(
      admin.mutation(api.creators.updateCreator, { id: c.creatorId, kind: "talent" }),
    ).rejects.toThrow(/1 compte/);

    // La population n'a pas bougé — le refus ne laisse pas d'état intermédiaire.
    expect(
      (await admin.query(api.creators.getCreator, { id: c.creatorId }))!.kind,
    ).toBe("clipper");
  });

  test("une édition ORDINAIRE reste possible sur une fiche non vierge", async () => {
    // La garde ne se déclenche QUE sur un changement de population : sans ce
    // test, elle pourrait bloquer un simple renommage et personne ne le saurait.
    const ts = Date.now();
    const c = await inscrire("clipper", ts, "edit");
    await availableTarget({
      e2eClient: admin,
      creatorId: c.creatorId,
      platform: "TikTok",
      handle: `@e2eswitchedit${ts}`,
      validatedAt: ts,
    });
    await admin.mutation(api.creators.updateCreator, {
      id: c.creatorId,
      name: `[E2E_TEST] renommé ${ts}`,
      kind: "clipper",
      clipRate: 9.9,
    });
    const fiche = (await admin.query(api.creators.getCreator, { id: c.creatorId }))!;
    expect(fiche.name).toContain("renommé");
    expect(fiche.clipRate).toBe(9.9);
    expect(E2E_SECRET.length).toBeGreaterThan(0);
  });
});
