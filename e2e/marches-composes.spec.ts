import { test, expect } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * MARCHÉS COMPOSÉS — la règle tient côté SERVEUR, pas seulement à l'écran.
 *
 * L'écran désactive les pays déjà pris et grise le bouton : c'est du confort.
 * Ce qui protège la donnée, c'est la mutation, et c'est elle qu'on éprouve ici.
 * Un écran ouvert depuis dix minutes ne sait pas ce qu'un collègue vient de
 * créer ; si seule l'interface refusait, deux onglets suffiraient à casser la
 * partition — et avec elle la ligne « tous marchés », qui ne serait plus le
 * total de rien.
 *
 * Chaque test travaille dans SON projet : les marchés sont scopés projet, et
 * un test qui les cumulerait d'un run à l'autre finirait par se contredire.
 */

/** Un projet neuf, pour que la partition testée soit celle de CE test. */
async function projetNeuf(quoi: string, ts: number) {
  return await admin.mutation(api.projects.e2eEnsureProjectBySlug, {
    secret: E2E_SECRET,
    slug: `e2e-marches-${quoi}-${ts}`,
    name: `[E2E_TEST] Marchés ${quoi} ${ts}`,
  });
}

test.describe("Marchés composés", () => {
  test("composer, modifier, défaire — et la liste suit", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { projectId } = await projetNeuf("cycle", ts);

    // Rien au départ : un projet neuf n'a aucun marché composé, et chaque pays
    // est donc son propre marché.
    expect(
      await admin.query(api.marketGroups.listMarketGroups, { projectId }),
    ).toEqual([]);

    const id = await admin.mutation(api.marketGroups.createMarketGroup, {
      projectId,
      name: "  Balkans  ",
      countries: ["RS", "HR"],
    });
    const apres = await admin.query(api.marketGroups.listMarketGroups, {
      projectId,
    });
    expect(apres).toHaveLength(1);
    // Le nom est ROGNÉ à l'écriture : sinon « Balkans » et « Balkans  » seraient
    // deux marchés que rien ne distingue à l'écran.
    expect(apres[0].name).toBe("Balkans");
    expect(apres[0].countries).toEqual(["RS", "HR"]);

    await admin.mutation(api.marketGroups.updateMarketGroup, {
      projectId,
      id,
      name: "Balkans élargis",
      countries: ["RS", "HR", "SI"],
    });
    const modifie = await admin.query(api.marketGroups.listMarketGroups, {
      projectId,
    });
    expect(modifie[0].name).toBe("Balkans élargis");
    expect(modifie[0].countries).toEqual(["RS", "HR", "SI"]);

    await admin.mutation(api.marketGroups.deleteMarketGroup, { projectId, id });
    expect(
      await admin.query(api.marketGroups.listMarketGroups, { projectId }),
    ).toEqual([]);
  });

  test("un pays ne peut appartenir qu'à UN marché", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 1;
    const { projectId } = await projetNeuf("partition", ts);

    await admin.mutation(api.marketGroups.createMarketGroup, {
      projectId,
      name: "Balkans",
      countries: ["RS", "HR"],
    });

    // La Serbie est prise : un second marché qui la revendique est REFUSÉ, et le
    // refus NOMME le marché qui la détient.
    await expect(
      admin.mutation(api.marketGroups.createMarketGroup, {
        projectId,
        name: "Europe de l'Est",
        countries: ["RS", "PL"],
      }),
    ).rejects.toThrow(/appartient déjà au marché/i);

    // Assertion de PRÉSENCE : sans elle, une garde qui refuserait TOUT passerait
    // le test du dessus. Un marché sur des pays libres, lui, se compose.
    await admin.mutation(api.marketGroups.createMarketGroup, {
      projectId,
      name: "Europe de l'Est",
      countries: ["PL", "CZ"],
    });
    expect(
      await admin.query(api.marketGroups.listMarketGroups, { projectId }),
    ).toHaveLength(2);
  });

  test("un marché qu'on MODIFIE ne se refuse pas ses propres pays", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 2;
    const { projectId } = await projetNeuf("edition", ts);

    const id = await admin.mutation(api.marketGroups.createMarketGroup, {
      projectId,
      name: "Balkans",
      countries: ["RS", "HR"],
    });
    // Le cas qui casse une garde naïve : on réenregistre le marché avec ses
    // propres pays, plus un. S'il se comparait à lui-même, il se refuserait.
    await admin.mutation(api.marketGroups.updateMarketGroup, {
      projectId,
      id,
      name: "Balkans",
      countries: ["RS", "HR", "SI"],
    });
    const apres = await admin.query(api.marketGroups.listMarketGroups, {
      projectId,
    });
    expect(apres[0].countries).toEqual(["RS", "HR", "SI"]);
  });

  test("les bornes de saisie sont tenues par le serveur", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 3;
    const { projectId } = await projetNeuf("bornes", ts);

    await expect(
      admin.mutation(api.marketGroups.createMarketGroup, {
        projectId,
        name: "   ",
        countries: ["RS"],
      }),
    ).rejects.toThrow(/nom/i);
    await expect(
      admin.mutation(api.marketGroups.createMarketGroup, {
        projectId,
        name: "Sans pays",
        countries: [],
      }),
    ).rejects.toThrow(/au moins un pays/i);
    await expect(
      admin.mutation(api.marketGroups.createMarketGroup, {
        projectId,
        name: "Doublon",
        countries: ["RS", "RS"],
      }),
    ).rejects.toThrow(/deux fois/i);
    // Aucun de ces refus n'a rien écrit.
    expect(
      await admin.query(api.marketGroups.listMarketGroups, { projectId }),
    ).toEqual([]);
  });

  test("un marché d'un AUTRE projet ne se modifie ni ne se supprime", async () => {
    test.setTimeout(120_000);
    const ts = Date.now() + 4;
    const a = await projetNeuf("projet-a", ts);
    const b = await projetNeuf("projet-b", ts);

    const idDeA = await admin.mutation(api.marketGroups.createMarketGroup, {
      projectId: a.projectId,
      name: "Balkans",
      countries: ["RS", "HR"],
    });

    // L'id est valide, le projet ne l'est pas. Le wrapper garde le BLOC, pas la
    // ligne : sans le contrôle explicite, un id deviné traverserait les projets.
    await expect(
      admin.mutation(api.marketGroups.updateMarketGroup, {
        projectId: b.projectId,
        id: idDeA,
        name: "Volé",
        countries: ["RS"],
      }),
    ).rejects.toThrow(/introuvable dans ce projet/i);
    await expect(
      admin.mutation(api.marketGroups.deleteMarketGroup, {
        projectId: b.projectId,
        id: idDeA,
      }),
    ).rejects.toThrow(/introuvable dans ce projet/i);

    // Et il est toujours là, intact, chez lui.
    const chezA = await admin.query(api.marketGroups.listMarketGroups, {
      projectId: a.projectId,
    });
    expect(chezA).toHaveLength(1);
    expect(chezA[0].name).toBe("Balkans");
    // Le projet B, lui, n'a rien vu passer.
    expect(
      await admin.query(api.marketGroups.listMarketGroups, {
        projectId: b.projectId,
      }),
    ).toEqual([]);
  });
});
