"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { Loader2Icon } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { projectPath } from "@/lib/project-path";
import { portalPathForRole } from "@/lib/portal-path";
import { useTranslations } from "next-intl";

/**
 * P3 Multi-tenant — contexte du projet courant, DÉRIVÉ DU SEGMENT D'URL
 * `[projectSlug]`. L'URL est la source de vérité : plus aucun projet implicite
 * ni stocké en localStorage (l'ancien provider basé sur getCurrentProject est
 * remplacé). Le slug est résolu via api.projects.getProjectForCurrentUser, qui
 * vérifie l'accès (superadmin ou membership) côté serveur.
 *
 * Le rendu des enfants est GATÉ tant que le projet n'est pas résolu : à
 * l'intérieur de l'arbre, useProjectId()/useProject() renvoient TOUJOURS un
 * projet valide, et les call sites passent projectId sans logique de skip.
 *
 * États non-ok rendus proprement :
 *   - not_found : slug inexistant → 404 applicatif.
 *   - forbidden : slug existant mais l'utilisateur n'a pas de membership
 *     (et n'est pas superadmin) → accès refusé.
 *
 * Rôles de PORTAIL — un créateur partenaire, un talent ou un clippeur a un
 * membership sur le projet (status "ok") mais AUCUN accès à l'app interne : il est
 * redirigé vers SON portail (table unique lib/portal-path). La vraie barrière est
 * serveur (adminQuery/adminMutation) ; ce redirect n'est que du confort UX.
 *
 * `project` n'est PAS le document complet : la query en renvoie une PROJECTION
 * whitelistée (convex/projects.projectForClient) — la configuration interne du
 * projet (Whop, PostHog, canal de notification, taux de change) n'a rien à faire
 * dans un bundle client. Le type est dérivé du retour de la query, donc tsc casse
 * si un écran lit un champ non projeté.
 */
type ProjectForClient = Extract<
  FunctionReturnType<typeof api.projects.getProjectForCurrentUser>,
  { status: "ok" }
>["project"];

type ProjectContextValue = {
  projectId: Id<"projects">;
  project: ProjectForClient;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  const tp = useTranslations("project");
  const result = useQuery(api.projects.getProjectForCurrentUser, { slug });

  if (result === undefined) {
    return <FullPageLoader />;
  }

  if (result.status === "not_found") {
    return (
      <ProjectGateMessage
        title={tp("notFound")}
        body={tp("noneNamed", { slug })}
      />
    );
  }

  if (result.status === "forbidden") {
    return (
      <ProjectGateMessage
        title={tp("denied")}
        body={tp("deniedBody")}
      />
    );
  }

  // Rôle de portail (partenaire / talent / clippeur) → l'app interne ne le
  // concerne pas : on le renvoie vers SON portail.
  const portalPath = portalPathForRole(result.portalRole);
  if (portalPath) {
    return <RedirectTo href={portalPath} />;
  }

  return (
    <ProjectContext.Provider
      value={{ projectId: result.project._id, project: result.project }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    // i18n-exempt: erreur de DÉVELOPPEMENT (contrat de montage React), jamais rendue à un utilisateur
    throw new Error("useProject must be used within ProjectProvider");
  }
  return ctx;
}

/** Raccourci : l'Id du projet courant (toujours défini sous ProjectProvider). */
export function useProjectId(): Id<"projects"> {
  return useProject().projectId;
}

/** Le slug du projet courant (segment d'URL). */
export function useProjectSlug(): string {
  return useProject().project.slug;
}

/**
 * Constructeur de href scopé projet : `useProjectPath()("/carrousels")` →
 * `/admin/<slug>/carrousels`. Stable entre rendus pour un slug donné.
 */
export function useProjectPath(): (path?: string) => string {
  const slug = useProject().project.slug;
  return useMemo(() => (path = "") => projectPath(slug, path), [slug]);
}

function RedirectTo({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [router, href]);
  return <FullPageLoader />;
}

function FullPageLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-slate-400" />
    </div>
  );
}

function ProjectGateMessage({ title, body }: { title: string; body: string }) {
  const tp = useTranslations("project");
  return (
    <div className="flex h-screen items-center justify-center px-6 text-center">
      <div className="max-w-sm space-y-3">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="text-sm text-slate-500">{body}</p>
        <Link
          href="/"
          className="inline-block text-sm font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700"
        >{tp("backHome")}</Link>
      </div>
    </div>
  );
}
