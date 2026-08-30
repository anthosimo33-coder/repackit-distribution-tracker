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
import { formatViews } from "@/lib/format-rate";
import { HubCardHeader, HubEmptyState, dash } from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
import { UsersIcon } from "lucide-react";
import { NatureRewardsCard } from "./NatureRewardsCard";
import type { CurrencyContext } from "@/lib/currency-display";
import type {
  AttributionData,
  NatureRewardsData,
  ViewCountersData,
} from "./types";

/**
 * Onglet ACQUISITION — les trois compteurs de vues (jamais additionnés),
 * l'efficacité par créatrice, et les jours solo (seule attribution honnête sans
 * lien tracké). Toutes ces données sont produites en phase A ; ici on affiche.
 */

/** "YYYY-MM-DD" → "28 juil." (midi local pour éviter tout décalage de fuseau). */
function frDay(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export function AcquisitionTab({
  attribution,
  viewCounters,
  natureRewards,
  revenueCurrency,
}: {
  attribution: AttributionData;
  viewCounters: ViewCountersData | undefined;
  natureRewards: NatureRewardsData | undefined;
  /** Devise du REVENU — celle dans laquelle tout le hub s'affiche. */
  revenueCurrency: string | null | undefined;
}) {
  const fxCtx: CurrencyContext = {
    payCurrency: attribution.payCurrency,
    revenueCurrency,
    fxRateToRevenue: attribution.fxRateToRevenue,
  };
  return (
    <div className="space-y-6">
      {/* Récompenses en nature — dû (dépense) vs engagé (promesse). Placée ici :
          ce sont les cumuls de vues de cet onglet qui font tomber les paliers. */}
      <NatureRewardsCard data={natureRewards} fxCtx={fxCtx} />

      {/* Quatre compteurs de vues */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Vues — quatre compteurs"
            subtitle="Jamais mélangés, jamais additionnés. Chacun a un seul usage."
            info={EXPLAIN.troisCompteurs}
          />
          {viewCounters === undefined ? (
            <p className="text-sm text-slate-400">—</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Compteur</TableHead>
                  <TableHead className="text-right">Vues</TableHead>
                  <TableHead>Sert à</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs font-medium text-slate-700">
                    Totales
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatViews(viewCounters.totales)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">
                    {viewCounters.usage.totales}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs font-medium text-slate-700">
                    Payables
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatViews(viewCounters.payables)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">
                    {viewCounters.usage.payables}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs font-medium text-slate-700">
                    Promo{" "}
                    <Badge
                      variant="outline"
                      className="text-[10px] text-slate-500"
                    >
                      non-warmup
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-semibold">
                    {formatViews(viewCounters.promo)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">
                    {viewCounters.usage.promo}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs font-medium text-slate-700">
                    Paliers{" "}
                    <Badge
                      variant="outline"
                      className="text-[10px] text-slate-500"
                    >
                      rémunéré + promo
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatViews(viewCounters.paliers)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-400">
                    {viewCounters.usage.paliers}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Efficacité par créatrice */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Efficacité par créatrice"
            subtitle="La médiane prédit la prochaine vidéo, le taux de vidéos à succès prédit le volume du mois. La moyenne ne prédit rien, non calculée."
            info={EXPLAIN.efficaciteCreatrice}
          />
          {attribution.creators.length === 0 ? (
            <HubEmptyState
              compact
              icon={UsersIcon}
              title="Aucune vidéo promo"
              description="Les statistiques par créatrice apparaissent dès qu'une vidéo non-warmup est publiée."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Créatrice</TableHead>
                  <TableHead className="text-right">Vidéos</TableHead>
                  <TableHead className="text-right">Médiane</TableHead>
                  <TableHead className="text-right">Hit &gt; 50k</TableHead>
                  <TableHead className="text-right">Vues promo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attribution.creators.map((c) => (
                  <TableRow key={c.creatorId}>
                    <TableCell className="text-xs font-medium text-slate-700">
                      {c.creatorName}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {c.videos}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {dash(c.medianViews, formatViews)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-medium">
                      {c.hitCount}/{c.videos}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatViews(c.promoViews)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Jours solo */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Jours solo"
            subtitle="Une seule créatrice a publié en promo : les inscriptions lui reviennent sans ambiguïté. Sans lien tracké, c'est la seule attribution honnête."
            info={EXPLAIN.joursSolo}
          />
          {!attribution.attributionAvailable ? (
            <p className="text-xs text-slate-400">
              — la série quotidienne PostHog n&apos;est pas encore disponible.
            </p>
          ) : attribution.soloDays.length === 0 ? (
            <p className="text-xs text-slate-400">
              — aucune publication promo sur la fenêtre.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jour</TableHead>
                  <TableHead>Créatrice</TableHead>
                  <TableHead className="text-right">Vues promo</TableHead>
                  <TableHead className="text-right">Visites</TableHead>
                  <TableHead className="text-right">Inscrits</TableHead>
                  <TableHead className="text-right">Abonnés</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attribution.soloDays.map((d) => (
                  <TableRow key={d.day}>
                    <TableCell className="text-xs tabular-nums text-slate-600">
                      {frDay(d.day)}
                    </TableCell>
                    {d.isSolo && d.attribution ? (
                      <>
                        <TableCell className="text-xs text-slate-700">
                          {d.attribution.creatorName}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatViews(d.promoViews)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {dash(d.attribution.visitors)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {dash(d.attribution.signups)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums font-semibold">
                          {dash(d.attribution.clients)}
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="text-xs text-slate-400">
                          {d.creators.length} créatrices
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-400">
                          {formatViews(d.promoViews)}
                        </TableCell>
                        <TableCell
                          colSpan={3}
                          className="text-right text-xs text-slate-400"
                        >
                          non attribuable
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-slate-400">
            Étaler les publications au lieu de grouper plusieurs vidéos le même jour
            multiplie ces jours certains, sans rien coûter.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
