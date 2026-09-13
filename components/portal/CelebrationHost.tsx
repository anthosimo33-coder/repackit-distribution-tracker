"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleCheckBigIcon,
  FlameIcon,
  PartyPopperIcon,
  TrophyIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useCreatorProject } from "@/components/portal/CreatorProjectProvider";
import {
  useMyAssignments,
  useProjectLeaderboard,
} from "@/components/portal/creator-data";
import { Confetti } from "@/components/portal/Confetti";
import {
  celebrate,
  isStreakMilestone,
  onCelebrate,
  type CelebrationPayload,
} from "@/lib/celebrate";
import { haptic } from "@/lib/haptics";
import { onTimeStreak } from "@/lib/on-time-streak";
import { formatMoney } from "@/lib/format-rate";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useTranslations } from "next-intl";

/**
 * L'HÔTE DES CÉLÉBRATIONS — monté UNE fois dans le shell créatrice.
 *
 * Il écoute les réussites émises n'importe où (`lib/celebrate`) et les joue une
 * par une : un éclat de confettis, une carte qui arrive avec un rebond, une
 * vibration. La carte part d'elle-même au bout de quelques secondes ou d'un tap.
 *
 * ⚠️ NON BLOQUANTE, et c'est voulu : ce n'est pas une modale. Pas de fond
 * assombri, pas de `aria-modal`, le reste de l'écran reste cliquable. Une
 * célébration qui empêche de continuer devient une corvée — et masquerait
 * l'écran de confirmation qu'elle accompagne.
 *
 * Deux réussites ne sont émises par aucun geste, parce qu'elles arrivent des
 * données : la place gagnée au classement et le palier de série. Les deux
 * « veilleurs » ci-dessous les détectent en comparant à la dernière valeur VUE
 * sur cet appareil (stockage local) — sans historique serveur, on célèbre ce qui
 * a changé depuis sa dernière visite, jamais une valeur inventée.
 *
 * Jamais monté en observation (« voir son espace ») : rien ne se célèbre à la
 * place de la créatrice, et le stockage local de l'admin n'est pas touché.
 */
type Queued = CelebrationPayload & { id: number };
let seq = 0;
const VISIBLE_MS = 4500;
const MAX_QUEUE = 3;

export function CelebrationHost() {
  const [queue, setQueue] = useState<Queued[]>([]);

  useEffect(
    () =>
      onCelebrate((payload) => {
        seq += 1;
        const id = seq;
        // Au-delà de trois en attente, on laisse tomber : une rafale de fêtes
        // n'en fait plus aucune.
        setQueue((q) => (q.length >= MAX_QUEUE ? q : [...q, { ...payload, id }]));
        haptic("celebrate");
      }),
    [],
  );

  const dismiss = useCallback(
    (id: number) => setQueue((q) => q.filter((x) => x.id !== id)),
    [],
  );
  const head = queue[0];

  useEffect(() => {
    if (!head) return;
    const timer = window.setTimeout(() => dismiss(head.id), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [head, dismiss]);

  return (
    <>
      <RankUpWatcher />
      <StreakWatcher />
      {head && (
        <CelebrationCard key={head.id} payload={head} onClose={() => dismiss(head.id)} />
      )}
    </>
  );
}

function CelebrationCard({
  payload,
  onClose,
}: {
  payload: CelebrationPayload;
  onClose: () => void;
}) {
  const t = useTranslations("portal.celebrate");
  const loc = useIntlLocale();
  const { current } = useCreatorProject();

  let Icon: LucideIcon = PartyPopperIcon;
  let title = "";
  let body = "";
  switch (payload.kind) {
    case "published":
      Icon = PartyPopperIcon;
      title = t("publishedTitle");
      body =
        payload.perVideo && payload.perVideo > 0
          ? t("publishedEarn", {
              amount: formatMoney(payload.perVideo, current.payCurrency, loc),
            })
          : t("publishedNoEarn");
      break;
    case "rankUp":
      Icon = TrophyIcon;
      title = t("rankUpTitle", { rank: payload.rank });
      body = t("rankUpBody", { total: payload.total });
      break;
    case "streak":
      Icon = FlameIcon;
      title = t("streakTitle", { count: payload.count });
      body = t("streakBody");
      break;
    case "warmupDone":
      Icon = CircleCheckBigIcon;
      title = t("warmupDoneTitle");
      body = t("warmupDoneBody", { handle: payload.handle });
      break;
  }
  const subject = payload.kind === "published" ? payload.missionName : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-end justify-center p-4 pb-24 md:items-center md:pb-4">
      <Confetti />
      <div
        role="status"
        aria-live="polite"
        data-testid="celebration"
        data-kind={payload.kind}
        className="animate-pop pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white px-5 pb-5 pt-6 text-center shadow-[0_24px_60px_-20px_rgba(15,23,42,0.35)]"
      >
        <span className="relative mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <span className="absolute inset-0 rounded-full bg-primary/20 motion-safe:animate-ping [animation-iteration-count:1]" />
          <Icon className={payload.kind === "streak" ? "animate-flame size-7" : "size-7"} />
        </span>
        <p className="mt-3 text-lg font-bold tracking-tight text-slate-900">{title}</p>
        {subject && <p className="mt-0.5 truncate text-sm font-medium text-slate-700">{subject}</p>}
        <p className="mt-1 text-sm text-slate-600">{body}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Lecture / écriture tolérantes : un stockage indisponible ne célèbre rien. */
function swapStored(key: string, next: number): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    window.localStorage.setItem(key, String(next));
    const prev = raw === null ? null : Number(raw);
    return prev !== null && Number.isFinite(prev) ? prev : null;
  } catch {
    return null;
  }
}

/**
 * « Tu passes 3e ! » — quand sa place s'améliore par rapport à la dernière vue
 * sur cet appareil. Première visite : on retient la place, on ne fête rien.
 */
function RankUpWatcher() {
  const { current } = useCreatorProject();
  const board = useProjectLeaderboard(current.projectId);

  useEffect(() => {
    const me = board?.find((e) => e.isMe);
    if (!board || !me) return;
    const prev = swapStored(`creator-rank:${current.projectId}`, me.rank);
    if (prev !== null && me.rank < prev) {
      celebrate({ kind: "rankUp", rank: me.rank, total: board.length });
    }
  }, [board, current.projectId]);

  return null;
}

/** Palier de série (3, 5, 10…) atteint depuis la dernière valeur vue. */
function StreakWatcher() {
  const { current } = useCreatorProject();
  const assignments = useMyAssignments(current.projectId);
  const [now] = useState(() => Date.now());
  const streak = useMemo(
    () => (assignments ? onTimeStreak(assignments, now).current : null),
    [assignments, now],
  );

  useEffect(() => {
    if (streak === null) return;
    const prev = swapStored(`creator-streak:${current.projectId}`, streak);
    if (prev !== null && streak > prev && isStreakMilestone(streak)) {
      celebrate({ kind: "streak", count: streak });
    }
  }, [streak, current.projectId]);

  return null;
}
