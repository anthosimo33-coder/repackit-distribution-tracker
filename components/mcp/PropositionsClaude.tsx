"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { BotIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectQuerySafe } from "@/components/project/use-project-convex";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useConvexError } from "@/lib/use-convex-error";

/**
 * PROPOSITIONS DE CLAUDE — ce que Claude a préparé sans pouvoir l'écrire (une
 * routine, une connexion en lecture seule). « Appliquer » appelle l'outil
 * d'écriture proposé AU NOM de la personne qui clique (mêmes règles, même
 * journal, même Défaire) ; « Écarter » le refuse — Claude ne le reproposera pas
 * avant 14 jours.
 *
 * Ne s'affiche que s'il y a quelque chose à trancher ; une liste en échec ne
 * fait jamais tomber l'accueil (`useProjectQuerySafe`).
 */
/** Au-delà, la liste se replie : l'accueil reste lisible même avec 50 propositions. */
const VISIBLES = 5;

export function PropositionsClaude() {
  const tr = useTranslations("admin.common.PropositionsClaude");
  const outils = useTranslations("admin.common.McpAccessDialog");
  const loc = useIntlLocale();
  const showError = useConvexError();
  const r = useProjectQuerySafe(api.mcpPropositions.listPropositions, {});
  const appliquer = useAction(api.mcpPropositions.appliquerProposition);
  const ecarter = useMutation(api.mcpPropositions.ecarterProposition);
  const [enCours, setEnCours] = useState<Id<"mcpPropositions"> | null>(null);
  const [voirDecisions, setVoirDecisions] = useState(false);
  const [toutVoir, setToutVoir] = useState(false);

  if (r.status !== "ok" || r.data.enAttente.length === 0) return null;
  const { enAttente, decidees } = r.data;
  const quand = (ts: number) =>
    new Intl.DateTimeFormat(loc, { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ts);
  const libelle = (outil: string) => {
    const cle = `outil.${outil}` as "outil.relancer";
    return outils.has(cle) ? outils(cle) : outil;
  };

  async function handleAppliquer(id: Id<"mcpPropositions">) {
    setEnCours(id);
    try {
      const res = await appliquer({ propositionId: id });
      if (res.ok) toast.success(tr("appliquee", { fait: res.message }));
      else toast.error(tr("refusee", { message: res.message }));
    } catch (err) {
      toast.error(showError(err, tr("impossible")));
    } finally {
      setEnCours(null);
    }
  }

  async function handleEcarter(id: Id<"mcpPropositions">) {
    try {
      await ecarter({ propositionId: id });
      toast.success(tr("ecarteeToast"));
    } catch (err) {
      toast.error(showError(err, tr("impossible")));
    }
  }

  return (
    <Card data-testid="propositions-claude">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start gap-2">
          <BotIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">{tr("titre", { count: enAttente.length })}</h2>
            <p className="text-xs text-slate-500">{tr("aide")}</p>
          </div>
        </div>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {(toutVoir ? enAttente : enAttente.slice(0, VISIBLES)).map((p) => (
            <li key={p._id} className="space-y-2 px-3 py-3" data-testid="proposition">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <Badge variant="secondary">{libelle(p.outil)}</Badge>
                {p.lot && <span>{p.lot}</span>}
                <span>{tr("par", { via: p.via, date: quand(p.creeLe) })}</span>
              </div>
              <p className="text-sm font-medium text-slate-900">{p.resume}</p>
              <p className="text-sm text-slate-600">{p.pourquoi}</p>
              {p.refus && (
                <p className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">{tr("dernierRefus", { message: p.refus })}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={enCours !== null || p.statut === "en_cours"}
                  onClick={() => void handleAppliquer(p._id)}
                >
                  {enCours === p._id && <Loader2Icon className="size-3.5 animate-spin" aria-hidden />}
                  {tr("appliquer")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={enCours !== null || p.statut === "en_cours"}
                  onClick={() => void handleEcarter(p._id)}
                >
                  {tr("ecarter")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {enAttente.length > VISIBLES && (
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => setToutVoir((v) => !v)}
            aria-expanded={toutVoir}
          >
            {toutVoir ? tr("voirMoins") : tr("voirLesAutres", { count: enAttente.length - VISIBLES })}
          </button>
        )}
        {decidees.length > 0 && (
          <div className="space-y-1">
            <button
              type="button"
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
              onClick={() => setVoirDecisions((v) => !v)}
              aria-expanded={voirDecisions}
            >
              {voirDecisions ? tr("masquerDecisions") : tr("voirDecisions", { count: decidees.length })}
            </button>
            {voirDecisions && (
              <ul className="space-y-1 text-xs text-slate-500">
                {decidees.map((p) => (
                  <li key={p._id}>
                    <span className={p.statut === "appliquee" ? "text-emerald-700" : "text-slate-400"}>
                      {p.statut === "appliquee" ? tr("statutAppliquee") : tr("statutEcartee")}
                    </span>{" "}
                    — {p.resume}
                    {p.decidePar ? ` · ${p.decidePar}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
