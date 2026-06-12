import { ConvexHttpClient } from "convex/browser";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Identité e2e partagée par toute la chaîne de test.
 *
 * UN SEUL secret à provisionner (E2E_SECRET) : gate des e2eMutation côté
 * deployment de test + mot de passe du user e2e (≥ 8 car.). Dispo via
 * .env.local (local) / secrets GitHub (CI). Le user e2e est créé via la
 * fenêtre bootstrap (e2e/auth.setup.ts).
 */
export const E2E_SECRET = process.env.E2E_SECRET ?? "";
export const E2E_EMAIL = process.env.E2E_EMAIL ?? "e2e@repackit.test";
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? E2E_SECRET;
// Slug du projet e2e dédié (créé par e2e/global-setup via projects:
// e2eEnsureProjectForEmail). getCurrentProject renverra ce projet pour le user
// e2e (membership le plus récent), cf convex/projects.ts.
export const E2E_PROJECT_SLUG = "e2e-test";

/**
 * P3 — l'app interne vit sous `/admin/[projectSlug]/…`. Les specs naviguent
 * dans le projet e2e dédié : `adminPath("/comptes")` → `/admin/e2e-test/comptes`.
 * Centralise le préfixe pour que les specs n'aient pas à coder le slug en dur.
 */
export function adminPath(path = ""): string {
  return `/admin/${E2E_PROJECT_SLUG}${path}`;
}

/**
 * P2 — rend projectId OPTIONNEL au niveau type : les specs appellent les
 * fonctions scopées projet sans projectId, il est injecté au runtime (projet
 * e2e courant). Les fonctions e2e-gated (secret) ou auth (provider) ne le
 * reçoivent pas (cf injectProject). Passer projectId explicitement l'emporte
 * (test d'isolation / 2e projet).
 */
type ProjectOptionalArgs<Ref extends FunctionReference<"query" | "mutation">> =
  FunctionArgs<Ref> extends { projectId: Id<"projects"> }
    ? Omit<FunctionArgs<Ref>, "projectId"> & { projectId?: Id<"projects"> }
    : FunctionArgs<Ref>;

export type E2eClient = {
  query<Ref extends FunctionReference<"query">>(
    ref: Ref,
    args: ProjectOptionalArgs<Ref>,
  ): Promise<FunctionReturnType<Ref>>;
  mutation<Ref extends FunctionReference<"mutation">>(
    ref: Ref,
    args: ProjectOptionalArgs<Ref>,
  ): Promise<FunctionReturnType<Ref>>;
  action<Ref extends FunctionReference<"action">>(
    ref: Ref,
    args: FunctionArgs<Ref>,
  ): Promise<FunctionReturnType<Ref>>;
  /** Id du projet e2e courant (résolu via getCurrentProject). */
  getProjectId(): Promise<Id<"projects">>;
};

/**
 * Crée (idempotent) le projet e2e dédié et y rattache le user e2e. À appeler
 * APRÈS que le user existe (bootstrap). e2e-gated (secret), pas d'auth requise.
 * getCurrentProject renverra ensuite ce projet pour le user e2e (membership le
 * plus récent).
 */
export async function ensureE2eProject(url: string): Promise<void> {
  const client = new ConvexHttpClient(url);
  const { projectId } = await client.mutation(
    api.projects.e2eEnsureProjectForEmail,
    {
      secret: E2E_SECRET,
      slug: E2E_PROJECT_SLUG,
      name: "E2E Test",
      email: E2E_EMAIL,
      role: "admin",
    },
  );
  // Élague les memberships parasites (projets d'isolation créés par
  // multi-tenant.spec) pour que getCurrentProject renvoie DÉTERMINISTEment le
  // projet e2e-test pour le user e2e.
  await client.mutation(api.projects.e2ePruneMemberships, {
    secret: E2E_SECRET,
    email: E2E_EMAIL,
    keepSlug: E2E_PROJECT_SLUG,
  });
  // La biblio hooks est scopée projet → seed les hooks dans le projet e2e
  // (idempotent : seedHooks skip si déjà présents). Requis par les specs qui
  // exercent le flow biblio (carrousel-biblio, slide1-prefill, hook-variants).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("fs") as typeof import("fs");
  const hooks = JSON.parse(
    readFileSync("./scripts/hooks-seed.json", "utf-8"),
  );
  await client.mutation(api.hooks.seedHooks, {
    secret: E2E_SECRET,
    projectId,
    hooks,
  });
}

function injectProject(
  args: unknown,
  projectId: Id<"projects">,
): Record<string, unknown> | unknown {
  if (
    args &&
    typeof args === "object" &&
    !("projectId" in args) &&
    !("secret" in args) &&
    !("provider" in args)
  ) {
    return { ...(args as Record<string, unknown>), projectId };
  }
  return args;
}

export function createE2eClient(
  url: string,
  // Override pour viser un autre deployment (ex: smoke prod avec compte réel).
  credentials?: { email: string; password: string },
): E2eClient {
  const client = new ConvexHttpClient(url);
  let authP: Promise<void> | null = null;
  let projectP: Promise<Id<"projects">> | null = null;

  const ensureAuthed = () => {
    authP ??= (async () => {
      const email = credentials?.email ?? E2E_EMAIL;
      const password = credentials?.password ?? E2E_PASSWORD;
      if (password.length === 0) {
        throw new Error(
          "E2E_SECRET (ou E2E_PASSWORD) manquant — requis pour authentifier le client Convex des specs.",
        );
      }
      const result = await client.action(api.auth.signIn, {
        provider: "password",
        params: { email, password, flow: "signIn" },
      });
      const token = result.tokens?.token;
      if (!token) {
        throw new Error(
          `signIn e2e sans token pour ${email} — le user existe-t-il ? (e2e/auth.setup.ts)`,
        );
      }
      client.setAuth(token);
    })();
    return authP;
  };

  const ensureProjectId = () => {
    projectP ??= (async () => {
      await ensureAuthed();
      // Appel RAW (pas d'injection) : getCurrentProject n'accepte pas projectId.
      const project = await client.query(api.projects.getCurrentProject, {});
      if (!project) {
        throw new Error(
          "getCurrentProject e2e a renvoyé null — projet e2e non créé ? (global-setup)",
        );
      }
      return project._id;
    })();
    return projectP;
  };

  return {
    async query(ref, args) {
      await ensureAuthed();
      const projectId = await ensureProjectId();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return client.query(ref, injectProject(args, projectId) as any);
    },
    async mutation(ref, args) {
      await ensureAuthed();
      const projectId = await ensureProjectId();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return client.mutation(ref, injectProject(args, projectId) as any);
    },
    async action(ref, args) {
      await ensureAuthed();
      return client.action(ref, args);
    },
    getProjectId: ensureProjectId,
  };
}
