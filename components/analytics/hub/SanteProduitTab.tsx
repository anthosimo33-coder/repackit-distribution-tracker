"use client";

import { Fragment, useMemo } from "react";
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
import { HubCardHeader, HubNotice, ColLabel, pct, formatDuration } from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
import type { ProductAnalyticsData } from "./types";

/**
 * Onglet SANTÉ PRODUIT (B2) — fiabilité des scans (avec le DÉTAIL PAR RAISON, plus
 * utile que le taux global), résultats de recherche, latence perçue, points de
 * friction. Le scan de détection produit la valeur du produit : s'il échoue en
 * silence, l'utilisateur croit qu'il ne s'est rien passé.
 */

const RESULT_LABELS: Record<string, string> = {
  found: "Trouvé",
  private: "Compte privé",
  not_found: "Introuvable",
  error: "Erreur",
  // Émis « paywalled » à venir (dev) : la ligne devient mesurée au lieu de déduite.
  paywalled: "Bloqués par le paywall avant résultat",
};

/** Déclenchements de scan (`reason`), scheduled_full en tête (détecte les unfollows). */
const REASON_ORDER = ["scheduled_full", "scheduled_light", "baseline", "manual_refresh"];
const REASON_LABELS: Record<string, string> = {
  scheduled_full: "Planifié complet",
  scheduled_light: "Planifié léger",
  baseline: "Baseline",
  manual_refresh: "Rafraîchissement manuel",
};

/** Résultats de scan (success/error) — libellés lisibles pour le détail par raison. */
const SCAN_RESULT_LABELS: Record<string, string> = {
  success: "Réussi",
  error: "Erreur",
  timeout: "Délai dépassé",
  "(sans result)": "Sans résultat émis",
};

/** Un result de scan qui n'est ni un succès ni un vide compte comme un échec. */
function isScanFailure(result: string): boolean {
  return result !== "success" && result !== "(sans result)";
}

function personCount(analytics: ProductAnalyticsData, event: string): number | null {
  return (
    analytics.instrumentation.events.find((e) => e.name === event)?.persons ?? null
  );
}

