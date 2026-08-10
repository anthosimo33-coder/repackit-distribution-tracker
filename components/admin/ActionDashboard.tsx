"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BellIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  FlameIcon,
  Loader2Icon,
  MessageSquareWarningIcon,
  UploadCloudIcon,
  UserPlusIcon,
  WalletIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  useProjectQuery,
  useProjectMutation,
} from "@/components/project/use-project-convex";
import { useProject, useProjectPath } from "@/components/project/ProjectProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { formatMoney } from "@/lib/format-rate";
import {
  isCycleUnpaid,
  isOverdueMission,
  isWarmupLate,
} from "@/lib/ops-digest";
import {
  getEffectiveStatus,
  getEffectiveWarmupDuration,
} from "@/lib/compte-status";
import { creatorStatusBadge } from "@/lib/creator-status";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

const DAY_MS = 86_400_000;
const WORKLIST_LIMIT = 6;
const ACTIVITY_LIMIT = 8;
/** Un refus est « stagnant » si le créateur n'a pas re-soumis depuis N jours. */
const STAGNANT_REJECTION_DAYS = 3;

/**
 * Dashboard d'accueil orienté ACTION — agrège des queries DÉJÀ existantes
 * (listAssignments, listComptes, listPayments, listCreators) côté client. Aucune
 * nouvelle logique métier ni fonction Convex : chaque carte/section ne fait que
 * filtrer/compter l'existant (cf lib/warmup, lib/compte-status). Toutes les
 * cartes sont cliquables et mènent à la page concernée.
 */

function relativeAge(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < 60_000) return "à l'instant";
  const days = Math.floor(diff / DAY_MS);
  if (days >= 1) return `il y a ${days} j`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `il y a ${hours} h`;
  return `il y a ${Math.floor(diff / 60_000)} min`;
}

