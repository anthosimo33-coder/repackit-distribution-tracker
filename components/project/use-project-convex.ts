"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { useProjectId } from "./ProjectProvider";

/**
 * P2 — wrappers front qui injectent automatiquement `projectId` (du projet
 * courant) dans les appels aux fonctions Convex scopées projet
 * (projectQuery / projectMutation). Évite de threader projectId à la main sur
 * ~79 call sites.
 *
 * NE PAS utiliser pour les fonctions non scopées (api.projects.getCurrentProject,
 * api.storage.*) : garder useQuery/useMutation bruts pour celles-là.
 */
type WithoutProject<T> = Omit<T, "projectId">;

export function useProjectQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: WithoutProject<FunctionArgs<Query>> | "skip",
): FunctionReturnType<Query> | undefined {
  const projectId = useProjectId();
  return useQuery(
    query,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args === "skip" ? "skip" : { ...args, projectId }) as any,
  );
}

export function useProjectMutation<
  Mutation extends FunctionReference<"mutation">,
>(
  mutation: Mutation,
): (
  args: WithoutProject<FunctionArgs<Mutation>>,
) => Promise<FunctionReturnType<Mutation>> {
  const projectId = useProjectId();
  const fn = useMutation(mutation);
  return (args) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn({ ...args, projectId } as any);
}

/** Idem useProjectMutation pour les ACTIONS scopées projet (ex. Radar tendances). */
export function useProjectAction<Action extends FunctionReference<"action">>(
  action: Action,
): (
  args: WithoutProject<FunctionArgs<Action>>,
) => Promise<FunctionReturnType<Action>> {
  const projectId = useProjectId();
  const fn = useAction(action);
  return (args) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fn({ ...args, projectId } as any);
}
