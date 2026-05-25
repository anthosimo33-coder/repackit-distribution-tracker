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
import { PersonneEditDialog } from "./PersonneEditDialog";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  UserIcon,
  UserPlusIcon,
  UserXIcon,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Combobox de sélection d'un gestionnaire (personne), adapté de
 * FolderCombobox. Permet la création inline.
 *
 * Décision split prénom/nom : l'espace fait office de séparateur. Si le
 * query contient un espace, on crée directement (premier mot = prénom, le
 * reste = nom) sans friction. Sinon (un seul mot, ou query vide), on ouvre
 * un sous-dialog à 2 champs car on ne peut pas deviner le découpage — le
 * prénom y est prérempli quand un mot a été saisi. Heuristique simple,
 * affinable après usage réel.
 *
 * La personne créée (split direct ou sous-dialog) est sélectionnée
 * automatiquement via onChange.
 */
export function PersonneCombobox({
  value,
  onChange,
}: {
  value: Id<"personnes"> | null;
  onChange: (personneId: Id<"personnes"> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [subPrenom, setSubPrenom] = useState("");
  const [subNom, setSubNom] = useState("");

  const personnes = useQuery(api.personnes.listPersonnes, {});
  const createPersonne = useMutation(api.personnes.createPersonne);

  const selected = personnes?.find((p) => p._id === value) ?? null;
  const trimmedQuery = query.trim();
  const exactMatch =
    personnes?.some(
      (p) =>
        `${p.prenom} ${p.nom}`.toLowerCase() === trimmedQuery.toLowerCase(),
    ) ?? false;
  // Item "+ Créer" terminal toujours présent (sauf doublon exact pour éviter
  // une création vouée à l'erreur dedupe).
  const showCreateItem = !exactMatch;

  function openSubDialog(prenom: string, nom: string) {
    setSubPrenom(prenom);
    setSubNom(nom);
    setOpen(false);
    setQuery("");
    setSubOpen(true);
  }

  async function createDirect(prenom: string, nom: string) {
    if (creating) return;
    setCreating(true);
    try {
      const newId = await createPersonne({ prenom, nom });
      onChange(newId);
      toast.success(`${prenom} ${nom} ajouté·e`);
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
    if (trimmedQuery.length === 0) {
      openSubDialog("", "");
      return;
    }
    if (/\s/.test(trimmedQuery)) {
      const parts = trimmedQuery.split(/\s+/);
      const prenom = parts[0];
      const nom = parts.slice(1).join(" ");
      void createDirect(prenom, nom);
      return;
    }
    // Un seul mot : on ne devine pas le nom → sous-dialog avec prénom prérempli.
    openSubDialog(trimmedQuery, "");
  }

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
                {selected ? (
                  <>
                    <UserIcon className="size-4 shrink-0 text-slate-500" />
                    <span className="truncate">
                      {selected.prenom} {selected.nom}
                    </span>
                  </>
                ) : (
                  <>
                    <UserXIcon className="size-4 shrink-0 text-slate-300" />
                    <span className="text-slate-500">Aucun gestionnaire</span>
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
              placeholder="Cherche ou crée une personne..."
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {personnes === undefined ? (
                <div className="space-y-2 p-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : (
                <>
                  <CommandEmpty>Aucune personne trouvée.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="__none__"
                      onSelect={() => {
                        onChange(null);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <UserXIcon className="size-4 text-slate-400" />
                      <span className="text-slate-600">Aucun gestionnaire</span>
                      {value === null && (
                        <CheckIcon className="ml-auto size-4 opacity-100" />
                      )}
                    </CommandItem>
                    {personnes.map((p) => (
                      <CommandItem
                        key={p._id}
                        value={`${p.prenom} ${p.nom}`}
                        onSelect={() => {
                          onChange(p._id);
                          setOpen(false);
                          setQuery("");
                        }}
                      >
                        <UserIcon className="size-4 text-slate-500" />
                        <span className="truncate">
                          {p.prenom} {p.nom}
                        </span>
                        {value === p._id && (
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
                          onSelect={handleCreateSelect}
                          disabled={creating}
                        >
                          <UserPlusIcon className="size-4 text-slate-700" />
                          {trimmedQuery.length > 0 ? (
                            <span>
                              Créer &laquo;&nbsp;{trimmedQuery}&nbsp;&raquo;
                            </span>
                          ) : (
                            <span>Créer une personne</span>
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

      <PersonneEditDialog
        open={subOpen}
        onOpenChange={setSubOpen}
        mode="create"
        initialPrenom={subPrenom}
        initialNom={subNom}
        onCreated={(id) => {
          onChange(id);
          setQuery("");
        }}
      />
    </>
  );
}
