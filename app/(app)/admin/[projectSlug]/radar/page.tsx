"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { RadarIcon, SlidersHorizontalIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { formatMoney } from "@/lib/format-rate";
import { RadarToday } from "@/components/admin/radar/RadarToday";
import { RadarExplorer, type ExplorerVue } from "@/components/admin/radar/RadarExplorer";
import { RadarRivals } from "@/components/admin/radar/RadarRivals";
import { RadarCreators } from "@/components/admin/radar/RadarCreators";
import { RadarKept } from "@/components/admin/radar/RadarKept";
import { RadarSettings } from "@/components/admin/radar/RadarSettings";
import { useAccentInk, useNow } from "@/components/admin/radar/radar-ui";
import { todayQueue } from "@/convex/radarDisplay";
import { listSince } from "@/convex/radarSignalFilters";

const ONGLETS = ["aujourdhui", "explorer", "concurrents", "createurs", "gardees", "reglages"] as const;
type Onglet = (typeof ONGLETS)[number];

/**
 * Les adresses d'avant la refonte du 09/11/2026 (liens collés, alertes Telegram,
 * favoris) mènent à la nouvelle place de ce qu'elles montraient.
 */
const ANCIENS: Record<string, { onglet: Onglet; vue?: ExplorerVue }> = {
  signaux: { onglet: "explorer", vue: "videos" },
  formats: { onglet: "explorer", vue: "formats" },
  pubs: { onglet: "explorer", vue: "pubs" },
  comptes: { onglet: "reglages" },
  budget: { onglet: "reglages" },
};
/** Paramètres des filtres de vidéos (radarSignalFilters) : un lien qui en porte va dans Explorer. */
const FILTER_PARAMS = ["q", "o", "p", "l", "a", "t", "st", "age", "seuil", "tri"];
const VUES: readonly ExplorerVue[] = ["videos", "formats", "pubs"];

export default function RadarPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <RadarPageInner />
    </Suspense>
  );
}

/**
 * RADAR — veille (ADMIN UNIQUEMENT), refondu le 09/11/2026 en trois endroits,
 * puis deux de plus le 11/11 :
 *  - AUJOURD'HUI : les 12 vidéos à regarder, les formats qui circulent, les
 *    concurrents de la semaine (RadarToday) ;
 *  - EXPLORER : tout, en vidéos, formats ou pubs, avec quatre filtres visibles
 *    (RadarExplorer) ;
 *  - CONCURRENTS : une fiche par app — vidéos, formats, pubs, comptes, réseau
 *    (RadarRivals) ;
 *  - CRÉATEURS (11/11/2026) : les comptes suivis d'une langue, à contacter, avec
 *    tous leurs TikToks relevés (RadarCreators) ;
 *  - GARDÉES (11/11/2026) : les vidéos que l'équipe a gardées (RadarKept) ;
 * et RÉGLAGES à part : apps suivies et budget (RadarSettings). L'onglet vit dans
 * l'adresse (`?onglet=`, `vue=`, `app=`), comme les filtres. L'accès est gardé
 * serveur : un créateur n'atteint aucune fonction Radar.
 */
