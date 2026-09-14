"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { VerdictBadge, PlatformBadge } from "@/components/VerdictBadge";
import { FilterSelect } from "@/components/filters/FilterSelect";
import { cn } from "@/lib/utils";
import { formatNumber, formatPercent } from "@/lib/format";
import {
  useSnapshotAge,
  snapshotQueryArgs,
} from "@/components/snapshot-age-selector/SnapshotAgeContext";
import { GitBranchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useIntlLocale } from "@/lib/use-intl-locale";

// P10 — mécanique/niveau (outillage éditorial interne) ne sont plus exposés
// dans l'UI : ni filtres, ni regroupement, ni badges. Les champs restent en
// base sur la table hooks ; cette page ne fait que ne plus les afficher.
const LANGUES = ["FR", "EN"] as const;

type Langue = (typeof LANGUES)[number];

type HookWithUsage = FunctionReturnType<
  typeof api.hooks.listHooksWithUsage
>[number];

const ALL = "all";

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Bibliothèque Hooks (Batch B — ex /hooks renommée /biblio-hooks).
 *
 * Reprend tel quel l'ancienne page /hooks. Seul changement fonctionnel :
 * HookVariantsPopover route désormais vers /carrousels?carouselId= ou
 * /shorts?carouselId= selon le mediaType de la variante (vs /tracker?
 * carouselId=). Évite un double-redirect via /p/[carouselId].
 */