export function ActionDashboard() {
  const projectPath = useProjectPath();
  // Paie créatrices → devise du projet ($). Absente → montant sans symbole.
  const payCurrency = useProject().project.payCurrency;
  // « Maintenant » figé au mount (lazy init pur — cf react-hooks/purity, même
  // pattern que MetricChart). Suffisant pour un instantané de dashboard.
  const [now] = useState(() => Date.now());
  const assignments = useProjectQuery(api.assignments.listAssignments, {});
  const comptes = useProjectQuery(api.comptes.listComptes, {});
  const payments = useProjectQuery(api.payments.listPayments, {});
  const creators = useProjectQuery(api.creators.listCreators, {});

  // Actions INLINE de la file : relancer un créateur (email du chantier B) et
  // marquer un cycle payé (MÊME mutation unitaire que /paiements et que le
  // marquage en masse du chantier A — aucune logique de paie dupliquée ici).
  const nudge = useProjectMutation(api.assignments.nudgeAssignment);
  const markCyclePaid = useProjectMutation(api.payments.markCyclePaid);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function handleNudge(id: Id<"assignments">, creatorName: string) {
    setBusyKey(id);
    try {
      const res = await nudge({ assignmentId: id });
      if (res.sent) toast.success(`${creatorName} relancé par email.`);
      else toast.info(`${creatorName} a déjà été relancé il y a moins de 24 h.`);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Relance impossible"));
    } finally {
      setBusyKey(null);
    }
  }

  async function handlePayCycle(
    key: string,
    creatorId: Id<"creators">,
    cycleIndex: number,
    creatorName: string,
  ) {
    setBusyKey(key);
    try {
      await markCyclePaid({ creatorId, cycleIndex });
      toast.success(`${creatorName} — cycle marqué payé.`);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Paiement impossible"));
    } finally {
      setBusyKey(null);
    }
  }

  const loading =
    assignments === undefined ||
    comptes === undefined ||
    payments === undefined ||
    creators === undefined;

  const data = useMemo(() => {
    if (
      assignments === undefined ||
      comptes === undefined ||
      payments === undefined ||
      creators === undefined
    ) {
      return null;
    }
    // Carte 1 + worklist — vidéos en attente de revue (plus anciennes en tête).
    const submitted = assignments
      .filter((a) => a.status === "video_submitted")
      .sort((a, b) => a.createdAt - b.createdAt);

    // Carte 2 — comptes en warmup avec des jours manqués. Le prédicat est
    // PARTAGÉ avec le digest quotidien (lib/ops-digest, jumeau serveur
    // convex/opsDigest apparié par test) : le message du matin et cet écran
    // doivent compter la même chose.
    const warmupLate = comptes.filter((c) =>
      isWarmupLate(
        {
          effectiveStatus: getEffectiveStatus(c),
          warmupStartedAt: c.warmupStartedAt,
          dailyChecks: c.warmupProtocol?.dailyChecks ?? [],
          targetDays: getEffectiveWarmupDuration(c),
        },
        now,
      ),
    );

    // Carte 3 — total DÛ = tous les cycles non payés, exactement le même
    // ensemble que le total de /paiements (les deux lisent listPayments).
    //
    // L'ancien calcul filtrait `p.period === currentPeriod(now)`, soit une clé
    // MENSUELLE "YYYY-MM" héritée de payments.periodOf. Depuis les cycles J+30,
    // une ligne de cycle porte `cyclePeriodKey(cycleStart)` = "YYYY-MM-DD" : la
    // comparaison ne matchait JAMAIS et la carte affichait 0 en permanence. Il
    // n'existe plus de « mois » en paie (chaque créateur est ancré sur son
    // firstPostAt) — d'où le libellé « Dû » et non « Dû ce mois ».
    const dueTotal = payments
      .filter((p) => p.status !== "paid")
      .reduce((s, p) => s + p.totalDue, 0);

    // Carte 4 — assignments actionnables dont la deadline tombe sous 7 j.
    const deadlines7 = assignments.filter((a) => {
      if (a.status !== "todo" && a.status !== "in_progress") return false;
      const d = a.dueDate - now;
      return d >= 0 && d <= 7 * DAY_MS;
    });

    // Activité créateurs — join créateurs × comptes (par creatorId), agrégats
    // perf déjà calculés par listComptes (perf.vuesCumulees / perf.nbPublies).
    const comptesByCreator = new Map<string, typeof comptes>();
    for (const c of comptes) {
      if (!c.creatorId) continue;
      const arr = comptesByCreator.get(c.creatorId) ?? [];
      arr.push(c);
      comptesByCreator.set(c.creatorId, arr);
    }
    const creatorActivity = creators
      .filter((cr) => cr.status !== "churned")
      .map((cr) => {
        const accts = comptesByCreator.get(cr._id) ?? [];
        return {
          creator: cr,
          vues: accts.reduce((s, a) => s + a.perf.vuesCumulees, 0),
          posts: accts.reduce((s, a) => s + a.perf.nbPublies, 0),
          warmupCount: accts.filter((a) => getEffectiveStatus(a) === "warmup")
            .length,
          nbComptes: accts.length,
        };
      })
      .sort((a, b) => b.vues - a.vues);

    // ── File « à traiter » étendue (chantier D) ─────────────────────────────
    // Tout est dérivé des MÊMES queries déjà chargées : aucune query en plus.

    // Comptes GÉRÉS par l'équipe : vidéo validée, en attente de publication.
    // La vidéo existe et ne rapporte rien tant qu'elle n'est pas en ligne.
    const toPublish = assignments
      .filter((a) => a.status === "to_publish" && a.managedByAdmin === true)
      .sort((a, b) => a.dueDate - b.dueDate);

    // Cycles dus non payés (argent dû aux créateurs). Notion « non payé », qui
    // inclut le cycle EN COURS — le digest quotidien emploie la notion plus
    // étroite `isCycleDue` (cycle refermé), cf lib/ops-digest.
    const unpaidCycles = payments
      .filter(isCycleUnpaid)
      .sort((a, b) => b.totalDue - a.totalDue);

    // Missions en retard : échéance dépassée, balle au créateur. Prédicat
    // PARTAGÉ avec le digest quotidien (cf warmupLate ci-dessus).
    const overdueMissions = assignments
      .filter((a) => isOverdueMission(a, now))
      .sort((a, b) => a.dueDate - b.dueDate);

    // Refus qui STAGNENT : refusés il y a >= N jours sans re-soumission (le
    // statut serait repassé à video_submitted). videoRejectedAt absent = refus
    // antérieur au chantier D → non remonté (cf schema).
    const stagnantRejections = assignments
      .filter(
        (a) =>
          a.status === "video_rejected" &&
          a.videoRejectedAt !== undefined &&
          now - a.videoRejectedAt >= STAGNANT_REJECTION_DAYS * DAY_MS,
      )
      .sort((a, b) => (a.videoRejectedAt ?? 0) - (b.videoRejectedAt ?? 0));

    return {
      submitted,
      warmupLate,
      dueTotal,
      deadlines7,
      creatorActivity,
      totalCreators: creators.length,
      toPublish,
      unpaidCycles,
      overdueMissions,
      stagnantRejections,
    };
  }, [assignments, comptes, payments, creators, now]);

  if (loading || data === null) return <ActionSkeleton />;

  const {
    submitted,
    warmupLate,
    dueTotal,
    deadlines7,
    creatorActivity,
    totalCreators,
    toPublish,
    unpaidCycles,
    overdueMissions,
    stagnantRejections,
  } = data;

  const worklistCount =
    toPublish.length +
    submitted.length +
    unpaidCycles.length +
    overdueMissions.length +
    stagnantRejections.length;

  // État vide : ni créateur ni soumission → message d'accueil (pas des cartes à
  // zéro qui semblent cassées).
  if (totalCreators === 0 && submitted.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-20 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserPlusIcon className="size-6" />
          </span>
          <div className="space-y-1">
            <h2 className="text-lg font-medium text-slate-900">
              Invite tes premiers créateurs pour commencer
            </h2>
            <p className="text-sm text-slate-500">
              Une fois des créateurs ajoutés et des contenus assignés, leurs
              soumissions et deadlines apparaîtront ici.
            </p>
          </div>
          <Link
            href={projectPath("/createurs")}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <UserPlusIcon className="size-4" />
            Ajouter un créateur
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Rangée de 4 cartes-action cliquables. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ActionCard
          href={projectPath("/validation")}
          icon={CheckCircle2Icon}
          label="À valider"
          value={String(submitted.length)}
          hint="soumissions en attente"
          accent
        />
        <ActionCard
          href={projectPath("/comptes")}
          icon={FlameIcon}
          label="Warmups en retard"
          value={String(warmupLate.length)}
          hint="comptes avec jours manqués"
          warn={warmupLate.length > 0}
        />
        <ActionCard
          href={projectPath("/paiements")}
          icon={WalletIcon}
          label="Dû"
          value={formatMoney(dueTotal, payCurrency)}
          hint="cycles non payés"
        />
        <ActionCard
          href={projectPath("/assignments")}
          icon={CalendarClockIcon}
          label="Deadlines 7 j"
          value={String(deadlines7.length)}
          hint="assignments à rendre"
          warn={deadlines7.length > 0}
        />
      </div>

      {/*
        File de travail — PLEINE LARGEUR : c'est le cœur du dashboard à 30+
        créateurs. Groupes ordonnés du plus coûteux au moins coûteux :
        1. à publier (la vidéo existe et ne rapporte rien tant qu'elle est hors
           ligne), 2. à valider (le créateur attend l'admin, ça bloque la
        chaîne), 3. cycles dus (argent dû), 4. missions en retard (production
        en retard), 5. refus qui stagnent (créateur bloqué sur un retour).
      */}
      <Section title="À traiter maintenant">
        {worklistCount === 0 && warmupLate.length === 0 ? (
          <EmptyRow
            icon={CheckCircle2Icon}
            label="Rien à traiter, tout est à jour."
          />
        ) : (
          <div className="space-y-1">
            {toPublish.length > 0 && (
              <>
                <GroupHeader
                  icon={UploadCloudIcon}
                  label="À publier (comptes gérés)"
                  count={toPublish.length}
                  tone="text-violet-700"
                />
                <div className="divide-y divide-slate-100">
                  {toPublish.slice(0, WORKLIST_LIMIT).map((a) => (
                    <WorklistRow
                      key={a._id}
                      title={a.creatorName}
                      subtitle={`${missionLabelOf(a)} · vidéo validée, en attente de mise en ligne`}
                      href={projectPath("/validation")}
                      hrefLabel="Publier"
                      primary
                    />
                  ))}
                </div>
              </>
            )}

            {submitted.length > 0 && (
              <>
                {/* Libellé volontairement distinct de la carte « À valider »
                    (collision de texte exact côté tests + ambiguïté à l'écran). */}
                <GroupHeader
                  icon={CheckCircle2Icon}
                  label="Vidéos à valider"
                  count={submitted.length}
                  tone="text-primary"
                />
                <div className="divide-y divide-slate-100">
                  {submitted.slice(0, WORKLIST_LIMIT).map((a) => (
                    <WorklistRow
                      key={a._id}
                      title={a.creatorName}
                      subtitle={`${missionLabelOf(a)} · soumise ${relativeAge(a.createdAt, now)}`}
                      href={projectPath("/validation")}
                      hrefLabel="Valider"
                      primary
                    />
                  ))}
                </div>
              </>
            )}

            {unpaidCycles.length > 0 && (
              <>
                <GroupHeader
                  icon={WalletIcon}
                  label="Cycles dus"
                  count={unpaidCycles.length}
                  tone="text-emerald-700"
                />
                <div className="divide-y divide-slate-100">
                  {unpaidCycles.slice(0, WORKLIST_LIMIT).map((p) => (
                    <WorklistRow
                      key={p.key}
                      title={p.creatorName}
                      subtitle={`${formatMoney(p.totalDue, payCurrency)} en attente de paiement`}
                      href={projectPath("/paiements")}
                      hrefLabel="Voir"
                      action={
                        // Rows orphelines exclues (créateur supprimé) : même
                        // limite qu'au chantier A, markCyclePaid ne peut pas
                        // les traiter.
                        p.key.startsWith("orphan:") ? undefined : (
                          <InlineAction
                            icon={WalletIcon}
                            label="Marquer payé"
                            busy={busyKey === p.key}
                            onClick={() =>
                              handlePayCycle(
                                p.key,
                                p.creatorId,
                                p.cycleIndex,
                                p.creatorName,
                              )
                            }
                          />
                        )
                      }
                    />
                  ))}
                </div>
              </>
            )}

            {overdueMissions.length > 0 && (
              <>
                <GroupHeader
                  icon={AlertTriangleIcon}
                  label="Missions en retard"
                  count={overdueMissions.length}
                  tone="text-rose-700"
                />
                <div className="divide-y divide-slate-100">
                  {overdueMissions.slice(0, WORKLIST_LIMIT).map((a) => (
                    <WorklistRow
                      key={a._id}
                      title={a.creatorName}
                      subtitle={`${missionLabelOf(a)} · attendue ${relativeAge(a.dueDate, now)}`}
                      href={projectPath("/assignments")}
                      hrefLabel="Voir"
                      action={
                        <InlineAction
                          icon={BellIcon}
                          label="Relancer"
                          busy={busyKey === a._id}
                          onClick={() => handleNudge(a._id, a.creatorName)}
                        />
                      }
                    />
                  ))}
                </div>
              </>
            )}

            {stagnantRejections.length > 0 && (
              <>
                <GroupHeader
                  icon={MessageSquareWarningIcon}
                  label="Refus sans re-soumission"
                  count={stagnantRejections.length}
                  tone="text-amber-700"
                />
                <div className="divide-y divide-slate-100">
                  {stagnantRejections.slice(0, WORKLIST_LIMIT).map((a) => (
                    <WorklistRow
                      key={a._id}
                      title={a.creatorName}
                      subtitle={`${missionLabelOf(a)} · refusée ${relativeAge(a.videoRejectedAt ?? a.createdAt, now)}`}
                      href={projectPath("/assignments")}
                      hrefLabel="Voir"
                      action={
                        <InlineAction
                          icon={BellIcon}
                          label="Relancer"
                          busy={busyKey === a._id}
                          onClick={() => handleNudge(a._id, a.creatorName)}
                        />
                      }
                    />
                  ))}
                </div>
              </>
            )}

            {warmupLate.length > 0 && (
              <Link
                href={projectPath("/comptes")}
                className="flex items-center justify-between gap-3 border-t border-slate-100 py-2.5 transition-colors hover:bg-slate-50"
              >
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <FlameIcon className="size-4 text-amber-600" />
                  <span>
                    <span className="font-medium">{warmupLate.length}</span>{" "}
                    warmup{warmupLate.length > 1 ? "s" : ""} en retard à
                    relancer
                  </span>
                </div>
                <ArrowRightIcon className="size-4 shrink-0 text-slate-400" />
              </Link>
            )}
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6">
        {/* Activité créateurs — agrégats existants (perf par compte). */}
        <Section
          title="Activité créateurs"
          action={
            creatorActivity.length > 0
              ? { label: "Voir tout", href: projectPath("/createurs") }
              : undefined
          }
        >
          {creatorActivity.length === 0 ? (
            <EmptyRow icon={UserPlusIcon} label="Aucun créateur actif." />
          ) : (
            <div className="divide-y divide-slate-100">
              {creatorActivity.slice(0, ACTIVITY_LIMIT).map(({ creator, vues, posts, warmupCount }) => {
                const badge = creatorStatusBadge(creator.status);
                return (
                  <Link
                    key={creator._id}
                    href={projectPath(`/createurs/${creator._id}`)}
                    className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">
                          {creator.name}
                        </span>
                        <Badge variant="outline" className={badge.className}>
                          {badge.label}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {posts} post{posts > 1 ? "s" : ""}
                        {warmupCount > 0 && (
                          <span className="text-amber-600">
                            {" · "}
                            {warmupCount} en warmup
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold tabular-nums text-slate-900">
                        {formatNumber(vues)}
                      </div>
                      <div className="text-xs text-slate-400">vues</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

/** Libellé lisible d'une mission : format nommé, sinon campagne, sinon générique. */
function missionLabelOf(a: {
  formatName: string | null;
  scriptCampaignName: string | null;
}): string {
  return a.formatName ?? a.scriptCampaignName ?? "Mission";
}

/** En-tête d'un groupe de la file (libellé + compteur, teinté par urgence). */
function GroupHeader({
  icon: Icon,
  label,
  count,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-1.5 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide">
      <Icon className={cn("size-3.5", tone)} />
      <span className={tone}>{label}</span>
      <span className="font-normal text-slate-400">({count})</span>
    </div>
  );
}

/** Bouton d'action INLINE d'une ligne de file (relance, paiement). */
function InlineAction({
  icon: Icon,
  label,
  busy,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="xs"
      className="h-7 gap-1 px-2"
      onClick={onClick}
      disabled={busy}
    >
      {busy ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <Icon className="size-3" />
      )}
      {label}
    </Button>
  );
}

/**
 * Ligne de la file : contexte à gauche, actions à droite. Toujours au moins un
 * accès direct à la surface concernée (« agir sans naviguer au hasard »), plus
 * une action inline quand elle existe (relancer, marquer payé).
 */
function WorklistRow({
  title,
  subtitle,
  href,
  hrefLabel,
  action,
  primary,
}: {
  title: string;
  subtitle: string;
  href: string;
  hrefLabel: string;
  action?: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-900">
          {title}
        </div>
        <div className="truncate text-xs text-slate-500">{subtitle}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {action}
        <Link
          href={href}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            primary
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "border border-slate-200 text-slate-700 hover:bg-slate-50",
          )}
        >
          {hrefLabel}
        </Link>
      </div>
    </div>
  );
}

function ActionCard({
  href,
  icon: Icon,
  label,
  value,
  hint,
  accent,
  warn,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <Link href={href} className="group block">
      <Card className="transition-colors group-hover:border-primary/40 group-hover:bg-primary/[0.03]">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-md",
                accent
                  ? "bg-primary/10 text-primary"
                  : warn
                    ? "bg-amber-50 text-amber-600"
                    : "bg-slate-100 text-slate-500",
              )}
            >
              <Icon className="size-4" />
            </span>
            <ArrowRightIcon className="size-4 text-slate-300 transition-colors group-hover:text-primary" />
          </div>
          <div
            className={cn(
              "mt-3 text-3xl font-bold tabular-nums",
              accent ? "text-primary" : "text-slate-900",
            )}
          >
            {value}
          </div>
          <div className="mt-1 text-sm font-medium text-slate-700">{label}</div>
          <div className="text-xs text-slate-400">{hint}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            {title}
          </h2>
          {action && (
            <Link
              href={action.href}
              className="text-xs font-medium text-primary hover:underline"
            >
              {action.label}
            </Link>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function EmptyRow({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
      <Icon className="size-4" />
      {label}
    </div>
  );
}

function ActionSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
