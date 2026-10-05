/**
 * SOCLE des outils MCP d'écriture, commun à tous les domaines (Compta, missions,
 * scripts, publications).
 *
 * Un domaine = un interrupteur dans « Connecter Claude » (`writeScopes`), une
 * liste d'outils annotés écriture, et une fonction qui les exécute. Chaque
 * écriture passe par `mcpWriteMutation` (autorisation de la connexion relue dans
 * la transaction, puis le droit du bouton de l'écran), appelle le CŒUR de la
 * mutation de l'écran, et se note au journal avec l'écran où la défaire.
 *
 * Claude ne voit aucun identifiant interne : il désigne une créatrice, un
 * compte, une campagne ou une brique par son NOM, tel que les outils de lecture
 * le lui ont montré. Un nom qui ne désigne rien, ou plusieurs choses, est refusé
 * avec la liste des candidats — jamais deviné.
 */

import { ConvexError } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { McpWriteScope, ProjectMutationCtx } from "./functions";
import { ERR, err } from "./errorCodes";
import { designer } from "./mcpWriteArgs";
import { textResult, ToolError, type McpTool, type ToolResult } from "./mcpProtocol";
import type { Annulation } from "./mcpAnnulation";
import type { PermissionId } from "./permissions";
import { comboAvecTexte, missionAvecTexte } from "./assignmentScriptText";

export const ARG_PROJET = {
  type: "string",
  description: "Slug ou nom du projet (ex. « snytch »). Facultatif si la clé n'ouvre qu'un seul projet.",
} as const;

/** Réécrire le même état ne change rien. */
export const ECRIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true } as const;
/** Crée quelque chose à chaque appel. */
export const AJOUTE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;
/** Retire ou abandonne, sans retour en arrière simple. */
export const EFFACE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false } as const;

/** Contexte d'une écriture MCP : personne, projet, et la connexion qui écrit. */
export type EcritureCtx = ProjectMutationCtx & { via: { kind: "token" | "oauth" | "proposition"; name: string } };

/** Ce qu'un outil d'écriture transmet à sa mutation gardée. */
export type CibleEcriture = {
  userId: Id<"users">;
  projectId: Id<"projects">;
  acces: { kind: "token" | "oauth" | "proposition"; id: string };
};

/** Un domaine d'écriture : son interrupteur, ses outils, leur exécution. */
export interface DomaineEcriture {
  scope: McpWriteScope;
  outils: readonly McpTool[];
  /** Le droit de l'app que chaque outil exige — celui du bouton de l'écran. */
  droits: Readonly<Record<string, PermissionId>>;
  appeler(
    ctx: ActionCtx,
    name: string,
    args: Record<string, unknown>,
    cible: CibleEcriture,
    projet: string,
  ): Promise<ToolResult>;
}

