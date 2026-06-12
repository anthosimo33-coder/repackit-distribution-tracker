import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Remédiation sécurité — identité e2e partagée par toute la chaîne de test.
 *
 * UN SEUL secret à provisionner (E2E_SECRET) :
 *  - env var sur le deployment Convex de test → gate des e2eMutation
 *    (cleanup / seed, cf convex/functions.ts) ;
 *  - mot de passe du user e2e (E2E_PASSWORD = E2E_SECRET par défaut, donc
 *    ≥ 8 caractères requis — exigence du provider Password) ;
 *  - dispo côté Node via .env.local en local, secrets GitHub Actions en CI.
 *
 * Le user e2e est créé au premier run via la fenêtre bootstrap (table users
 * vide → superadmin), cf e2e/auth.setup.ts. ⚠️ Changer E2E_SECRET après coup
 * désynchronise le mot de passe du user existant — recréer le user (ou
 * `convex run maintenance:wipeAuthTables` puis re-bootstrap).
 */
export const E2E_SECRET = process.env.E2E_SECRET ?? "";
export const E2E_EMAIL = process.env.E2E_EMAIL ?? "e2e@repackit.test";
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? E2E_SECRET;

/**
 * Drop-in du `new ConvexHttpClient(url)` historique des specs : même type,
 * mêmes appels, mais s'authentifie (lazy, au premier appel) en tant que user
 * e2e via l'action api.auth.signIn — les fonctions authed* exigent désormais
 * une identité. Le sign-in est fait sur le client cible directement (pas via
 * le Proxy) pour éviter toute récursion.
 */
export function createE2eClient(
  url: string,
  // Override pour les scripts visant un autre deployment que celui de test
  // (ex: scripts/smoke-prod-presets.ts avec un compte prod réel).
  credentials?: { email: string; password: string },
): ConvexHttpClient {
  const client = new ConvexHttpClient(url);
  let ready: Promise<void> | null = null;

  const ensureAuthed = () => {
    ready ??= (async () => {
      const email = credentials?.email ?? E2E_EMAIL;
      const password = credentials?.password ?? E2E_PASSWORD;
      if (password.length === 0) {
        throw new Error(
          "E2E_SECRET (ou E2E_PASSWORD) manquant — requis pour authentifier le client Convex des specs. Local : .env.local ; CI : secrets GitHub.",
        );
      }
      const result = await client.action(api.auth.signIn, {
        provider: "password",
        params: { email, password, flow: "signIn" },
      });
      const token = result.tokens?.token;
      if (!token) {
        throw new Error(
          `signIn e2e sans token pour ${email} — le user existe-t-il ? (créé par e2e/auth.setup.ts via la fenêtre bootstrap)`,
        );
      }
      client.setAuth(token);
    })();
    return ready;
  };

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "query" || prop === "mutation" || prop === "action") {
        const method = Reflect.get(target, prop, receiver) as (
          ...a: unknown[]
        ) => Promise<unknown>;
        return async (...args: unknown[]) => {
          await ensureAuthed();
          return method.apply(target, args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
