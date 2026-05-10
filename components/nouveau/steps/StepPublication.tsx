"use client";

import { useMemo, type Dispatch } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fr } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { FORMAT_CONFIGS, type FormatKey } from "@/lib/format-config";
import type { NouveauAction, NouveauData } from "../useNouveauState";

/**
 * StepPublication — étape 4 du modal. Plateformes (filtrées par mediaType
 * via FORMAT_CONFIGS), compte filtré par plateforme cochée, date, notes.
 *
 * Reset compte quand plateformes change : géré au niveau NouveauModal pour
 * éviter un useEffect setState ici.
 */
export function StepPublication({
  data,
  dispatch,
}: {
  data: NouveauData;
  dispatch: Dispatch<NouveauAction>;
}) {
  const comptesData = useQuery(api.comptes.listComptes, { actifOnly: true });

  const allowedPlatforms = useMemo<readonly string[]>(() => {
    if (!data.mediaType) return [];
    const key = data.mediaType as FormatKey;
    return FORMAT_CONFIGS[key]?.allowedPlatforms ?? [];
  }, [data.mediaType]);

  const filteredComptes = useMemo(() => {
    if (!comptesData) return [];
    return comptesData.filter((c) => data.plateformes.includes(c.plateforme));
  }, [comptesData, data.plateformes]);

  const datePubliDate = new Date(data.datePubli);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Plateformes</Label>
        <div className="flex gap-4 pt-2">
          {allowedPlatforms.map((p) => (
            <label
              key={p}
              className="flex cursor-pointer items-center gap-2"
            >
              <Checkbox
                checked={data.plateformes.includes(p)}
                onCheckedChange={() =>
                  dispatch({ type: "TOGGLE_PLATEFORME", plateforme: p })
                }
              />
              <span className="text-sm">{p}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Compte</Label>
        {comptesData === undefined ? (
          <Skeleton className="h-9 w-full" />
        ) : filteredComptes.length === 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Aucun compte actif sur les plateformes sélectionnées.{" "}
            <Link
              href="/comptes"
              className="font-medium underline underline-offset-2"
            >
              Ajoute-en un
            </Link>
            .
          </div>
        ) : (
          <Select
            value={data.compte}
            onValueChange={(v) =>
              v !== null && dispatch({ type: "SET_COMPTE", compte: v })
            }
          >
            <SelectTrigger>
              <SelectValue>{data.compte || "Sélectionne un compte"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {filteredComptes.map((c) => (
                <SelectItem key={c._id} value={c.handle}>
                  <span className="font-mono">{c.handle}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {c.plateforme}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Date de publication</Label>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className="w-full justify-start text-left font-normal"
              >
                <CalendarIcon className="mr-2 size-4" />
                {datePubliDate.toLocaleDateString("fr-FR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </Button>
            }
          />
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={datePubliDate}
              onSelect={(d) =>
                d &&
                dispatch({ type: "SET_DATE_PUBLI", datePubli: d.getTime() })
              }
              locale={fr}
              weekStartsOn={1}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          rows={2}
          placeholder="Optionnel..."
          value={data.notes}
          onChange={(e) =>
            dispatch({ type: "SET_NOTES", notes: e.target.value })
          }
        />
      </div>
    </div>
  );
}
