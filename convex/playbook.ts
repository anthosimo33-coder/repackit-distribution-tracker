/**
 * PLAYBOOK — les fiches des formats qui ont gagné, par projet (bloc
 * `scripts.manage`, celui des campagnes qu'elles nourrissent). Règles pures dans
 * `convex/playbookFiche.ts`.
 *
 * Chaque geste laisse une ligne au JOURNAL (`playbookRevisions`) avec les
 * valeurs d'avant et le motif : la fiche dit ce qui marche, le journal dit
 * depuis quand et pourquoi. Les posts de preuve sont relus EN DIRECT (vues du
 * dernier relevé) : une fiche ne recopie jamais un chiffre qui vieillit.
 *
 * Les CŒURS (`…Core`) servent aussi Claude : la lecture MCP (`playbook`) passe
 * par `lireFichesCore` / `lireFicheCore` / `aDocumenterCore`, l'écriture
 * (`documenter_format`, convex/mcpPlaybook) par les mêmes cœurs que l'écran.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { permissionMutation, permissionQuery, type ProjectMutationCtx } from "./functions";
import { ERR, err } from "./errorCodes";
import {
  A_DOCUMENTER_FENETRE_MS,
  CHAMPS_TEXTE,
  MAX_POSTS,
  MAX_TEXTE,
  MAX_TITRE,
  STATUT_INITIAL,
  aDocumenter,
  clePost,
  dateDeCle,
  dedoublonnerPosts,
  diffFiche,
  fenetreDePublication,
  motifValide,
  texteValide,
  titreValide,
  type ChampTexte,
  type ContenuFiche,
  type StatutFiche,
} from "./playbookFiche";

const STATUT = v.union(
  v.literal("prouve"),
  v.literal("en_test"),
  v.literal("hypothese"),
  v.literal("en_usure"),
  v.literal("retire"),
);

/** Les entrées d'une modification ; chaque champ absent reste tel quel. */
export type SaisieFiche = Partial<{ titre: string; statut: StatutFiche } & Record<ChampTexte, string>>;

type LectureCtx = { db: QueryCtx["db"]; projectId: Id<"projects"> };

async function ficheDuProjet(ctx: LectureCtx, id: Id<"playbookFiches">): Promise<Doc<"playbookFiches">> {
  const f = await ctx.db.get(id);
  if (!f || f.projectId !== ctx.projectId) throw err(ERR.PLAYBOOK_NOT_FOUND, "Fiche introuvable.");
  return f;
}

function contenuDe(f: Doc<"playbookFiches">): ContenuFiche {
  return {
    titre: f.titre,
    statut: f.statut,
    recette: f.recette,
    preuves: f.preuves,
    contrePreuve: f.contrePreuve,
    regles: f.regles,
    aTester: f.aTester,
  };
}

/** Nettoie et vérifie une saisie : un titre vide ou un texte trop long est refusé, rien n'est écrit. */
function saisieValide(saisie: SaisieFiche): Partial<ContenuFiche> {
  const out: Partial<ContenuFiche> = {};
  if (saisie.titre !== undefined) {
    const t = titreValide(saisie.titre);
    if (t === null) throw err(ERR.PLAYBOOK_TITLE_INVALID, "Titre vide ou trop long.", { max: MAX_TITRE });
    out.titre = t;
  }
  if (saisie.statut !== undefined) out.statut = saisie.statut;
  for (const champ of CHAMPS_TEXTE) {
    const brut = saisie[champ];
    if (brut === undefined) continue;
    const t = texteValide(brut);
    if (t === null) throw err(ERR.PLAYBOOK_TEXT_TOO_LONG, `Texte trop long (${champ}).`, { max: MAX_TEXTE, champ });
    out[champ] = t;
  }
  return out;
}

// ─── Lecture ─────────────────────────────────────────────────────────────────

/** Un post de preuve tel que l'écran et l'outil MCP le montrent : relu à l'instant. */
export type PostDeFiche = {
  publicationId: Id<"publications">;
  cle: string | null;
  url: string | null;
  plateforme: string;
  compte: string;
  datePubli: number;
  campagne: string | null;
  vues: number | null;
  likes: number | null;
  saves: number | null;
};

