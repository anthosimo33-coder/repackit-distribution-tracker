"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isoCountryLabel } from "@/lib/country-name";
import { countryFlag } from "@/lib/countries";
import { cn } from "@/lib/utils";
import {
  refusDeMarche,
  NOM_MAX,
  type MarcheCompose,
} from "@/lib/market-groups";
import type { MarketGroup } from "@/convex/marketGroups";

/**
 * COMPOSER UN MARCHÉ — « Serbie + Croatie », lus comme un seul.
 *
 * Il porte ses propres écritures plutôt que de les faire remonter : la liste des
 * marchés est une query Convex, donc l'écran se remet à jour tout seul après une
 * création. Faire transiter ça par un état de la page ajouterait une copie qui
 * peut mentir.
 *
 * ── LE REFUS EST ANNONCÉ AVANT LE CLIC, ET REJOUÉ APRÈS ─────────────────────
 * `refusDeMarche` (lib) désactive le bouton et dit pourquoi ; la mutation
 * revérifie sur l'état réel, parce qu'un écran ouvert depuis dix minutes ne sait
 * pas ce qu'un collègue vient de créer. Le message du serveur est affiché tel
 * quel s'il tombe : inventer un texte à la place ferait mentir l'écran sur ce
 * qui s'est passé.
 */
export function MarketComposer({
  groups,
  countries,
  maille,
  onMaille,
}: {
  /** Les marchés composés du projet (query Convex, réactive). */
  groups: MarketGroup[];
  /** Les pays PRÉSENTS dans les données — on ne propose pas un pays vide. */
  countries: string[];
  maille: "pays" | "marche";
  onMaille: (m: "pays" | "marche") => void;
}) {
  const creer = useProjectMutation(api.marketGroups.createMarketGroup);
  const modifier = useProjectMutation(api.marketGroups.updateMarketGroup);
  const supprimer = useProjectMutation(api.marketGroups.deleteMarketGroup);

  /** `null` = éditeur fermé ; `""` = nouveau marché ; sinon l'id édité. */
  const [edite, setEdite] = useState<string | null>(null);
  const [nom, setNom] = useState("");
  const [choisis, setChoisis] = useState<string[]>([]);
  const [erreurServeur, setErreurServeur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const existants: MarcheCompose[] = groups.map((g) => ({
    id: g._id as string,
    nom: g.name,
    pays: g.countries,
  }));
  const refus =
    edite === null
      ? null
      : refusDeMarche({ nom, pays: choisis }, existants, edite || undefined);

  const ouvrir = (id: string) => {
    if (edite === id) return fermer();
    const g = groups.find((x) => (x._id as string) === id);
    setEdite(id);
    setNom(g?.name ?? "");
    setChoisis(g ? [...g.countries] : []);
    setErreurServeur(null);
  };
  const fermer = () => {
    setEdite(null);
    setErreurServeur(null);
  };

  const enregistrer = async () => {
    if (refus !== null || edite === null) return;
    setOccupe(true);
    setErreurServeur(null);
    try {
      if (edite === "") await creer({ name: nom, countries: choisis });
      else
        await modifier({
          id: edite as Id<"marketGroups">,
          name: nom,
          countries: choisis,
        });
      fermer();
      onMaille("marche");
    } catch (e) {
      // Le message du SERVEUR, pas un texte inventé : c'est lui qui sait ce
      // qu'un collègue vient de créer.
      setErreurServeur(messageDe(e));
    } finally {
      setOccupe(false);
    }
  };

  const defaire = async () => {
    if (edite === null || edite === "") return;
    setOccupe(true);
    try {
      await supprimer({ id: edite as Id<"marketGroups"> });
      fermer();
    } catch (e) {
      setErreurServeur(messageDe(e));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">Marchés</p>
          <p className="text-xs text-slate-500">
            Un marché composé additionne le coût et le revenu de ses pays, et se
            lit comme un seul.
          </p>
        </div>
        <div
          role="group"
          aria-label="Maille de lecture"
          className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5"
        >
          {(["pays", "marche"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={maille === m}
              onClick={() => onMaille(m)}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                maille === m
                  ? "bg-white font-medium text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              {m === "pays" ? "Par pays" : "Par marché"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {groups.map((g) => (
          <button
            key={g._id as string}
            type="button"
            aria-pressed={edite === (g._id as string)}
            onClick={() => ouvrir(g._id as string)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors",
              edite === (g._id as string)
                ? "border-slate-900 bg-slate-100 text-slate-900"
                : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300",
            )}
          >
            {g.name}
            <span className="font-mono text-[10px] text-slate-400">
              {g.countries.join(" + ")}
            </span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={edite === ""}
          onClick={() => ouvrir("")}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-600 transition-colors hover:border-slate-400"
        >
          <PlusIcon className="size-3" />
          Composer un marché
        </button>
      </div>

      {edite !== null ? (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <Input
            value={nom}
            maxLength={NOM_MAX}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Nom du marché (par exemple : Balkans)"
            aria-label="Nom du marché"
            className="h-8 max-w-xs text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {countries.map((code) => {
              const pris = choisis.includes(code);
              // Un pays déjà dans un AUTRE marché ne se propose pas : le refus
              // serait exact mais arriverait après le clic.
              const ailleurs = existants.find(
                (m) => m.id !== edite && m.pays.includes(code),
              );
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={pris}
                  disabled={ailleurs !== undefined}
                  title={
                    ailleurs ? `Déjà dans le marché « ${ailleurs.nom} »` : undefined
                  }
                  onClick={() =>
                    setChoisis((c) =>
                      c.includes(code) ? c.filter((x) => x !== code) : [...c, code],
                    )
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                    pris
                      ? "border-slate-900 bg-slate-100 text-slate-900"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300",
                    ailleurs ? "cursor-not-allowed opacity-40" : "",
                  )}
                >
                  <span aria-hidden="true">{countryFlag(code)}</span>
                  {isoCountryLabel(code)}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={enregistrer}
              disabled={refus !== null || occupe}
              data-testid="marche-enregistrer"
            >
              {edite === "" ? "Composer" : "Enregistrer"}
            </Button>
            {edite !== "" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={defaire}
                disabled={occupe}
                data-testid="marche-defaire"
              >
                Défaire
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={fermer} disabled={occupe}>
              <XIcon className="mr-1 size-3" />
              Annuler
            </Button>
            <span className="text-xs text-slate-500">
              {erreurServeur ?? refus?.message ?? `${choisis.length} pays choisis`}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Le message LISIBLE d'une erreur Convex, sans son emballage technique. */
function messageDe(e: unknown): string {
  const brut = e instanceof Error ? e.message : String(e);
  const MARQUEUR = "Uncaught ConvexError: ";
  const utile = brut.includes(MARQUEUR)
    ? brut.slice(brut.lastIndexOf(MARQUEUR) + MARQUEUR.length)
    : brut;
  return utile.split(/\s+at\s+/)[0].trim().slice(0, 200);
}
