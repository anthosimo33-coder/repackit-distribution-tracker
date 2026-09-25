"use client";

import { use } from "react";
import { OAuthConsent, type ParametresAutorisation } from "@/components/mcp/OAuthConsent";

/**
 * `authorization_endpoint` du connecteur OAuth (convex/mcpOAuth.ts) : Claude
 * y envoie la personne. Page protégée par le proxy — sans session, détour par
 * `/login?suite=…` puis retour ici (lib/login-suite.ts).
 */
const CLES = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const satisfies readonly (keyof ParametresAutorisation)[];

export default function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const brut = use(searchParams);
  const params: ParametresAutorisation = {};
  for (const cle of CLES) {
    const val = brut[cle];
    // Un paramètre répété est ambigu : RFC 6749 §3.1 le refuse, on l'ignore.
    if (typeof val === "string") params[cle] = val;
  }
  return <OAuthConsent params={params} />;
}