type PublicationLue = Pick<
  Doc<"publications">,
  "_id" | "postUrl" | "plateforme" | "compte" | "datePubli" | "scriptCombo" | "vuesLatest" | "likesLatest" | "savesLatest"
>;

/** Une publication telle qu'une fiche la montre, le nom de sa campagne lu une fois par campagne. */
async function postDe(
  ctx: { db: QueryCtx["db"] },
  p: PublicationLue,
  campagnes: Map<string, string | null>,
): Promise<PostDeFiche> {
  const campaignId = p.scriptCombo?.campaignId;
  if (campaignId && !campagnes.has(campaignId)) {
    campagnes.set(campaignId, (await ctx.db.get(campaignId))?.name ?? null);
  }
  return {
    publicationId: p._id,
    cle: p.postUrl ? clePost(p.postUrl) : null,
    url: p.postUrl ?? null,
    plateforme: p.plateforme,
    compte: p.compte,
    datePubli: p.datePubli,
    campagne: campaignId ? (campagnes.get(campaignId) ?? null) : null,
    vues: p.vuesLatest ?? null,
    likes: p.likesLatest ?? null,
    saves: p.savesLatest ?? null,
  };
}

async function postsDe(ctx: { db: QueryCtx["db"] }, ids: Id<"publications">[]): Promise<PostDeFiche[]> {
  const campagnes = new Map<string, string | null>();
  const out: PostDeFiche[] = [];
  for (const id of ids) {
    const p = await ctx.db.get(id);
    // Une publication supprimée depuis disparaît de la fiche à l'affichage ; son lien reste au journal.
    if (!p) continue;
    out.push(await postDe(ctx, p, campagnes));
  }
  return dedoublonnerPosts(out);
}

