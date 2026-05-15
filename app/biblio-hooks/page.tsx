"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
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
import { FilterMultiSelect } from "@/components/filters/FilterMultiSelect";
import { cn } from "@/lib/utils";
import { formatNumber, formatPercent } from "@/lib/format";
import { GitBranchIcon } from "lucide-react";

const MECANIQUES = [
  "Erreur",
  "Volume",
  "Comparaison",
  "Contradiction",
  "Universalité",
  "Question",
] as const;
const NIVEAUX = ["Broad-A", "Broad-B", "Niché"] as const;
const LANGUES = ["FR", "EN"] as const;

type Mecanique = (typeof MECANIQUES)[number];
type Niveau = (typeof NIVEAUX)[number];
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
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [mecanique, setMecanique] = useState<Set<string>>(new Set());
  const [niveau, setNiveau] = useState<Set<string>>(new Set());
  const [langue, setLangue] = useState<string>("FR");
  const [hideUsed, setHideUsed] = useState(false);
  const [hideDraft, setHideDraft] = useState(false);

  const hooks = useQuery(api.hooks.listHooksWithUsage, {
    search: debouncedSearch || undefined,
    mecanique:
      mecanique.size === 0
        ? undefined
        : (Array.from(mecanique) as Mecanique[]),
    niveau:
      niveau.size === 0 ? undefined : (Array.from(niveau) as Niveau[]),
    langue: langue === ALL ? undefined : (langue as Langue),
    hideUsed: hideUsed || undefined,
    hideDraft: hideDraft || undefined,
  });
  const totalCount = useQuery(api.hooks.countHooks);

  const reset = () => {
    setSearch("");
    setMecanique(new Set());
    setNiveau(new Set());
    setLangue("FR");
    setHideUsed(false);
    setHideDraft(false);
  };

  const grouped = hooks
    ? MECANIQUES.map((m) => ({
        mecanique: m,
        items: hooks.filter((h) => h.mecanique === m),
      })).filter((g) => g.items.length > 0)
    : [];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Bibliothèque Hooks
        </h1>
        <p className="text-sm text-slate-500">
          {hooks === undefined || totalCount === undefined
            ? "Chargement..."
            : hooks.length === totalCount
              ? `${formatNumber(totalCount)} hooks`
              : `${formatNumber(hooks.length)} sur ${formatNumber(totalCount)} hooks`}
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <label
            htmlFor="hook-search"
            className="text-xs font-medium text-slate-600"
          >
            Recherche
          </label>
          <Input
            id="hook-search"
            placeholder="Texte du hook..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <FilterMultiSelect
          label="Mécanique"
          selectedValues={mecanique}
          onChange={setMecanique}
          options={MECANIQUES.map((m) => ({ value: m, label: m }))}
          allLabel="Toutes"
          width="w-[180px]"
        />

        <FilterMultiSelect
          label="Niveau"
          selectedValues={niveau}
          onChange={setNiveau}
          options={NIVEAUX.map((n) => ({ value: n, label: n }))}
          allLabel="Tous"
          width="w-[140px]"
        />

        <FilterSelect
          label="Langue"
          value={langue}
          onChange={setLangue}
          options={[...LANGUES]}
          allLabel="Toutes"
          width="w-[120px]"
        />

        <label className="flex cursor-pointer items-center gap-2 self-end pb-2">
          <Switch
            id="hide-used"
            checked={hideUsed}
            onCheckedChange={setHideUsed}
          />
          <span className="text-sm text-slate-700">Masquer publiés</span>
        </label>

        <label className="flex cursor-pointer items-center gap-2 self-end pb-2">
          <Switch
            id="hide-draft"
            checked={hideDraft}
            onCheckedChange={setHideDraft}
          />
          <span className="text-sm text-slate-700">Masquer les à venir</span>
        </label>

        <Button variant="outline" onClick={reset}>
          Reset filtres
        </Button>
      </div>

      {hooks === undefined ? (
        <LoadingSkeleton />
      ) : hooks.length === 0 ? (
        <EmptyState onReset={reset} />
      ) : (
        <div className="space-y-8">
          {grouped.map((group) => (
            <section key={group.mecanique} className="space-y-3">
              <h2 className="text-lg font-semibold text-slate-800">
                {group.mecanique}
                <span className="ml-2 text-sm font-normal text-slate-500">
                  ({group.items.length})
                </span>
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {group.items.map((h) => (
                  <HookCard key={h._id} hook={h} />
                ))}
              </div>
            </section>
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
function PublishedBadge({
  carousels,
  shorts,
}: {
  carousels: number;
  shorts: number;
}) {
  // Refinement SR — retour à 2 formats (SR retiré du comptage biblio).
  // Couleurs : emerald=carousel only, red=short only, slate=les 2.
  const activeFormats = [carousels > 0, shorts > 0].filter(Boolean).length;

  if (activeFormats === 1) {
    if (carousels > 0)
      return (
        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
          Utilisé {carousels} {carousels > 1 ? "fois" : "fois"}
        </Badge>
      );
    return (
      <Badge className="border-red-200 bg-red-50 text-red-700">
        Utilisé {shorts} fois en Short
      </Badge>
    );
  }
  // 2 formats : badge mixte slate.
  return (
    <Badge className="border-slate-300 bg-slate-100 text-slate-700">
      {carousels} carr.{carousels > 1 ? "" : ""} ·{" "}
      {shorts} Short{shorts > 1 ? "s" : ""}
    </Badge>
  );
}

function DraftBadge({
  carousels,
  shorts,
}: {
  carousels: number;
  shorts: number;
}) {
  const parts: string[] = [];
  if (carousels > 0) parts.push(`+${carousels} carr.`);
  if (shorts > 0)
    parts.push(`+${shorts} Short${shorts > 1 ? "s" : ""}`);
  return (
    <Badge variant="outline" className="text-amber-700">
      {parts.join(" · ")} à venir
    </Badge>
  );
}

function HookCard({ hook }: { hook: HookWithUsage }) {
  // Refinement SR — ScreenRecorder retiré du comptage biblio hooks. Le
  // concept "hook" n'existe plus pour SR (étape Hook skip dans modal
  // nouveau). Les badges SR (indigo) et le 3e bouton popover variantes
  // SR sont retirés. Justification : un SR ne mérite pas d'apparaître
  // dans la biblio hooks car il n'a pas de "hook" sémantiquement.
  const totalPublished =
    hook.publishedCarouselsCount + hook.publishedShortsCount;
  const totalDraft = hook.draftCarouselsCount + hook.draftShortsCount;
  const used = totalPublished > 0;

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="flex-1 space-y-2">
          <p className="font-medium text-slate-900">{hook.text}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{hook.mecanique}</Badge>
            <Badge variant="outline">{hook.niveau}</Badge>
            <Badge variant="outline">{hook.langue}</Badge>
            {used && (
              <PublishedBadge
                carousels={hook.publishedCarouselsCount}
                shorts={hook.publishedShortsCount}
              />
            )}
            {totalDraft > 0 && (
              <DraftBadge
                carousels={hook.draftCarouselsCount}
                shorts={hook.draftShortsCount}
              />
            )}
            {hook.variantsCountCarousel > 0 && (
              <Badge className="border-violet-200 bg-violet-50 text-violet-700">
                {hook.variantsCountCarousel} variante
                {hook.variantsCountCarousel > 1 ? "s" : ""} carrousel
              </Badge>
            )}
            {hook.variantsCountShort > 0 && (
              <Badge className="border-red-200 bg-red-50 text-red-700">
                {hook.variantsCountShort} variante
                {hook.variantsCountShort > 1 ? "s" : ""} Short
                {hook.variantsCountShort > 1 ? "s" : ""}
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
            {hook.variantsCountShort > 0 && (
              <HookVariantsPopover
                hookId={hook._id}
                count={hook.variantsCountShort}
                mediaType="short"
              />
            )}
          </div>
        </div>
        <Link
          href={`/nouveau?hookId=${hook._id}`}
          className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
        >
          Créer carrousel →
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
  const [open, setOpen] = useState(false);
  const variants = useQuery(
    api.hooks.getHookVariants,
    open ? { hookId, mediaType } : "skip",
  );
  const router = useRouter();

  function go(carouselId: string) {
    setOpen(false);
    const route =
      mediaType === "carousel"
        ? "/carrousels"
        : mediaType === "screenrecorder"
          ? "/screenrecorder"
          : "/shorts";
    router.push(`${route}?carouselId=${carouselId}`);
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
            Aucune variante.
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
                            : formatPercent(v.saveRate)}
                        </span>
                        <span className="text-slate-400">·</span>
                      </>
                    )}
                    <span>{formatShortDate(v.datePubli)}</span>
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

function formatShortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

function UsageDetail({ hook }: { hook: HookWithUsage }) {
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
              +{extraAccounts} autre{extraAccounts > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}
      {hook.lastPublishedAt !== null && (
        <div>Dernière publi : {formatLongDate(hook.lastPublishedAt)}</div>
      )}
    </div>
  );
}

function formatLongDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("fr-FR", {
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
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white py-16">
      <p className="text-slate-500">Aucun hook ne correspond à ces filtres.</p>
      <Button variant="outline" size="sm" onClick={onReset}>
        Reset les filtres
      </Button>
    </div>
  );
}
