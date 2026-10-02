import { test, expect, adminPath, E2E_PROJECT_SLUG } from "./fixtures/auth-fixture";
import { createE2eClient } from "./helpers/authed-client";
import { createCreatorSession } from "./helpers/creator-client";
import { availableTarget } from "./helpers/targets";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { campaignNameMatches, PROVEN_CAMPAIGN_NAME } from "../convex/graduation";
import { config } from "dotenv";

config({ path: ".env.local" });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
const admin = createE2eClient(convexUrl);
const DAY = 86_400_000;

type Rpc = { result?: { tools?: { name: string; annotations: Record<string, unknown> }[]; content?: { text: string }[]; isError?: boolean }; error?: { message: string } };

async function rpc(url: string, token: string, method: string, params?: unknown): Promise<Rpc> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return (await r.json()) as Rpc;
}
async function appel(url: string, token: string, name: string, args: Record<string, unknown>) {
  const r = await rpc(url, token, "tools/call", { name, arguments: { projet: E2E_PROJECT_SLUG, ...args } });
  return {
    erreur: r.error !== undefined || r.result?.isError === true,
    texte: r.error?.message ?? r.result?.content?.[0]?.text ?? "",
  };
}

/** Jour de Paris dans `n` jours — la forme que Claude lit dans `planning`. */
const jourParis = (n: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + n * DAY));
const jourDe = (ts: number | undefined) =>
  ts === undefined ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ts));

const MISSIONS = ["assigner_scripts", "rejouer_script", "replanifier_mission", "consigne_mission", "annuler_mission"];
const SCRIPTS = ["ajouter_hooks", "activer_briques", "graduer_hook"];
const PUBLICATIONS = ["confirmer_publication", "marquer_warmup"];

/**
 * MCP EN ÉCRITURE — missions, scripts, publications. Chaque domaine ne s'ouvre
 * que par SON interrupteur dans l'app ; chaque outil appelle le cœur du bouton de
 * l'écran (mêmes règles, mêmes refus) et désigne les choses par le NOM que les
 * outils de lecture montrent : créatrice + jour prévu, lien d'un post, libellé
 * d'une brique.
 *
 * Données à la forme de la prod : noms complets, handles suffixés, jours ≠
 * aujourd'hui, deux créatrices (le décalage d'un jour de l'assignation en masse).
 */