export default function BiblioHooksPage() {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.library.BiblioHooksPage");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [langue, setLangue] = useState<string>("FR");
  const [hideUsed, setHideUsed] = useState(false);
  const [hideDraft, setHideDraft] = useState(false);

  const hooks = useProjectQuery(api.hooks.listHooksWithUsage, {
    search: debouncedSearch || undefined,
    langue: langue === ALL ? undefined : (langue as Langue),
    hideUsed: hideUsed || undefined,
    hideDraft: hideDraft || undefined,
  });
  const totalCount = useProjectQuery(api.hooks.countHooks, {});

  const reset = () => {
    setSearch("");
    setLangue("FR");
    setHideUsed(false);
    setHideDraft(false);
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          {tr("bibliothequeHooks")}
        </h1>
        <p className="text-sm text-slate-500">
          {hooks === undefined || totalCount === undefined
            ? tr("chargement")
            : hooks.length === totalCount
              ? tr("hooks", { count: formatNumber(totalCount, loc) })
              : tr("surHooks", { count: formatNumber(hooks.length, loc), count2: formatNumber(totalCount, loc) })}
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <label
            htmlFor="hook-search"
            className="text-xs font-medium text-slate-600"
          >
            {tr("recherche")}
          </label>
          <Input
            id="hook-search"
            placeholder={tr("texteDuHook")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <FilterSelect
          label={tr("langue")}
          value={langue}
          onChange={setLangue}
          options={[...LANGUES]}
          allLabel={tr("toutes")}
          width="w-[120px]"
        />

        <label className="flex cursor-pointer items-center gap-2 self-end pb-2">
          <Switch
            id="hide-used"
            checked={hideUsed}
            onCheckedChange={setHideUsed}
          />
          <span className="text-sm text-slate-700">{tr("masquerPublies")}</span>
        </label>

        <label className="flex cursor-pointer items-center gap-2 self-end pb-2">
          <Switch
            id="hide-draft"
            checked={hideDraft}
            onCheckedChange={setHideDraft}
          />
          <span className="text-sm text-slate-700">{tr("masquerLesAVenir")}</span>
        </label>

        <Button variant="outline" onClick={reset}>
          {tr("resetFiltres")}
        </Button>
      </div>

      {hooks === undefined ? (
        <LoadingSkeleton />
      ) : hooks.length === 0 ? (
        <EmptyState onReset={reset} />
      ) : (
        // P10 — regroupement par mécanique retiré : liste plate des hooks.
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {hooks.map((h) => (
            <HookCard key={h._id} hook={h} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Badge condensé pour publications publiées sur 1, 2 ou 3 formats.
 * Couleurs : emerald=carousel only, red=short only, indigo=SR only,
 * slate=multi-formats. Pluriel cohérent avec l'usage des autres badges.
 */
// Refinement Shorts — biblio hooks = carrousel only (SR puis Short retirés
// du comptage). Les badges ne reflètent plus que les carrousels.
function PublishedBadge({ carousels }: { carousels: number }) {
  const tr = useTranslations("admin.library.PublishedBadge");
  return (
    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
      {tr("utiliseFois", { carousels: carousels })}
    </Badge>
  );
}

function DraftBadge({ carousels }: { carousels: number }) {
  const tr = useTranslations("admin.library.DraftBadge");
  return (
    <Badge variant="outline" className="text-amber-700">
      {tr("carrAVenir", { carousels: carousels })}
    </Badge>
  );
}

function HookCard({ hook }: { hook: HookWithUsage }) {
  const tr = useTranslations("admin.library.HookCard");
  const projectPath = useProjectPath();
  // Refinement Shorts — biblio hooks = exclusivement carrousel (SR puis
  // Short retirés du comptage). Les badges/variantes Short et SR ne sont
  // plus affichés ; un hook utilisé uniquement en Short apparaît donc
  // comme "non utilisé" ici, ce qui est le comportement voulu.
  const used = hook.publishedCarouselsCount > 0;
  const totalDraft = hook.draftCarouselsCount;

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="flex-1 space-y-2">
          <p className="font-medium text-slate-900">{hook.text}</p>
          <div className="flex flex-wrap gap-1.5">
            {/* P10 — mécanique/niveau retirés ; on garde la langue + usage. */}
            <Badge variant="outline">{hook.langue}</Badge>
            {used && (
              <PublishedBadge carousels={hook.publishedCarouselsCount} />
            )}
            {totalDraft > 0 && (
              <DraftBadge carousels={hook.draftCarouselsCount} />
            )}
            {hook.variantsCountCarousel > 0 && (
              <Badge className="border-violet-200 bg-violet-50 text-violet-700">
                {tr("varianteCarrousel", { variantsCountCarousel: hook.variantsCountCarousel })}
              </Badge>
            )}
          </div>
          {used && <UsageDetail hook={hook} />}
          <div className="flex flex-wrap gap-1">
            {hook.variantsCountCarousel > 0 && (
              <HookVariantsPopover
                hookId={hook._id}
                count={hook.variantsCountCarousel}
                mediaType="carousel"
              />
            )}
          </div>
        </div>
        <Link
          href={projectPath(
            `/dashboard?nouveau=open&format=carousel&hookId=${hook._id}`,
          )}
          className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
        >
          {tr("creerCarrousel")}
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Modif 5 — Popover compact listant les variantes d'un hook.
 *
 * Batch B : route directement vers /carrousels?carouselId= ou /shorts?
 * carouselId= selon mediaType (vs ancien /tracker?carouselId=). Évite le
 * double-hop par la route catch-all /p/[carouselId].
 */
function HookVariantsPopover({
  hookId,
  count,
  mediaType,
}: {
  hookId: Id<"hooks">;
  count: number;
  mediaType: "carousel" | "short" | "screenrecorder";
}) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.library.HookVariantsPopover");
  const [open, setOpen] = useState(false);
  // Cohérence biblio-hooks ↔ tracker : les verdicts des variantes suivent la
  // période d'âge globale (SnapshotAgeSelector), comme le tracker.
  const { age, customDay } = useSnapshotAge();
  const variants = useProjectQuery(
    api.hooks.getHookVariants,
    open
      ? { hookId, mediaType, ...snapshotQueryArgs({ age, customDay }) }
      : "skip",
  );
  const router = useRouter();
  const projectPath = useProjectPath();

  function go(carouselId: string) {
    setOpen(false);
    const route =
      mediaType === "carousel"
        ? "/carrousels"
        : mediaType === "screenrecorder"
          ? "/screenrecorder"
          : "/shorts";
    router.push(projectPath(`${route}?carouselId=${carouselId}`));
  }

  const isShort = mediaType === "short";
  const isScreenRecorder = mediaType === "screenrecorder";
  const triggerLabel = `Voir les ${count} variantes ${
    isScreenRecorder
      ? "ScreenRecorder"
      : isShort
        ? "Shorts"
        : "carrousel"
  }`;
  const triggerColorClass = isScreenRecorder
    ? "text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800"
    : isShort
      ? "text-red-700 hover:bg-red-50 hover:text-red-800"
      : "text-violet-700 hover:bg-violet-50 hover:text-violet-800";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-7 gap-1.5 px-2 text-xs", triggerColorClass)}
          >
            <GitBranchIcon className="size-3.5" />
            {triggerLabel}
          </Button>
        }
      />
      <PopoverContent
        className="max-h-96 w-[420px] overflow-y-auto p-1"
        align="start"
      >
        {variants === undefined ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : variants.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-slate-500">
            {tr("aucuneVariante")}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {variants.map((v, i) => (
              <li key={`${v.carouselId}-${v.plateforme}-${i}`}>
                <button
                  type="button"
                  onClick={() => go(v.carouselId)}
                  className="flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2 text-sm text-slate-900">
                    <span className="font-mono">{v.carouselId}</span>
                    <span className="text-slate-400">·</span>
                    <span className="font-mono text-xs text-slate-600">
                      {v.compte}
                    </span>
                    <span className="text-slate-400">·</span>
                    <PlatformBadge plateforme={v.plateforme} />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {!isShort && !isScreenRecorder && (
                      <>
                        <VerdictBadge verdict={v.verdict} />
                        <span className="tabular-nums">
                          {v.saveRate === null
                            ? "—"
                            : formatPercent(v.saveRate, undefined, loc)}
                        </span>
                        <span className="text-slate-400">·</span>
                      </>
                    )}
                    <span>{formatShortDate(v.datePubli, loc)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function formatShortDate(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
  });
}

function UsageDetail({ hook }: { hook: HookWithUsage }) {
  const loc = useIntlLocale();
  const tr = useTranslations("admin.library.UsageDetail");
  const accounts = hook.accountsUsed;
  const visibleAccounts = accounts.slice(0, 3);
  const extraAccounts = accounts.length - visibleAccounts.length;

  return (
    <div className="space-y-0.5 pt-1 text-xs text-slate-500">
      {accounts.length > 0 && (
        <div>
          <span className="font-mono">{visibleAccounts.join(" · ")}</span>
          {extraAccounts > 0 && (
            <span className="ml-1 text-slate-400">
              {tr("autre", { extraAccounts: extraAccounts })}
            </span>
          )}
        </div>
      )}
      {hook.lastPublishedAt !== null && (
        <div>{tr("dernierePubli", { date: formatLongDate(hook.lastPublishedAt, loc) })}</div>
      )}
    </div>
  );
}

function formatLongDate(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  const tr = useTranslations("admin.library.EmptyState");
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white py-16">
      <p className="text-slate-500">{tr("aucunHookNeCorrespondA")}</p>
      <Button variant="outline" size="sm" onClick={onReset}>
        {tr("resetLesFiltres")}
      </Button>
    </div>
  );
}
