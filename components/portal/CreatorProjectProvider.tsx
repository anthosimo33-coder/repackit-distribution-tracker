"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useTranslations } from "next-intl";

/**
 * Multi-projets créateur — contexte du PROJET COURANT côté portail /app.
 *
 * Contrairement à l'admin (slug dans l'URL `/admin/[slug]`), le portail créateur
 * est plat (`/app`). Le projet courant est donc mémorisé côté client
 * (localStorage), validé contre la liste des projets du créateur
 * (api.creators.getMyCreatorProjects). Tout le portail lit `current.projectId`
 * et le passe aux creatorQuery/creatorMutation → isolation stricte par projet.
 *
 * Le rendu est GATÉ tant que la liste n'est pas chargée. À l'intérieur,
 * useCreatorProject() renvoie TOUJOURS un projet courant valide.
 */
export type CreatorProject = {
  projectId: Id<"projects">;
  slug: string;
  name: string;
  accentColor: string;
  logoUrl: string | null;
  payoutDay: number;
  creatorName: string | null;
  /** Devise de la PAIE créatrices (dollars pour Snytch). null → sans symbole. */
  payCurrency: string | null;
};

type CreatorProjectContextValue = {
  current: CreatorProject;
  projects: CreatorProject[];
  setProjectId: (id: Id<"projects">) => void;
};

/**
 * Exporté pour le mode admin « voir l'espace d'un créateur » (lecture seule) :
 * la route view-as fournit une valeur SYNTHÉTIQUE (projet unique fixe + nom du
 * créateur ciblé) à ce MÊME contexte, si bien que les écrans portail réutilisés
 * (useCreatorProject / useCreatorProjectId) fonctionnent sans modification. Le
 * portail créateur normal continue d'être alimenté par CreatorProjectProvider.
 */
export const CreatorProjectContext =
  createContext<CreatorProjectContextValue | null>(null);

const STORAGE_KEY = "creator-current-project";

export function CreatorProjectProvider({ children }: { children: ReactNode }) {
  const tns = useTranslations("portal.noSpace");
  const projects = useQuery(api.creators.getMyCreatorProjects, {});
  const [selectedId, setSelectedId] = useState<Id<"projects"> | null>(null);

  // Hydratation post-mount du dernier projet sélectionné (même pattern que
  // sidebar-collapsed : flicker bref accepté, évite un mismatch SSR).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setSelectedId(stored as Id<"projects">);
    } catch {
      // localStorage indispo → défaut (1er projet).
    }
  }, []);

  if (projects === undefined) {
    return <FullPageLoader />;
  }

  if (projects.length === 0) {
    // Un créateur a toujours ≥ 1 projet (le layout ne monte ce provider que pour
    // un rôle creator). Garde-fou défensif.
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center">
        <p className="max-w-sm text-sm text-slate-500">{tns("notLinked")}</p>
      </div>
    );
  }

  // Projet courant : le sélectionné s'il est encore valide, sinon le 1er.
  const current =
    projects.find((p) => p.projectId === selectedId) ?? projects[0];

  function setProjectId(id: Id<"projects">) {
    setSelectedId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // best-effort.
    }
  }

  return (
    <CreatorProjectContext.Provider
      value={{ current, projects, setProjectId }}
    >
      {children}
    </CreatorProjectContext.Provider>
  );
}

export function useCreatorProject(): CreatorProjectContextValue {
  const ctx = useContext(CreatorProjectContext);
  if (!ctx) {
    throw new Error(
      // i18n-exempt: erreur de PROGRAMMATION (garde de contexte React) — jamais lue par un utilisateur.
      "useCreatorProject must be used within CreatorProjectProvider",
    );
  }
  return ctx;
}

function FullPageLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2Icon className="size-6 animate-spin text-slate-400" />
    </div>
  );
}
