"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { formatViews } from "@/lib/format-rate";
import {
  toDisplayAmount,
  convertedValue,
  conversionNote,
  type CurrencyContext,
} from "@/lib/currency-display";
import { HubCardHeader, HubNotice } from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
import type { NatureRewardsData } from "./types";

/**
 * RÉCOMPENSES EN NATURE — iPhone, MacBook, voiture : elles n'ont aucun montant en
 * paie, mais elles coûtent, et jusqu'ici elles n'apparaissaient nulle part dans
 * l'économie du moteur.
 *
 * La carte sépare STRICTEMENT deux natures de chiffre, parce que les confondre
 * ferait passer une promesse lointaine pour de l'argent sorti :
 *  - DÉJÀ DÛ = palier franchi, l'objet est à livrer. C'est une DÉPENSE, et elle
 *    entre dans le coût complet du moteur (jamais dans le coût d'acquisition : un
 *    iPhone n'est pas un coût par client, c'est un engagement pris sur le volume) ;
 *  - ENGAGÉ = palier pas encore franchi. Ce n'est PAS une dépense, ça n'entre dans
 *    aucun coût — mais c'est visible, chiffré et daté par la progression.
 *
 * Les coûts sont les COÛTS RÉELS pour nous (prix d'achat négocié), jamais le prix
 * public ni la valeur perçue par la créatrice. Sans coût renseigné, la ligne
 * affiche un tiret et la carte dit où le saisir — jamais un 0, qui se lirait
 * « gratuit ».
 */

function Amount({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${valueClass ?? "text-slate-900"}`}>
        {value}
      </div>
      <div className="text-[11px] leading-relaxed text-slate-400">{hint}</div>
    </div>
  );
}

export function NatureRewardsCard({
  data,
  fxCtx,
}: {
  data: NatureRewardsData | undefined;
  /** Devises de l'écran — les coûts réels sont saisis en devise de PAIE et
   *  s'affichent, comme tout le hub, dans celle du REVENU. */
  fxCtx: CurrencyContext;
}) {
  // Aucune récompense en nature dans aucune grille → rien à montrer.
  if (data === undefined || !data.hasNatureTiers) return null;

  const dueTotal = toDisplayAmount(data.dueTotal, fxCtx);
  const engagedTotal = toDisplayAmount(data.engagedTotal, fxCtx);
  const missing = data.dueMissingCost + data.engagedMissingCost;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <HubCardHeader
          title="Récompenses en nature"
          subtitle="Un iPhone ou une voiture n'a pas de montant en paie, mais coûte. Ce qui est dû est une dépense ; ce qui est engagé ne l'est pas encore."
          info={EXPLAIN.recompensesNature}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Amount
            label="Déjà dû"
            value={
              data.dueTotal === 0 && data.dueMissingCost > 0
                ? "—"
                : convertedValue(dueTotal)
            }
            hint="paliers franchis, objets à livrer · compté dans le coût complet du moteur"
            valueClass={data.dueTotal > 0 ? "text-rose-600" : "text-slate-900"}
          />
          <Amount
            label="Engagé si les paliers tombent"
            value={
              data.engagedTotal === 0 && data.engagedMissingCost > 0
                ? "—"
                : convertedValue(engagedTotal)
            }
            hint="promesses en cours · ce n'est PAS une dépense, aucun coût ne le compte"
            valueClass="text-slate-500"
          />
        </div>

        {!data.anyCostConfigured ? (
          <HubNotice>
            <strong>Aucun coût réel renseigné.</strong> Les récompenses sont listées
            mais pas chiffrées : ouvrez <em>Barèmes</em>, éditez la grille, et
            remplissez « Coût réel » sur chaque palier en nature. Attendu : ce que
            l&apos;objet nous coûte vraiment (prix d&apos;achat négocié), pas son prix
            public. Tant qu&apos;il manque, le coût complet du moteur est sous-estimé.
          </HubNotice>
        ) : missing > 0 ? (
          <HubNotice>
            <strong>
              {formatNumber(missing)} récompense{missing > 1 ? "s" : ""} sans coût réel
            </strong>{" "}
            — elle{missing > 1 ? "s" : ""} n&apos;entre{missing > 1 ? "nt" : ""} dans
            aucun total ci-dessus. À compléter dans <em>Barèmes</em>, sur le palier
            concerné.
          </HubNotice>
        ) : null}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Palier</TableHead>
                <TableHead>Récompense</TableHead>
                <TableHead className="text-right">Coût réel</TableHead>
                <TableHead className="text-right">Dû</TableHead>
                <TableHead className="text-right">Engagé</TableHead>
                <TableHead>La plus proche</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => {
                const pct =
                  r.closestCumul !== null && r.seuilVues > 0
                    ? Math.round((r.closestCumul / r.seuilVues) * 1000) / 10
                    : null;
                return (
                  <TableRow key={`${r.seuilVues}|${r.libelle ?? ""}`}>
                    <TableCell className="text-xs tabular-nums text-slate-600">
                      {formatViews(r.seuilVues)} vues
                    </TableCell>
                    <TableCell className="text-xs font-medium text-slate-700">
                      {r.libelle ?? "récompense"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {r.coutReel === null ? (
                        <span
                          className="cursor-help text-amber-700"
                          title="Coût réel non renseigné : cette récompense n'entre dans aucun total. À saisir dans Barèmes."
                        >
                          —
                        </span>
                      ) : (
                        convertedValue(toDisplayAmount(r.coutReel, fxCtx))
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {r.dueCount > 0 ? (
                        <span className="font-medium text-rose-600">
                          {formatNumber(r.dueCount)}
                        </span>
                      ) : (
                        <span className="text-slate-300">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-slate-500">
                      {formatNumber(r.engagedCount)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {r.closestCreatorName === null || r.closestCumul === null ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <>
                          {r.closestCreatorName}{" "}
                          <span className="tabular-nums text-slate-400">
                            {formatViews(r.closestCumul)}
                          </span>{" "}
                          {pct !== null ? (
                            <Badge
                              variant="outline"
                              className="border-slate-200 bg-slate-50 text-[10px] tabular-nums text-slate-500"
                            >
                              {formatNumber(pct)} %
                            </Badge>
                          ) : null}
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
