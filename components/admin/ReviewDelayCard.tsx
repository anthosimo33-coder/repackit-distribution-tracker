"use client";

import { useTranslations } from "next-intl";
import { TimerIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProjectQuery } from "@/components/project/use-project-convex";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIntlLocale } from "@/lib/use-intl-locale";
import { useIsMobile } from "@/components/layout/use-is-mobile";
import { decoupeDuree, type Fenetre } from "@/convex/reviewDelay";

/**
 * Une durée lisible (« 45 min », « 3 h 05 », « 2 j 4 h ») dans la langue de
 * l'écran — le découpage est la règle pure de convex/reviewDelay.
 */
export function useFormatDuree(): (ms: number) => string {
  const tr = useTranslations("admin.validation.duree");
  return (ms) => {
    const d = decoupeDuree(ms);
    if (d.unite === "minutes") return tr("minutes", { m: d.m });
    if (d.unite === "heures") {
      return d.m === 0
        ? tr("heuresRondes", { h: d.h })
        : tr("heures", { h: d.h, m: String(d.m).padStart(2, "0") });
    }
    return d.h === 0 ? tr("joursRonds", { j: d.j }) : tr("jours", { j: d.j, h: d.h });
  };
}

type Ligne = { cle: string; label: string; f: Fenetre };

/**
 * TEMPS DE RÉPONSE de la Validation — de l'envoi d'une vidéo à « Valider » ou
 * « Refuser ». Trois fenêtres (7 derniers jours, les 7 d'avant pour comparer,
 * 30 jours), la plus longue attente de la file en cours, et le détail par
 * personne dès que plusieurs décident.
 *
 * Même bloc que la file (`review.manage`) : la carte ne peut pas faire tomber
 * l'écran pour quelqu'un qui voit la file.
 */
export function ReviewDelayCard({
  plusLongueAttente,
}: {
  /** La vidéo de la file qui attend depuis le plus longtemps (heure d'entrée connue). */
  plusLongueAttente: { ms: number; createatrice: string } | null;
}) {
  const tr = useTranslations("admin.validation.ReviewDelayCard");
  const loc = useIntlLocale();
  const duree = useFormatDuree();
  const isMobile = useIsMobile();
  const data = useProjectQuery(api.videoReviews.getReviewDelay, {});

  if (data === undefined) return <Skeleton className="h-40 w-full" />;

  const cellule = (ms: number | null) => (ms === null ? "—" : duree(ms));
  const part = (p: number | null) => (p === null ? "—" : tr("pourcent", { p: Math.round(p * 100) }));
  const periodes: Ligne[] = [
    { cle: "review-delay-7j", label: tr("septJours"), f: data.septJours },
    { cle: "review-delay-7j-avant", label: tr("septJoursAvant"), f: data.septJoursAvant },
    { cle: "review-delay-30j", label: tr("trenteJours"), f: data.trenteJours },
  ];
  // Par personne : seulement quand plusieurs décident — seule, la ligne
  // répéterait celle des 30 jours.
  const personnes: Ligne[] =
    data.parPersonne.length > 1
      ? data.parPersonne.map((p) => ({ cle: `review-delay-personne-${p.userId ?? "?"}`, label: p.nom ?? tr("sansNom"), f: p }))
      : [];

  // Téléphone : une ligne par période, les chiffres en dessous — un tableau à
  // six colonnes y défilerait de côté et cacherait « Plus long ».
  const listeMobile = (lignes: Ligne[], titre: string) => (
    <ul className="divide-y divide-slate-100">
      <li className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{titre}</li>
      {lignes.map(({ cle, label, f }) => (
        <li key={cle} data-testid={cle} className="space-y-1 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium text-slate-700">{label}</span>
            <span className="font-semibold tabular-nums" data-testid={`${cle}-moyenne`}>
              {cellule(f.moyenneMs)}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-500">
            <div className="flex justify-between gap-2"><dt>{tr("videos")}</dt><dd className="tabular-nums" data-testid={`${cle}-videos`}>{f.videos}</dd></div>
            <div className="flex justify-between gap-2"><dt>{tr("mediane")}</dt><dd className="tabular-nums">{cellule(f.medianeMs)}</dd></div>
            <div className="flex justify-between gap-2"><dt>{tr("rapide")}</dt><dd className="tabular-nums">{part(f.partRapide)}</dd></div>
            <div className="flex justify-between gap-2"><dt>{tr("plusLong")}</dt><dd className="tabular-nums" data-testid={`${cle}-plus-long`}>{cellule(f.plusLongMs)}</dd></div>
          </dl>
        </li>
      ))}
    </ul>
  );
  const tableau = (lignes: Ligne[], premiere: string) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{premiere}</TableHead>
          <TableHead className="text-right">{tr("videos")}</TableHead>
          <TableHead className="text-right">{tr("moyenne")}</TableHead>
          <TableHead className="text-right">{tr("mediane")}</TableHead>
          <TableHead className="text-right">{tr("rapide")}</TableHead>
          <TableHead className="text-right">{tr("plusLong")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lignes.map(({ cle, label, f }) => (
          <TableRow key={cle} data-testid={cle}>
            <TableCell className="font-medium text-slate-700">{label}</TableCell>
            <TableCell className="text-right tabular-nums" data-testid={`${cle}-videos`}>
              {f.videos}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums" data-testid={`${cle}-moyenne`}>
              {cellule(f.moyenneMs)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{cellule(f.medianeMs)}</TableCell>
            <TableCell className="text-right tabular-nums">{part(f.partRapide)}</TableCell>
            <TableCell className="text-right tabular-nums" data-testid={`${cle}-plus-long`}>
              {cellule(f.plusLongMs)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
  const bloc = isMobile ? listeMobile : tableau;

  return (
    <section className="space-y-3" data-testid="review-delay">
      <div className="space-y-0.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wider text-slate-500">
          <TimerIcon className="size-4" />
          {tr("titre")}
        </h2>
        <p className="text-xs text-slate-500">{tr("explication")}</p>
      </div>
      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          {data.mesureDepuis === null ? (
            <p className="p-4 text-sm text-slate-500" data-testid="review-delay-empty">
              {tr("aucuneMesure")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              {bloc(periodes, tr("periode"))}
              {personnes.length > 0 && (
                <div data-testid="review-delay-personnes" className="border-t border-slate-100">
                  {bloc(personnes, tr("parPersonne"))}
                </div>
              )}
            </div>
          )}
          {(plusLongueAttente !== null || data.mesureDepuis !== null) && (
            <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              {plusLongueAttente !== null && (
                <p data-testid="review-delay-attente">
                  {tr("attenteEnCours", {
                    duree: duree(plusLongueAttente.ms),
                    createatrice: plusLongueAttente.createatrice,
                  })}
                </p>
              )}
              {data.mesureDepuis !== null && (
                <p>
                  {tr("mesureDepuis", {
                    date: new Date(data.mesureDepuis).toLocaleDateString(loc),
                  })}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
