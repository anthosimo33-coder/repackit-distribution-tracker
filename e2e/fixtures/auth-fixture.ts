import { test as base, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { E2E_EMAIL, E2E_PASSWORD } from "../helpers/authed-client";
import { config } from "dotenv";

config({ path: ".env.local" });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

// Namespace des clés localStorage du client Convex Auth = NEXT_PUBLIC_CONVEX_URL
// dépouillée de tout caractère non alphanumérique (cf ConvexAuthNextjsClient-
// Provider). Vérifié contre un storageState réel.
const NS = CONVEX_URL.replace(/[^a-zA-Z0-9]/g, "");
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

/**
 * Remédiation sécurité — fixture d'authentification PAR TEST.
 *
 * Pourquoi pas un storageState global partagé : le client Convex Auth (variante
 * Next) force un refresh du token au montage de chaque page — le serveur ne lui
 * transmet qu'un refreshToken « dummy », le vrai vient du localStorage. Or les
 * refresh tokens sont SINGLE-USE (fenêtre de réutilisation de 10 s côté Convex
 * Auth). Un storageState figé partagé entre des dizaines de contextes Playwright
 * voit donc son refresh token consommé par le 1er test, puis tous les suivants
 * échouent (cookies effacés → app bloquée sur le loader). C'est exactement le
 * mode de panne observé (45/57 specs rouges).
 *
 * Solution : chaque test obtient sa PROPRE session fraîche (signIn via l'action
 * Convex), injectée comme storageState du contexte. Le refresh token n'est
 * partagé par aucun autre test ; les navigations internes au test réutilisent
 * la rotation locale du contexte. Coût : ~1 signIn (~300 ms) par test.
 *
 * Prérequis : le user e2e doit exister (créé une fois par e2e/auth.setup.ts via
 * la fenêtre bootstrap). Specs : importer { test, expect } DE CE FICHIER au lieu
 * de "@playwright/test".
 */
export const test = base.extend({
  // 2e param Playwright (la fonction « use ») renommé `provide` : éviter le
  // faux positif react-hooks/rules-of-hooks (qui croit voir le hook React `use`).
  storageState: async ({}, provide) => {
    const client = new ConvexHttpClient(CONVEX_URL);
    const result = await client.action(api.auth.signIn, {
      provider: "password",
      params: { email: E2E_EMAIL, password: E2E_PASSWORD, flow: "signIn" },
    });
    const tokens = result.tokens;
    if (!tokens?.token || !tokens.refreshToken) {
      throw new Error(
        `signIn e2e sans tokens pour ${E2E_EMAIL} — le user existe-t-il ? (bootstrap via e2e/auth.setup.ts)`,
      );
    }
    // Date.now() en helper top-level (interdit en workflow, OK ici).
    const fetchTime = String(Date.now());
    const origin = new URL(BASE_URL).origin;

    await provide({
      cookies: [
        cookie("__convexAuthJWT", tokens.token, origin),
        cookie("__convexAuthRefreshToken", tokens.refreshToken, origin),
      ],
      origins: [
        {
          origin,
          localStorage: [
            { name: `__convexAuthJWT_${NS}`, value: tokens.token },
            {
              name: `__convexAuthRefreshToken_${NS}`,
              value: tokens.refreshToken,
            },
            {
              name: `__convexAuthServerStateFetchTime_${NS}`,
              value: fetchTime,
            },
          ],
        },
      ],
    });
  },
});

function cookie(name: string, value: string, origin: string) {
  const url = new URL(origin);
  return {
    name,
    value,
    domain: url.hostname,
    path: "/",
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "Lax" as const,
    expires: -1,
  };
}

export { expect };
// P3 — réexporté pour que les specs naviguent dans /admin/e2e-test/… sans
// importer un second helper (elles importent déjà { test, expect } d'ici).
export { adminPath, E2E_PROJECT_SLUG } from "../helpers/authed-client";
