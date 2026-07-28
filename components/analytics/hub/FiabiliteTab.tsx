"use client";

import { useMemo } from "react";
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
import { formatNumber, formatDate } from "@/lib/format";
import { buildCoherenceChecks, type CoherenceStatus } from "@/lib/analytics-hub";
import { HubCardHeader } from "./HubPrimitives";
import { EXPLAIN } from "./explanations";
import type { ReliabilityData } from "./types";

/**
 * Onglet FIABILITÉ (C1) — état de l'instrumentation, contrôles de cohérence, ce
 * qui n'est pas mesurable (avec la raison), fraîcheur par source. La query
 * getReliability fournit les chiffres bruts ; les contrôles sont composés ici
 * par le module pur (buildCoherenceChecks), côté client.
 */

/** Au-delà de ce délai, une source est signalée périmée. */
const STALE_MS = 12 * 60 * 60 * 1000;

const SOURCE_LABELS: Record<string, string> = {
  posthog: "PostHog",
  whop: "Whop",
  scraping: "Vues (scraping)",
};

/** Ce qui n'est pas mesurable, avec la raison. Curé — un trou caché fait décider sur du vide. */
const NOT_MEASURABLE: { what: string; why: string }[] = [
  { what: "Désabonnements", why: "peu d'événements subscription_cancelled émis" },
  { what: "Échecs de recherche", why: "le chemin d'erreur n'émet aucun event" },
  { what: "Détail des échecs de paiement", why: "propriété cause absente sur payment_failed" },
  { what: "Latence de recherche", why: "pas de durée émise sur handle_search_result" },
  { what: "Net par variante A/B", why: "la variante n'est pas portée par le paiement" },
  { what: "Journal des changements d'offre", why: "nécessite une table dédiée (saisie admin)" },
];

function StatusBadge({ status }: { status: CoherenceStatus }) {
  if (status === "ok") {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        OK
      </Badge>
    );
  }
  if (status === "info") {
    return (
      <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
        info
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
      écart
    </Badge>
  );
}

export function FiabiliteTab({
  reliability,
  now,
}: {
  reliability: ReliabilityData;
  now: number;
}) {
  const checks = useMemo(() => {
    const c = reliability.coherence;
    return buildCoherenceChecks({
      sequentialSteps: c.sequentialSteps.map((s) => ({
        key: s.key,
        label: s.key,
        count: s.count,
      })),
      reachSteps: c.reachSteps.map((s) => ({ key: s.key, label: s.key, count: s.count })),
      currencyCount: c.currencyCount,
      dashboardClients: c.dashboardClients,
      whopMembers: c.whopMembers,
      whopExcludedPre: c.whopExcludedPre,
      whopExcludedAfter: c.whopExcludedAfter,
      dailyClientsSum: c.dailyClientsSum,
      dailySignupsSum: c.dailySignupsSum,
    });
  }, [reliability.coherence]);

  return (
    <div className="space-y-6">
      {/* État de l'instrumentation */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="État de l'instrumentation"
            subtitle="Chaque event du contrat, son volume et sa santé. Une carte qui dépend d'un event manquant affiche son état, pas un zéro."
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead className="text-right">Personnes</TableHead>
                  <TableHead className="text-right">Première émission</TableHead>
                  <TableHead className="text-right">État</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reliability.instrumentation.events.map((e) => (
                  <TableRow key={e.name}>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {e.name}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {e.persons === 0 ? "—" : formatNumber(e.persons)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-slate-500">
                      {e.firstSeenMs === null ? "—" : formatDate(e.firstSeenMs)}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.persons === 0 ? (
                        <Badge
                          variant="outline"
                          className={
                            e.notYetEmitted
                              ? "border-slate-200 bg-slate-50 text-slate-500"
                              : "border-red-200 bg-red-50 text-red-700"
                          }
                        >
                          {e.notYetEmitted ? "attendu, absent" : "absent"}
                        </Badge>
                      ) : e.note ? (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 text-amber-700"
                          title={e.note}
                        >
                          à surveiller
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 text-emerald-700"
                        >
                          sain
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {reliability.instrumentation.props.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">
                Propriétés sondées
              </p>
              <div className="flex flex-wrap gap-1.5">
                {reliability.instrumentation.props.map((p) => (
                  <Badge
                    key={p.key}
                    variant="outline"
                    className={
                      p.present > 0
                        ? "border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700"
                        : "border-slate-200 bg-slate-50 text-[11px] text-slate-500"
                    }
                    title={`${p.present} events (sur ${p.onEvent})`}
                  >
                    {p.key} · {p.present > 0 ? `émise (${formatNumber(p.present)})` : "absente"}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          <p className="text-xs text-slate-400">
            Comptes internes exclus partout, des DEUX côtés :{" "}
            <strong>{formatNumber(reliability.internalExcluded.persons)}</strong>{" "}
            personne(s) côté PostHog (sur{" "}
            {formatNumber(reliability.internalExcluded.totalPersons)}) et{" "}
            <strong>{formatNumber(reliability.whopInternalExcluded)}</strong>{" "}
            membership(s) côté Whop (le compte de test de l&apos;admin).
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Contrôles de cohérence */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Contrôles de cohérence"
              subtitle="Vérifiés à chaque synchro. Un écart remplace les chiffres au lieu de les afficher."
              info={EXPLAIN.gardeFous}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrôle</TableHead>
                  <TableHead>Détail</TableHead>
                  <TableHead className="text-right">État</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checks.map((c) => (
                  <TableRow key={c.key}>
                    <TableCell className="text-xs text-slate-600">{c.label}</TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {c.detail || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={c.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Ce qui n'est pas mesurable */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <HubCardHeader
              title="Ce qui n'est pas mesurable"
              subtitle="Affiché plutôt que masqué : un trou caché fait décider sur du vide."
            />
            <Table>
              <TableBody>
                {NOT_MEASURABLE.map((x) => (
                  <TableRow key={x.what}>
                    <TableCell className="text-xs font-medium text-slate-700">
                      {x.what}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400">{x.why}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Fraîcheur des données */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Fraîcheur des données"
            subtitle="Chaque source avec sa dernière synchro. Une donnée périmée est signalée avant d'être lue (au-delà de 12 h)."
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Dernière synchro</TableHead>
                <TableHead className="text-right">État</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reliability.freshness.map((f) => {
                const stale =
                  f.lastSyncMs === null || now - f.lastSyncMs > STALE_MS;
                return (
                  <TableRow key={f.source}>
                    <TableCell className="text-xs text-slate-600">
                      {SOURCE_LABELS[f.source] ?? f.source}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-slate-500">
                      {f.lastSyncMs === null ? "—" : formatDate(f.lastSyncMs)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="outline"
                        className={
                          stale
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }
                      >
                        {stale ? "périmé" : "frais"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
