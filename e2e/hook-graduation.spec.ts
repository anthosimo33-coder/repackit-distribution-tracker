import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  LAB_CAMPAIGN_NAME,
  PROVEN_CAMPAIGN_NAME,
  campaignNameMatches,
} from "../convex/graduation";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(url);

/**
 * GRADUATION d'un hook — preuves SERVEUR d'atomicité et d'idempotence.
 *
 * Ce que l'unitaire ne peut pas prouver : que les DEUX écritures (copie dans les
 * prouvées + désactivation dans le LAB) tombent ensemble, et qu'un second
 * passage ne duplique pas. Il faut une base pour ça.
 *
 * ⚠️ La base e2e est partagée : les assertions portent sur NOS briques (par
 * identifiant), jamais sur un décompte absolu de la campagne.
 */
test.describe("Graduation d'un hook", () => {
  test("copie + désactive en une transaction, ne duplique jamais, ne laisse rien à moitié fait", async () => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const texte = `[E2E] Elle a vérifié son téléphone à 3 h du matin — ${ts}`;

    /**
     * Ces deux campagnes sont identifiées par leur NOM EXACT (c'est la règle de
     * `graduateHook`) : impossible de les préfixer « [E2E_TEST] », donc la
     * fixture ne les nettoie pas. En créer une paire par run ferait s'accumuler
     * les homonymes, et la mutation résoudrait une campagne d'un run PRÉCÉDENT —
     * la spec deviendrait dépendante de l'ordre. On RÉUTILISE donc celle qui
     * existe déjà.
     */
    async function campagne(nom: string): Promise<Id<"scriptCampaigns">> {
      const existantes = await admin.query(api.scripts.listCampaigns, {});
      const trouvee = existantes.find((c) => campaignNameMatches(c.name, nom));
      if (trouvee) return trouvee._id;
      return (await admin.mutation(api.scripts.createCampaign, {
        name: nom,
      })) as Id<"scriptCampaigns">;
    }

    const lab = await campagne(LAB_CAMPAIGN_NAME);

    async function hookDansLab(content: string): Promise<Id<"scriptBricks">> {
      return (await admin.mutation(api.scripts.createBrick, {
        campaignId: lab,
        kind: "hook",
        label: `[E2E] hook ${ts}`,
        content,
        angleFamily: "vérification",
      })) as Id<"scriptBricks">;
    }

    // ── 1. SANS campagne cible : la mutation ÉCHOUE et ne touche à RIEN ──────
    // C'est l'assertion d'atomicité la plus lisible : si la désactivation était
    // écrite avant la vérification de la cible, le hook finirait inactif ET non
    // gradué — à moitié fait, dans le sens qui casse la campagne LAB.
    const dejaCible = (await admin.query(api.scripts.listCampaigns, {})).some(
      (c) => campaignNameMatches(c.name, PROVEN_CAMPAIGN_NAME),
    );
    if (!dejaCible) {
      const orphelin = await hookDansLab(`${texte} (orphelin)`);
      await expect(
        admin.mutation(api.scripts.graduateHook, { brickId: orphelin }),
      ).rejects.toThrow(/Ouvertures prouvées/i);

      const apresEchec = await admin.query(api.scripts.getCampaign, { id: lab });
      expect(
        apresEchec?.bricks.find((b) => b._id === orphelin)?.active,
        "un échec de graduation doit laisser le hook ACTIF",
      ).toBe(true);
    }

    // ── 2. Avec la cible : copie + désactivation ─────────────────────────────
    const prouvees = await campagne(PROVEN_CAMPAIGN_NAME);

    const source = await hookDansLab(texte);
    const res = await admin.mutation(api.scripts.graduateHook, {
      brickId: source,
    });
    expect(res.outcome).toBe("graduated");

    const labApres = await admin.query(api.scripts.getCampaign, { id: lab });
    expect(
      labApres?.bricks.find((b) => b._id === source)?.active,
      "l'original du LAB doit être désactivé",
    ).toBe(false);

    const prouveesApres = await admin.query(api.scripts.getCampaign, {
      id: prouvees,
    });
    const copie = prouveesApres?.bricks.find((b) => b._id === res.targetBrickId);
    expect(copie?.content).toBe(texte);
    expect(copie?.active, "la copie doit être ACTIVE").toBe(true);
    // La famille d'angle suit le texte, pas la campagne.
    expect(copie?.angleFamily).toBe("vérification");

    // ── 3. IDEMPOTENCE — même texte, réécrit à la casse/espaces près ─────────
    // Le doublon qu'on cherche à éviter n'arrive pas par un re-clic (le bouton
    // disparaît) mais par un hook ressaisi presque à l'identique.
    const jumeau = await hookDansLab(`  ${texte.toUpperCase()}  `);
    const res2 = await admin.mutation(api.scripts.graduateHook, {
      brickId: jumeau,
    });
    expect(res2.outcome).toBe("already-graduated");
    expect(res2.targetBrickId).toBe(res.targetBrickId);

    const prouveesFin = await admin.query(api.scripts.getCampaign, {
      id: prouvees,
    });
    const copies = (prouveesFin?.bricks ?? []).filter(
      (b) => b.content.trim().toLowerCase() === texte.trim().toLowerCase(),
    );
    expect(copies, "aucun doublon dans la campagne cible").toHaveLength(1);

    // …et l'original du second passage est désactivé LUI AUSSI : c'est ce qui
    // rétablit l'invariant « un seul exemplaire actif », alors même qu'aucune
    // copie n'a été créée.
    const labFin = await admin.query(api.scripts.getCampaign, { id: lab });
    expect(labFin?.bricks.find((b) => b._id === jumeau)?.active).toBe(false);
  });
});
