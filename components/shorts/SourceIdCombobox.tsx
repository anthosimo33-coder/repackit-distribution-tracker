"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeSourceId } from "@/lib/source-id";
import { CheckIcon, ChevronsUpDownIcon, FilmIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SourceIdCombobox — sélection / saisie libre d'un sourceId de Short.
 *
 * Calqué sur IcpCombobox (free-text + autocomplete) MAIS sans mutation create :
 * un sourceId n'est pas une entité à part, il est stocké au moment du save de
 * la publication. La query listSources alimente les suggestions (sourceId déjà
 * utilisés + leur couverture plateforme). Sélectionner un existant OU "Utiliser
 * X" appelle simplement onChange(rawValue).
 *
 * Le matching d'unicité utilise normalizeSourceId (cf serveur) : taper
 * "short_042.mp4" matche un existant "short_042".
 *
 * required=true (nouveaux Shorts) : placeholder explicite. La validation de
 * non-vacuité est portée par l'appelant (étape Hook du modal).
 */
export function SourceIdCombobox({
  value,
  onChange,
  required = false,
  placeholder = "Source (nom de fichier Drive)…",
}: {
  value: string;
  onChange: (newValue: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const sources = useQuery(api.publications.listSources, {});

  const trimmedQuery = query.trim();
  const normalizedQuery = normalizeSourceId(trimmedQuery);
  const exactMatch = useMemo(
    () =>
      (sources ?? []).some((s) => s.sourceId === normalizedQuery) &&
      normalizedQuery !== "",
    [sources, normalizedQuery],
  );
  const showCreateItem = trimmedQuery.length > 0 && !exactMatch;

  function selectValue(raw: string) {
    onChange(raw);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between text-left font-normal"
          >
            <span className="flex items-center gap-2 truncate">
              {value ? (
                <span className="truncate font-mono text-sm">{value}</span>
              ) : (
                <>
                  <FilmIcon className="size-4 shrink-0 text-slate-300" />
                  <span className="text-slate-500">
                    {required ? placeholder : "Aucune source"}
                  </span>
                </>
              )}
            </span>
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent
        className="w-[var(--anchor-width,360px)] min-w-[260px] max-w-[420px] p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder="Cherche ou saisis une source…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {sources === undefined ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {trimmedQuery.length > 0
                    ? "Aucune source existante."
                    : "Tape un nom de source."}
                </CommandEmpty>
                {!required && value !== "" && (
                  <CommandGroup>
                    <CommandItem
                      value="__none__"
                      onSelect={() => selectValue("")}
                    >
                      <FilmIcon className="size-4 text-slate-400" />
                      <span className="text-slate-600">Aucune source</span>
                    </CommandItem>
                  </CommandGroup>
                )}
                <CommandGroup>
                  {(sources ?? []).map((s) => {
                    const covered = [
                      s.coverage.tiktok ? "TikTok" : null,
                      s.coverage.instagram ? "Instagram" : null,
                      s.coverage.youtube ? "YouTube" : null,
                    ].filter((x): x is string => x !== null);
                    return (
                      <CommandItem
                        key={s.sourceId}
                        value={s.sourceId}
                        onSelect={() => selectValue(s.displaySourceId)}
                      >
                        <CheckIcon
                          className={cn(
                            "size-4",
                            normalizeSourceId(value) === s.sourceId
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        <div className="flex-1 truncate">
                          <div className="truncate font-mono text-sm">
                            {s.displaySourceId}
                          </div>
                          <div className="text-xs text-slate-500">
                            Déjà sur {covered.join(", ")} ({s.coverage.total}/3)
                          </div>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                {showCreateItem && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        value={`__create__${trimmedQuery}`}
                        onSelect={() => selectValue(trimmedQuery)}
                      >
                        <PlusIcon className="size-4 text-slate-700" />
                        <span>
                          Utiliser &laquo;&nbsp;{trimmedQuery}&nbsp;&raquo;
                        </span>
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