function RadarPageInner() {
  const tr = useTranslations("admin.ops.RadarPage");
  const loc = useIntlLocale();
  const router = useRouter();
  const projectPath = useProjectPath();
  const searchParams = useSearchParams();
  const now = useNow();
  const ink = useAccentInk();
  const signals = useProjectQuery(api.radarSignals.listSignals, { since: listSince(now) });
  const budget = useProjectQuery(api.radarSignals.getRadarBudget, {});
  const kept = useProjectQuery(api.radarSignals.listKept, {});

  const raw = searchParams.get("onglet") ?? "";
  const ancien = ANCIENS[raw];
  const onglet: Onglet = (ONGLETS as readonly string[]).includes(raw)
    ? (raw as Onglet)
    : ancien
      ? ancien.onglet
      : FILTER_PARAMS.some((p) => searchParams.has(p))
        ? "explorer"
        : "aujourdhui";
  const rawVue = searchParams.get("vue") ?? "";
  const vue: ExplorerVue = (VUES as readonly string[]).includes(rawVue) ? (rawVue as ExplorerVue) : (ancien?.vue ?? "videos");

  const href = (o: Onglet, params?: Record<string, string>) => {
    const p = new URLSearchParams(params);
    if (o !== "aujourdhui") p.set("onglet", o);
    const qs = p.toString();
    return projectPath(qs ? `/radar?${qs}` : "/radar");
  };
  const go = (o: Onglet, params?: Record<string, string>) => router.push(href(o, params), { scroll: true });

  const toWatch = signals ? todayQueue(signals.signals, now).length : null;
  const money = (x: number) => (budget ? formatMoney(x, budget.currency, loc) : "");

  const TABS: { id: Exclude<Onglet, "reglages">; label: string }[] = [
    { id: "aujourdhui", label: tr("aujourdhui") },
    { id: "explorer", label: tr("explorer") },
    { id: "concurrents", label: tr("concurrents") },
    { id: "createurs", label: tr("createurs") },
    { id: "gardees", label: tr("gardees") },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <RadarIcon className="size-5" aria-hidden />
          </span>
          <div className="space-y-0.5">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{tr("radar")}</h1>
            <p className="text-sm text-slate-500">{tr("sousTitre")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {budget && (
            <span className="inline-flex items-center gap-2 text-[13px] text-slate-600" data-testid="radar-etat">
              <span
                className={cn("size-2 rounded-full", budget.jobs.keyPresent && !budget.state.capReached && budget.state.tier === "normal" ? "bg-emerald-600" : "bg-amber-500")}
                aria-hidden
              />
              {!budget.jobs.keyPresent
                ? tr("collecteSansCle")
                : budget.state.capReached
                  ? tr("collectePlafond", { plafond: money(budget.budget.capUsd) })
                  : budget.state.reserveReached
                    ? tr("collecteReserve", { reserve: budget.jobs.creditReserve.toLocaleString(loc) })
                    : budget.state.tier === "survie"
                      ? tr("collecteSurvie")
                      : budget.state.tier === "economie"
                        ? tr("collecteEconomie")
                        : tr("collecteActive", { depense: money(budget.state.spentUsd), plafond: money(budget.budget.capUsd) })}
            </span>
          )}
          <Link
            href={href("reglages")}
            prefetch={false}
            aria-current={onglet === "reglages" ? "page" : undefined}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium",
              onglet === "reglages" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
            )}
          >
            <SlidersHorizontalIcon className="size-4" aria-hidden />
            {tr("reglages")}
          </Link>
        </div>
      </header>

      {onglet !== "reglages" && (
        <nav aria-label={tr("radar")} className="flex flex-wrap gap-1 border-b border-slate-200">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={href(t.id)}
              prefetch={false}
              scroll={false}
              aria-current={onglet === t.id ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3.5 text-[15px]",
                onglet === t.id ? "border-slate-900 font-semibold text-slate-900" : "border-transparent font-medium text-slate-600 hover:text-slate-900",
              )}
            >
              {t.label}
              {t.id === "aujourdhui" && toWatch !== null && toWatch > 0 && (
                <span className={cn("rounded-full bg-primary px-2 py-px text-xs font-bold", ink)} data-testid="radar-badge-aujourdhui">
                  {toWatch}
                </span>
              )}
              {/* Un compte, pas une file à vider : sans la couleur du projet. */}
              {t.id === "gardees" && kept && kept.total > 0 && (
                <span className="rounded-full bg-slate-100 px-2 py-px text-xs font-semibold text-slate-700" data-testid="radar-badge-gardees">
                  {kept.total}
                </span>
              )}
            </Link>
          ))}
        </nav>
      )}

      {onglet === "aujourdhui" && <RadarToday go={go} />}
      {onglet === "explorer" && <RadarExplorer vue={vue} hrefFor={(v) => href("explorer", v === "videos" ? {} : { vue: v })} />}
      {onglet === "concurrents" && <RadarRivals selected={searchParams.get("app")} hrefFor={(slug) => href("concurrents", { app: slug })} overviewHref={href("concurrents")} go={go} />}
      {onglet === "createurs" && <RadarCreators />}
      {onglet === "gardees" && <RadarKept go={go} />}
      {onglet === "reglages" && <RadarSettings backHref={href("aujourdhui")} />}
    </div>
  );
}