/** La liste : de quoi ranger par statut, sans relire chaque post (le meilleur seulement). */
export async function lireFichesCore(ctx: LectureCtx) {
  const fiches = await ctx.db
    .query("playbookFiches")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect();
  const out = [];
  for (const f of fiches) {
    // Comptés comme sur la fiche : publications qui existent encore, une par vidéo.
    const lus = [];
    for (const id of f.posts) {
      const p = await ctx.db.get(id);
      if (p) lus.push({ cle: p.postUrl ? clePost(p.postUrl) : null, vues: p.vuesLatest ?? null });
    }
    const posts = dedoublonnerPosts(lus);
    out.push({
      _id: f._id,
      titre: f.titre,
      statut: f.statut,
      recette: f.recette,
      posts: posts.length,
      meilleuresVues: posts[0]?.vues ?? null,
      updatedAt: f.updatedAt,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * La FILE « à documenter » : les posts des 30 derniers jours qui sortent du lot
 * (règle pure `aDocumenter`) et qu'aucune fiche du projet ne cite encore.
 */
export async function aDocumenterCore(ctx: LectureCtx, maintenant: number) {
  const dansFiches = new Set<string>();
  for (const f of await ctx.db
    .query("playbookFiches")
    .withIndex("by_project", (q) => q.eq("projectId", ctx.projectId))
    .collect()) {
    for (const id of f.posts) {
      const url = (await ctx.db.get(id))?.postUrl;
      const cle = url ? clePost(url) : null;
      if (cle) dansFiches.add(cle);
    }
  }
  const publications = await ctx.db
    .query("publications")
    .withIndex("by_project_datePubli", (q) =>
      q.eq("projectId", ctx.projectId).gte("datePubli", maintenant - A_DOCUMENTER_FENETRE_MS),
    )
    .collect();
  const { posts, total } = aDocumenter(
    publications.map((p) => ({ p, cle: p.postUrl ? clePost(p.postUrl) : null, vues: p.vuesLatest ?? null, isWarmup: p.isWarmup })),
    dansFiches,
  );
  const campagnes = new Map<string, string | null>();
  const out: PostDeFiche[] = [];
  for (const x of posts) out.push(await postDe(ctx, x.p, campagnes));
  return { posts: out, total };
}

export type LigneJournal = {
  _id: Id<"playbookRevisions">;
  nature: Doc<"playbookRevisions">["nature"];
  champs: string[];
  avant: Partial<ContenuFiche> | null;
  apres: Partial<ContenuFiche> | null;
  motif: string | null;
  postUrl: string | null;
  par: string | null;
  via: string | null;
  le: number;
};

/** La fiche entière, ses posts relus à l'instant et les dernières lignes de son journal. */
export async function lireFicheCore(ctx: LectureCtx, id: Id<"playbookFiches">, journal = 50) {
  const f = await ficheDuProjet(ctx, id);
  const revisions = await ctx.db
    .query("playbookRevisions")
    .withIndex("by_fiche", (q) => q.eq("ficheId", f._id))
    .order("desc")
    .take(journal);
  const noms = new Map<string, string | null>();
  const lignes: LigneJournal[] = [];
  for (const r of revisions) {
    if (!noms.has(r.par)) noms.set(r.par, (await ctx.db.get(r.par))?.name ?? null);
    lignes.push({
      _id: r._id,
      nature: r.nature,
      champs: r.champs,
      avant: r.avant ? (JSON.parse(r.avant) as Partial<ContenuFiche>) : null,
      apres: r.apres ? (JSON.parse(r.apres) as Partial<ContenuFiche>) : null,
      motif: r.motif ?? null,
      postUrl: r.post?.url ?? null,
      par: noms.get(r.par) ?? null,
      via: r.via ?? null,
      le: r.le,
    });
  }
  return {
    _id: f._id,
    titre: f.titre,
    statut: f.statut,
    recette: f.recette,
    preuves: f.preuves,
    contrePreuve: f.contrePreuve,
    regles: f.regles,
    aTester: f.aTester,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    posts: await postsDe(ctx, f.posts),
    journal: lignes,
  };
}

export const listFiches = permissionQuery("scripts.manage")({
  args: {},
  handler: (ctx) => lireFichesCore(ctx),
});

export const getFiche = permissionQuery("scripts.manage")({
  args: { id: v.id("playbookFiches") },
  handler: async (ctx, { id }) => {
    const f = await ctx.db.get(id);
    if (!f || f.projectId !== ctx.projectId) return null;
    return lireFicheCore(ctx, id);
  },
});

export const listADocumenter = permissionQuery("scripts.manage")({
  args: {},
  handler: (ctx) => aDocumenterCore(ctx, Date.now()),
});

// ─── Écriture ────────────────────────────────────────────────────────────────

async function journaliser(
  ctx: ProjectMutationCtx,
  ficheId: Id<"playbookFiches">,
  ligne: Pick<Doc<"playbookRevisions">, "nature" | "champs"> &
    Partial<Pick<Doc<"playbookRevisions">, "avant" | "apres" | "motif" | "post">>,
): Promise<void> {
  const via = (ctx as ProjectMutationCtx & { via?: { name: string } }).via?.name;
  await ctx.db.insert("playbookRevisions", {
    projectId: ctx.projectId,
    ficheId,
    nature: ligne.nature,
    champs: ligne.champs,
    ...(ligne.avant !== undefined ? { avant: ligne.avant } : {}),
    ...(ligne.apres !== undefined ? { apres: ligne.apres } : {}),
    ...(ligne.motif !== undefined ? { motif: ligne.motif } : {}),
    ...(ligne.post !== undefined ? { post: ligne.post } : {}),
    par: ctx.userId,
    // Une écriture de Claude porte sa connexion (contexte d'écriture MCP) : le journal dit qui a tenu le stylo.
    ...(via ? { via } : {}),
    le: Date.now(),
  });
}

/** Crée une fiche : un titre, le reste vide, statut « hypothèse » sauf mention. */
export async function creerFicheCore(
  ctx: ProjectMutationCtx,
  args: SaisieFiche & { titre: string; motif?: string },
): Promise<Id<"playbookFiches">> {
  const s = saisieValide(args);
  const maintenant = Date.now();
  const id = await ctx.db.insert("playbookFiches", {
    projectId: ctx.projectId,
    titre: s.titre!,
    statut: s.statut ?? STATUT_INITIAL,
    recette: s.recette ?? "",
    preuves: s.preuves ?? "",
    contrePreuve: s.contrePreuve ?? "",
    regles: s.regles ?? "",
    aTester: s.aTester ?? "",
    posts: [],
    createdBy: ctx.userId,
    createdAt: maintenant,
    updatedAt: maintenant,
  });
  const motif = motifValide(args.motif);
  await journaliser(ctx, id, { nature: "creation", champs: [], ...(motif ? { motif } : {}) });
  return id;
}

export const creerFiche = permissionMutation("scripts.manage")({
  args: { titre: v.string(), statut: v.optional(STATUT) },
  handler: (ctx, args) => creerFicheCore(ctx, args),
});

/**
 * Modifie une fiche. Seuls les champs qui changent vraiment s'écrivent ; une
 * saisie identique ne laisse aucune ligne au journal (`modifie: false`).
 */
export async function modifierFicheCore(
  ctx: ProjectMutationCtx,
  id: Id<"playbookFiches">,
  args: SaisieFiche & { motif?: string },
): Promise<{ modifie: boolean; champs: string[] }> {
  const f = await ficheDuProjet(ctx, id);
  const d = diffFiche(contenuDe(f), saisieValide(args));
  if (d.champs.length === 0) return { modifie: false, champs: [] };
  await ctx.db.patch(f._id, { ...d.apres, updatedAt: Date.now() });
  const motif = motifValide(args.motif);
  await journaliser(ctx, f._id, {
    nature: "modification",
    champs: d.champs,
    avant: JSON.stringify(d.avant),
    apres: JSON.stringify(d.apres),
    ...(motif ? { motif } : {}),
  });
  return { modifie: true, champs: d.champs };
}

export const modifierFiche = permissionMutation("scripts.manage")({
  args: {
    id: v.id("playbookFiches"),
    titre: v.optional(v.string()),
    statut: v.optional(STATUT),
    recette: v.optional(v.string()),
    preuves: v.optional(v.string()),
    contrePreuve: v.optional(v.string()),
    regles: v.optional(v.string()),
    aTester: v.optional(v.string()),
    motif: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...saisie }) => modifierFicheCore(ctx, id, saisie),
});

/**
 * La publication du projet qui porte ce lien. On ne relit pas tout le projet :
 * l'identifiant de la vidéo donne sa date de mise en ligne, et l'index par date
 * de publication borne la recherche à quelques jours.
 */
async function publicationDuLien(ctx: ProjectMutationCtx, url: string): Promise<Doc<"publications">> {
  const cle = clePost(url);
  const date = cle ? dateDeCle(cle) : null;
  if (!cle || date === null) throw err(ERR.PLAYBOOK_LINK_INVALID, "Lien de vidéo illisible.");
  const { du, au } = fenetreDePublication(date);
  const candidates = await ctx.db
    .query("publications")
    .withIndex("by_project_datePubli", (q) => q.eq("projectId", ctx.projectId).gte("datePubli", du).lte("datePubli", au))
    .collect();
  const memes = candidates.filter((c) => c.postUrl && clePost(c.postUrl) === cle);
  if (memes.length === 0) throw err(ERR.PLAYBOOK_POST_NOT_FOUND, "Aucun post du projet ne porte ce lien.");
  // Deux publications pour une même vidéo (deux comptes) : celle dont le lien est
  // celui collé, sinon celle qui a le plus de vues.
  return (
    memes.find((c) => c.postUrl?.trim() === url.trim()) ??
    memes.reduce((a, b) => ((b.vuesLatest ?? -1) > (a.vuesLatest ?? -1) ? b : a))
  );
}

/** Ajoute un post de preuve par son lien. Une même vidéo sur deux comptes n'entre qu'une fois. */
export async function ajouterPostCore(
  ctx: ProjectMutationCtx,
  id: Id<"playbookFiches">,
  args: { url: string; motif?: string },
): Promise<{ publicationId: Id<"publications"> }> {
  const f = await ficheDuProjet(ctx, id);
  const p = await publicationDuLien(ctx, args.url);
  const cle = clePost(args.url);
  // Les publications supprimées depuis quittent la fiche ici : elles ne comptent plus.
  const vivants: Id<"publications">[] = [];
  for (const deja of f.posts) {
    const autre = deja === p._id ? p : await ctx.db.get(deja);
    if (!autre) continue;
    if (autre._id === p._id || (autre.postUrl && clePost(autre.postUrl) === cle)) {
      throw err(ERR.PLAYBOOK_POST_ALREADY, "Ce post est déjà dans la fiche.");
    }
    vivants.push(deja);
  }
  if (vivants.length >= MAX_POSTS) {
    throw err(ERR.PLAYBOOK_TOO_MANY_POSTS, "Trop de posts dans la fiche.", { max: MAX_POSTS });
  }
  await ctx.db.patch(f._id, { posts: [...vivants, p._id], updatedAt: Date.now() });
  const motif = motifValide(args.motif);
  await journaliser(ctx, f._id, {
    nature: "postAjoute",
    champs: ["posts"],
    post: { publicationId: p._id, url: p.postUrl ?? args.url.trim() },
    ...(motif ? { motif } : {}),
  });
  return { publicationId: p._id };
}

export const ajouterPostFiche = permissionMutation("scripts.manage")({
  args: { id: v.id("playbookFiches"), url: v.string(), motif: v.optional(v.string()) },
  handler: (ctx, { id, ...args }) => ajouterPostCore(ctx, id, args),
});

/**
 * Remet une fiche dans un état gardé au journal de Claude (`defaire`) : son
 * contenu par `modifierFicheCore`, ses posts tels quels. Chaque geste laisse sa
 * ligne au journal de la fiche, avec le motif.
 */
export async function remettreFicheCore(
  ctx: ProjectMutationCtx,
  id: Id<"playbookFiches">,
  etat: ContenuFiche & { posts: Id<"publications">[] },
  motif: string,
): Promise<void> {
  const { posts, ...contenu } = etat;
  await modifierFicheCore(ctx, id, { ...contenu, motif });
  const f = await ficheDuProjet(ctx, id);
  const retires = f.posts.filter((p) => !posts.includes(p));
  const remis = posts.filter((p) => !f.posts.includes(p));
  if (retires.length === 0 && remis.length === 0) return;
  await ctx.db.patch(f._id, { posts, updatedAt: Date.now() });
  for (const [nature, ids] of [["postRetire", retires], ["postAjoute", remis]] as const) {
    for (const publicationId of ids) {
      const url = (await ctx.db.get(publicationId))?.postUrl ?? "";
      await journaliser(ctx, f._id, { nature, champs: ["posts"], post: { publicationId, url }, motif });
    }
  }
}

export async function retirerPostCore(
  ctx: ProjectMutationCtx,
  id: Id<"playbookFiches">,
  publicationId: Id<"publications">,
  motif?: string,
): Promise<void> {
  const f = await ficheDuProjet(ctx, id);
  if (!f.posts.includes(publicationId)) return;
  await ctx.db.patch(f._id, { posts: f.posts.filter((p) => p !== publicationId), updatedAt: Date.now() });
  const url = (await ctx.db.get(publicationId))?.postUrl ?? "";
  const m = motifValide(motif);
  await journaliser(ctx, f._id, { nature: "postRetire", champs: ["posts"], post: { publicationId, url }, ...(m ? { motif: m } : {}) });
}

export const retirerPostFiche = permissionMutation("scripts.manage")({
  args: { id: v.id("playbookFiches"), publicationId: v.id("publications") },
  handler: async (ctx, { id, publicationId }) => {
    await retirerPostCore(ctx, id, publicationId);
    return { ok: true };
  },
});

/** Supprime une fiche ET son journal. Pour un format qui ne marche plus, « Retiré » garde l'historique. */
export async function supprimerFicheCore(ctx: ProjectMutationCtx, id: Id<"playbookFiches">): Promise<void> {
  const f = await ficheDuProjet(ctx, id);
  for (const r of await ctx.db
    .query("playbookRevisions")
    .withIndex("by_fiche", (q) => q.eq("ficheId", f._id))
    .collect()) {
    await ctx.db.delete(r._id);
  }
  await ctx.db.delete(f._id);
}

export const supprimerFiche = permissionMutation("scripts.manage")({
  args: { id: v.id("playbookFiches") },
  handler: async (ctx, { id }) => {
    await supprimerFicheCore(ctx, id);
    return { ok: true };
  },
});
