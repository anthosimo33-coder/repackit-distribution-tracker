import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { createE2eClient } from "./authed-client";

export interface CreatorSession {
  /** Client Convex authentifié EN TANT QUE le créateur. */
  client: ConvexHttpClient;
  projectId: Id<"projects">;
  creatorId: Id<"creators">;
  email: string;
}

/**
 * P5 — invite (via l'admin e2e) puis onboarde un créateur RÉEL (signUp par
 * token) et retourne un client Convex authentifié en tant que ce créateur +
 * son projectId/creatorId. Email/nom marqués pour le cleanup (e2e-creator…).
 */
export async function createCreatorSession(
  url: string,
  opts: { name: string; email: string; password: string },
): Promise<CreatorSession> {
  const admin = createE2eClient(url);
  const projectId = await admin.getProjectId();
  const { creatorId, token } = await admin.mutation(
    api.creators.inviteCreator,
    { name: opts.name, email: opts.email },
  );
  const client = new ConvexHttpClient(url);
  const res = await client.action(api.auth.signIn, {
    provider: "password",
    params: {
      email: opts.email,
      password: opts.password,
      flow: "signUp",
      inviteToken: token,
    },
  });
  const sessionToken = res.tokens?.token;
  if (!sessionToken) {
    throw new Error(`signUp créateur sans token pour ${opts.email}`);
  }
  client.setAuth(sessionToken);
  return { client, projectId, creatorId, email: opts.email };
}
