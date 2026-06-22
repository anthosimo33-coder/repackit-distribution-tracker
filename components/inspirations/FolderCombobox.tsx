"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useProjectQuery, useProjectMutation } from "@/components/project/use-project-convex";
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
import {
  CheckIcon,
  ChevronsUpDownIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
} from "lucide-react";
import { toast } from "sonner";
import { convexErrorMessage } from "@/lib/convex-error";

/**
 * Batch F — adapté de HookCombobox. Liste les folders + permet création
 * inline via CommandItem terminal "+ Créer". La nouvelle valeur est
 * automatiquement sélectionnée après création (UX cohérente avec un
 * select/create combiné).
 */
export function FolderCombobox({
  value,
  onChange,
}: {
  value: Id<"folders"> | null;
  onChange: (folderId: Id<"folders"> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const folders = useProjectQuery(api.folders.listFolders, {});
  const createFolder = useProjectMutation(api.folders.createFolder);

  const selected = folders?.find((f) => f._id === value) ?? null;
  const trimmedQuery = query.trim();
  const exactMatch =
    folders?.some(
      (f) => f.name.toLowerCase() === trimmedQuery.toLowerCase(),
    ) ?? false;
  const showCreateItem =
    trimmedQuery.length > 0 && trimmedQuery.length <= 80 && !exactMatch;

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const newId = await createFolder({ name: trimmedQuery });
      onChange(newId);
      toast.success(`Dossier "${trimmedQuery}" créé`);
      setOpen(false);
      setQuery("");
    } catch (e) {
      toast.error(convexErrorMessage(e, "Une erreur est survenue."));
    } finally {
      setCreating(false);
    }
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
              {selected ? (
                <>
                  <FolderIcon className="size-4 shrink-0 text-slate-500" />
                  <span className="truncate">{selected.name}</span>
                </>
              ) : (
                <>
                  <FolderOpenIcon className="size-4 shrink-0 text-slate-300" />
                  <span className="text-slate-500">Aucun dossier</span>
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
            placeholder="Cherche ou crée un dossier..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {folders === undefined ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {showCreateItem
                    ? "Aucun dossier — crée-le ci-dessous."
                    : "Aucun dossier trouvé."}
                </CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="__none__"
                    onSelect={() => {
                      onChange(null);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <FolderOpenIcon className="size-4 text-slate-400" />
                    <span className="text-slate-600">Aucun dossier</span>
                    {value === null && (
                      <CheckIcon className="ml-auto size-4 opacity-100" />
                    )}
                  </CommandItem>
                  {folders.map((f) => (
                    <CommandItem
                      key={f._id}
                      value={f.name}
                      onSelect={() => {
                        onChange(f._id);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <FolderIcon className="size-4 text-slate-500" />
                      <span className="truncate">{f.name}</span>
                      {value === f._id && (
                        <CheckIcon className="ml-auto size-4 opacity-100" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {showCreateItem && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        value={`__create__${trimmedQuery}`}
                        onSelect={handleCreate}
                        disabled={creating}
                      >
                        <PlusIcon className="size-4 text-slate-700" />
                        <span>Créer &laquo;&nbsp;{trimmedQuery}&nbsp;&raquo;</span>
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
