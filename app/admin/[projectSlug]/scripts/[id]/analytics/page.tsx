"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { JUGEABLE_THRESHOLD } from "@/lib/scriptStats";
import {
  ArrowLeftIcon,
  TrophyIcon,
  ChevronDownIcon,
  SparklesIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  FlameIcon,
  MinusIcon,
} from "lucide-react";

type Window = "j3" | "j7" | "j14" | "j30";
const WINDOWS: { key: Window; label: string }[] = [
  { key: "j3", label: "J+3" },
  { key: "j7", label: "J+7" },
  { key: "j14", label: "J+14" },
  { key: "j30", label: "J+30" },
];

type BrickPerf = FunctionReturnType<typeof api.scriptAnalytics.perfByBrick>[number];
type TierPerf = FunctionReturnType<typeof api.scriptAnalytics.perfByTier>[number];
type ComboPerf = FunctionReturnType<typeof api.scriptAnalytics.perfByCombo>[number];
type Decisions = FunctionReturnType<typeof api.scriptDecision.campaignDecisions>;
type Dimension = Decisions["dimensions"][number];
type BrickDecision = Dimension["decisions"][number];
type StrongSignal = Decisions["strongSignals"][number];

const KIND_LABEL: Record<string, string> = {
  flux: "Flux",
  cta: "CTA",
  hook: "Hook",
};

const DIMENSION_LABEL: Record<string, string> = {
  tier: "Tiers de hook",
  flux: "Flux",
  cta: "CTA",
};

