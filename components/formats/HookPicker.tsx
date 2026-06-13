"use client";

import { useState } from "react";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/command";
import { CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * P6 — sélection des hooks EMBARQUÉS dans un format depuis la biblio du projet.
 * On stocke les TEXTES (le format est auto-suffisant ; le créateur ne voit
 * jamais la biblio). Recherche via api.hooks.listHooks(search).
 */
export function HookPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const hooks = useProjectQuery(
    api.hooks.listHooks,
    search.trim().length > 0 ? { search: search.trim() } : {},
  );

  function toggle(text: string) {
    onChange(
      value.includes(text) ? value.filter((t) => t !== text) : [...value, text],
    );
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1.5">
          {value.map((h) => (
            <li
              key={h}
              className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-1.5 text-sm text-slate-800"
            >
              <span className="flex-1">{h}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((t) => t !== h))}
                aria-label="Retirer le hook"
                className="mt-0.5 text-slate-400 hover:text-slate-700"
              >
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button type="button" variant="outline" size="sm">
              <PlusIcon className="mr-1.5 size-4" />
              Choisir des hooks
            </Button>
          }
        />
        <PopoverContent className="w-[min(28rem,90vw)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Rechercher un hook…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {hooks === undefined ? (
                <div className="p-3 text-sm text-slate-400">Chargement…</div>
              ) : hooks.length === 0 ? (
                <CommandEmpty>Aucun hook.</CommandEmpty>
              ) : (
                <CommandGroup>
                  {hooks.map((h) => {
                    const selected = value.includes(h.text);
                    return (
                      <CommandItem
                        key={h._id}
                        value={h._id}
                        onSelect={() => toggle(h.text)}
                        className="flex items-start gap-2"
                      >
                        <CheckIcon
                          className={cn(
                            "mt-0.5 size-4 shrink-0",
                            selected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="flex-1 text-sm">{h.text}</span>
                        <Badge variant="secondary" className="shrink-0 text-[0.65rem]">
                          {h.langue}
                        </Badge>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
