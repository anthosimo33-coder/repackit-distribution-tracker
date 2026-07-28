"use client";

import { Fragment, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
  // Fiabilité des scans par MODE, avec le détail par RAISON (result) sous chaque
  // mode. La granularité vient de l'app : elle n'émet plus que `full`/`light` (la
  // distinction baseline/scheduled a disparu). Le calcul, lui, est inchangé.
  const scans = useMemo(() => {
    const byMode = new Map<
      string,
      { runs: number; failures: number; results: { result: string; runs: number }[] }
    >();
    for (const r of analytics.scanReliability.rows) {
      const cur = byMode.get(r.mode) ?? { runs: 0, failures: 0, results: [] };
      cur.runs += r.runs;
      if (isScanFailure(r.result)) cur.failures += r.runs;
      cur.results.push({ result: r.result, runs: r.runs });
      byMode.set(r.mode, cur);
    }
    return [...byMode.entries()]
      .map(([mode, x]) => ({
        mode,
        runs: x.runs,
        failures: x.failures,
        rate: x.runs > 0 ? Math.round((x.failures / x.runs) * 1000) / 10 : null,
        results: x.results.sort((a, b) => b.runs - a.runs),
      }))
      .sort((a, b) => b.runs - a.runs);
  }, [analytics.scanReliability.rows]);

  // Ventilation par DÉCLENCHEMENT (baseline / planifié) — s'allume quand
  // scan_trigger revient ; sinon la régression est signalée en clair sur la carte.
  const trigger = useMemo(() => {
    const rows = analytics.scanReliability.rows;
    const emitted = rows.some(
      (r) => r.trigger && r.trigger !== "(inconnu)" && r.trigger !== "(absent)",
    );
    const byKey = new Map<
      string,
      { mode: string; trigger: string; runs: number; failures: number }
    >();
    for (const r of rows) {
      const trig = r.trigger ?? "(inconnu)";
      const key = `${r.mode}|${trig}`;
      const cur = byKey.get(key) ?? { mode: r.mode, trigger: trig, runs: 0, failures: 0 };
      cur.runs += r.runs;
      if (isScanFailure(r.result)) cur.failures += r.runs;
      byKey.set(key, cur);
    }
    return {
      emitted,
      rows: [...byKey.values()]
        .map((x) => ({
          ...x,
          rate: x.runs > 0 ? Math.round((x.failures / x.runs) * 1000) / 10 : null,
        }))
        .sort((a, b) => b.runs - a.runs),
    };
  }, [analytics.scanReliability.rows]);

  // Résultats de recherche + trou d'instrumentation (submitted sans result émis).
  const search = useMemo(() => {
    const submitted = personCount(analytics, "handle_submitted");
    const withResult = personCount(analytics, "handle_search_result");
    const silent =
      submitted !== null && withResult !== null
        ? Math.max(0, submitted - withResult)
        : null;
    return { rows: analytics.searchResults.rows, submitted, silent };
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
          {/* Régression de visibilité VISIBLE sur la carte, pas seulement en note. */}
          {!trigger.emitted && scans.length > 0 ? (
            <HubNotice>
              <strong>Perte de visibilité.</strong> L&apos;app n&apos;émet plus la
              distinction baseline / planifié, seulement <code>full</code> /{" "}
              <code>light</code>. Le scan planifié complet (<code>scheduled_full</code>),
              celui qui détecte les désabonnements, n&apos;est plus isolable : on est
              passé de 27,5 % d&apos;échec mesurés sur ce scan précis à un agrégat qui
              mélange tout. La ventilation par déclenchement ci-dessous s&apos;allumera
              d&apos;elle-même dès le retour de <code>scan_trigger</code>.
            </HubNotice>
          ) : null}
          {scans.length === 0 ? (
            <p className="text-xs text-slate-400">— en attente de scan_completed.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type de scan · raison</TableHead>
                  <TableHead className="text-right">Exécutés</TableHead>
                  <TableHead className="text-right">Taux d&apos;échec</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.map((s) => (
                  <Fragment key={s.mode}>
                    <TableRow className="bg-slate-50/70">
                      <TableCell className="text-xs font-semibold text-slate-800">
                        {s.mode}
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
                      <TableRow key={`${s.mode}-${r.result}`}>
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
          {/* Ventilation par déclenchement — allumée dès que scan_trigger revient. */}
          {trigger.emitted ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">
                Par déclenchement (baseline / planifié)
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type · déclenchement</TableHead>
                    <TableHead className="text-right">Exécutés</TableHead>
                    <TableHead className="text-right">Taux d&apos;échec</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trigger.rows.map((t) => (
                    <TableRow key={`${t.mode}-${t.trigger}`}>
                      <TableCell className="text-xs font-medium text-slate-700">
                        {t.mode} · {t.trigger}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatNumber(t.runs)}
                      </TableCell>
                      <TableCell
                        className={
                          (t.rate ?? 0) > 15
                            ? "text-right text-xs tabular-nums font-semibold text-red-600"
                            : "text-right text-xs tabular-nums font-semibold"
                        }
                      >
                        {pct(t.rate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          <p className="text-xs text-slate-400">
            Le calcul du taux d&apos;échec (échecs / exécutés) est inchangé ; seule la
            granularité du déclenchement a été perdue côté app.
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
                {search.silent !== null && search.silent > 0 ? (
                  <TableRow>
                    <TableCell className="text-xs font-semibold text-red-700">
                      Aucun résultat émis
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-semibold text-red-700">
                      {formatNumber(search.silent)}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
            <p className="text-xs text-slate-400">
              Le chemin d&apos;échec de recherche n&apos;émet aucun event : ces
              personnes sont invisibles (trou d&apos;instrumentation, pas un zéro).
              Calculé comme <code>handle_submitted</code> −{" "}
              <code>handle_search_result</code>.
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
