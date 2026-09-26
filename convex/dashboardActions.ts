/**
 * LES QUATRE CARTES D'ACTION du Dashboard (à valider, warmups en retard, warmups
 * à valider, dû) — le calcul que l'écran ET l'outil MCP `dashboard` font sur les
 * mêmes lectures. Module pur : les lectures restent celles de l'écran, chacune
 * derrière son bloc.
 *
 * Les prédicats sont ceux du digest quotidien (convex/opsDigest, jumeau de
 * lib/ops-digest verrouillé par test) : une carte et une notification ne peuvent
 * pas compter deux choses différentes sous le même nom.
 */

import { effectiveStatus } from "./compteStatut";
import { isWarmupLate } from "./opsDigest";
import { resolveCreatorKind } from "./roles";

export function dashboardActions<
  A extends { status: string; createdAt: number },
  C extends {
    creatorId?: string;
    status?: Parameters<typeof effectiveStatus>[0]["status"];
    actif?: boolean;
    warmupStartedAt?: number;
    warmupProtocol?: { dailyChecks?: string[] } | null;
    targetDays: number;
    warmupDone?: boolean;
  },
>(input: {
  assignments: readonly A[] | undefined;
  comptes: readonly C[] | undefined;
  creators: readonly { _id: string; kind?: string | null }[] | undefined;
  now: number;
}): { submitted: A[]; warmupLate: C[]; warmupReady: C[]; totalCreators: number } {
  // Carte 1 — vidéos en attente de revue, les plus anciennes d'abord.
  const submitted = (input.assignments ?? [])
    .filter((a) => a.status === "video_submitted")
    .sort((a, b) => a.createdAt - b.createdAt);

  // Carte 2 — comptes en warmup avec des jours manqués. Les comptes de CLIPPEUR
  // en sortent (pas de checks quotidiens — même correction que côté digest).
  const kindById = new Map((input.creators ?? []).map((c) => [c._id, c.kind]));
  const estCompteDeClippeur = (creatorId: string | undefined) =>
    creatorId !== undefined && resolveCreatorKind(kindById.get(creatorId)) === "clipper";
  const warmupLate = (input.comptes ?? []).filter((c) =>
    estCompteDeClippeur(c.creatorId)
      ? false
      : isWarmupLate(
          {
            effectiveStatus: effectiveStatus(c),
            warmupStartedAt: c.warmupStartedAt,
            dailyChecks: c.warmupProtocol?.dailyChecks ?? [],
            targetDays: c.targetDays,
          },
          input.now,
        ),
  );

  // Carte 2 bis — warmups TERMINÉS qui attendent une validation admin. Sous le
  // gate strict, ces comptes ne publient pas tant qu'ils ne sont pas repassés en
  // « actif ». `warmupDone` est SERVI par le serveur, jamais recalculé.
  const warmupReady = (input.comptes ?? []).filter(
    (c) => effectiveStatus(c) === "warmup" && c.warmupDone === true,
  );

  return {
    submitted,
    warmupLate,
    warmupReady,
    totalCreators: (input.creators ?? []).length,
  };
}
