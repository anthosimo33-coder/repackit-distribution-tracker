"use client";

import { useState } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
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
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * HookCombobox — extrait de l'ancien app/nouveau/page.tsx (Batch C).
 *
 * Présenté dans son propre fichier pour pouvoir être réutilisé par StepHook
 * du modal Nouveau. Pas de modification de logique vs ancienne version,
 * juste l'extraction.
 */
export function HookCombobox({
  hooks,
  value,
  onChange,
}: {
  hooks: Doc<"hooks">[] | undefined;
  value: Id<"hooks"> | null;
  onChange: (id: Id<"hooks">) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = hooks?.find((h) => h._id === value);

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
            <span className="truncate">
              {selected
                ? selected.text
                : "Sélectionne un hook de la bibliothèque..."}
            </span>
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-w-[600px] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Cherche un hook..." />
          <CommandList>
            {hooks === undefined ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <>
                <CommandEmpty>Aucun hook trouvé.</CommandEmpty>
                <CommandGroup>
                  {hooks.map((h) => (
                    <CommandItem
                      key={h._id}
                      value={h.text}
                      onSelect={() => {
                        onChange(h._id);
                        setOpen(false);
                      }}
                    >
                      <CheckIcon
                        className={cn(
                          "mr-2 size-4",
                          value === h._id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="flex-1">
                        <div className="text-sm">{h.text}</div>
                        {/* P10 — mécanique/niveau retirés de l'UI ; le
                            sous-titre se réduit à la langue du hook. */}
                        <div className="text-xs text-slate-500">{h.langue}</div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
