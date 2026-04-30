"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [mecanique, setMecanique] = useState<string>(ALL);
  const [niveau, setNiveau] = useState<string>(ALL);
  const [langue, setLangue] = useState<string>("FR");

  const hooks = useQuery(api.hooks.listHooks, {
    search: debouncedSearch || undefined,
    mecanique: mecanique === ALL ? undefined : (mecanique as Mecanique),
    niveau: niveau === ALL ? undefined : (niveau as Niveau),
    langue: langue === ALL ? undefined : (langue as Langue),
  });

  const reset = () => {
    setSearch("");
    setMecanique(ALL);
    setNiveau(ALL);
    setLangue("FR");
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
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Bibliothèque hooks
        </h1>
        <p className="text-sm text-slate-500">
          {hooks === undefined
            ? "Chargement..."
            : `${hooks.length} hook${hooks.length > 1 ? "s" : ""} affiché${hooks.length > 1 ? "s" : ""}`}
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

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-600">Mécanique</label>
          <Select value={mecanique} onValueChange={setMecanique}>
            <SelectTrigger className="w-[180px]">
              <SelectValue>{mecanique === ALL ? "Toutes" : mecanique}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Toutes</SelectItem>
              {MECANIQUES.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-600">Niveau</label>
          <Select value={niveau} onValueChange={setNiveau}>
            <SelectTrigger className="w-[140px]">
              <SelectValue>{niveau === ALL ? "Tous" : niveau}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tous</SelectItem>
              {NIVEAUX.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-slate-600">Langue</label>
          <Select value={langue} onValueChange={setLangue}>
            <SelectTrigger className="w-[120px]">
              <SelectValue>{langue === ALL ? "Toutes" : langue}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Toutes</SelectItem>
              {LANGUES.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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

function HookCard({ hook }: { hook: Doc<"hooks"> }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="flex-1 space-y-2">
          <p className="font-medium text-slate-900">{hook.text}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{hook.mecanique}</Badge>
            <Badge variant="outline">{hook.niveau}</Badge>
            <Badge variant="outline">{hook.langue}</Badge>
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

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white"
        />
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
