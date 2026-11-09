"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BookmarkIcon, PenLineIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { useProject } from "@/components/project/ProjectProvider";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";
import { formatCount, formatOutlierRatio } from "@/components/admin/radar/radar-format";
import { inkOn } from "@/lib/accent-ink";
import { curveOf, originalSoundOf, scoreOf, sharesWell, sparklinePoints } from "@/convex/radarDisplay";
import type { SignalStatus } from "@/convex/radarSignalFilters";

export type RadarSignal = FunctionReturnType<typeof api.radarSignals.listSignals>["signals"][number];

/**
 * L'encre lisible sur la couleur du projet (`bg-primary`) : blanche sur le violet
 * de Snytch, noire sur le rose de BLUSH ou l'orange par défaut (lib/accent-ink).
 */
export function useAccentInk(): string {
  const { project } = useProject();
  return inkOn(project.accentColor || "#FF5200") === "light" ? "text-white" : "text-slate-950";
}

/** Une étiquette à la couleur du projet (score, « concurrent », « poussé par un concurrent »). */
export function AccentTag({ children, className }: { children: React.ReactNode; className?: string }) {
  const ink = useAccentInk();
  return <span className={cn("rounded-md bg-primary font-bold", ink, className)}>{children}</span>;
}

/** Un lien d'action du Radar : texte sombre (lisible), souligné à la couleur du projet. */
export const ACCENT_LINK = "font-semibold text-slate-900 underline decoration-primary decoration-2 underline-offset-4 hover:decoration-slate-900";

/**
 * Le score d'une vidéo, le même partout : « 286× » = 286 fois ce que son compte
 * fait d'habitude ; « 12× abonnés » quand on ne connaît pas encore sa normale.
 */
export function ScoreBadge({ s, size = "md", className }: { s: Pick<RadarSignal, "multiplier" | "ratio">; size?: "sm" | "md" | "lg"; className?: string }) {
  const tr = useTranslations("admin.ops.RadarUi");
  const loc = useIntlLocale();
  const ink = useAccentInk();
  const { value, basis } = scoreOf(s);
  const x = formatOutlierRatio(value, loc);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md bg-primary font-bold",
        ink,
        size === "sm" ? "px-1.5 py-0.5 text-xs" : size === "lg" ? "px-2.5 py-1 text-2xl" : "px-2 py-0.5 text-[13px]",
        className,
      )}
      title={basis === "normale" ? tr("scoreNormaleAide", { x }) : tr("scoreAbonnesAide", { x })}
      data-testid="radar-score"
    >
      {x}
      {basis === "abonnes" && <span className="font-semibold">{tr("abonnesCourt")}</span>}
    </span>
  );
}