export default function ScriptAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id as Id<"scriptCampaigns">;
  const projectPath = useProjectPath();
  const [window, setWindow] = useState<Window>("j7");

  const campaign = useProjectQuery(api.scripts.getCampaign, { id: campaignId });
  const tiers = useProjectQuery(api.scriptAnalytics.perfByTier, {
    campaignId,
    window,
  });
  const bricks = useProjectQuery(api.scriptAnalytics.perfByBrick, {
    campaignId,
    window,
  });
  const combos = useProjectQuery(api.scriptAnalytics.perfByCombo, {
    campaignId,
    window,
  });
  const decisions = useProjectQuery(api.scriptDecision.campaignDecisions, {
    campaignId,
    window,
  });

  const loading =
    tiers === undefined ||
    bricks === undefined ||
    combos === undefined ||
    decisions === undefined;
  const windowLabel = WINDOWS.find((w) => w.key === window)?.label ?? "";

  return (
    <div className="space-y-6">
      <Link
        href={projectPath(`/scripts/${campaignId}`)}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />
        Retour à la campagne
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Analytics{campaign ? ` — ${campaign.name}` : ""}
          </h1>
          <p className="text-sm text-slate-500">
            Performance par variable de script. Médiane des vues (robuste aux
            outliers). Verdict à partir de {JUGEABLE_THRESHOLD} posts par
            brique.
          </p>
        </div>
        <WindowSelector value={window} onChange={setWindow} />
      </header>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="space-y-10">
          {/* S4 — l'ACTIONNABLE en haut : verdicts + signaux à valider. */}
          <DecisionsSection decisions={decisions} windowLabel={windowLabel} />

          {/* S3 — chiffres bruts, inchangés, sous les décisions. */}
          {combos.length > 0 && (
            <div className="space-y-8">
              <div className="border-t border-slate-200 pt-6">
                <h2 className="text-base font-semibold text-slate-900">
                  Détail des chiffres
                </h2>
                <p className="text-sm text-slate-500">
                  Médianes brutes par variable et par combo. Les décisions
                  ci-dessus en sont tirées.
                </p>
              </div>
              <TierSection tiers={tiers} />
              {(["flux", "cta"] as const).map((kind) => (
                <BrickSection
                  key={kind}
                  kind={kind}
                  bricks={bricks.filter((b) => b.kind === kind)}
                />
              ))}
              <ComboSection combos={combos} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WindowSelector({
  value,
  onChange,
}: {
  value: Window;
  onChange: (w: Window) => void;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
      role="group"
      aria-label="Fenêtre de vues"
    >
      {WINDOWS.map((w) => (
        <button
          key={w.key}
          type="button"
          onClick={() => onChange(w.key)}
          aria-pressed={value === w.key}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            value === w.key
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-900",
          )}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

// ─── S4 : Décisions (verdicts + signaux forts) ───────────────────────────────

const VERDICT_ORDER: Record<string, number> = {
  a_pousser: 0,
  a_couper: 1,
  neutre: 2,
  en_test: 3,
};

/** Écart signé en % (ex. "+30 %", "−40 %"), aligné sur le moteur. */
function signedPct(fraction: number): string {
  const sign = fraction >= 0 ? "+" : "−";
  return `${sign}${Math.round(Math.abs(fraction) * 100)} %`;
}

/** Ratio médiane/pairs (ex. "×2,3"), null si non calculable. */
function ratioText(median: number | null, peerMedian: number | null): string | null {
  if (median === null || peerMedian === null || peerMedian <= 0) return null;
  return `×${(median / peerMedian).toFixed(1).replace(".", ",")}`;
}

function VerdictBadge({ verdict }: { verdict: BrickDecision["verdict"] }) {
  switch (verdict) {
    case "a_pousser":
      return (
        <Badge className="shrink-0 gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
          <TrendingUpIcon className="size-3" />À pousser
        </Badge>
      );
    case "a_couper":
      return (
        <Badge className="shrink-0 gap-1 bg-rose-600 text-white hover:bg-rose-600">
          <TrendingDownIcon className="size-3" />À couper
        </Badge>
      );
    case "neutre":
      return (
        <Badge variant="secondary" className="shrink-0 gap-1">
          <MinusIcon className="size-3" />
          Neutre
        </Badge>
      );
    default:
      return (
        <Badge
          variant="outline"
          className="shrink-0 border-amber-300 text-amber-700"
        >
          en test
        </Badge>
      );
  }
}

/** Phrase de reco prête à lire (verbe d'action en tête). */
function decisionHeadline(d: BrickDecision): string {
  const r = ratioText(d.viewsMedian, d.peerMedian);
  switch (d.verdict) {
    case "a_pousser":
      return `Pousse ${d.label}${r ? ` — médiane ${r} vs pairs` : ""}, sur ${d.postCount} posts.`;
    case "a_couper":
      return `Coupe ${d.label}${
        d.deltaVsPeerMedian !== null
          ? ` — médiane ${signedPct(d.deltaVsPeerMedian)} sous les pairs`
          : ""
      }, sur ${d.postCount} posts.`;
    case "neutre":
      return `${d.label} — dans la moyenne${
        d.deltaVsPeerMedian !== null ? ` (${signedPct(d.deltaVsPeerMedian)})` : ""
      }, garder en rotation. ${d.postCount} posts.`;
    default:
      return `${d.label} — en test, ${d.postCount}/${JUGEABLE_THRESHOLD} posts.`;
  }
}

function DecisionRow({ d }: { d: BrickDecision }) {
  const actionable = d.verdict === "a_pousser" || d.verdict === "a_couper";
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border p-3",
        d.verdict === "a_pousser" && "border-emerald-300 bg-emerald-50/60",
        d.verdict === "a_couper" && "border-rose-300 bg-rose-50/60",
        !actionable && "border-slate-200 bg-white",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="pt-0.5">
          <VerdictBadge verdict={d.verdict} />
        </div>
        <p
          className={cn(
            "min-w-0 text-sm",
            actionable ? "font-medium text-slate-900" : "text-slate-600",
          )}
        >
          {decisionHeadline(d)}
        </p>
      </div>
      <span className="shrink-0 pt-0.5 tabular-nums text-sm font-semibold text-slate-900">
        {formatNumber(d.viewsMedian)}
      </span>
    </div>
  );
}

function DimensionBlock({ dimension }: { dimension: Dimension }) {
  if (dimension.decisions.length === 0) return null;
  const sorted = [...dimension.decisions].sort(
    (a, b) =>
      (VERDICT_ORDER[a.verdict] ?? 9) - (VERDICT_ORDER[b.verdict] ?? 9) ||
      (b.viewsMedian ?? -1) - (a.viewsMedian ?? -1),
  );
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {DIMENSION_LABEL[dimension.kind] ?? dimension.kind}
      </h3>
      <div className="space-y-2">
        {sorted.map((d) => (
          <DecisionRow key={d.key} d={d} />
        ))}
      </div>
    </div>
  );
}

/** État « pas encore jugeable » — message de collecte + brique la plus avancée. */
function CollectState({
  decisions,
  windowLabel,
}: {
  decisions: Decisions;
  windowLabel: string;
}) {
  if (decisions.totalPosts === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm font-medium text-slate-900">
            Aucune publication de script mesurée à {windowLabel}.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Essaie une autre fenêtre, ou reviens quand des posts auront des vues
            à cette échéance.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Brique la plus avancée vers le seuil (encouragement / repère).
  let lead: BrickDecision | null = null;
  for (const dim of decisions.dimensions) {
    for (const d of dim.decisions) {
      if (d.postCount > (lead?.postCount ?? -1)) lead = d;
    }
  }

  return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="text-sm font-medium text-slate-900">
          Encore en collecte de données.
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          Les recommandations apparaîtront dès qu&apos;une brique atteint{" "}
          {JUGEABLE_THRESHOLD} posts publiés. (Le bulk testing a besoin de volume
          pour décider.)
        </p>
        {lead && lead.postCount > 0 && (
          <p className="mt-3 text-xs text-slate-400">
            Brique la plus avancée : {lead.label} — {lead.postCount}/
            {JUGEABLE_THRESHOLD}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StrongSignalsBlock({ signals }: { signals: StrongSignal[] }) {
  return (
    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex items-center gap-2">
        <FlameIcon className="size-4 text-amber-600" />
        <h3 className="text-sm font-semibold text-amber-900">
          Signaux forts à valider
        </h3>
      </div>
      <p className="text-xs text-amber-700">
        Briques/combos qui explosent la médiane de campagne avant d&apos;être
        jugeables. À confirmer manuellement — aucune action automatique (un seul
        carton peut être un accident).
      </p>
      <div className="space-y-2 pt-1">
        {signals.map((s) => (
          <div
            key={s.key}
            className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {s.label}
              </p>
              <p className="text-xs text-slate-500">
                ×{s.multipleOfGlobal.toFixed(1).replace(".", ",")} la médiane de
                campagne · {s.postCount} posts · à confirmer manuellement
              </p>
            </div>
            <span className="shrink-0 tabular-nums text-sm font-semibold text-slate-900">
              {formatNumber(s.viewsMedian)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionsSection({
  decisions,
  windowLabel,
}: {
  decisions: Decisions;
  windowLabel: string;
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">Décisions</h2>
        <p className="text-sm text-slate-500">
          Recommandations de bulk testing à {windowLabel}. « À pousser » = à
          assigner davantage ; « à couper » = arrêter d&apos;assigner. Le système
          recommande, il ne ré-assigne jamais tout seul.
        </p>
      </div>

      {decisions.anyJudgeable ? (
        <div className="space-y-5">
          {decisions.dimensions.map((dim) => (
            <DimensionBlock key={dim.kind} dimension={dim} />
          ))}
        </div>
      ) : (
        <CollectState decisions={decisions} windowLabel={windowLabel} />
      )}

      {decisions.strongSignals.length > 0 && (
        <StrongSignalsBlock signals={decisions.strongSignals} />
      )}
    </section>
  );
}

/** Statut de données (badge) + intitulé "en test (N/50)". */
function StatusBadge({
  status,
  postCount,
}: {
  status: "en_test" | "jugeable";
  postCount: number;
}) {
  if (status === "jugeable") {
    return (
      <Badge variant="secondary" className="shrink-0">
        {postCount} posts
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-amber-300 text-amber-700"
    >
      en test ({postCount}/{JUGEABLE_THRESHOLD})
    </Badge>
  );
}

/** Barre comparative + médiane + statut. winner = surligné (jugeable gagnant). */
function MetricRow({
  label,
  sublabel,
  median,
  postCount,
  status,
  maxMedian,
  winner,
}: {
  label: string;
  sublabel?: string;
  median: number | null;
  postCount: number;
  status: "en_test" | "jugeable";
  maxMedian: number;
  winner: boolean;
}) {
  const pct =
    median !== null && maxMedian > 0
      ? Math.max(2, (median / maxMedian) * 100)
      : 0;
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        winner
          ? "border-emerald-300 bg-emerald-50/60"
          : "border-slate-200 bg-white",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {winner && (
            <TrophyIcon className="size-4 shrink-0 text-emerald-600" />
          )}
          <span className="truncate text-sm font-medium text-slate-900">
            {label}
          </span>
          {sublabel && (
            <span className="shrink-0 text-xs text-slate-400">{sublabel}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="tabular-nums text-sm font-semibold text-slate-900">
            {formatNumber(median)}
          </span>
          <StatusBadge status={status} postCount={postCount} />
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            "h-full rounded-full",
            winner ? "bg-emerald-500" : "bg-slate-300",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Indice du gagnant : brique JUGEABLE de médiane max. -1 si aucune jugeable. */
function winnerIndex(rows: { median: number | null; jugeable: boolean }[]): number {
  let best = -1;
  let bestMed = -Infinity;
  rows.forEach((r, i) => {
    if (r.jugeable && r.median !== null && r.median > bestMed) {
      bestMed = r.median;
      best = i;
    }
  });
  return best;
}

function TierSection({ tiers }: { tiers: TierPerf[] }) {
  const rows = tiers.map((t) => ({
    median: t.viewsMedian,
    jugeable: t.status === "jugeable",
  }));
  const wIdx = winnerIndex(rows);
  const maxMedian = Math.max(0, ...tiers.map((t) => t.viewsMedian ?? 0));
  const winner = wIdx >= 0 ? tiers[wIdx] : null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Tiers de hook
        </h2>
      </div>
      {winner && (
        <p className="text-sm text-emerald-700">
          <span className="font-semibold">Tier {winner.tier} surperforme</span>{" "}
          — médiane {formatNumber(winner.viewsMedian)} vues sur{" "}
          {winner.postCount} posts.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {tiers.map((t, i) => (
          <MetricRow
            key={t.tier}
            label={`Tier ${t.tier}`}
            median={t.viewsMedian}
            postCount={t.postCount}
            status={t.status}
            maxMedian={maxMedian}
            winner={i === wIdx}
          />
        ))}
      </div>
    </section>
  );
}

function BrickSection({
  kind,
  bricks,
}: {
  kind: string;
  bricks: BrickPerf[];
}) {
  const rows = bricks.map((b) => ({
    median: b.viewsMedian,
    jugeable: b.status === "jugeable",
  }));
  const wIdx = winnerIndex(rows);
  const maxMedian = Math.max(0, ...bricks.map((b) => b.viewsMedian ?? 0));

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {KIND_LABEL[kind] ?? kind}
      </h2>
      {bricks.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-slate-400">
            Aucune brique active.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {bricks.map((b, i) => (
            <MetricRow
              key={b.brickId}
              label={b.label}
              median={b.viewsMedian}
              postCount={b.postCount}
              status={b.status}
              maxMedian={maxMedian}
              winner={i === wIdx}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ComboSection({ combos }: { combos: ComboPerf[] }) {
  const [open, setOpen] = useState(false);
  const top = combos.slice(0, 20);
  return (
    <section className="space-y-2">
      <Button
        variant="ghost"
        className="h-auto px-0 py-1"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronDownIcon
          className={cn("mr-1 size-4 transition-transform", open && "rotate-180")}
        />
        <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Combos complets ({combos.length})
        </span>
      </Button>
      {open && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            La plupart des combos précis sont sous le seuil ({JUGEABLE_THRESHOLD}
            ) : c&apos;est attendu. « Signal » = jugeable ET au-dessus de la
            médiane de campagne.
          </p>
          {top.map((c) => (
            <div
              key={c.comboKey}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  Tier {c.tier ?? "?"} · {c.fluxLabel} · {c.ctaLabel}
                </p>
                <p className="truncate text-xs text-slate-400">{c.hookLabel}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums text-sm font-semibold text-slate-900">
                  {formatNumber(c.viewsMedian)}
                </span>
                {c.signal ? (
                  <Badge className="shrink-0 gap-1 bg-emerald-600">
                    <SparklesIcon className="size-3" />
                    signal
                  </Badge>
                ) : (
                  <StatusBadge status={c.status} postCount={c.postCount} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
