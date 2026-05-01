"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { FilterSelect } from "@/components/filters/FilterSelect";
import { FilterMultiSelect } from "@/components/filters/FilterMultiSelect";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

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

export default function HooksPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  // Multi-select v2 : Set vide = "tous". Langue reste single-select.
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
          Bibliothèque hooks
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

function HookCard({ hook }: { hook: HookWithUsage }) {
  const used = hook.publishedCount > 0;
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
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                Utilisé {hook.publishedCount}{" "}
                {hook.publishedCount > 1 ? "fois" : "fois"}
              </Badge>
            )}
            {hook.draftCount > 0 && (
              <Badge variant="outline" className="text-amber-700">
                +{hook.draftCount} à venir
              </Badge>
            )}
            {hook.variantsCount > 0 && (
              <Badge className="border-violet-200 bg-violet-50 text-violet-700">
                {hook.variantsCount} variante{hook.variantsCount > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          {used && <UsageDetail hook={hook} />}
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

function UsageDetail({ hook }: { hook: HookWithUsage }) {
  // Pas de badge "Frais" pour les hooks à publishedCount=0 (95% des cards) :
  // l'absence de badge "Utilisé" porte déjà cette info, et ajouter un badge
  // partout serait du bruit visuel.
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
