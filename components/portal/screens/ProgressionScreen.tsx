"use client";

import Link from "next/link";
import {
  ArrowLeftIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  TrophyIcon,
} from "lucide-react";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import { usePortalBase } from "@/components/portal/ViewAsContext";
import { useMyProgression } from "@/components/portal/creator-data";
import {
  buildProgression,
  type ProgressionReward,
  type LadderEntry,
  type ProgressionVictory,
} from "@/lib/progression";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatMoney, formatViews } from "@/lib/format-rate";
import { formatDate } from "@/lib/format";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";

/**
 * Écran « Ma progression » (route POUSSÉE /app/progression, pas un onglet) —
 * RÉUTILISÉ par le portail créateur ET le mode admin « voir l'espace ». Plein
 * format : hero vues cumulées → prochain palier, échelle des récompenses DU
 * PROJET (config, jamais en dur), victoires. Purement en lecture (aucune
 * mutation) → identique en view-as, seules les données sont scopées.
 */
export default function ProgressionScreen() {
  const { current } = useCreatorProject();
  // Devise de la paie créatrices ($ Snytch ; null → sans symbole), threadée aux
  // sous-composants (Hero, échelle) qui rendent des montants cash.
  const payCurrency = current.payCurrency;
  const base = usePortalBase();
  const raw = useMyProgression(current.projectId);
  const p = raw ? buildProgression(raw) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={base}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeftIcon className="size-4" />
        Retour
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Ma progression
        </h1>
        <p className="text-sm text-slate-500">
          Tes vues cumulées débloquent les récompenses de {current.name}.
        </p>
      </header>

      {raw === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : p === null ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-500">
            Ta progression apparaîtra ici dès tes premières vues.
          </CardContent>
        </Card>
      ) : (
        <>
          <Hero p={p} currency={payCurrency} />
          <LadderSection ladder={p.ladder} currency={payCurrency} />
          <VictoriesSection victories={p.victories} />
        </>
      )}
    </div>
  );
}

type P = NonNullable<ReturnType<typeof buildProgression>>;

/** Hero : vues cumulées → jauge vers le prochain palier (accent projet). */
function Hero({ p, currency }: { p: P; currency?: string | null }) {
  const loc = useIntlLocale();
  const t = useTranslations("portal");
  const pct = Math.round(p.progressToNext * 100);
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-4 py-6">
        <div className="space-y-0.5 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Vues cumulées
          </p>
          <p
            className="text-4xl font-semibold tabular-nums text-slate-900"
            data-testid="progression-cumul"
          >
            {formatViews(p.cumulViews, loc)}
          </p>
        </div>

        {p.nextReward ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-slate-500">{t("progression.nextTier")}</span>
              <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                <RewardLabel reward={p.nextReward} currency={currency} />
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-primary/10">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
                data-testid="progression-bar"
              />
            </div>
            <p className="text-xs text-slate-500">
              Plus que{" "}
              <span className="font-semibold tabular-nums text-slate-700">
                {formatViews(p.remainingViews, loc)}
              </span>{" "}
              vues.
            </p>
          </div>
        ) : (
          <p className="text-center text-sm font-medium text-primary">
            Tous les paliers sont débloqués 🎉
          </p>
        )}

        {(p.cashUnlockedTotal > 0 || p.itemsUnlocked.length > 0) && (
          <div className="flex flex-wrap justify-center gap-1.5 border-t border-primary/15 pt-3">
            {p.cashUnlockedTotal > 0 && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                + {formatMoney(p.cashUnlockedTotal, currency, loc)} débloqués
              </span>
            )}
            {p.itemsUnlocked.map((r, i) => (
              <span
                key={i}
                className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary"
              >
                {r.emoji} {r.label}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Échelle des récompenses du projet (débloqué / en cours / à venir). */
function LadderSection({
  ladder,
  currency,
}: {
  ladder: LadderEntry[];
  currency?: string | null;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Échelle des récompenses
      </h2>
      {ladder.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-500">
            Pas encore de paliers de récompense sur ce projet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-slate-100 p-0">
            {ladder.map((entry, i) => {
              // « En cours » = le premier palier non débloqué (le prochain).
              const isCurrent =
                !entry.unlocked && ladder.slice(0, i).every((e) => e.unlocked);
              return (
                <LadderRow
                  key={entry.threshold}
                  entry={entry}
                  current={isCurrent}
                  currency={currency}
                />
              );
            })}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function LadderRow({
  entry,
  current,
  currency,
}: {
  entry: LadderEntry;
  current: boolean;
  currency?: string | null;
}) {
  const loc = useIntlLocale();
  const Icon = entry.unlocked
    ? CircleCheckIcon
    : current
      ? CircleDashedIcon
      : CircleIcon;
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3",
        current && "bg-primary/5",
      )}
      data-testid="ladder-row"
    >
      <Icon
        className={cn(
          "size-5 shrink-0",
          entry.unlocked
            ? "text-primary"
            : current
              ? "text-primary"
              : "text-slate-300",
        )}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm font-medium",
            entry.unlocked || current ? "text-slate-900" : "text-slate-500",
          )}
        >
          <RewardLabel reward={entry.reward} currency={currency} />
        </p>
        <p className="text-xs text-slate-400">
          {formatViews(entry.threshold, loc)} vues
          {entry.unlocked && entry.unlockedAt
            ? ` · débloqué le ${formatDate(entry.unlockedAt, loc)}`
            : ""}
        </p>
      </div>
      {entry.unlocked ? (
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
          Débloqué
        </span>
      ) : current ? (
        <span className="shrink-0 rounded-full border border-primary/30 px-2 py-0.5 text-xs font-semibold text-primary">
          En cours
        </span>
      ) : null}
    </div>
  );
}

/** Victoires (badges légers, dérivés à la lecture). */
function VictoriesSection({ victories }: { victories: ProgressionVictory[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Tes victoires
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {victories.map((v) => (
          <div
            key={v.id}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl px-3 py-4 text-center ring-1",
              v.achieved
                ? "bg-primary/5 ring-primary/20"
                : "bg-slate-50 ring-transparent",
            )}
            data-testid="victory"
            data-achieved={v.achieved}
          >
            <span
              className={cn(
                "text-2xl",
                v.achieved ? "" : "opacity-40 grayscale",
              )}
              aria-hidden
            >
              {v.emoji}
            </span>
            <span
              className={cn(
                "text-xs font-medium leading-tight",
                v.achieved ? "text-slate-900" : "text-slate-400",
              )}
            >
              {v.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Libellé d'une récompense : cash → $, item → emoji + label. */
function RewardLabel({
  reward,
  currency,
}: {
  reward: ProgressionReward;
  currency?: string | null;
}) {
  const loc = useIntlLocale();
  if (reward.kind === "cash") {
    return (
      <>
        <TrophyIcon className="size-3.5 text-primary" aria-hidden />
        {formatMoney(reward.amount, currency, loc)}
      </>
    );
  }
  return (
    <>
      <span aria-hidden>{reward.emoji}</span>
      {reward.label}
    </>
  );
}
