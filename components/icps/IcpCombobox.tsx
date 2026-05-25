"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import { IcpEditDialog } from "./IcpEditDialog";
import { getFolderColor } from "@/lib/folder-colors";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  TargetIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Combobox de sélection d'un ICP, calque IcpCombobox sur PersonneCombobox.
 *
 * Création inline : si le query est non-vide, on crée directement avec
 * nom=query + couleur slate par défaut (un ICP n'a pas de découpage à
 * deviner comme prénom/nom). Si le query est vide, on ouvre le sous-dialog
 * complet (nom + description + color picker). L'ICP créé est sélectionné
 * automatiquement via onChange.
 *
 * required=true (Short) : pas d'option "Aucun ICP" pour forcer la sélection.
 * required=false : option "Aucun ICP" en tête pour reset à null.
 */
export function IcpCombobox({
  value,
  onChange,
  required = false,
}: {
  value: Id<"icps"> | null;
  onChange: (icpId: Id<"icps"> | null) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [subOpen, setSubOpen] = useState(false);

  const icps = useQuery(api.icps.listIcps, {});
  const createIcp = useMutation(api.icps.createIcp);

  const selected = icps?.find((i) => i._id === value) ?? null;
  const trimmedQuery = query.trim();
  const exactMatch =
    icps?.some((i) => i.nom.toLowerCase() === trimmedQuery.toLowerCase()) ??
    false;
  const showCreateItem = !exactMatch;

  async function createDirect(nom: string) {
    if (creating) return;
    setCreating(true);
    try {
      const newId = await createIcp({ nom });
      onChange(newId);
      toast.success(`ICP "${nom}" créé`);
      setOpen(false);
      setQuery("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setCreating(false);
    }
  }

  function handleCreateSelect() {
    if (creating) return;
    if (trimmedQuery.length > 0) {
      void createDirect(trimmedQuery);
      return;
    }
    // Query vide → sous-dialog complet (nom + description + color).
    setOpen(false);
    setQuery("");
    setSubOpen(true);
  }

  const selectedColor = selected ? getFolderColor(selected.color) : null;

  return (
    <>
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
                {selected && selectedColor ? (
                  <>
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        selectedColor.dotClass,
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{selected.nom}</span>
                  </>
                ) : (
                  <>
                    <TargetIcon className="size-4 shrink-0 text-slate-300" />
                    <span className="text-slate-500">
                      {required ? "Sélectionner un ICP" : "Aucun ICP"}
                    </span>
                  </>
                )}
              </span>
              <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          }
        />
        <PopoverContent
          className="w-[var(--anchor-width,360px)] min-w-[260px] max-w-[400px] p-0"
          align="start"
        >
          <Command>
            <CommandInput
              placeholder="Cherche ou crée un ICP..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {icps === undefined ? (
                <div className="space-y-2 p-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : (
                <>
                  <CommandEmpty>Aucun ICP trouvé.</CommandEmpty>
                  <CommandGroup>
                    {!required && (
                      <CommandItem
                        value="__none__"
                        onSelect={() => {
                          onChange(null);
                          setOpen(false);
                          setQuery("");
                        }}
                      >
                        <TargetIcon className="size-4 text-slate-400" />
                        <span className="text-slate-600">Aucun ICP</span>
                        {value === null && (
                          <CheckIcon className="ml-auto size-4 opacity-100" />
                        )}
                      </CommandItem>
                    )}
                    {icps.map((i) => {
                      const color = getFolderColor(i.color);
                      return (
                        <CommandItem
                          key={i._id}
                          value={i.nom}
                          onSelect={() => {
                            onChange(i._id);
                            setOpen(false);
                            setQuery("");
                          }}
                        >
                          <span
                            className={cn(
                              "size-2.5 shrink-0 rounded-full",
                              color.dotClass,
                            )}
                            aria-hidden
                          />
                          <span className="truncate">{i.nom}</span>
                          {value === i._id && (
                            <CheckIcon className="ml-auto size-4 opacity-100" />
                          )}
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
                          onSelect={handleCreateSelect}
                          disabled={creating}
                        >
                          <PlusIcon className="size-4 text-slate-700" />
                          {trimmedQuery.length > 0 ? (
                            <span>
                              Créer &laquo;&nbsp;{trimmedQuery}&nbsp;&raquo;
                            </span>
                          ) : (
                            <span>Créer un ICP</span>
                          )}
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

      <IcpEditDialog
        open={subOpen}
        onOpenChange={setSubOpen}
        mode="create"
        onCreated={(id) => {
          onChange(id);
          setQuery("");
        }}
      />
    </>
  );
}
