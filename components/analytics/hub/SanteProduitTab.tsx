"use client";

import { useMemo } from "react";
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
import { HubCardHeader, pct, formatDuration } from "./HubPrimitives";
import type { ProductAnalyticsData } from "./types";

/**
 * Onglet SANTÉ PRODUIT (B2) — fiabilité des scans, résultats de recherche (avec
 * le trou d'instrumentation affiché explicitement), latence perçue par taille de
 * compte, et points de friction. Le scan de détection produit la valeur du
 * produit : s'il échoue en silence, l'utilisateur croit qu'il ne s'est rien passé.
 */

const BUCKET_LABELS: Record<string, string> = {
  "<1k": "Scan < 1k abonnés",
  "1k-10k": "Scan 1k–10k",
  "10k-100k": "Scan 10k–100k",
  "100k+": "Scan 100k+",
};

const RESULT_LABELS: Record<string, string> = {
  found: "Trouvé",
  private: "Compte privé",
  not_found: "Introuvable",
  error: "Erreur",
};

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
  // Fiabilité des scans, agrégée par mode (échec = result ≠ « success »).
  const scans = useMemo(() => {
    const byMode = new Map<string, { runs: number; failures: number }>();
    for (const r of analytics.scanReliability.rows) {
      const cur = byMode.get(r.mode) ?? { runs: 0, failures: 0 };
      cur.runs += r.runs;
      if (r.result !== "success" && r.result !== "(sans result)") {
        cur.failures += r.runs;
      }
      byMode.set(r.mode, cur);
    }
    return [...byMode.entries()]
      .map(([mode, x]) => ({
        mode,
        runs: x.runs,
        failures: x.failures,
        rate: x.runs > 0 ? Math.round((x.failures / x.runs) * 1000) / 10 : null,
      }))
      .sort((a, b) => b.runs - a.runs);
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

  return (
    <div className="space-y-6">
      {/* Fiabilité des scans */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Fiabilité des scans"
            subtitle="Le scan de détection produit la valeur du produit. S'il échoue, l'utilisateur croit qu'il ne s'est rien passé."
          />
          {scans.length === 0 ? (
            <p className="text-xs text-slate-400">— en attente de scan_completed.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type de scan</TableHead>
                  <TableHead className="text-right">Exécutés</TableHead>
                  <TableHead className="text-right">Échecs</TableHead>
                  <TableHead className="text-right">Taux</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.map((s) => (
                  <TableRow key={s.mode}>
                    <TableCell className="text-xs font-medium text-slate-700">
                      {s.mode}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(s.runs)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatNumber(s.failures)}
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
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Résultats de recherche */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Résultats de recherche"
              subtitle="Ce que les gens obtiennent quand ils cherchent un compte."
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
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Étape</TableHead>
                  <TableHead className="text-right">Médiane</TableHead>
                  <TableHead className="text-right">9 sur 10</TableHead>
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
                      {BUCKET_LABELS[r.bucket] ?? r.bucket}
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
        </CardContent>
      </Card>
    </div>
  );
}
