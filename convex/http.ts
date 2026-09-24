import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { mcpEndpoint } from "./mcpHttp";

/**
 * Routes HTTP : celles de Convex Auth (vérification JWT, refresh de session), et
 * le serveur MCP (convex/mcpHttp.ts). GET et DELETE y répondent 405 — le
 * transport est sans état, seul POST porte des messages ; les déclarer évite un
 * 404 muet à un client qui les tente.
 */
const http = httpRouter();
auth.addHttpRoutes(http);
for (const method of ["POST", "GET", "DELETE"] as const) {
  http.route({ path: "/mcp", method, handler: mcpEndpoint });
}
export default http;
