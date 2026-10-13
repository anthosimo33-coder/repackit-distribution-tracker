"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Valeur du select « pas de scénario : fichiers déposés » (Select n'accepte pas ""). */
const AUCUN = "__fichiers__";

type ScenarioListe = { _id: string; code: string; titre: string; theme: string; statut: string };

/**
 * Le SCÉNARIO d'une brique conversation, choisi PAR THÈME : la liste est
 * rangée comme l'écran Scénarios, pour qu'une campagne « La dispute » ne tire
 * pas une conv d'un autre style. Les scénarios archivés n'y sont pas (sauf
 * celui déjà choisi) ; un brouillon est proposé, mais ne partira qu'activé.
 */
export function ScenarioPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string, scenario: ScenarioListe | null) => void;
}) {
  const tr = useTranslations("admin.scripts.ScenarioPicker");
  const tStatut = useTranslations("admin.scripts.scenarioStatut");
  const projectPath = useProjectPath();
  const scenarios = useProjectQuery(api.scenarios.listScenarios, {});

  const groupes = useMemo(() => {
    const parTheme = new Map<string, ScenarioListe[]>();
    for (const sc of scenarios ?? []) {
      if (sc.statut === "archive" && sc._id !== value) continue;
      const k = sc.theme.trim();
      parTheme.set(k, [...(parTheme.get(k) ?? []), sc]);
    }
    return [...parTheme.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "fr")));
  }, [scenarios, value]);

  const libelle = (sc: ScenarioListe) =>
    sc.statut === "actif" ? `${sc.code} · ${sc.titre}` : `${sc.code} · ${sc.titre} (${tStatut(sc.statut as "brouillon")})`;
  const items: Record<string, string> = { [AUCUN]: tr("aucun") };
  for (const sc of scenarios ?? []) items[sc._id] = libelle(sc);
  const courant = (scenarios ?? []).find((sc) => sc._id === value);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="brick-scenario">{tr("scenario")}</Label>
      <Select
        value={value || AUCUN}
        items={items}
        onValueChange={(v) => {
          if (!v) return;
          const id = v === AUCUN ? "" : v;
          onChange(id, (scenarios ?? []).find((sc) => sc._id === id) ?? null);
        }}
      >
        <SelectTrigger id="brick-scenario" className="w-full min-w-0" data-testid="brick-scenario">
          <SelectValue>{value ? (courant ? libelle(courant) : "…") : tr("aucun")}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value={AUCUN}>{tr("aucun")}</SelectItem>
          {groupes.map(([theme, liste]) => (
            <SelectGroup key={theme || "—"}>
              <SelectLabel>{theme || tr("sansTheme")}</SelectLabel>
              {liste.map((sc) => (
                <SelectItem key={sc._id} value={sc._id}>
                  {libelle(sc)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-slate-400">
        {value ? tr("aideScenario") : tr("aideFichiers")}{" "}
        {value && (
          <Link
            href={projectPath(`/scenarios/${value}`)}
            prefetch={false}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {tr("tester")}
          </Link>
        )}
      </p>
      {courant && courant.statut !== "actif" && (
        <p className="text-xs text-amber-700" data-testid="brick-scenario-inactif">
          {tr("inactif")}
        </p>
      )}
    </div>
  );
}
