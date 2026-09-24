/**
 * PROTOCOLE MCP (Model Context Protocol) — module PUR, sans import Convex, testé
 * par Vitest (lib/mcp-protocol.test.ts). convex/mcpHttp.ts ne fait que brancher
 * la requête HTTP réelle sur `handleMcpHttp`.
 *
 * Transport « Streamable HTTP » en mode SANS ÉTAT : chaque POST porte un message
 * JSON-RPC, la réponse revient en `application/json` dans le même échange. Pas de
 * flux SSE (GET → 405) ni de session (le serveur n'a rien à pousser de lui-même :
 * ses outils répondent, ils ne notifient pas). C'est une forme que la
 * spécification autorise explicitement, et la seule qu'une action HTTP Convex
 * sait servir sans connexion longue.
 *
 * Ce module ne connaît ni les clés ni les données : il reçoit un `McpServer` déjà
 * résolu pour la personne authentifiée.
 */

/** Versions du protocole comprises, la plus récente d'abord. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** Codes d'erreur JSON-RPC 2.0. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** Sous-ensemble de JSON Schema utilisé par nos outils — et le seul validé. */
export type ArgSchema =
  | { type: "string"; description: string; enum?: readonly string[] }
  | { type: "integer"; description: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description: string };

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ArgSchema>;
  required?: readonly string[];
  additionalProperties: false;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: ToolInputSchema;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface McpServer {
  info: { name: string; version: string };
  instructions?: string;
  tools: readonly McpTool[];
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

type JsonRpcId = string | number | null;
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Erreur « métier » d'un outil : son message est montré tel quel au modèle. */
export class ToolError extends Error {}

export function textResult(text: string, isError = false): ToolResult {
  return isError
    ? { content: [{ type: "text", text }], isError: true }
    : { content: [{ type: "text", text }] };
}

/**
 * Arguments conformes au schéma de l'outil ? Rend le PREMIER problème, lisible
 * par le modèle (qui peut alors corriger son appel), ou `null`.
 */
export function validateArgs(
  schema: ToolInputSchema,
  args: Record<string, unknown>,
): string | null {
  for (const cle of schema.required ?? []) {
    if (args[cle] === undefined || args[cle] === null) {
      return `Argument requis manquant : « ${cle} ».`;
    }
  }
  for (const [cle, valeur] of Object.entries(args)) {
    const def = schema.properties[cle];
    if (!def) {
      return `Argument inconnu : « ${cle} ». Arguments possibles : ${
        Object.keys(schema.properties).join(", ") || "aucun"
      }.`;
    }
    if (valeur === undefined || valeur === null) continue;
    if (def.type === "string") {
      if (typeof valeur !== "string") return `« ${cle} » doit être du texte.`;
      if (def.enum && !def.enum.includes(valeur)) {
        return `« ${cle} » doit valoir : ${def.enum.join(", ")}.`;
      }
    } else if (def.type === "integer") {
      if (typeof valeur !== "number" || !Number.isInteger(valeur)) {
        return `« ${cle} » doit être un nombre entier.`;
      }
      if (def.minimum !== undefined && valeur < def.minimum) {
        return `« ${cle} » doit être ≥ ${def.minimum}.`;
      }
      if (def.maximum !== undefined && valeur > def.maximum) {
        return `« ${cle} » doit être ≤ ${def.maximum}.`;
      }
    } else if (typeof valeur !== "boolean") {
      return `« ${cle} » doit valoir true ou false.`;
    }
  }
  return null;
}

function reponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function erreur(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

const estObjet = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Traite UN message JSON-RPC. `null` = rien à répondre : notification (pas
 * d'`id`) ou réponse du client à une requête du serveur (nous n'en faisons pas).
 */
async function traiterMessage(
  server: McpServer,
  msg: unknown,
): Promise<JsonRpcResponse | null> {
  if (!estObjet(msg) || msg.jsonrpc !== "2.0") {
    return erreur(null, RPC.INVALID_REQUEST, "Message JSON-RPC 2.0 attendu.");
  }
  const id =
    typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;
  if (typeof msg.method !== "string") {
    // Une RÉPONSE du client (result/error sans method) : rien à renvoyer.
    return msg.id !== undefined && ("result" in msg || "error" in msg)
      ? null
      : erreur(id, RPC.INVALID_REQUEST, "Champ « method » manquant.");
  }
  // Notification : aucun `id` → jamais de réponse (initialized, cancelled…).
  if (msg.id === undefined) return null;

  const params = estObjet(msg.params) ? msg.params : {};
  switch (msg.method) {
    case "initialize": {
      const demandee = params.protocolVersion;
      const version = PROTOCOL_VERSIONS.find((v) => v === demandee) ?? PROTOCOL_VERSIONS[0];
      return reponse(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: server.info,
        ...(server.instructions ? { instructions: server.instructions } : {}),
      });
    }
    case "ping":
      return reponse(id, {});
    case "tools/list":
      return reponse(id, {
        tools: server.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          // Lecture seule, et rien hors de l'app : Claude peut les appeler sans
          // craindre d'effet de bord.
          annotations: { readOnlyHint: true, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const nom = params.name;
      const outil = server.tools.find((t) => t.name === nom);
      if (typeof nom !== "string" || !outil) {
        return erreur(id, RPC.INVALID_PARAMS, `Outil inconnu : ${String(nom)}.`);
      }
      const args = estObjet(params.arguments) ? params.arguments : {};
      const invalide = validateArgs(outil.inputSchema, args);
      // Erreur d'OUTIL (résultat), pas de protocole : le modèle lit le message
      // et corrige son appel, au lieu de voir un échec technique.
      if (invalide) return reponse(id, textResult(invalide, true));
      try {
        return reponse(id, await server.callTool(outil.name, args));
      } catch (e) {
        // Un refus métier (droit, projet introuvable) se dit tel quel ; toute
        // autre erreur reste générique — pas de trace interne vers l'extérieur.
        const texte =
          e instanceof ToolError ? e.message : "Erreur interne de l'outil.";
        return reponse(id, textResult(texte, true));
      }
    }
    default:
      return erreur(id, RPC.METHOD_NOT_FOUND, `Méthode non prise en charge : ${msg.method}.`);
  }
}

/** Un message, ou un lot (tableau) — les versions antérieures du protocole en envoient. */
export async function handleMcpMessage(
  server: McpServer,
  body: unknown,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return erreur(null, RPC.INVALID_REQUEST, "Lot JSON-RPC vide.");
    }
    const reponses: JsonRpcResponse[] = [];
    for (const m of body) {
      const r = await traiterMessage(server, m);
      if (r) reponses.push(r);
    }
    return reponses.length > 0 ? reponses : null;
  }
  return traiterMessage(server, body);
}

/** Clé extraite d'un en-tête `Authorization: Bearer …`, ou `null`. */
export function bearerToken(header: string | null): string | null {
  const m = header?.match(/^\s*Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

export interface HttpReponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Tout l'échange HTTP, sans le réseau : méthode, authentification, corps. La
 * résolution de la clé est injectée (`resoudre`) — `null` = clé inconnue ou
 * révoquée.
 */
export async function handleMcpHttp(
  req: { method: string; authorization: string | null; body: string },
  resoudre: (token: string) => Promise<McpServer | null>,
): Promise<HttpReponse> {
  if (req.method !== "POST") {
    // Pas de flux serveur→client ni de session à fermer : seul POST existe.
    return {
      status: 405,
      headers: { Allow: "POST", ...JSON_HEADERS },
      body: JSON.stringify(erreur(null, RPC.INVALID_REQUEST, "Seul POST est accepté.")),
    };
  }
  const token = bearerToken(req.authorization);
  const server = token ? await resoudre(token) : null;
  if (!server) {
    return {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="jarvia"', ...JSON_HEADERS },
      body: JSON.stringify(
        erreur(
          null,
          RPC.INVALID_REQUEST,
          "Clé d'accès absente, inconnue ou révoquée. Crée-en une dans l'app : Connecter Claude.",
        ),
      ),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body);
  } catch {
    return {
      status: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify(erreur(null, RPC.PARSE_ERROR, "JSON invalide.")),
    };
  }
  const resultat = await handleMcpMessage(server, parsed);
  // Rien à répondre (notification) : 202, corps vide — exigé par le transport.
  if (resultat === null) return { status: 202, headers: {}, body: null };
  return { status: 200, headers: JSON_HEADERS, body: JSON.stringify(resultat) };
}