test.describe("MCP en écriture — missions, scripts, publications", () => {
  test("un interrupteur par domaine, puis assigner, replanifier, publier, rejouer, abandonner, hooks", async ({ page }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    const kellyNom = `Kelly Martin ${ts}`;
    const leaNom = `Léa Fontaine ${ts}`;
    const kelly = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] ${kellyNom}`,
      email: `e2e-mcp-kelly-${ts}@repackit.test`,
      password: "kelly-12345",
    });
    const lea = await createCreatorSession(convexUrl, {
      name: `[E2E_TEST] ${leaNom}`,
      email: `e2e-mcp-lea-${ts}@repackit.test`,
      password: "lea-123456",
    });
    const hKelly = `@kellymartinfr${ts}`;
    const hLea = `@leafontaine${ts}`;
    await availableTarget({ e2eClient: admin, creatorId: kelly.creatorId, platform: "TikTok", handle: hKelly });
    await availableTarget({ e2eClient: admin, creatorId: lea.creatorId, platform: "TikTok", handle: hLea });

    const campagne = `Snytch FR ${ts}`;
    const campaignId = (await admin.mutation(api.scripts.createCampaign, { name: `[E2E_TEST] ${campagne}` })) as Id<"scriptCampaigns">;
    const brique = (kind: "hook" | "flux" | "cta", label: string, content: string) =>
      admin.mutation(api.scripts.createBrick, { campaignId, kind, label, content });
    await brique("hook", "Hook dos de carte", `Personne ne regarde le dos de ses cartes ${ts}`);
    await brique("hook", "Hook prix", `Cette carte valait 3 € il y a un an ${ts}`);
    await brique("hook", "Hook grenier", `J'ai retrouvé le classeur de mon frère ${ts}`);
    await brique("flux", "Flux scan", "Je la scanne avec l'appli et le prix tombe.");
    await brique("cta", "CTA bio", "Le lien est dans ma bio.");
    const bareme = `Barème créatrices ${ts}`;
    await admin.mutation(api.pricing.createPricing, { name: `[E2E_TEST] ${bareme}`, montantFixe: 100, nbVideosCible: 10, tauxCPM: 2.5 });

    const missions = async (creatorId: Id<"creators">) =>
      (await admin.query(api.assignments.listAssignments, {})).filter((a) => a.creatorId === creatorId);
    const missionDu = async (creatorId: Id<"creators">, jour: string) =>
      (await missions(creatorId)).filter((a) => jourDe(a.postDate) === jour);

    // ── Une clé, depuis l'écran : lecture seule ───────────────────────────────
    const nomCle = `E2E missions ${ts}`;
    await page.goto(adminPath("/comptes"));
    await page.getByRole("button", { name: "Connecter Claude" }).click();
    await page.getByLabel("Nom de la clé").fill(nomCle);
    await page.getByRole("button", { name: "Créer une clé" }).click();
    const token = (await page.getByTestId("mcp-cle-en-clair").textContent())!.trim();
    const url = (await page.locator("pre").filter({ hasText: "claude mcp add" }).textContent())!.match(/jarvia (\S+\/mcp) /)![1];
    await page.getByRole("button", { name: "J’ai copié la clé" }).click();

    const noms = async () => ((await rpc(url, token, "tools/list")).result?.tools ?? []).map((t) => t.name);
    let liste = await noms();
    expect(liste).toContain("planning");
    for (const n of [...MISSIONS, ...SCRIPTS, ...PUBLICATIONS]) expect(liste).not.toContain(n);
    const J3 = jourParis(3);
    const J4 = jourParis(4);
    const J5 = jourParis(5);
    const J6 = jourParis(6);
    const J7 = jourParis(7);
    const assigner = { campagne, createatrices: [kellyNom], jours: [J3, J5], bareme };
    const refuse = await appel(url, token, "assigner_scripts", assigner);
    expect(refuse.erreur).toBe(true);
    expect(await missions(kelly.creatorId)).toHaveLength(0);

    // ── Un domaine à la fois ──────────────────────────────────────────────────
    const interrupteur = (domaine: string) => page.getByRole("switch", { name: `Modifications des ${domaine} pour ${nomCle}` });
    await interrupteur("missions").click();
    await expect(interrupteur("missions")).toBeChecked();
    liste = await noms();
    for (const n of MISSIONS) expect(liste).toContain(n);
    for (const n of [...SCRIPTS, ...PUBLICATIONS]) expect(liste).not.toContain(n);
    const outils = (await rpc(url, token, "tools/list")).result!.tools!;
    expect(outils.find((t) => t.name === "assigner_scripts")!.annotations).toMatchObject({ readOnlyHint: false });
    expect(outils.find((t) => t.name === "annuler_mission")!.annotations).toMatchObject({ destructiveHint: true });
    // Deux interrupteurs coup sur coup : le second ne doit pas écraser le premier.
    await interrupteur("scripts").click();
    await interrupteur("publications").click();
    await expect(interrupteur("scripts")).toBeChecked();
    await expect(interrupteur("publications")).toBeChecked();
    await expect(interrupteur("missions")).toBeChecked();
    liste = await noms();
    for (const n of [...MISSIONS, ...SCRIPTS, ...PUBLICATIONS]) expect(liste).toContain(n);

    // ── assigner_scripts : simuler n'écrit rien ───────────────────────────────
    const sim = await appel(url, token, "assigner_scripts", { ...assigner, simuler: true });
    expect(sim.erreur, sim.texte).toBe(false);
    const simulation = JSON.parse(sim.texte).simulation as {
      assignation: { comptes: string[]; bareme: string };
      scripts: { jour: string; cle: string; script: string }[];
    };
    expect(simulation.assignation.comptes).toEqual([`${hKelly} (TikTok)`]);
    expect(simulation.assignation.bareme).toBe(`[E2E_TEST] ${bareme}`);
    expect(simulation.scripts.map((s) => s.jour)).toEqual([J3, J5]);
    expect(simulation.scripts[0].script).toContain("Le lien est dans ma bio.");
    expect(await missions(kelly.creatorId)).toHaveLength(0);

    // ── …puis on crée, en écartant le premier script proposé ─────────────────
    const consigne = "Filme en lumière du jour, la carte bien nette.";
    const a = await appel(url, token, "assigner_scripts", {
      ...assigner,
      plage: "21h-23h",
      consigne,
      exclure: [simulation.scripts[0].cle],
    });
    expect(a.erreur, a.texte).toBe(false);
    expect(JSON.parse(a.texte).parCreatrice[0]).toMatchObject({ creees: 2, jours: [J3, J5], emailEnvoye: true });
    const creees = await missions(kelly.creatorId);
    expect(creees).toHaveLength(2);
    expect(creees.map((m) => jourDe(m.postDate)).sort()).toEqual([J3, J5]);
    expect(creees.map((m) => m.comboKey)).not.toContain(simulation.scripts[0].cle);
    expect(creees.map((m) => m.comboKey)).toContain(simulation.scripts[1].cle);
    for (const m of creees) {
      expect(m.instructions).toBe(consigne);
      expect(m.postWindow).toEqual({ startMin: 21 * 60, endMin: 23 * 60 });
      expect(m.targets.map((t) => t.accountHandle)).toEqual([hKelly]);
      expect(m.status).toBe("todo");
    }

    // ── replanifier_mission : désignée par créatrice + jour prévu ────────────
    const rp = await appel(url, token, "replanifier_mission", { createatrice: kellyNom, jour: J3, nouveau_jour: J4, plage: "soir" });
    expect(rp.erreur, rp.texte).toBe(false);
    expect((await missions(kelly.creatorId)).map((m) => jourDe(m.postDate)).sort()).toEqual([J4, J5]);
    // Un jour sans mission : le refus cite les missions les plus proches.
    const perdu = await appel(url, token, "replanifier_mission", { createatrice: kellyNom, jour: jourParis(9), nouveau_jour: J6 });
    expect(perdu.erreur).toBe(true);
    expect(perdu.texte).toContain("Ses missions les plus proches");
    expect(perdu.texte).toContain(hKelly);

    // ── consigne_mission : seulement la mission désignée ──────────────────────
    const cg = await appel(url, token, "consigne_mission", {
      createatrice: kellyNom,
      jour: J4,
      consigne: "Montre le prix affiché à l'écran.",
      texte_a_incruster: "Elle valait 3 €…",
    });
    expect(cg.erreur, cg.texte).toBe(false);
    const [m4] = await missionDu(kelly.creatorId, J4);
    const [m5] = await missionDu(kelly.creatorId, J5);
    expect(m4.instructions).toBe("Montre le prix affiché à l'écran.");
    expect(m4.overlayText).toBe("Elle valait 3 €…");
    expect(m5.instructions).toBe(consigne);

    // ── confirmer_publication : le lien collé en secours ──────────────────────
    const videoId = ((BigInt(Math.floor(Date.now() / 1000)) << BigInt(32)) + BigInt(4242)).toString();
    const lien = `https://www.tiktok.com/${hKelly}/video/${videoId}`;
    const cp = await appel(url, token, "confirmer_publication", { createatrice: kellyNom, jour: J4, liens: [lien] });
    expect(cp.erreur, cp.texte).toBe(false);
    const [publiee] = await missionDu(kelly.creatorId, J4);
    expect(publiee.status).toBe("published");
    expect(publiee.targets[0].publishedUrl).toBe(lien);
    // Plus aucune mission à publier ce jour-là : le refus le dit.
    const encore = await appel(url, token, "confirmer_publication", { createatrice: kellyNom, jour: J4, liens: [lien] });
    expect(encore.erreur).toBe(true);
    expect(encore.texte).toContain("déjà publiée");

    // ── marquer_warmup : le post désigné par son lien, paramètres compris ─────
    const publication = (await admin.query(api.publications.listPublications, {})).find((p) => p.postUrl === lien)!;
    expect(publication).toBeDefined();
    expect(publication.isWarmup === true).toBe(false);
    const w = await appel(url, token, "marquer_warmup", { lien: `${lien}?is_from_webapp=1&sender_device=pc`, warmup: true });
    expect(w.erreur, w.texte).toBe(false);
    expect(JSON.parse(w.texte).fait).toContain("chauffe, non rémunéré");
    const drapeaux = await admin.query(api.publications.getPublicationPayFlags, { publicationId: publication._id });
    expect(drapeaux).toMatchObject({ isWarmup: true, isRemunerated: false });

    // ── rejouer_script : deux créatrices, la 2e décalée d'un jour ─────────────
    const rj = await appel(url, token, "rejouer_script", { lien, createatrices: [leaNom, kellyNom], jours: [J6], bareme });
    expect(rj.erreur, rj.texte).toBe(false);
    const parCreatrice = JSON.parse(rj.texte).parCreatrice as { createatrice: string; creees: number; jours: string[] }[];
    expect(parCreatrice.map((p) => [p.createatrice, p.creees, p.jours])).toEqual([
      [leaNom, 1, [J6]],
      [kellyNom, 1, [J7]],
    ]);
    const [rejeuLea] = await missions(lea.creatorId);
    expect(rejeuLea).toMatchObject({ comboImposed: true, replayedFrom: publiee._id, comboKey: publiee.comboKey });
    expect(jourDe(rejeuLea.postDate)).toBe(J6);
    expect((await missionDu(kelly.creatorId, J7))[0]?.comboKey).toBe(publiee.comboKey);

    // ── annuler_mission : une publiée ne s'abandonne pas, une à faire si ─────
    const anPub = await appel(url, token, "annuler_mission", { createatrice: kellyNom, jour: J4 });
    expect(anPub.erreur).toBe(true);
    expect((await missionDu(kelly.creatorId, J4))[0].status).toBe("published");
    const an = await appel(url, token, "annuler_mission", { createatrice: kellyNom, jour: J5 });
    expect(an.erreur, an.texte).toBe(false);
    expect((await missionDu(kelly.creatorId, J5))[0].status).toBe("cancelled");

    // ── ajouter_hooks : désactivés, sans doublon ──────────────────────────────
    const nouveau = `Le dos de cette carte cache un défaut ${ts}`;
    const ah = await appel(url, token, "ajouter_hooks", {
      campagne,
      hooks: [{ texte: nouveau, consigne: "Retourne la carte lentement." }, { texte: `Personne ne regarde le dos de ses cartes ${ts}` }],
    });
    expect(ah.erreur, ah.texte).toBe(false);
    expect(JSON.parse(ah.texte)).toMatchObject({ dejaPresents: [`Personne ne regarde le dos de ses cartes ${ts}`] });
    const bricks = async () => (await admin.query(api.scripts.getCampaign, { id: campaignId }))!.bricks;
    const ajoute = (await bricks()).find((b) => b.content === nouveau)!;
    expect(ajoute).toMatchObject({ kind: "hook", active: false, label: nouveau, instruction: "Retourne la carte lentement." });
    expect((await bricks()).filter((b) => b.kind === "hook")).toHaveLength(4);

    // ── activer_briques : tout ou rien ────────────────────────────────────────
    const ambigu = await appel(url, token, "activer_briques", { campagne, briques: [nouveau, "Hook"], actif: true });
    expect(ambigu.erreur).toBe(true);
    expect(ambigu.texte).toContain("Rien n'a changé");
    expect((await bricks()).find((b) => b._id === ajoute._id)!.active).toBe(false);
    const ab = await appel(url, token, "activer_briques", { campagne, briques: ["le dos de cette carte"], actif: true });
    expect(ab.erreur, ab.texte).toBe(false);
    expect((await bricks()).find((b) => b._id === ajoute._id)!.active).toBe(true);

    // ── graduer_hook : copie + désactivation ──────────────────────────────────
    // La campagne cible se trouve par son NOM exact : on réutilise celle d'un run
    // précédent (cf hook-graduation.spec), sinon on la crée.
    const prouvees =
      (await admin.query(api.scripts.listCampaigns, {})).find((c) => campaignNameMatches(c.name, PROVEN_CAMPAIGN_NAME))?._id ??
      ((await admin.mutation(api.scripts.createCampaign, { name: PROVEN_CAMPAIGN_NAME })) as Id<"scriptCampaigns">);
    const gr = await appel(url, token, "graduer_hook", { campagne, hook: "Hook grenier" });
    expect(gr.erreur, gr.texte).toBe(false);
    expect((await bricks()).find((b) => b.label === "Hook grenier")!.active).toBe(false);
    const copie = (await admin.query(api.scripts.getCampaign, { id: prouvees }))!.bricks.find(
      (b) => b.content === `J'ai retrouvé le classeur de mon frère ${ts}`,
    );
    expect(copie).toMatchObject({ kind: "hook", active: true });

    // ── Le journal, dans l'écran, avec l'écran où défaire ─────────────────────
    const journal = page.getByTestId("mcp-journal");
    await expect(journal).toContainText("Assigner des scripts");
    await expect(journal).toContainText(`[E2E_TEST] ${kellyNom} : 2 vidéos`);
    await expect(journal).toContainText("Rejouer un script");
    await expect(journal).toContainText("Coller un lien de post");
    await expect(journal).toContainText("Graduer un hook");
    await expect(journal.getByRole("link", { name: /Assignments/ }).first()).toHaveAttribute("href", adminPath("/assignments"));
    await expect(journal.getByRole("link", { name: /Campagne/ }).first()).toHaveAttribute("href", adminPath(`/scripts/${campaignId}`));
    await expect(journal.getByRole("link", { name: /Tracker/ }).first()).toHaveAttribute("href", adminPath("/dashboard"));

    // ── Couper les missions : leurs outils disparaissent, pas les autres ──────
    await interrupteur("missions").click();
    await expect(interrupteur("missions")).not.toBeChecked();
    liste = await noms();
    for (const n of MISSIONS) expect(liste).not.toContain(n);
    for (const n of SCRIPTS) expect(liste).toContain(n);
    const avant = (await missions(kelly.creatorId)).length;
    const coupe = await appel(url, token, "assigner_scripts", { ...assigner, jours: [jourParis(8)] });
    expect(coupe.erreur).toBe(true);
    expect(await missions(kelly.creatorId)).toHaveLength(avant);
  });
});
