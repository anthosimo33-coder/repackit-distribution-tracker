"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  DoorOpenIcon,
  FlameIcon,
  GraduationCapIcon,
  Loader2Icon,
  UserPlusIcon,
  WalletIcon,
  ZapOffIcon,
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
import { formatNumber, formatPercent } from "@/lib/format";
import { formatMoney } from "@/lib/format-rate";
import { isWarmupLate } from "@/lib/ops-digest";
import { resolveCreatorKind } from "@/convex/roles";
import {
  getEffectiveStatus,
  getEffectiveWarmupDuration,
} from "@/lib/compte-status";
import {
  verdictOf,
  likeRateTone,
  saveRateTone,
  accountStateOf,
  rateOf,
  type PostSignal,
  type Verdict,
  type RateTone,
  type AccountState,
} from "@/convex/decisions";
import { savesAvailability } from "@/convex/decisionThresholds";
import { POST_WINDOW_PRESETS } from "@/convex/postWindow";
import { GraduateHookDialog } from "@/components/admin/GraduateHookDialog";
import { AssignScriptCampaignDialog } from "@/components/admin/AssignScriptCampaignDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

const DAY_MS = 86_400_000;

type DashboardDecisions = FunctionReturnType<
  typeof api.dashboardDecisions.decisionDashboard
>;
type Post48h = DashboardDecisions["posts48h"][number];

/** Créneau pré-rempli de « Programmer la frappe » : le soir, 21 h-23 h. */
const SOIR = POST_WINDOW_PRESETS.find((p) => p.id === "soir")!.window;

/**
 * Minuit LOCAL du lendemain — même convention que le calendrier d'assignation
 * (les postDate de prod sont toutes à minuit heure du poste admin, UTC+1).
 */