/** La courbe des vues en petit : de la publication au dernier relevé. */
export function Sparkline({ s, className }: { s: Pick<RadarSignal, "snapshots" | "publishedAt">; className?: string }) {
  const tr = useTranslations("admin.ops.RadarUi");
  const pts = sparklinePoints(curveOf(s.snapshots, s.publishedAt), 74, 26);
  if (!pts) return null;
  return (
    <svg width="74" height="26" viewBox="0 0 74 26" role="img" aria-label={tr("courbeDesVues")} className={className}>
      <polyline points={pts} fill="none" className="stroke-primary" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Miniature de la vidéo (signée, peut expirer) : repli sur un fond sombre. */
export function SignalThumb({ s, className, children }: { s: Pick<RadarSignal, "coverUrl">; className?: string; children?: React.ReactNode }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={cn("relative block overflow-hidden bg-stone-900 text-white", className)}>
      {s.coverUrl && !broken && (
        // eslint-disable-next-line @next/next/no-img-element -- miniature TikTok signée, hors domaine optimisable
        <img src={s.coverUrl} alt="" loading="lazy" onError={() => setBroken(true)} className="absolute inset-0 size-full object-cover opacity-60" />
      )}
      {children}
    </span>
  );
}

/** Le texte qui dit le format : le texte à l'écran, sinon la légende, sinon le compte. */
export const signalTitle = (s: Pick<RadarSignal, "hook" | "caption" | "handle">) => s.hook || s.caption || `@${s.handle}`;

/**
 * Passer, garder, mettre « à adapter » : le statut de l'équipe du projet sur une
 * vidéo, avec « Annuler » dans le message. Renvoie false si l'écriture a échoué.
 */
export function useSignalStatus() {
  const tr = useTranslations("admin.ops.RadarUi");
  const mark = useProjectMutation(api.radarSignals.markSignal);
  const { project } = useProject();
  const showError = useConvexError();
  return async function setStatus(s: RadarSignal, status: SignalStatus): Promise<boolean> {
    const prev = s.status;
    if (prev === status) return true;
    try {
      await mark({ signalId: s.id, status });
    } catch (err) {
      toast.error(showError(err, tr("statutImpossible")));
      return false;
    }
    const message =
      status === "ignore"
        ? tr("passee", { handle: s.handle })
        : status === "enregistre"
          ? tr("gardee", { handle: s.handle })
          : status === "adapte"
            ? tr("aAdapter", { handle: s.handle, projet: project.name })
            : tr("remiseANouveau", { handle: s.handle });
    toast(message, {
      action: {
        label: tr("annuler"),
        onClick: () => {
          void mark({ signalId: s.id, status: prev });
        },
      },
    });
    return true;
  };
}

/** Les trois gestes sur une vidéo, en petit (cartes et lignes). */
export function SignalActions({ s, onStatus, compact = false }: { s: RadarSignal; onStatus: (st: SignalStatus) => void; compact?: boolean }) {
  const tr = useTranslations("admin.ops.RadarUi");
  const { project } = useProject();
  const kept = s.status === "enregistre";
  const adapting = s.status === "adapte";
  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        aria-pressed={adapting}
        onClick={() => onStatus(adapting ? "nouveau" : "adapte")}
        aria-label={tr("adapterPourDe", { projet: project.name, handle: s.handle })}
        className={cn(
          "inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold",
          adapting ? "border border-slate-900 bg-white text-slate-900" : "bg-slate-900 text-white",
          compact && "flex-none",
        )}
      >
        <PenLineIcon className="size-3.5" aria-hidden />
        {adapting ? tr("aAdapterCourt") : tr("adapter")}
      </button>
      <button
        type="button"
        aria-pressed={kept}
        aria-label={kept ? tr("nePlusGarder", { handle: s.handle }) : tr("garderDe", { handle: s.handle })}
        onClick={() => onStatus(kept ? "nouveau" : "enregistre")}
        className={cn("flex min-h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white", kept ? "border-slate-900" : "border-slate-300")}
      >
        <BookmarkIcon className={cn("size-4", kept && "fill-slate-900")} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={tr("passerDe", { handle: s.handle })}
        onClick={() => onStatus("ignore")}
        className="flex min-h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600"
      >
        <XIcon className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Le nom d'un format pour un humain : le texte à l'écran entre guillemets, ou le
 * son — « Son original de @georgiaspamming » plutôt que « original sound - georgiaspamming ».
 */
export function useFormatLabel() {
  const tr = useTranslations("admin.ops.RadarUi");
  return (f: { kind: "hook" | "sound"; label: string }) => {
    if (f.kind === "hook") return tr("hookCite", { hook: f.label });
    const handle = originalSoundOf(f.label);
    return handle ? tr("sonOriginalDe", { handle }) : f.label;
  };
}

/** L'heure de l'écran, qui avance chaque minute (âges, « aujourd'hui »). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** « il y a 5 h » / « il y a 3 j ». */
export function useAge() {
  const tr = useTranslations("admin.ops.RadarUi");
  return (publishedAt: number, now: number) => {
    const h = Math.max(0, Math.round((now - publishedAt) / 3_600_000));
    return h < 24 ? tr("ilYAHeures", { n: h }) : tr("ilYAJours", { n: Math.floor(h / 24) });
  };
}

/**
 * Une vidéo en carte (Aujourd'hui, fiche d'un concurrent) : la miniature avec le
 * texte à l'écran, le score, l'app, la langue ; les vues, la courbe ; les gestes.
 */
export function SignalCard({
  s,
  now,
  onOpen,
  onStatus,
  showActions = true,
}: {
  s: RadarSignal;
  now: number;
  onOpen: () => void;
  onStatus: (st: SignalStatus) => void;
  showActions?: boolean;
}) {
  const tr = useTranslations("admin.ops.RadarUi");
  const loc = useIntlLocale();
  const age = useAge();
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="radar-signal">
      <button type="button" onClick={onOpen} aria-label={tr("regarderDe", { handle: s.handle })} className="block text-left">
        <SignalThumb s={s} className="flex h-56 flex-col justify-end p-3.5">
          <span className="absolute inset-x-2.5 top-2.5 flex flex-wrap gap-1.5">
            <ScoreBadge s={s} />
            {s.app && (
              <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", s.competitor ? "bg-white text-slate-900" : "bg-black/50 text-white")}>
                {s.competitor ? tr("appConcurrent", { app: s.app }) : s.app}
              </span>
            )}
            <span className="rounded-md bg-black/50 px-2 py-0.5 text-xs font-semibold text-white">{tr(`langue.${s.lang}` as Parameters<typeof tr>[0])}</span>
            {s.platform === "instagram" && <span className="rounded-md bg-fuchsia-600 px-2 py-0.5 text-xs font-semibold text-white">{tr("instagram")}</span>}
            {sharesWell(s) && (
              <span className="rounded-md bg-white px-2 py-0.5 text-xs font-semibold text-slate-900" data-testid="radar-se-partage">
                {tr("sePartage")}
              </span>
            )}
          </span>
          <span className="relative line-clamp-5 text-[15px] font-semibold leading-snug [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">{signalTitle(s)}</span>
        </SignalThumb>
      </button>
      <div className="flex flex-1 flex-col gap-2 px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-semibold">{tr("vues", { n: formatCount(s.views, loc) })}</span>
          <Sparkline s={s} />
        </div>
        <p className="truncate text-[13px] text-slate-500">
          @{s.handle} · {age(s.publishedAt, now)}
        </p>
        {s.network && (
          <p className="truncate text-xs text-slate-500" data-testid="radar-reseau-seul">
            {tr("compteSuiviPour", { app: s.network })}
          </p>
        )}
        {showActions && (
          <div className="mt-auto pt-1">
            <SignalActions s={s} onStatus={onStatus} />
          </div>
        )}
      </div>
    </article>
  );
}