export function SanteProduitTab({
  analytics,
}: {
  analytics: ProductAnalyticsData;
}) {
  // Fiabilité des scans ventilée par DÉCLENCHEMENT (`reason`) : baseline /
  // scheduled_light / scheduled_full / manual_refresh (émis depuis le 28/07).
  // scheduled_full est le scan qui détecte les désabonnements → mis en évidence.
  // Le détail par result (réussi / erreur) reste sous chaque déclenchement.
  const scansByReason = useMemo(() => {
    const byReason = new Map<
      string,
      { runs: number; failures: number; results: { result: string; runs: number }[] }
    >();
    for (const r of analytics.scanReliability.rows) {
      const reason = r.reason ?? "(sans reason)";
      const cur = byReason.get(reason) ?? { runs: 0, failures: 0, results: [] };
      cur.runs += r.runs;
      if (isScanFailure(r.result)) cur.failures += r.runs;
      const ex = cur.results.find((x) => x.result === r.result);
      if (ex) ex.runs += r.runs;
      else cur.results.push({ result: r.result, runs: r.runs });
      byReason.set(reason, cur);
    }
    return [...byReason.entries()]
      .map(([reason, x]) => ({
        reason,
        runs: x.runs,
        failures: x.failures,
        rate: x.runs > 0 ? Math.round((x.failures / x.runs) * 1000) / 10 : null,
        results: x.results.sort((a, b) => b.runs - a.runs),
        isUnfollowScan: reason === "scheduled_full",
      }))
      .sort((a, b) => {
        const oa = REASON_ORDER.indexOf(a.reason);
        const ob = REASON_ORDER.indexOf(b.reason);
        return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob) || b.runs - a.runs;
      });
  }, [analytics.scanReliability.rows]);

  // Résultats de recherche. Les gens sans accès sont BLOQUÉS par le paywall avant
  // que la recherche s'exécute : ce n'est pas un trou de mesure, c'est un choix
  // produit. Tant que le dev n'émet pas result « paywalled », on les DÉDUIT
  // (handle_submitted − handle_search_result) ; dès qu'il l'émet, la ligne est
  // MESURÉE (elle apparaît directement dans searchResults).
  const search = useMemo(() => {
    const rows = analytics.searchResults.rows;
    const measured = rows.some((r) => r.result === "paywalled");
    const submitted = personCount(analytics, "handle_submitted");
    const withResult = personCount(analytics, "handle_search_result");
    const deducedPaywalled =
      submitted !== null && withResult !== null
        ? Math.max(0, submitted - withResult)
        : null;
    return { rows, measured, deducedPaywalled };
  }, [analytics]);

  // Ventilation de la friction par ÉTAPE d'onboarding : émise ? (point 10).
  const stepRows = analytics.frictionByStep.rows;
  const stepEmitted = stepRows.some(
    (r) => r.step !== "(inconnu)" && r.step !== "(absent)",
  );

  return (
    <div className="space-y-6">
      {/* Fiabilité des scans — détail par raison */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Fiabilité des scans"
            subtitle="Le scan de détection produit la valeur du produit. Le détail par raison est plus parlant que le taux global."
            info={EXPLAIN.fiabiliteScans}
          />
          {scansByReason.length === 0 ? (
            <p className="text-xs text-slate-400">— en attente de scan_completed.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Déclenchement · résultat</TableHead>
                  <TableHead className="text-right">Exécutés</TableHead>
                  <TableHead className="text-right">Taux d&apos;échec</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scansByReason.map((s) => (
                  <Fragment key={s.reason}>
                    <TableRow className={s.isUnfollowScan ? "bg-primary/5" : "bg-slate-50/70"}>
                      <TableCell className="text-xs font-semibold text-slate-800">
                        <span className="inline-flex items-center gap-1.5">
                          {REASON_LABELS[s.reason] ?? s.reason}
                          {s.isUnfollowScan ? (
                            <Badge
                              variant="outline"
                              className="border-primary/30 bg-primary/10 text-[10px] text-primary"
                            >
                              détecte les désabonnements
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums font-medium">
                        {formatNumber(s.runs)}
                      </TableCell>
                      <TableCell
                        className={
                          (s.rate ?? 0) > 15
                            ? "text-right text-xs tabular-nums font-semibold text-red-600"
                            : "text-right text-xs tabular-nums font-semibold"
                        }
                      >
                        {pct(s.rate)}
                      </TableCell>
                    </TableRow>
                    {s.results.map((r) => (
                      <TableRow key={`${s.reason}-${r.result}`}>
                        <TableCell
                          className={
                            isScanFailure(r.result)
                              ? "pl-6 text-xs text-red-600"
                              : "pl-6 text-xs text-slate-500"
                          }
                        >
                          {SCAN_RESULT_LABELS[r.result] ?? r.result}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-500">
                          {formatNumber(r.runs)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-400">
                          {pct(s.runs > 0 ? Math.round((r.runs / s.runs) * 1000) / 10 : null)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-slate-400">
            <code>scheduled_full</code> est le scan planifié complet : c&apos;est lui
            qui détecte les désabonnements, donc le plus important à garder fiable. Taux
            d&apos;échec = échecs / exécutés.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Résultats de recherche */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Résultats de recherche"
              subtitle="Ce que les gens obtiennent quand ils cherchent un compte."
              info={EXPLAIN.resultatsRecherche}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Résultat</TableHead>
                  <TableHead className="text-right">Personnes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {search.rows.map((r) => (
                  <TableRow key={r.result}>
                    <TableCell className="text-xs text-slate-600">
                      {RESULT_LABELS[r.result] ?? r.result}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(r.persons)}
                    </TableCell>
                  </TableRow>
                ))}
                {!search.measured &&
                search.deducedPaywalled !== null &&
                search.deducedPaywalled > 0 ? (
                  <TableRow>
                    <TableCell className="text-xs font-semibold text-amber-700">
                      Bloqués par le paywall avant résultat{" "}
                      <span className="font-normal text-slate-400">(déduit)</span>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-semibold text-amber-700">
                      {formatNumber(search.deducedPaywalled)}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
            <p className="text-xs text-slate-400">
              Ces personnes ont saisi un nom, puis le hard paywall les intercepte avant
              que la recherche s&apos;exécute : un choix produit, pas un trou de mesure.
              Déduit par <code>handle_submitted</code> −{" "}
              <code>handle_search_result</code> tant que le dev n&apos;émet pas result «{" "}
              paywalled », mesuré ensuite.
            </p>
          </CardContent>
        </Card>

        {/* Latence perçue */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Latence perçue"
              subtitle="Temps d'attente du scan, par taille de compte."
              info={EXPLAIN.latencePercue}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Étape</TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="Médiane" info={EXPLAIN.medianeP90} />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColLabel label="9 sur 10" info={EXPLAIN.medianeP90} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs text-slate-600">
                    Recherche du compte
                  </TableCell>
                  <TableCell colSpan={2} className="text-right text-xs text-slate-400">
                    non mesurable (pas de durée émise)
                  </TableCell>
                </TableRow>
                {analytics.scanLatency.rows.map((r) => (
                  <TableRow key={r.bucket}>
                    <TableCell className="text-xs text-slate-600">
                      {`Scan ${r.bucket}`}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatDuration(r.medianMs)}
                    </TableCell>
                    <TableCell
                      className={
                        (r.p90Ms ?? 0) > 60_000
                          ? "text-right text-xs tabular-nums font-semibold text-red-600"
                          : "text-right text-xs tabular-nums"
                      }
                    >
                      {formatDuration(r.p90Ms)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-slate-400">
              Si la durée ne croît pas avec la taille du compte, c&apos;est de la
              file d&apos;attente, pas du volume.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Points de friction */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Points de friction"
            subtitle="Clics répétés au même endroit en quelques secondes — le signal de frustration le plus fiable."
            info={EXPLAIN.pointsFriction}
          />
          {analytics.friction.rows.length === 0 ? (
            <p className="text-xs text-slate-400">— aucun rageclick sur la fenêtre.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page</TableHead>
                  <TableHead className="text-right">Personnes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.friction.rows.map((r) => (
                  <TableRow key={r.page}>
                    <TableCell className="text-xs tabular-nums text-slate-600">
                      {r.page}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(r.persons)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Ventilation par étape d'onboarding — provisionnée, en attente d'émission. */}
          {stepEmitted ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">
                Friction d&apos;onboarding par étape
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Étape</TableHead>
                    <TableHead className="text-right">Personnes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stepRows.map((r) => (
                    <TableRow key={r.step}>
                      <TableCell className="text-xs text-slate-600">{r.step}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(r.persons)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <HubNotice className="border-slate-200 bg-slate-50 text-slate-600">
              Sur <code>/onboarding</code>, on ne sait pas QUELLE étape frustre : les
              9 écrans partagent la même adresse, de la saisie du handle jusqu&apos;au
              paywall. Ça change tout, entre la saisie du handle et le paywall.
              Impossible de trancher tant que l&apos;app n&apos;émet pas le numéro
              d&apos;étape (<code>onboarding_step</code> sur le rageclick). La
              ventilation par étape est prête et s&apos;allumera d&apos;elle-même dès
              que la propriété sera émise.
            </HubNotice>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