function tomorrowMidnightLocal(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

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

  // Les deux sections décisionnelles lisent UNE query d'assemblage ; toute la
  // logique (seuils, détections) vit dans les modules purs testés.
  const decisions = useProjectQuery(api.dashboardDecisions.decisionDashboard, {});

  // Dialogues des trois actions : graduer (modale existante), désactiver un
  // hook mort (confirmation), programmer une frappe (modale d'assignation
  // pré-remplie créatrice + Soir 21-23h + demain).
  const [graduating, setGraduating] = useState<Id<"scriptBricks"> | null>(null);
  const [deactivating, setDeactivating] = useState<{
    brickId: Id<"scriptBricks">;
    content: string;
  } | null>(null);
  const [strikeCreator, setStrikeCreator] = useState<Id<"creators"> | null>(
    null,
  );

  const loading =
    assignments === undefined ||
    comptes === undefined ||
    payments === undefined ||
    creators === undefined ||
    decisions === undefined;

  const data = useMemo(() => {
    if (
      assignments === undefined ||
      comptes === undefined ||
      payments === undefined ||
      creators === undefined
    ) {
      return null;
    }
    // Carte 1 — vidéos en attente de revue.
    const submitted = assignments
      .filter((a) => a.status === "video_submitted")
      .sort((a, b) => a.createdAt - b.createdAt);

    // Carte 2 — comptes en warmup avec des jours manqués. Prédicat PARTAGÉ avec
    // le digest quotidien (lib/ops-digest) ; les comptes de CLIPPEUR en sortent
    // (pas de checks quotidiens — même correction que côté digest).
    const creatorById = new Map((creators ?? []).map((c) => [c._id, c]));
    const estCompteDeClippeur = (creatorId: Id<"creators"> | undefined) =>
      creatorId !== undefined &&
      resolveCreatorKind(creatorById.get(creatorId)?.kind) === "clipper";
    const warmupLate = comptes.filter((c) =>
      estCompteDeClippeur(c.creatorId)
        ? false
        : isWarmupLate(
            {
              effectiveStatus: getEffectiveStatus(c),
              warmupStartedAt: c.warmupStartedAt,
              dailyChecks: c.warmupProtocol?.dailyChecks ?? [],
              targetDays: getEffectiveWarmupDuration(c),
            },
            now,
          ),
    );

    // Carte 3 — total DÛ = tous les cycles non payés (même ensemble que le
    // total de /paiements, les deux lisent listPayments).
    const dueTotal = payments
      .filter((p) => p.status !== "paid")
      .reduce((sum, p) => sum + p.totalDue, 0);

    // Carte 4 — assignments actionnables dont la deadline tombe sous 7 j.
    const deadlines7 = assignments.filter((a) => {
      if (a.status !== "todo" && a.status !== "in_progress") return false;
      const d = a.dueDate - now;
      return d >= 0 && d <= 7 * DAY_MS;
    });

    return {
      submitted,
      warmupLate,
      dueTotal,
      deadlines7,
      totalCreators: creators.length,
    };
  }, [assignments, comptes, payments, creators, now]);

  if (loading || data === null) return <ActionSkeleton />;

  const { submitted, warmupLate, dueTotal, deadlines7, totalCreators } = data;

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
        « À décider » — le cœur de la refonte : une ligne par DÉCISION, jamais
        une tâche d'exécution (celles-ci vivent dans leurs pages, atteignables
        par les 4 cartes du haut). Détections servies par decisionDashboard,
        seuils dans convex/decisionThresholds.ts.
      */}
      <Section title="À décider">
        <DecideList
          decisions={decisions!}
          onStrike={(creatorId) => setStrikeCreator(creatorId)}
          onGraduate={(brickId) => setGraduating(brickId)}
          onDeactivate={(brickId, content) =>
            setDeactivating({ brickId, content })
          }
        />
      </Section>

      {/* « Posts des dernières 48 h » — remplace les cumuls à vie : le rythme
          réel, groupé par créatrice, delta 24 h en évidence. Le cumul reste
          accessible via « Voir tout ». */}
      <Section
        title="Posts des dernières 48 h"
        action={{ label: "Voir tout", href: projectPath("/createurs") }}
      >
        <Recent48h posts={decisions!.posts48h} alarms={decisions!.alarms} now={now} />
      </Section>

      <GraduateHookDialog
        brickId={graduating}
        open={graduating !== null}
        onOpenChange={(o) => !o && setGraduating(null)}
      />
      <DeactivateHookDialog
        target={deactivating}
        onOpenChange={(o) => !o && setDeactivating(null)}
      />
      {/* « Programmer la frappe » : la modale d'assignation EXISTANTE, sur la
          campagne des ouvertures prouvées, pré-remplie créatrice + Soir 21-23h
          + demain. Le bouton est masqué si la campagne n'existe pas. */}
      {decisions!.provenCampaign !== null && strikeCreator !== null && (
        <AssignScriptCampaignDialog
          open
          onOpenChange={(o) => !o && setStrikeCreator(null)}
          campaignId={decisions!.provenCampaign.id}
          campaignName={decisions!.provenCampaign.name}
          strike={{
            creatorId: strikeCreator,
            plage: SOIR,
            postDate: tomorrowMidnightLocal(now),
          }}
        />
      )}
    </div>
  );
}

// ─── Section « À décider » ───────────────────────────────────────────────────

