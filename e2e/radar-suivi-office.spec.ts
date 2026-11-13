import { test, expect, adminPath } from "./fixtures/auth-fixture";
import { createE2eClient, E2E_SECRET } from "./helpers/authed-client";
import { api } from "../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);

/**
 * Radar — le suivi d'office des apps trouvées (13/11/2026). La tâche ne tourne pas en e2e (pas de clé du
 * fournisseur) : on sème des apps repérées par les classements et par la place de marché, on joue un passage du
 * suivi d'office sur elles seules, et on lit l'écran — les apps assez prouvées sont suivies avec leurs comptes,
 * les autres restent proposées.
 *
 * Apps, comptes et apps repérées sont GLOBAUX et le projet e2e est partagé : tout porte un marqueur, effacé à la fin.
 */
test.describe("Radar — suivi d'office des apps trouvées", () => {
  test("une app à trois comptes créateurs et un produit payé à la vue sont suivis seuls ; une app à deux comptes peu prouvés reste proposée", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2eso${ts}`;
    const pre = `e2esom${ts}`;
    const app = (lettre: string) => ({ marque: `E2eso${ts}${lettre}`, tag: `${p}${lettre}`, storeId: `${ts}${lettre.charCodeAt(0)}` });
    const [forte, faible, connue] = ["a", "b", "c"].map(app);
    const produit = { marque: `Roadso${ts}`, cle: `roadso${ts}` };
    const entree = (x: { marque: string; storeId: string }) => ({ storeId: x.storeId, name: `${x.marque}: fiches de révision`, artist: "Inc.", genre: "Éducation", released: "2026-02-03" });
    // Une app déjà suivie sous le même nom, avec d'autres motifs (suivie sous son hashtag, le contrôle la reconnaîtrait
    // et ne la proposerait pas) : la proposition doit simplement disparaître.
    await admin.mutation(api.radarNetworks.e2eSeedNetwork, { secret: E2E_SECRET, apps: [{ slug: connue.marque.toLowerCase(), name: connue.marque, rivalOf: [], strong: [`vieux${ts}`] }], accounts: [] });
    await admin.mutation(api.radarStore.e2eSeedStoreApps, { secret: E2E_SECRET, country: "fr", entries: [entree(forte), entree(faible), entree(connue)] });
    const controle = (x: { storeId: string; tag: string }, auteurs: string[]) =>
      admin.mutation(api.radarStore.e2eCheckStoreApp, {
        secret: E2E_SECRET,
        storeId: x.storeId,
        tags: [{ tag: x.tag, videos: 1_125, views: 1_125_000, items: auteurs.map((author) => ({ author, desc: `#${x.tag}` })) }],
        profiles: [],
      });
    // Trois pseudos au nom de l'app (prénom d'abord) ; deux seulement, sans bio qui la nomme ; deux pour l'app déjà suivie.
    const fortes = [`lea.${forte.tag}`, `tom_${forte.tag}`, `ines.${forte.tag}`];
    expect(await controle(forte, [...fortes, "z"])).toMatchObject({ outcome: "network", creators: 3 });
    expect(await controle(faible, [`lea.${faible.tag}`, `tom_${faible.tag}`, "z"])).toMatchObject({ outcome: "network", creators: 2 });
    expect(await controle(connue, [`lea.${connue.tag}`, `tom_${connue.tag}`, `ines.${connue.tag}`])).toMatchObject({ outcome: "network", creators: 3 });
    // Un produit payé à la vue sur la place de marché, que l'IA a dit « app ».
    const ids = await admin.mutation(api.radarMarket.e2eSeedMarketCampaigns, {
      secret: E2E_SECRET,
      campaigns: [{ campaignId: `${pre}-a1`, read: { name: `${produit.marque} Clipping`, org: "Clipix", description: `${produit.marque} is a drive tracker for iOS.`, launchedAt: ts, rateCents: 125, creators: 46, views: 589_966, spentCents: 169_580, handles: [`reign_${pre}`, `leos_${pre}`] } }],
    });
    expect(await admin.mutation(api.radarMarket.e2eJudgeMarket, { secret: E2E_SECRET, answer: { campaigns: [{ id: ids[0], kind: "app", product: produit.marque, handle: "" }] } })).toEqual({ judged: 1, found: 1 });

    const classements = page.getByRole("region", { name: "Apps trouvées dans les classements App Store" }).getByTestId("radar-app-classement");
    const marche = page.getByRole("region", { name: "Apps et logiciels qui paient des créateurs" }).getByTestId("radar-app-marche");
    const suivie = (nom: string) => page.getByRole("region", { name: "Autres apps" }).getByTestId("radar-app").filter({ hasText: nom });
    try {
      // Avant le passage : tout est proposé (sauf l'app déjà suivie sous son nom, que le contrôle a quand même notée).
      await page.goto(adminPath("/radar?onglet=comptes"));
      await expect(classements.filter({ hasText: forte.marque })).toHaveCount(1);
      await expect(classements.filter({ hasText: faible.marque })).toHaveCount(1);
      await expect(marche.filter({ hasText: produit.marque })).toHaveCount(1);

      // Le passage du suivi d'office : deux apps suivies, cinq comptes rattachés, une app laissée proposée.
      expect(await admin.mutation(api.radarAuto.e2eAutoFollow, { secret: E2E_SECRET, markers: [String(ts), produit.cle] })).toEqual({ followed: 2, kept: 1, attached: 5 });

      // Suivies : elles ont quitté les propositions et ont leurs comptes.
      await expect(suivie(forte.marque)).toContainText("3 comptes");
      await expect(suivie(produit.marque)).toContainText("2 comptes");
      await expect(classements.filter({ hasText: forte.marque })).toHaveCount(0);
      await expect(marche.filter({ hasText: produit.marque })).toHaveCount(0);
      // L'app à deux comptes peu prouvés reste proposée ; celle déjà suivie n'a pas été créée une seconde fois.
      await expect(classements.filter({ hasText: faible.marque })).toHaveCount(1);
      await expect(suivie(faible.marque)).toHaveCount(0);
      await expect(suivie(connue.marque)).toHaveCount(1);
      await expect(classements.filter({ hasText: connue.marque })).toHaveCount(0);
      await suivie(forte.marque).getByRole("button", { name: new RegExp(forte.marque) }).click();
      for (const handle of fortes) await expect(suivie(forte.marque).getByTestId("radar-compte").filter({ hasText: `@${handle}` })).toHaveCount(1);

      // Un second passage ne refait rien : chaque app repérée n'est regardée qu'une fois.
      expect(await admin.mutation(api.radarAuto.e2eAutoFollow, { secret: E2E_SECRET, markers: [String(ts), produit.cle] })).toEqual({ followed: 0, kept: 0, attached: 0 });
    } finally {
      await admin.mutation(api.radarMarket.e2eClearMarket, { secret: E2E_SECRET, prefix: pre });
      await admin.mutation(api.radarStore.e2eClearStore, { secret: E2E_SECRET, prefix: String(ts) });
      for (const prefix of [p, produit.cle, `e2eso${ts}`]) await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix });
    }
  });

  test("une app entre sous son hashtag prouvé tel quel ; un nom courant reste proposé avec la raison ; une app entrée sous un motif raccourci est réparée", async ({ page }) => {
    test.setTimeout(120_000);
    const ts = Date.now();
    const p = `e2esp${ts}`;
    const m = `e2espm${ts}`;
    const app = (lettre: string) => ({ marque: `E2esp${ts}${lettre}`, court: `${p}${lettre}`, tag: `${p}${lettre}app`, storeId: `${ts}${lettre.charCodeAt(0)}`, slug: `${p}${lettre}` });
    const [precise, courante, attente] = ["a", "b", "c"].map(app);
    const entree = (x: { marque: string; storeId: string }) => ({ storeId: x.storeId, name: `${x.marque}: fiches de révision`, artist: "Inc.", genre: "Éducation", released: "2026-02-03" });
    await admin.mutation(api.radarStore.e2eSeedStoreApps, { secret: E2E_SECRET, country: "fr", entries: [entree(precise), entree(courante), entree(attente)] });
    // Le hashtag que ses comptes portent est « <nom>app » : trois pseudos au nom de l'app, et un compte dont la bio la nomme.
    const comptes = (x: { court: string }) => [`lea.${x.court}`, `tom_${x.court}`, `ines.${x.court}`];
    const zoe = `zoe_${m}`;
    const controle = (x: { storeId: string; tag: string; court: string; marque: string }, bio = false) =>
      admin.mutation(api.radarStore.e2eCheckStoreApp, {
        secret: E2E_SECRET,
        storeId: x.storeId,
        tags: [{ tag: x.tag, videos: 1_125, views: 1_125_000, items: [...comptes(x), ...(bio ? [zoe] : []), "z"].map((author) => ({ author, desc: `#${x.tag}` })) }],
        profiles: bio ? [{ handle: zoe, fans: 300, bio: `Je révise avec l'app ${x.marque}`, descs: [] }] : [],
      });
    expect(await controle(precise, true)).toMatchObject({ outcome: "network", creators: 4 });
    expect(await controle(courante)).toMatchObject({ outcome: "network", creators: 3 });
    expect(await controle(attente)).toMatchObject({ outcome: "network", creators: 3 });

    const classements = page.getByRole("region", { name: "Apps trouvées dans les classements App Store" }).getByTestId("radar-app-classement");
    const suivie = (nom: string) => page.getByRole("region", { name: "Autres apps" }).getByTestId("radar-app").filter({ hasText: nom });
    const passage = (o: { common?: string[]; unjudged?: string[] } = {}) => admin.mutation(api.radarAuto.e2eAutoFollow, { secret: E2E_SECRET, markers: [String(ts)], ...o });
    /** Les motifs de recherche d'une app suivie, tels que la tâche des fiches les lirait. */
    const motifs = async (x: { slug: string }) => (await admin.mutation(api.radarFiche.e2eJudgeNiches, { secret: E2E_SECRET, slugs: [x.slug], answers: [] })).prompt.match(/search terms: (.*)/)?.[1];
    const releve = (handle: string, tag: string) =>
      admin.mutation(api.radarNetworks.e2eApplyAccountRead, {
        secret: E2E_SECRET,
        handle,
        videos: Array.from({ length: 9 }, (_, i) => ({ videoId: `${m}${handle.slice(0, 3)}${i}`, ageH: 20 + i * 24, views: 800 + i, caption: `Mes révisions du jour #${tag} #bac`, lang: "fr" })),
      });
    try {
      // ── Le passage : l'IA dit le motif de la deuxième « courant », ne dit rien de la troisième ──
      expect(await passage({ common: [courante.storeId], unjudged: [attente.storeId] })).toEqual({ followed: 1, kept: 1, attached: 4 });
      await page.goto(adminPath("/radar?onglet=comptes"));
      // La première est suivie sous le hashtag PROUVÉ, tel quel — pas sous son nom raccourci.
      await expect(suivie(precise.marque)).toContainText("4 comptes");
      expect(await motifs(precise)).toBe(`${precise.tag}, #${precise.tag}`);
      // La deuxième reste proposée, avec la raison ; la troisième aussi, sans raison : elle n'a pas encore été regardée.
      const proposee = (x: { marque: string }) => classements.filter({ hasText: x.marque });
      await expect(proposee(courante).getByTestId("radar-app-non-suivie")).toHaveText("Pas suivie d'office : nom courant : à suivre à la main avec un motif précis");
      await expect(suivie(courante.marque)).toHaveCount(0);
      await expect(proposee(attente)).toHaveCount(1);
      await expect(proposee(attente).getByTestId("radar-app-non-suivie")).toHaveCount(0);
      // Au passage suivant, la troisième a son verdict : elle entre. La deuxième n'est pas regardée une seconde fois.
      expect(await passage()).toEqual({ followed: 1, kept: 0, attached: 3 });
      await expect(suivie(attente.marque)).toContainText("3 comptes");
      await expect(proposee(courante)).toHaveCount(1);

      // ── La réparation. On remet la première dans l'état du 13/11/2026 : entrée sous son hashtag raccourci. ──
      expect(await admin.mutation(api.radarAuto.e2eShortenAutoPattern, { secret: E2E_SECRET, slug: precise.slug })).toBe(precise.court);
      expect(await motifs(precise)).toBe(`${precise.court}, #${precise.court}`);
      // Deux comptes sont relevés : l'un cite le vrai hashtag, l'autre seulement le mot raccourci. Les deux autres ne l'ont jamais été.
      expect(await releve(comptes(precise)[0], precise.tag)).toEqual({ lang: "fr", status: "active" });
      expect(await releve(comptes(precise)[1], `${precise.court} `)).toEqual({ lang: "fr", status: "active" });
      const attendu = { app: precise.marque, motif: `${precise.court} → ${precise.tag}`, removed: 2, paused: 1, kept: 1 };
      // À blanc : dit ce qui serait fait, n'écrit rien.
      expect(await admin.mutation(api.radarAuto.e2eRepairAutoPatterns, { secret: E2E_SECRET, dryRun: true, pause: [] })).toEqual({ apps: 1, treated: [attendu], left: 0 });
      expect(await motifs(precise)).toBe(`${precise.court}, #${precise.court}`);
      await expect(suivie(precise.marque)).toContainText("4 comptes");
      // Pour de bon : le hashtag prouvé revient, les deux comptes jamais relevés sont retirés, celui qui ne cite que le mot raccourci passe en pause.
      expect(await admin.mutation(api.radarAuto.e2eRepairAutoPatterns, { secret: E2E_SECRET, dryRun: false, pause: [] })).toEqual({ apps: 1, treated: [attendu], left: 0 });
      expect(await motifs(precise)).toBe(`${precise.tag}, #${precise.tag}`);
      await expect(suivie(precise.marque)).toContainText("2 comptes (1 relevé)");
      await suivie(precise.marque).getByRole("button", { name: new RegExp(precise.marque) }).click();
      const ligne = (handle: string) => suivie(precise.marque).getByTestId("radar-compte").filter({ hasText: `@${handle}` });
      await expect(ligne(comptes(precise)[0])).toHaveCount(1);
      await expect(ligne(comptes(precise)[1])).toHaveCount(1);
      await expect(ligne(comptes(precise)[2])).toHaveCount(0);
      await expect(ligne(zoe)).toHaveCount(0);
      // Réparée, elle n'est plus à réparer.
      expect(await admin.mutation(api.radarAuto.e2eRepairAutoPatterns, { secret: E2E_SECRET, dryRun: false, pause: [] })).toEqual({ apps: 0, treated: [], left: 0 });

      // ── Une app dont le NOM est un mot courant : mise en pause, ses comptes jamais relevés retirés ──
      expect(await admin.mutation(api.radarAuto.e2eRepairAutoPatterns, { secret: E2E_SECRET, dryRun: false, pause: [attente.slug] })).toEqual({
        apps: 1,
        treated: [{ app: attente.marque, motif: "mise en pause", removed: 3, paused: 0, kept: 0 }],
        left: 0,
      });
      await expect(suivie(attente.marque)).toContainText("aucun compte");
      await expect(suivie(attente.marque)).toContainText("en pause");
    } finally {
      await admin.mutation(api.radarStore.e2eClearStore, { secret: E2E_SECRET, prefix: String(ts) });
      await admin.mutation(api.radarNetworks.e2eClearNetwork, { secret: E2E_SECRET, prefix: p });
      await admin.mutation(api.radarSignals.e2eClearSignals, { secret: E2E_SECRET, prefix: m });
    }
  });
});