/** JSON à clés TRIÉES : deux états égaux s'écrivent pareil, quel que soit l'ordre des champs. */
export function jsonCanonique(x: unknown): string {
  const trier = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(trier)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
              .map((k) => [k, trier((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(trier(x));
}

/**
 * Le SCRIPT d'une mission tel que la créatrice le reçoit — combinaison, texte
 * figé, notif — et sa consigne : ce que `reecrire_mission` écrit et ce que
 * `defaire` remet (annulation « combo »).
 */
export async function scriptDeMission(
  ctx: Pick<EcritureCtx, "db">,
  a: Doc<"assignments">,
): Promise<string> {
  return jsonCanonique({
    // AVEC son texte, qui vit hors du document : même forme qu'avant la sortie
    // du texte, donc les entrées déjà au journal se comparent pareil.
    scriptCombo: (await comboAvecTexte(ctx, a)) ?? null,
    comboKey: a.comboKey ?? null,
    comboImposed: a.comboImposed ?? null,
    instructions: a.instructions ?? null,
  });
}

/** Un document touché par une écriture : en entier (JSON), avant et après. */
export type Etat = { table: string; id: string; avant: string | null; apres: string | null };
/** Un document photographié AVANT l'écriture, à compléter par `etatsApres`. */
export type Photo = { table: TableNames; id: string; avant: string | null };

async function lireDoc(
  ctx: Pick<EcritureCtx, "db">,
  table: string,
  id: string,
): Promise<string | null> {
  const d = await ctx.db.get(id as Id<TableNames>);
  if (!d) return null;
  // Une MISSION se photographie avec son texte de script, comme avant qu'il ne
  // sorte du document (convex/assignmentScriptText) : de quoi la reconstruire,
  // script compris, et la même forme que les entrées déjà au journal.
  return JSON.stringify(
    table === "assignments" ? await missionAvecTexte(ctx, d as Doc<"assignments">) : d,
  );
}

/** Photographie des documents AVANT de les écrire (null = n'existe pas). */
export async function photographier(
  ctx: Pick<EcritureCtx, "db">,
  table: TableNames,
  ids: readonly string[],
): Promise<Photo[]> {
  return Promise.all(ids.map(async (id) => ({ table, id, avant: await lireDoc(ctx, table, id) })));
}

/** Photographie les documents qu'une ligne du journal a touchés (pour `defaire`). */
export async function photographierEtats(
  ctx: Pick<EcritureCtx, "db">,
  etats: readonly { table: string; id: string }[],
): Promise<Photo[]> {
  return Promise.all(etats.map(async (e) => ({ table: e.table as TableNames, id: e.id, avant: await lireDoc(ctx, e.table, e.id) })));
}

/** Les photos d'avant, complétées de l'état relu APRÈS l'écriture. */
export async function etatsApres(ctx: Pick<EcritureCtx, "db">, photos: readonly Photo[]): Promise<Etat[]> {
  return Promise.all(photos.map(async (p) => ({ table: p.table, id: p.id, avant: p.avant, apres: await lireDoc(ctx, p.table, p.id) })));
}

/** Des documents CRÉÉS par l'écriture : rien avant, l'état relu après. */
export async function etatsCrees(ctx: Pick<EcritureCtx, "db">, table: TableNames, ids: readonly string[]): Promise<Etat[]> {
  return etatsApres(ctx, ids.map((id) => ({ table, id, avant: null })));
}

/**
 * Note une écriture réussie au journal (« Connecter Claude › Modifications faites
 * par Claude »). `path` = l'écran où la défaire, sous `/admin/<projet>/`.
 *
 * `etats` est OBLIGATOIRE : chaque outil d'écriture garde les documents qu'il a
 * touchés, en entier, avant et après — de quoi défaire, et de quoi reconstruire
 * une mission supprimée depuis (incident du 05/10/2026 : la combinaison d'une
 * mission abandonnée puis supprimée n'était nulle part). Le type le tient : un
 * outil qui l'oublie ne compile pas.
 */
export async function journaliser(
  ctx: Pick<EcritureCtx, "db" | "userId" | "projectId" | "via">,
  e: {
    tool: string;
    summary: string;
    section: string;
    month?: string;
    path?: string;
    annulation?: Annulation;
    etats: readonly Etat[];
  },
) {
  await ctx.db.insert("mcpWriteLog", {
    userId: ctx.userId,
    projectId: ctx.projectId,
    via: ctx.via,
    tool: e.tool,
    summary: e.summary,
    section: e.section,
    ...(e.month ? { month: e.month } : {}),
    ...(e.path ? { path: e.path } : {}),
    ...(e.annulation ? { annulation: e.annulation } : {}),
    etats: [...e.etats],
    at: Date.now(),
  });
}

/** Le message d'un refus serveur, tel que l'app le formule. */
export function refusDe(e: unknown): string | null {
  if (!(e instanceof ConvexError)) return null;
  const d: unknown = e.data;
  if (typeof d === "string") return d;
  if (typeof d === "object" && d !== null && "message" in d) return String((d as { message: unknown }).message);
  return null;
}

/** Le code d'un refus serveur (`ERR_…`), pour les refus qui appellent une suite. */
export function codeDe(e: unknown): string | null {
  if (!(e instanceof ConvexError)) return null;
  const d: unknown = e.data;
  return typeof d === "object" && d !== null && "code" in d ? String((d as { code: unknown }).code) : null;
}

/** Un refus de l'app, tel que le modèle le lit — avec son code, pour enchaîner. */
export class RefusEcriture extends ToolError {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

/** Une écriture : un refus de l'app devient un message pour le modèle. */
export async function ecrire<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    const m = refusDe(e);
    if (m !== null) throw new RefusEcriture(`Refusé : ${m}`, codeDe(e));
    throw e;
  }
}

/** La réponse d'un outil d'écriture : ce qui a changé, et où le défaire. */
export function resultatEcriture(
  projet: string,
  fait: string | string[],
  pourDefaire: string,
  plus: Record<string, unknown> = {},
): ToolResult {
  return textResult(
    JSON.stringify(
      {
        projet,
        fait,
        ...plus,
        journal: "Noté dans Jarvia › Connecter Claude › Modifications faites par Claude.",
        pourDefaire,
      },
      null,
      1,
    ),
  );
}

/**
 * UN élément désigné par son nom, ou le refus qui cite les candidats (au plus
 * 15) — dans la transaction, donc sur ce que la base contient à cet instant.
 */
export function designerOuRefuser<T>(
  items: readonly T[],
  nomDe: (t: T) => string,
  demande: string,
  quoi: string,
): T {
  const r = designer(items, nomDe, demande);
  if (r.ok) return r.item;
  const liste = (r.candidats.length > 0 ? r.candidats : items).map(nomDe);
  const extrait = liste.slice(0, 15).map((n) => `« ${n} »`).join(", ") + (liste.length > 15 ? "…" : "");
  throw err(
    ERR.MCP_DESIGNATION,
    r.candidats.length > 1
      ? `« ${demande} » désigne plusieurs ${quoi} : ${extrait}. Précise.`
      : `${quoi.charAt(0).toUpperCase()}${quoi.slice(1)} « ${demande} » introuvable.` +
          (liste.length > 0 ? ` Possibles : ${extrait}.` : ""),
  );
}

/** Le texte d'un argument, sans les blancs du bord ; absent = "". */
export const texteArg = (args: Record<string, unknown>, cle: string) =>
  typeof args[cle] === "string" ? (args[cle] as string).trim() : "";

/** Une liste de textes non vides ; absente = []. */
export function textesArg(args: Record<string, unknown>, cle: string): string[] {
  const x = args[cle];
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x) || !x.every((t) => typeof t === "string")) {
    throw new ToolError(`« ${cle} » doit être une liste de textes.`);
  }
  return x.map((t) => t.trim()).filter((t) => t !== "");
}

/**
 * UNE brique par son libellé (ce que l'outil `scripts` montre), sinon par un
 * morceau de son texte ; ambiguë ou introuvable → refus qui cite les candidats.
 */
export function briqueDe(briques: readonly Doc<"scriptBricks">[], demande: string, role: string): Doc<"scriptBricks"> {
  const parLibelle = designer(briques, (b) => b.label, demande);
  if (parLibelle.ok) return parLibelle.item;
  const parTexte = designer(briques, (b) => b.content, demande);
  if (parTexte.ok) return parTexte.item;
  const candidats = parLibelle.candidats.length > 0 ? parLibelle.candidats : parTexte.candidats;
  throw err(
    ERR.MCP_DESIGNATION,
    candidats.length > 1
      ? `« ${demande} » désigne plusieurs ${role}s : ${candidats.slice(0, 6).map((b) => `« ${b.label} »`).join(", ")}.`
      : `${role} « ${demande} » introuvable dans la campagne. Possibles : ${briques.slice(0, 15).map((b) => `« ${b.label} »`).join(", ")}.`,
  );
}
