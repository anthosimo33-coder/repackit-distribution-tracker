"use client";

import {
  useAction,
  useMutation,
  useQuery,
  useQuery_experimental,
} from "convex/react";
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
// i18n-exempt: faux positif du détecteur : générique TypeScript, pas du texte
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

/**
 * Résultat d'une query qui a le DROIT d'échouer sans emporter la page.
 *
 * `loading` : pas encore de réponse. `ok` : la donnée. `error` : la query a
 * levé — le message est celui du serveur, pas un texte inventé.
 */
export type SafeQueryResult<T> =
  | { status: "loading"; data: undefined; error: null }
  | { status: "ok"; data: T; error: null }
  | { status: "error"; data: undefined; error: string };

/**
 * `useProjectQuery`, mais l'échec est une VALEUR au lieu d'une exception.
 *
 * POURQUOI. `useQuery` de convex/react LANCE pendant le rendu quand la query
 * échoue : c'est voulu (les frontières d'erreur React sont faites pour ça), mais
 * un écran qui tire neuf agrégats — le hub Analytics — meurt alors ENTIER parce
 * qu'un seul a expiré. Constaté en production le 2026-09-08 : `getReliability`
 * a échoué cinq fois d'affilée, et les six onglets disparaissaient avec.
 *
 * ⚠️ NE PAS RÉÉCRIRE CE HOOK SUR `useQueries`. C'est la première version, et
 * elle bouclait à l'infini (« Too many re-renders ») : `useQueries` se
 * ré-abonne dès que l'objet de requête change d'IDENTITÉ, et une
 * `FunctionReference` lue sur le proxy `api` est neuve à chaque rendu. C'est
 * exactement pour ça que `useQuery` mémoïse sur `getFunctionName(query)` et pas
 * sur la référence. `useQuery_experimental` est la porte prévue par la
 * bibliothèque pour ne pas lever — on l'emprunte plutôt que de refaire sa
 * mémoïsation à côté.
 *
 * À RÉSERVER aux écrans qui composent PLUSIEURS agrégats indépendants. Pour une
 * page dont la query est LA raison d'être, `useProjectQuery` et la frontière
 * d'erreur du segment restent le bon choix : mieux vaut une page d'erreur
 * franche qu'un écran à moitié vide dont on ne sait pas ce qu'il tait.
 */
/**
 * Le message d'une erreur Convex, débarrassé de son emballage.
 *
 * Brut, il arrive ainsi : « [CONVEX Q(analyticsHub:getReliability)] [Request ID:
 * …] Server Error Uncaught Error: <la phrase utile> at handler (../convex/…) at
 * … ». Affiché tel quel dans un bandeau, la phrase utile se noie dans une pile
 * d'appels que personne ne lira. On garde la phrase, on jette l'emballage — la
 * pile complète reste dans la console et dans les journaux Convex, où elle sert.
 */
function messageCourt(e: Error): string {
  const brut = e.message;
  // i18n-exempt: marqueur TECHNIQUE émis par le runtime Convex, pas de l'interface — le traduire ne matcherait plus rien.
  const MARQUEUR = "Uncaught Error: ";
  const apresPrefixe = brut.includes(MARQUEUR)
    ? brut.slice(brut.lastIndexOf(MARQUEUR) + MARQUEUR.length)
    : brut;
  // Coupe à la PREMIÈRE trame de pile — sa forme est « at <nom> ( » (« at
  // handler (../convex/… », « at Object.foo (… »). Exiger la parenthèse évite
  // de trancher une phrase qui contiendrait « at » par hasard.
  const sansPile = apresPrefixe.split(/\s+at\s+[\w.$<>[\]]+\s*\(/)[0];
  return sansPile.trim().slice(0, 300);
}

export function useProjectQuerySafe<Query extends FunctionReference<"query">>(
  query: Query,
  args: WithoutProject<FunctionArgs<Query>> | "skip",
): SafeQueryResult<FunctionReturnType<Query>> {
  const projectId = useProjectId();
  const state = useQuery_experimental({
    query,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: (args === "skip" ? "skip" : { ...args, projectId }) as any,
  });
  if (state.status === "error") {
    return { status: "error", data: undefined, error: messageCourt(state.error) };
  }
  if (state.status === "pending") {
    return { status: "loading", data: undefined, error: null };
  }
  return {
    status: "ok",
    data: state.data as FunctionReturnType<Query>,
    error: null,
  };
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
