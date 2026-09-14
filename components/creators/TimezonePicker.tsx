"use client";

import { useMemo, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, ClockIcon } from "lucide-react";
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
import {
  TIMEZONE_CHOICES,
  allTimezones,
  utcOffsetLabel,
  zoneArea,
  zoneCity,
  zoneLabelWith,
} from "@/lib/timezone-choices";
import { useTranslations } from "next-intl";

/** Valeur sentinelle : « fuseau non défini ». */
export const TZ_NONE = "none";

/**
 * SÉLECTEUR DE FUSEAU — les 418 de la base IANA, cherchables.
 *
 * ─── CE QUI NE CHANGE PAS ────────────────────────────────────────────────────
 * `isSupportedTimezone` acceptait DÉJÀ n'importe quel identifiant IANA : le
 * serveur n'a jamais été la limite. C'était l'écran qui n'en proposait que
 * dix-sept, et une créatrice à Belgrade se voyait attribuer « Paris » faute de
 * mieux — un jour de warmup compté au mauvais endroit, en silence.
 *
 * ─── LES DIX-SEPT RESTENT EN TÊTE ────────────────────────────────────────────
 * Sous « Fréquents », avec leurs libellés écrits à la main (« New York — côte
 * est (US) »), parce qu'ils portent une information que l'identifiant IANA ne
 * porte pas : quelle côte, quel décalage, et lequel choisir quand « États-Unis »
 * n'en désigne aucun en particulier. C'est cette ambiguïté-là qui a coûté des
 * jours de warmup — la lever reste le premier service du sélecteur.
 *
 * ─── LA RECHERCHE ────────────────────────────────────────────────────────────
 * Ville, continent ET décalage : « Belgrade », « Europe » ou « UTC+2 » mènent au
 * même endroit. Le décalage est calculé à l'instant présent, jamais mis en
 * cache : il change deux fois par an.
 */
export function TimezonePicker({
  value,
  onChange,
  id,
  ariaLabel,
}: {
  /** Identifiant IANA, ou `TZ_NONE`. */
  value: string;
  onChange: (v: string) => void;
  id?: string;
  ariaLabel?: string;
}) {
  const tr = useTranslations("admin.creators.TimezonePicker");
  const tZoneNs = useTranslations("admin.creators.timezone");
  // La table des fuseaux porte des clés `string` (module pur) : même compromis
  // documenté que `lib/use-label`.
  const tZone = (key: string) => tZoneNs(key as Parameters<typeof tZoneNs>[0]);
  const [open, setOpen] = useState(false);

  const misEnAvant = new Set(TIMEZONE_CHOICES.map((c) => c.zone));
  // Les fuseaux sont triés par CONTINENT puis par ville : « Europe/Belgrade »
  // suit « Europe/Athens », et non « America/Belize » comme le ferait un tri sur
  // l'identifiant brut.
  const reste = useMemo(
    () =>
      allTimezones()
        .filter((z) => !misEnAvant.has(z))
        .sort((a, b) =>
          zoneArea(a).localeCompare(zoneArea(b), "fr") ||
          zoneCity(a).localeCompare(zoneCity(b), "fr"),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const ligne = (zone: string, libelle: string) => {
    const offset = utcOffsetLabel(zone);
    return (
      <CommandItem
        key={zone}
        // Ville, continent, identifiant ET décalage : quatre façons de tomber
        // sur la même ligne.
        value={`${libelle} ${zone} ${offset ?? ""}`}
        onSelect={() => {
          onChange(zone);
          setOpen(false);
        }}
      >
        <span className="truncate">{libelle}</span>
        <span className="ml-auto flex items-center gap-2">
          {offset && (
            <span className="text-xs tabular-nums text-slate-400">{offset}</span>
          )}
          {value === zone && <CheckIcon className="size-4" />}
        </span>
      </CommandItem>
    );
  };

  const libelleCourant =
    value === TZ_NONE || value === ""
      ? null
      : `${zoneLabelWith(tZone, value)}${utcOffsetLabel(value) ? ` — ${utcOffsetLabel(value)}` : ""}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel ?? tr("fuseauHoraire")}
            className="w-full justify-between text-left font-normal"
          >
            {libelleCourant === null ? (
              <span className="flex items-center gap-2 text-slate-500">
                <ClockIcon className="size-4 shrink-0 text-slate-300" />
                {tr("nonDefini")}
              </span>
            ) : (
              <span className="truncate">{libelleCourant}</span>
            )}
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent
        className="w-[var(--anchor-width,380px)] min-w-[280px] p-0"
        align="start"
      >
        <Command filter={scoreRecherche}>
          <CommandInput placeholder={tr("chercheUneVilleOuUn")} />
          <CommandList>
            <CommandEmpty>{tr("aucunFuseauNeCorrespond")}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={tr("noneSearchTerms")}
                onSelect={() => {
                  onChange(TZ_NONE);
                  setOpen(false);
                }}
              >
                <ClockIcon className="size-4 text-slate-400" />
                <span className="text-slate-600">{tr("nonDefini")}</span>
                {(value === TZ_NONE || value === "") && (
                  <CheckIcon className="ml-auto size-4" />
                )}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={tr("frequents")}>
              {TIMEZONE_CHOICES.map((c) => ligne(c.zone, tZone(c.key)))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={tr("tousLesFuseaux")}>
              {reste.map((z) =>
                ligne(z, zoneArea(z) ? `${zoneCity(z)} — ${zoneArea(z)}` : zoneCity(z)),
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
