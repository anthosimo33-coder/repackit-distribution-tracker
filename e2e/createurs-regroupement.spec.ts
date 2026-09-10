import { test, expect } from "./fixtures/auth-fixture";
import { api } from "../convex/_generated/api";
import { createE2eClient, adminPath } from "./helpers/authed-client";
import { config } from "dotenv";
config({ path: ".env.local" });
const admin = createE2eClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const MARKER = "[E2E_TEST]";

/**
 * REGROUPEMENT PAR RÉGION, recherche, et colonnes d'activité.
 *
 * ─── CE QUI EST PROTÉGÉ ICI ─────────────────────────────────────────────────
 * L'axe « région » n'a pas de champ en base : il se dérive du fuseau EFFECTIF
 * (fiche, sinon pays des comptes), celui-là même sur lequel le warmup compte les
 * jours. Deux façons de le casser sans que rien ne rougisse :
 *
 *   1. ranger les fiches SANS fuseau avec les autres — elles tournent sur UTC,
 *      c'est une file de travail, et la noyer la rend invisible ;
 *   2. brancher la colonne « Comptes » sur autre chose que les comptes de la
 *      personne — le chiffre resterait plausible.
 *
 * `lib/creator-region.test.ts` couvre la RÈGLE de dérivation (y compris le refus
 * de deviner) ; ce fichier-ci couvre le CÂBLAGE : serveur → écran.
 */
