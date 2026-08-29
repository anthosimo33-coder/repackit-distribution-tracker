import { test, expect } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const rawUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!rawUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
/** Typé `string` (et non `string | undefined`) : la narrowing du `const` ne
 *  survit pas aux fonctions imbriquées du corps de test. */
const url: string = rawUrl;
const admin = createE2eClient(url);

const DAY = 86_400_000;

/** Minuit local + N jours — la convention de stockage réelle de `postDate`. */
function dayMs(offsetDays: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() + offsetDays * DAY;
}

/**
 * COOLDOWN DE COMBO — la durée vient du PROJET, et le serveur l'applique.
 *
 * Les tests vitest (lib/combo-cooldown.test.ts) verrouillent la valeur et la
 * borne sur le module pur. Ce qu'ils ne peuvent PAS prouver, et que ce fichier
 * prouve : que `convex/scripts.ts` — sa propre réplique de la règle, sur des
 * `Doc<"assignments">` — lit bien le réglage du projet au lieu d'une constante.
 * Sans cette spec, on pourrait régler le cooldown à l'écran sans que le tirage
 * change quoi que ce soit.
 *
 * ── Le montage, et pourquoi il est minimal ───────────────────────────────────
 * La campagne n'a QU'UN SEUL combo (1 hook × 1 flux × 1 cta). C'est ce qui rend
 * la conclusion lisible : avec plusieurs combos, un second créateur en recevrait
 * simplement un autre et on ne saurait pas si le cooldown a joué. Ici il n'y a
 * rien d'autre à piocher — soit la fenêtre bloque, soit elle ne bloque pas.
 *
 * L'unicité à vie n'interfère jamais : chaque assignation vise un créateur
 * DIFFÉRENT, et l'unicité est par (créateur × plateforme).
 */
test.describe("Cooldown de combo — réglage par projet", () => {
  // Le réglage est GLOBAL au projet et la suite partage une base : on le remet
  // à « non défini » quoi qu'il arrive, sinon une spec suivante hériterait d'une
  // fenêtre qu'elle n'a pas demandée.
  test.afterAll(async () => {
    await admin.mutation(api.projects.setComboCooldownDays, { days: null });
  });

  test("défaut 1 jour : la veille est libre, le jour même ne l'est pas", async () => {
    test.setTimeout(180_000);
    const ts = Date.now();

    await admin.mutation(api.projects.setComboCooldownDays, { days: null });
    const settings = await admin.query(api.projects.getComboCooldownSettings, {});
    expect(settings.defined).toBeNull();
    expect(settings.effective).toBe(1);

    const campaignId = await admin.mutation(api.scripts.createCampaign, {
      name: `[E2E_TEST] Cooldown ${ts}`,
    });
    const add = (kind: "hook" | "flux" | "cta", label: string) =>
      admin.mutation(api.scripts.createBrick, {
        campaignId,
        kind,
        label,
        content: `${label} contenu`,
        ...(kind === "hook" ? { tier: "S" as const } : {}),
      });
    await add("hook", "H1");
    await add("flux", "F1");
    await add("cta", "C1");
    const { pricingId } = await admin.mutation(api.pricing.createPricing, {
      name: `[E2E_TEST] PricingCooldown ${ts}`,
      montantFixe: 100,
      nbVideosCible: 10,
      tauxCPM: 2,
    });

    /** Une créatrice neuve + son compte TikTok disponible. */
    async function newCreator(tag: string) {
      const c = await createCreatorSession(url, {
        name: `[E2E_TEST] Cool${tag} ${ts}`,
        email: `e2e-cool-${tag.toLowerCase()}-${ts}@repackit.test`,
        password: `cool-${tag.toLowerCase()}-12345`,
      });
      const target = await availableTarget({
        e2eClient: admin,
        creatorId: c.creatorId,
        platform: "TikTok",
        handle: `@cool${tag.toLowerCase()}${ts}`,
      });
      return { creatorId: c.creatorId, target };
    }

    const a = await newCreator("A");
    const b = await newCreator("B");
    const c = await newCreator("C");
    const d = await newCreator("D");

    const assignAt = (
      who: { creatorId: (typeof a)["creatorId"]; target: (typeof a)["target"] },
      postDate: number,
    ) =>
      admin.mutation(api.scripts.assignScriptCampaign, {
        campaignId,
        creatorId: who.creatorId,
        targets: [who.target],
        videosPerCreator: 1,
        dueDate: ts + 7 * DAY,
        pricingId,
        postDates: [postDate],
      });

    // A occupe le combo unique pour AUJOURD'HUI.
    expect((await assignAt(a, dayMs(0))).created).toBe(1);

    // B vise LE MÊME JOUR : le seul combo est dans la fenêtre → refus daté.
    // (Le refus est un throw, pas un `created: 0` : le serveur préfère dire
    //  quand ça repasse plutôt que d'assigner moins que demandé en silence.)
    await expect(assignAt(b, dayMs(0))).rejects.toThrow(
      /Plus aucun script disponible/i,
    );

    // C vise LE LENDEMAIN : un jour d'écart suffit — la borne est stricte, donc
    // un écart d'exactement 1 jour est AUTORISÉ. C'est le pendant du cas
    // ci-dessus, et le couple est ce qui prouve que la fenêtre vaut bien 1.
    expect((await assignAt(c, dayMs(1))).created).toBe(1);

    // ── Le réglage est réellement lu par le SERVEUR ───────────────────────────
    // Même situation que C, mais avec une fenêtre de 4 jours : le lendemain
    // redevient bloqué. Si le tirage lisait encore une constante, D passerait.
    await admin.mutation(api.projects.setComboCooldownDays, { days: 4 });
    expect(
      (await admin.query(api.projects.getComboCooldownSettings, {})).effective,
    ).toBe(4);
    await expect(assignAt(d, dayMs(2))).rejects.toThrow(
      /Plus aucun script disponible/i,
    );

    // Et à 0 (cooldown désactivé) la même assignation passe, le jour même de
    // celle de A — l'unicité à vie, elle, n'a pas bougé (D est une autre
    // créatrice, elle n'a jamais vu ce combo).
    await admin.mutation(api.projects.setComboCooldownDays, { days: 0 });
    expect((await assignAt(d, dayMs(0))).created).toBe(1);
  });

  test("refuse une durée hors bornes, et n'écrit rien", async () => {
    await admin.mutation(api.projects.setComboCooldownDays, { days: 2 });
    await expect(
      admin.mutation(api.projects.setComboCooldownDays, { days: 31 }),
    ).rejects.toThrow(/cooldown invalide/i);
    // La valeur précédente est intacte : un refus ne doit rien avoir patché.
    expect(
      (await admin.query(api.projects.getComboCooldownSettings, {})).defined,
    ).toBe(2);
  });
});
