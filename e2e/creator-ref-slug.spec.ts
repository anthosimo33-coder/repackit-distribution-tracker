import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

/**
 * refSlug d'une créatrice via la fiche admin (`updateCreator`) : normalisation
 * (« /Kelly/ » → « kelly »), idempotence, effacement par saisie blanche.
 *
 * Le chemin CLI (`setCreatorRefSlugBySlug`, mutation interne d'amorçage) est
 * exercé à part, sur backend local avec une créatrice réelle — sa garde
 * « refuse d'écraser une ref différente sans force » y est prouvée.
 */
test.describe("refSlug créatrice", () => {
  test("normalisé, idempotent, refuse d'écraser sans force, effaçable", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const creator = await createCreatorSession(url, {
      name: `[E2E_TEST] Ref ${ts}`,
      email: `e2e-ref-${ts}@repackit.test`,
      password: "creator-ref-12345",
    });

    // ── Chemin écran : updateCreator normalise ────────────────────────────────
    await admin.mutation(api.creators.updateCreator, {
      id: creator.creatorId,
      refSlug: "  /Kelly/ ",
    });
    let fiche = (await admin.query(api.creators.listCreators, {})).find(
      (c) => c._id === creator.creatorId,
    )!;
    expect(fiche.refSlug).toBe("kelly");

    // ── Idempotence : reposer la MÊME ref ne change rien ─────────────────────
    await admin.mutation(api.creators.updateCreator, {
      id: creator.creatorId,
      refSlug: "kelly",
    });
    fiche = (await admin.query(api.creators.listCreators, {})).find(
      (c) => c._id === creator.creatorId,
    )!;
    expect(fiche.refSlug).toBe("kelly");

    // ── Effacement : null ET saisie blanche retirent la ref ───────────────────
    await admin.mutation(api.creators.updateCreator, {
      id: creator.creatorId,
      refSlug: "   ",
    });
    fiche = (await admin.query(api.creators.listCreators, {})).find(
      (c) => c._id === creator.creatorId,
    )!;
    expect(fiche.refSlug).toBeUndefined();
  });

  /**
   * Une ref appartient à UNE personne. Sans ce refus, deux fiches portant
   * « kelly » afficheraient toutes deux les chiffres de kelly, et le « Total
   * attribué » resterait juste — il somme les refs, pas les fiches. Rien
   * n'aurait donc signalé l'erreur : c'est le genre de défaut qui ne se voit
   * jamais, d'où un refus À L'ÉCRITURE.
   *
   * Garde SERVEUR : invérifiable en unitaire, elle vit dans la mutation.
   */
  test("refuse une ref déjà portée par une autre créatrice", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const a = await createCreatorSession(url, {
      name: `[E2E_TEST] RefA ${ts}`,
      email: `e2e-refa-${ts}@repackit.test`,
      password: "creator-ref-12345",
    });
    const b = await createCreatorSession(url, {
      name: `[E2E_TEST] RefB ${ts}`,
      email: `e2e-refb-${ts}@repackit.test`,
      password: "creator-ref-12345",
    });
    const ref = `e2edup${ts}`;

    await admin.mutation(api.creators.updateCreator, { id: a.creatorId, refSlug: ref });

    // La casse ne sauve pas : les refs sont pliées avant comparaison.
    await expect(
      admin.mutation(api.creators.updateCreator, {
        id: b.creatorId,
        refSlug: ref.toUpperCase(),
      }),
    ).rejects.toThrow(/déjà portée/);

    // ASSERTION DE PRÉSENCE : le refus n'a rien écrit, et la 1re fiche est intacte.
    const fiches = await admin.query(api.creators.listCreators, {});
    expect(fiches.find((c) => c._id === b.creatorId)!.refSlug).toBeUndefined();
    expect(fiches.find((c) => c._id === a.creatorId)!.refSlug).toBe(ref);

    // …et la MÊME fiche peut toujours reposer SA propre ref (idempotence intacte).
    await admin.mutation(api.creators.updateCreator, { id: a.creatorId, refSlug: ref });
  });
});