test.describe("Créateurs — regroupement par région", () => {
  test("chaque fuseau tombe dans sa région, et l'absence de fuseau dans la sienne", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();

    // Trois fiches, trois régions attendues. Fuseaux IANA réels, dont un à
    // trois segments : c'est la forme de la prod, pas des valeurs de labo.
    const seeds = [
      { n: "Ludivine", tz: "Europe/Paris", region: "Europe" },
      { n: "Angelica", tz: "America/New_York", region: "États-Unis" },
      { n: "Cintia", tz: "America/Argentina/Buenos_Aires", region: "Amérique latine" },
      // Sans fuseau : ses jours de warmup tournent sur UTC. C'est ELLE que
      // l'écran doit désigner.
      { n: "Sansfuseau", tz: null, region: "Fuseau non renseigné" },
    ] as const;

    for (const s of seeds) {
      const { creatorId } = await admin.mutation(api.creators.inviteCreator, {
        name: `${MARKER} ${s.n} ${ts}`,
        email: `e2e-creator-region-${ts}-${s.n.toLowerCase()}@repackit.test`,
      });
      if (s.tz) {
        await admin.mutation(api.creators.updateCreator, {
          id: creatorId,
          timezone: s.tz,
        });
      }
    }

    await page.goto(adminPath("/createurs"));
    await expect(page.getByRole("columnheader", { name: "Nom" })).toBeVisible({
      timeout: 15_000,
    });

    // Le regroupement par région est le DÉFAUT : c'est la question qu'on se pose
    // devant la liste, pas une option à aller chercher.
    await expect(page.getByTestId("grouper-par")).toHaveValue("region");

    // Les quatre en-têtes de groupe sont là, « fuseau non renseigné » compris.
    for (const s of seeds) {
      await expect(
        page.getByTestId("entete-groupe").filter({ hasText: s.region }),
        `groupe ${s.region}`,
      ).toHaveCount(1);
    }

    // ── Chacune est bien DANS son groupe ────────────────────────────────────
    // Vérifié par le filtre région, qui lit le même axe que le regroupement :
    // cocher une région ne doit laisser QUE ses créatrices. L'assertion
    // d'absence (les autres sortent) est appariée à celle de présence (la bonne
    // reste) — sans quoi un filtre qui ne rendrait RIEN passerait.
    const ligne = (n: string) =>
      page.getByRole("row").filter({ hasText: `${MARKER} ${n} ${ts}` });

    await page.getByTestId("filtre-region").locator("button").click();
    await page
      .getByTestId("filtre-options")
      .getByRole("option", { name: /^Fuseau non renseigné/ })
      .click();
    await page.keyboard.press("Escape");

    await expect(ligne("Sansfuseau")).toHaveCount(1);
    await expect(ligne("Ludivine"), "Paris n'est pas « non renseigné »").toHaveCount(0);
    await expect(ligne("Angelica"), "New York non plus").toHaveCount(0);
    await expect(ligne("Cintia"), "Buenos Aires non plus").toHaveCount(0);

    // Et le groupe « Europe » a bien disparu de l'écran avec ses lignes : un
    // en-tête de groupe vide serait un groupe qui ment.
    await expect(
      page.getByTestId("entete-groupe").filter({ hasText: "Europe" }),
    ).toHaveCount(0);
  });

  test("la recherche trouve par nom ET par e-mail", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    await admin.mutation(api.creators.inviteCreator, {
      name: `${MARKER} Juliette Chetrit ${ts}`,
      email: `e2e-creator-search-${ts}-a@repackit.test`,
    });
    await admin.mutation(api.creators.inviteCreator, {
      name: `${MARKER} Veljko ${ts}`,
      email: `e2e-creator-cherchemoi-${ts}-b@repackit.test`,
    });

    await page.goto(adminPath("/createurs"));
    const champ = page.getByRole("searchbox", { name: "Chercher un créateur" });
    await expect(champ).toBeVisible({ timeout: 15_000 });

    const ligne = (n: string) =>
      page.getByRole("row").filter({ hasText: `${MARKER} ${n} ${ts}` });

    // Par NOM.
    await champ.fill("Chetrit");
    await expect(ligne("Juliette Chetrit")).toHaveCount(1);
    await expect(ligne("Veljko")).toHaveCount(0);

    // Par E-MAIL — la moitié qu'on oublie de câbler, parce que le nom marche.
    await champ.fill("cherchemoi");
    await expect(ligne("Veljko")).toHaveCount(1);
    await expect(ligne("Juliette Chetrit")).toHaveCount(0);

    // Vider rend TOUT : une recherche qui ne se défait pas piège l'écran.
    await champ.fill("");
    await expect(ligne("Juliette Chetrit")).toHaveCount(1);
    await expect(ligne("Veljko")).toHaveCount(1);
  });

  test("la colonne Comptes compte les comptes DE LA PERSONNE", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const { creatorId: avec } = await admin.mutation(
      api.creators.inviteCreator,
      {
        name: `${MARKER} Avecomptes ${ts}`,
        email: `e2e-creator-cpt-${ts}-a@repackit.test`,
      },
    );
    await admin.mutation(api.creators.inviteCreator, {
      name: `${MARKER} Sanscomptes ${ts}`,
      email: `e2e-creator-cpt-${ts}-b@repackit.test`,
    });

    // Deux comptes rattachés à la première, un troisième ARCHIVÉ : il ne doit
    // pas être compté (un compte archivé — y compris un compte refusé à la
    // validation — est du travail qui n'existe plus).
    for (const [handle, status] of [
      ["e2ecpt_a", "actif"],
      ["e2ecpt_b", "warmup"],
      ["e2ecpt_mort", "archived"],
    ] as const) {
      const compteId = await admin.mutation(api.comptes.createCompte, {
        handle: `${handle}_${ts}`,
        plateforme: "TikTok",
        notes: "",
        status,
        // `warmupStartedAt` est EXIGÉ par le serveur quand le statut est
        // « warmup » — un compte en chauffe sans date de début n'a pas de
        // décompte. Daté d'il y a deux jours : la forme de la prod.
        ...(status === "warmup"
          ? { warmupStartedAt: Date.now() - 2 * 86_400_000 }
          : {}),
      });
      await admin.mutation(api.comptes.updateCompte, {
        id: compteId,
        creatorId: avec,
      });
    }

    await page.goto(adminPath("/createurs"));
    await expect(
      page.getByRole("columnheader", { name: "Comptes" }),
    ).toBeVisible({ timeout: 15_000 });

    const ligne = (n: string) =>
      page.getByRole("row").filter({ hasText: `${MARKER} ${n} ${ts}` });

    // La CELLULE, pas la ligne : une ligne contient un horodatage plein de
    // chiffres, `toContainText("2")` y passerait quoi qu'il arrive.
    const cellComptes = (n: string) =>
      ligne(n).getByTestId("cell-comptes");

    // Deux comptes vivants sur trois. Un « 3 » signalerait que l'archivage est
    // ignoré ; un « 0 » que la colonne n'est pas branchée du tout.
    await expect(cellComptes("Avecomptes")).toHaveText("2");
    // Et la voisine, elle, n'a rien — la colonne ne déborde pas d'une ligne à
    // l'autre. Le tiret est le rendu de zéro : « aucun compte » se lit, il ne
    // se déduit pas d'une case vide.
    await expect(cellComptes("Sanscomptes")).toHaveText("—");
  });
});
