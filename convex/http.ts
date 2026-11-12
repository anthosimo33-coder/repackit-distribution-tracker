import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { mcpEndpoint } from "./mcpHttp";
import { exportHandler } from "./swarmExport";
import {
  enregistrement,
  jeton,
  preflight,
  ressourceProtegee,
  revocation,
  serveurAutorisation,
} from "./mcpOAuthHttp";

/**
 * Routes HTTP : celles de Convex Auth (vérification JWT, refresh de session), le
 * serveur MCP (convex/mcpHttp.ts) et son connecteur OAuth (convex/mcpOAuthHttp.ts).
 * Sur /mcp, GET et DELETE répondent 405 — le transport est sans état, seul POST
 * porte des messages ; les déclarer évite un 404 muet à un client qui les tente.
 * /swarm/export : l'export du Radar lu chaque jour par Swarm (convex/swarmExport.ts).
 */
const http = httpRouter();
auth.addHttpRoutes(http);
for (const method of ["POST", "GET", "DELETE"] as const) {
  http.route({ path: "/mcp", method, handler: mcpEndpoint });
}

// Découverte : la forme à suffixe (RFC 9728 §3.1, RFC 8414 §3) est celle que
// Claude essaie d'abord ; la forme nue sert les clients qui s'arrêtent à l'origine.
for (const path of [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]) {
  http.route({ path, method: "GET", handler: ressourceProtegee });
  http.route({ path, method: "OPTIONS", handler: preflight });
}
for (const path of [
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/oauth",
]) {
  http.route({ path, method: "GET", handler: serveurAutorisation });
  http.route({ path, method: "OPTIONS", handler: preflight });
}
for (const [path, handler] of [
  ["/oauth/register", enregistrement],
  ["/oauth/token", jeton],
  ["/oauth/revoke", revocation],
] as const) {
  http.route({ path, method: "POST", handler });
  http.route({ path, method: "OPTIONS", handler: preflight });
}
http.route({ path: "/swarm/export", method: "GET", handler: exportHandler });
export default http;
