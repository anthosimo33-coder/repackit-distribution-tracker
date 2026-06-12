import { httpRouter } from "convex/server";
import { auth } from "./auth";

/**
 * Routes HTTP requises par Convex Auth (vérification JWT, refresh de session).
 * Aucune autre route HTTP custom dans ce repo.
 */
const http = httpRouter();
auth.addHttpRoutes(http);
export default http;
