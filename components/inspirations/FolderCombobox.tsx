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
import { useTranslations } from "next-intl";

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
  const tr = useTranslations("admin.library.FolderCombobox");
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
    // i18n-exempt: code TypeScript, pas du texte
    trimmedQuery.length > 0 && trimmedQuery.length <= 80 && !exactMatch;

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const newId = await createFolder({ name: trimmedQuery });
      onChange(newId);
      toast.success(tr("dossierCree", { trimmedQuery: trimmedQuery }));
      setOpen(false);
      setQuery("");
    } catch (e) {
      toast.error(convexErrorMessage(e, tr("uneErreurEstSurvenue")));
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
                  <span className="text-slate-500">{tr("aucunDossier")}</span>
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
            placeholder={tr("chercheOuCreeUnDossier")}
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
                    ? tr("aucunDossierCreeLeCi")
                    : tr("aucunDossierTrouve")}
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
                    <span className="text-slate-600">{tr("aucunDossier")}</span>
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
                        <span>{tr("creer", { trimmedQuery: trimmedQuery })}</span>
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
