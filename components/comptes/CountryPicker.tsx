"use client";

import { useMemo, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, GlobeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { scoreRecherche } from "@/lib/search-match";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { COUNTRY_CODES, countryFlag, countryLabel, countryName } from "@/lib/countries";

/** Valeur sentinelle : « aucun pays ciblé ». */
export const COUNTRY_NONE = "none";

/**
 * SÉLECTEUR DE PAYS — 250 codes, et pourtant trois frappes pour en trouver un.
 *
 * ─── POURQUOI PAS UN `Select` ────────────────────────────────────────────────
 * Le champ portait dix pays dans une liste déroulante ordinaire. À dix, ça
 * marche ; à 250, une liste déroulante devient une épreuve de défilement — et
 * c'est exactement l'écueil que l'élargissement aurait créé si on s'était
 * contenté d'allonger la liste. Une RECHERCHE renverse le rapport : plus la
 * liste est longue, plus taper est rapide que choisir.
 *
 * ─── CE QUE LA RECHERCHE ACCEPTE ─────────────────────────────────────────────
 * Le nom ET le code : « Serbie » comme « RS ». Quelqu'un qui pense en codes ISO
 * (parce qu'il vient de l'analytics, où Whop rend « RS ») ne doit pas avoir à
 * traduire de tête.
 *
 * ─── LE GROUPE « DÉJÀ UTILISÉS » ─────────────────────────────────────────────
 * Ouvrir sur « Afghanistan » n'aide personne. Les pays déjà posés sur d'autres
 * comptes du projet remontent donc en tête — un signal qui se maintient tout
 * seul, contrairement à une liste de pays « importants » qu'il faudrait
 * deviner puis tenir à jour.
 */
export function CountryPicker({
  value,
  onChange,
  suggestions = [],
  ariaLabel = "Pays ciblé",
}: {
  /** Code ISO, ou `COUNTRY_NONE`. */
  value: string;
  onChange: (v: string) => void;
  /** Codes à remonter en tête (ex. ceux déjà utilisés dans le projet). */
  suggestions?: readonly string[];
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  // Tri par NOM LOCALISÉ, pas par code : une liste ordonnée « AD, AE, AF »
  // n'est alphabétique que pour une machine.
  const tous = useMemo(
    () =>
      [...COUNTRY_CODES]
        .map((code) => ({ code, nom: countryName(code) ?? code }))
        .sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
    [],
  );

  // Les suggestions sont RETIRÉES de la grande liste : un même pays rendu deux
  // fois donnerait deux entrées à la même valeur, et cmdk filtre par valeur.
  const enTete = useMemo(() => {
    const vus = new Set<string>();
    return suggestions
      .map((c) => c.trim().toUpperCase())
      .filter((c) => {
        if (vus.has(c) || !tous.some((t) => t.code === c)) return false;
        vus.add(c);
        return true;
      })
      .map((code) => ({ code, nom: countryName(code) ?? code }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  }, [suggestions, tous]);
  const enTeteCodes = new Set(enTete.map((c) => c.code));

  const ligne = (c: { code: string; nom: string }) => (
    <CommandItem
      key={c.code}
      // Nom ET code : « Serbie » comme « RS » trouvent la même ligne.
      value={`${c.nom} ${c.code}`}
      onSelect={() => {
        onChange(c.code);
        setOpen(false);
      }}
    >
      <span aria-hidden>{countryFlag(c.code)}</span>
      <span className="truncate">{c.nom}</span>
      <span className="ml-auto flex items-center gap-2">
        <span className="text-xs tabular-nums text-slate-400">{c.code}</span>
        {value === c.code && <CheckIcon className="size-4" />}
      </span>
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            className="w-full justify-between text-left font-normal"
          >
            {value === COUNTRY_NONE ? (
              <span className="flex items-center gap-2 text-slate-500">
                <GlobeIcon className="size-4 shrink-0 text-slate-300" />
                Non défini
              </span>
            ) : (
              <span className="truncate">{countryLabel(value)}</span>
            )}
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent
        className="w-[var(--anchor-width,360px)] min-w-[260px] p-0"
        align="start"
      >
        <Command filter={scoreRecherche}>
          <CommandInput placeholder="Cherche un pays ou un code…" />
          <CommandList>
            <CommandEmpty>Aucun pays ne correspond.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="non défini aucun"
                onSelect={() => {
                  onChange(COUNTRY_NONE);
                  setOpen(false);
                }}
              >
                <GlobeIcon className="size-4 text-slate-400" />
                <span className="text-slate-600">Non défini</span>
                {value === COUNTRY_NONE && (
                  <CheckIcon className="ml-auto size-4" />
                )}
              </CommandItem>
            </CommandGroup>
            {enTete.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Déjà utilisés dans ce projet">
                  {enTete.map(ligne)}
                </CommandGroup>
              </>
            )}
            <CommandSeparator />
            <CommandGroup heading="Tous les pays">
              {tous.filter((c) => !enTeteCodes.has(c.code)).map(ligne)}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
