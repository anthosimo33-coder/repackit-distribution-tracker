"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useProjectMutation, useProjectQuery } from "@/components/project/use-project-convex";
import { useProject } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format-rate";
import { formatDateFr } from "@/convex/dateFr";
import { convexErrorMessage } from "@/lib/convex-error";

/**
 * FORFAITS DES TALENTS — le second chemin de lecture de l'écran Paiements.
 *
 * Un talent ne publie jamais, donc `cyclePaymentsForCreator` rend `[]` pour lui
 * et il est absent du tableau des cycles. C'est le « coût accepté » annoncé par
 * l'arbitrage B3, et il s'arrête à cette carte : le tableau des partenaires
 * n'est pas élargi.
 *
 * ⚠️ LE RÉCAP EST TOUJOURS AFFICHÉ, pas derrière un seuil. Un talent activé le
 * 28 et arrêté le 3 doit DEUX mois pleins pour sept jours couverts — c'est la
 * conséquence assumée de la règle « mois d'entrée et de sortie payés en
 * entier ». Le montant est rendu à côté des jours parce que c'est LUI qui fait
 * hésiter, pas le nombre de mois, et qu'il doit se lire AVANT le virement.
 */
export function TalentPayCard() {
  const recaps = useProjectQuery(api.talentPay.listTalentPay, {});
  const currency = useProject().project.payCurrency;

  if (recaps === undefined) return <Skeleton className="h-40 w-full" />;
  // Aucun talent activé : pas de carte vide. Manon (onboarding) n'apparaît pas
  // tant qu'elle n'est pas activée — une ligne à 0 € se lirait « forfait nul ».
  if (recaps.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-slate-900">
            Forfaits des talents
          </h2>
          <p className="text-xs text-slate-500">
            Forfait mensuel — mois d&apos;entrée et de sortie payés en entier.
            Aucun prorata.
          </p>
        </div>
        {recaps.map((r) => (
          <TalentRecap key={r.creatorId} recap={r} currency={currency} />
        ))}
      </CardContent>
    </Card>
  );
}

type Recap = NonNullable<
  ReturnType<typeof useProjectQuery<typeof api.talentPay.listTalentPay>>
>[number];

function TalentRecap({
  recap,
  currency,
}: {
  recap: Recap;
  currency: string | null | undefined;
}) {
  const payer = useProjectMutation(api.payments.markTalentMonthPaid);
  const [busy, setBusy] = useState<string | null>(null);

  async function onPay(period: string) {
    setBusy(period);
    try {
      const res = await payer({
        creatorId: recap.creatorId as Id<"creators">,
        period,
      });
      toast.success(
        res.alreadyPaid
          ? "Ce mois était déjà payé."
          : `Forfait marqué payé — ${formatMoney(res.amount, currency)}.`,
      );
    } catch (e) {
      toast.error(convexErrorMessage(e, "Échec du marquage"));
    } finally {
      setBusy(null);
    }
  }

  const dus = recap.months.filter((m) => m.status === "due");

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-900">
          {recap.creatorName}
        </span>
        {recap.endAt !== null && (
          <Badge
            variant="outline"
            className="border-slate-200 bg-slate-50 text-slate-500"
          >
            arrêtée
          </Badge>
        )}
      </div>

      {/* LE RÉCAP EN TOUTES LETTRES — nombre de mois, montant, jours couverts,
          et les deux dates. C'est ce qui doit se lire avant le virement. */}
      <p className="text-xs text-slate-600" data-testid="talent-recap">
        <strong className="tabular-nums">
          {dus.length} mois de forfait dus
        </strong>
        {dus.length > 0 && (
          <>
            {" — "}
            <strong className="tabular-nums">
              {formatMoney(recap.totalDue, currency)}
            </strong>
            {recap.daysCovered !== null && (
              <> pour {recap.daysCovered} jours couverts</>
            )}
          </>
        )}
        {recap.startAt !== null && (
          <> — activée le {formatDateFr(recap.startAt)}</>
        )}
        {recap.endAt !== null && <>, arrêtée le {formatDateFr(recap.endAt)}</>}
      </p>

      <ul className="space-y-1">
        {recap.months.map((m) => (
          <li
            key={m.period}
            className="flex items-center justify-between gap-3 border-t border-slate-100 pt-1 text-xs"
          >
            <span className="text-slate-600">
              {m.label}
              {m.current && (
                <span className="ml-2 text-slate-400">en cours</span>
              )}
              {/* Le compte de rushes est AFFICHÉ, jamais calculé dans le
                  montant : un mois à 0 rush est dû, et c'est précisément le cas
                  où l'admin doit le voir avant de cliquer. */}
              <span className="ml-2 text-slate-400">
                {m.rushCount} rush{m.rushCount > 1 ? "es" : ""}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums text-slate-900">
                {formatMoney(m.amount, currency)}
              </span>
              {m.status === "paid" ? (
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-emerald-50 text-emerald-700"
                >
                  <CheckIcon className="mr-1 size-3" />
                  payé
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => onPay(m.period)}
                >
                  {busy === m.period && (
                    <Loader2Icon className="mr-1 size-3 animate-spin" />
                  )}
                  Marquer payé
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
