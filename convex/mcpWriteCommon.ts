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
import type { Id } from "./_generated/dataModel";
import type { McpWriteScope, ProjectMutationCtx } from "./functions";
import { ERR, err } from "./errorCodes";
import { designer } from "./mcpWriteArgs";
import { textResult, ToolError, type McpTool, type ToolResult } from "./mcpProtocol";

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
export type EcritureCtx = ProjectMutationCtx & { via: { kind: "token" | "oauth"; name: string } };

/** Ce qu'un outil d'écriture transmet à sa mutation gardée. */
export type CibleEcriture = {
  userId: Id<"users">;
  projectId: Id<"projects">;
  acces: { kind: "token" | "oauth"; id: string };
};

/** Un domaine d'écriture : son interrupteur, ses outils, leur exécution. */
export interface DomaineEcriture {
  scope: McpWriteScope;
  outils: readonly McpTool[];
  appeler(
    ctx: ActionCtx,
    name: string,
    args: Record<string, unknown>,
    cible: CibleEcriture,
    projet: string,
  ): Promise<ToolResult>;
}

/**
 * Note une écriture réussie au journal (« Connecter Claude › Modifications faites
 * par Claude »). `path` = l'écran où la défaire, sous `/admin/<projet>/`.
 */
export async function journaliser(
  ctx: EcritureCtx,
  e: { tool: string; summary: string; section: string; month?: string; path?: string },
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