function DecideList({
  decisions,
  onStrike,
  onGraduate,
  onDeactivate,
}: {
  decisions: DashboardDecisions;
  onStrike: (creatorId: Id<"creators">) => void;
  onGraduate: (brickId: Id<"scriptBricks">) => void;
  onDeactivate: (brickId: Id<"scriptBricks">, content: string) => void;
}) {
  const { openDoors, graduations, deadHooks, alarms, provenCampaign } = decisions;
  const total =
    openDoors.length + graduations.length + deadHooks.length + alarms.length;

  if (total === 0) {
    return (
      <EmptyRow
        icon={CheckCircle2Icon}
        label="Rien à décider ce soir. Prochain relevé après le sync de 23h30."
      />
    );
  }

  return (
    <div className="space-y-1">
      {openDoors.length > 0 && (
        <>
          <GroupHeader
            icon={DoorOpenIcon}
            label="Portes ouvertes"
            count={openDoors.length}
            tone="text-violet-700"
          />
          <div className="divide-y divide-slate-100">
            {openDoors.map((d) => (
              <WorklistRow
                key={d.post.publicationId}
                title={`${d.post.compte}${d.post.creatorName ? ` — ${d.post.creatorName}` : ""}`}
                subtitle={[
                  `${formatNumber(d.post.vues)} vues`,
                  `${formatPercent(d.likeRate)} likes`,
                  `${formatNumber(d.post.saves ?? 0)} saves`,
                  `+${formatNumber(d.post.followersDelta ?? 0)} abonnés`,
                  ...(d.post.angleFamily ? [d.post.angleFamily] : []),
                ].join(" · ")}
                action={
                  d.post.creatorId !== null && provenCampaign !== null ? (
                    <InlineAction
                      icon={DoorOpenIcon}
                      label="Programmer la frappe"
                      busy={false}
                      onClick={() => onStrike(d.post.creatorId as Id<"creators">)}
                    />
                  ) : undefined
                }
              />
            ))}
          </div>
        </>
      )}

      {graduations.length > 0 && (
        <>
          <GroupHeader
            icon={GraduationCapIcon}
            label="À graduer"
            count={graduations.length}
            tone="text-primary"
          />
          <div className="divide-y divide-slate-100">
            {graduations.map((g) => (
              <WorklistRow
                key={g.brickId}
                title={g.content}
                subtitle={[
                  `meilleur run ${formatNumber(g.best.vues)} vues`,
                  `${formatPercent(rateOf(g.best.likes, g.best.vues) ?? 0)} likes`,
                  g.best.saves !== null
                    ? `${formatPercent(rateOf(g.best.saves, g.best.vues) ?? 0)} saves`
                    : "saves —",
                  `${g.runs} run${g.runs > 1 ? "s" : ""}`,
                  ...(g.angleFamily ? [g.angleFamily] : []),
                ].join(" · ")}
                action={
                  <InlineAction
                    icon={GraduationCapIcon}
                    label="Graduer"
                    busy={false}
                    onClick={() => onGraduate(g.brickId)}
                  />
                }
              />
            ))}
          </div>
        </>
      )}

      {deadHooks.length > 0 && (
        <>
          <GroupHeader
            icon={ZapOffIcon}
            label="Hooks morts"
            count={deadHooks.length}
            tone="text-slate-500"
          />
          <div className="divide-y divide-slate-100">
            {deadHooks.map((h) => (
              <WorklistRow
                key={h.brickId}
                title={h.content}
                subtitle={`${h.runs} runs publiés, meilleur ${formatNumber(h.bestViews)} vues — aucun ne prend (${h.campaignName})`}
                action={
                  <InlineAction
                    icon={ZapOffIcon}
                    label="Désactiver"
                    busy={false}
                    onClick={() => onDeactivate(h.brickId, h.content)}
                  />
                }
              />
            ))}
          </div>
        </>
      )}

      {alarms.length > 0 && (
        <>
          <GroupHeader
            icon={AlertTriangleIcon}
            label="Alarmes compte"
            count={alarms.length}
            tone="text-rose-700"
          />
          <div className="divide-y divide-slate-100">
            {alarms.map((a) => (
              <WorklistRow
                key={a.compte}
                title={`${a.compte}${a.creatorName ? ` — ${a.creatorName}` : ""}`}
                subtitle={`${a.streak} posts consécutifs sous les seuils — stop promos, warmup prouvé pendant 5-7 jours`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Confirmation de DÉSACTIVATION d'un hook mort. Même mutation que la bascule de
 * la page campagne (updateBrick) : aucune logique nouvelle, juste une porte de
 * confirmation — le geste retire le hook de toutes les rotations futures.
 */
function DeactivateHookDialog({
  target,
  onOpenChange,
}: {
  target: { brickId: Id<"scriptBricks">; content: string } | null;
  onOpenChange: (o: boolean) => void;
}) {
  const update = useProjectMutation(api.scripts.updateBrick);
  const [busy, setBusy] = useState(false);

  async function onConfirm() {
    if (!target) return;
    setBusy(true);
    try {
      await update({ id: target.brickId, active: false });
      toast.success("Hook désactivé — il sort des rotations.");
      onOpenChange(false);
    } catch (e) {
      toast.error(convexErrorMessage(e, "Désactivation impossible"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Désactiver ce hook</DialogTitle>
          <DialogDescription>
            Il sort des rotations automatiques ; ses runs passés et leurs
            statistiques restent intacts. Réactivable depuis la page campagne.
          </DialogDescription>
        </DialogHeader>
        {target && (
          <blockquote className="rounded-md border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800">
            {target.content}
          </blockquote>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <ZapOffIcon className="size-4" />
            )}
            Désactiver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Section « Posts des dernières 48 h » ────────────────────────────────────

function Recent48h({
  posts,
  alarms,
  now,
}: {
  posts: Post48h[];
  alarms: DashboardDecisions["alarms"];
  now: number;
}) {
  // Repli par créatrice — état LOCAL, défaut déplié (l'écran sert à lire, le
  // repli sert à ranger les créatrices déjà vues ce soir).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const alarmedComptes = useMemo(
    () => new Set(alarms.map((a) => a.compte)),
    [alarms],
  );

  const groups = useMemo(() => {
    const byCreator = new Map<string, { label: string; posts: Post48h[] }>();
    for (const p of posts) {
      // Un post sans créatrice rattachée est groupé par COMPTE : l'information
      // reste visible au lieu de disparaître dans un bucket fourre-tout.
      const key = p.creatorId ?? `compte:${p.compte}`;
      const g = byCreator.get(key) ?? {
        label: p.creatorName ?? p.compte,
        posts: [],
      };
      g.posts.push(p);
      byCreator.set(key, g);
    }
    return [...byCreator.entries()].sort(
      (a, b) =>
        b[1].posts.reduce((s, p) => s + p.vues, 0) -
        a[1].posts.reduce((s, p) => s + p.vues, 0),
    );
  }, [posts]);

  if (posts.length === 0) {
    return (
      <EmptyRow
        icon={CalendarClockIcon}
        label="Aucun post publié dans les dernières 48 h."
      />
    );
  }

  return (
    <div className="space-y-1">
      {groups.map(([key, g]) => {
        const vues48 = g.posts.reduce((s, p) => s + p.vues, 0);
        // Delta d'abonnés PAR COMPTE (dédupliqué) puis sommé ; tous null →
        // « collecte… » (il faut deux relevés nocturnes, cf computeFollowersDelta).
        const parCompte = new Map<string, number | null>();
        for (const p of g.posts) parCompte.set(p.compte, p.followersDelta);
        const deltas = [...parCompte.values()].filter(
          (d): d is number => d !== null,
        );
        const followers = deltas.length > 0
          ? deltas.reduce((s, d) => s + d, 0)
          : null;
        const alarmed = [...parCompte.keys()].some((c) => alarmedComptes.has(c));
        const state = accountStateOf(g.posts, alarmed);
        const isCollapsed = collapsed.has(key);

        return (
          <div key={key} className="border-t border-slate-100 first:border-t-0">
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
              className="flex w-full items-center gap-2 py-2.5 text-left transition-colors hover:bg-slate-50"
            >
              {isCollapsed ? (
                <ChevronRightIcon className="size-4 shrink-0 text-slate-400" />
              ) : (
                <ChevronDownIcon className="size-4 shrink-0 text-slate-400" />
              )}
              <span className="truncate text-sm font-medium text-slate-900">
                {g.label}
              </span>
              <AccountStateBadge state={state} />
              <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-500">
                {g.posts.length} post{g.posts.length > 1 ? "s" : ""} ·{" "}
                {(g.posts.length / 2).toFixed(1).replace(".", ",")}/j ·{" "}
                {formatNumber(vues48)} vues ·{" "}
                {followers !== null ? (
                  <span className={followers >= 0 ? "text-emerald-700" : "text-rose-700"}>
                    {followers >= 0 ? "+" : ""}
                    {formatNumber(followers)} abonnés
                  </span>
                ) : (
                  <span
                    className="italic text-slate-400"
                    title="Le delta d'abonnés demande deux relevés nocturnes — en cours de collecte."
                  >
                    abonnés : collecte…
                  </span>
                )}
              </span>
            </button>
            {!isCollapsed && (
              <div className="divide-y divide-slate-50 pb-1 pl-6">
                {g.posts.map((p) => (
                  <PostRow key={p.publicationId} post={p} now={now} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PostRow({ post: p, now }: { post: Post48h; now: number }) {
  const likeRate = rateOf(p.likes, p.vues);
  const savesState = savesAvailability(p.saves, p.plateforme);
  const saveRate = savesState === "measured" ? rateOf(p.saves, p.vues) : null;

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm text-slate-900">
            {p.label || "(sans titre)"}
          </span>
          <TypeBadge type={p.type} />
          {p.angleFamily && (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {p.angleFamily}
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-slate-400">
          {p.compte} · {relativeAge(p.postedAt, now)}
        </div>
      </div>
      <Metric value={formatNumber(p.vues)} label="vues" />
      {/* LA colonne du tableau : un post qui monte vs un post qui s'éteint. */}
      <div className="w-20 shrink-0 text-right">
        {p.delta24h !== null ? (
          <div className="text-sm font-semibold tabular-nums text-slate-900">
            +{formatNumber(p.delta24h)}
          </div>
        ) : (
          <div
            className="text-sm italic text-slate-400"
            title="Pas encore deux relevés espacés — delta au prochain sync de 23h30."
          >
            —
          </div>
        )}
        <div className="text-[10px] text-slate-400">Δ 24 h</div>
      </div>
      <RateCell rate={likeRate} tone={likeRateTone(likeRate)} label="likes" />
      {savesState === "collecting" ? (
        <div className="w-16 shrink-0 text-right">
          <div
            className="text-xs italic text-slate-400"
            title="Saves branchées récemment — en cours de collecte."
          >
            collecte…
          </div>
          <div className="text-[10px] text-slate-400">saves</div>
        </div>
      ) : (
        <RateCell
          rate={saveRate}
          tone={savesState === "unavailable" ? "unknown" : saveRateTone(saveRate)}
          label="saves"
        />
      )}
      <VerdictBadge verdict={verdictOf(p, now)} />
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="w-16 shrink-0 text-right">
      <div className="text-xs tabular-nums text-slate-600">{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  );
}

const RATE_TONE_CLASS: Record<RateTone, string> = {
  bad: "text-rose-600",
  neutral: "text-slate-600",
  good: "text-emerald-600",
  unknown: "text-slate-400",
};

function RateCell({
  rate,
  tone,
  label,
}: {
  rate: number | null;
  tone: RateTone;
  label: string;
}) {
  return (
    <div className="w-16 shrink-0 text-right">
      <div className={cn("text-xs tabular-nums", RATE_TONE_CLASS[tone])}>
        {rate === null ? "—" : formatPercent(rate)}
      </div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  );
}

const VERDICT_DISPLAY: Record<Verdict, { label: string; className: string }> = {
  pending: { label: "en attente", className: "text-slate-400 italic" },
  "open-door": { label: "porte ouverte", className: "text-violet-700 font-medium" },
  rising: { label: "monte", className: "text-emerald-700 font-medium" },
  fading: { label: "s'éteint", className: "text-slate-400" },
  below: { label: "sous les seuils", className: "text-rose-600" },
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const d = VERDICT_DISPLAY[verdict];
  return (
    <span className={cn("w-24 shrink-0 text-right text-xs", d.className)}>
      {d.label}
    </span>
  );
}

const TYPE_DISPLAY: Record<string, { label: string; className: string }> = {
  prouve: { label: "prouvé", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  lab: { label: "LAB", className: "border-sky-200 bg-sky-50 text-sky-700" },
  warmup: { label: "warmup", className: "border-amber-200 bg-amber-50 text-amber-700" },
  promo: { label: "promo", className: "border-violet-200 bg-violet-50 text-violet-700" },
};

function TypeBadge({ type }: { type: string }) {
  const d = TYPE_DISPLAY[type] ?? TYPE_DISPLAY.promo;
  return (
    <Badge variant="outline" className={cn("shrink-0 text-[10px]", d.className)}>
      {d.label}
    </Badge>
  );
}

const ACCOUNT_STATE_DISPLAY: Record<
  AccountState,
  { label: string; className: string }
> = {
  window: { label: "Fenêtre active", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  cruise: { label: "Croisière", className: "border-slate-200 bg-slate-50 text-slate-600" },
  alarm: { label: "Alarme", className: "border-rose-200 bg-rose-50 text-rose-700" },
};

function AccountStateBadge({ state }: { state: AccountState }) {
  const d = ACCOUNT_STATE_DISPLAY[state];
  return (
    <Badge variant="outline" className={cn("shrink-0", d.className)}>
      {d.label}
    </Badge>
  );
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
  /** Lien de navigation — optionnel : une ligne de DÉCISION n'a qu'une action. */
  href?: string;
  hrefLabel?: string;
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
        {href !== undefined && hrefLabel !== undefined && (
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
        )}
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
