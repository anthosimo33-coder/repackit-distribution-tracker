"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  buildRetentionGrid,
  computeConversion,
  type CohortInput,
} from "@/lib/analytics-hub";
import { ConversionTable, RetentionHeatmap } from "./HubCharts";
import {
  AwaitingEvents,
  CorrelationNote,
  HubCardHeader,
} from "./HubPrimitives";
import type { ProductAnalyticsData } from "./types";

/**
 * Onglet COHORTES — rétention par cohorte d'inscription et prédicteurs
 * d'abonnement. C'est le découpage COMPORTEMENTAL qui a de la valeur : « avec
 * squad vs sans squad » transforme une courbe en hypothèse actionnable. Le
 * garde-fou d'effectif s'applique partout (cohorte grisée + badge sous n = 30)
 * et le rappel corrélation ≠ causalité accompagne chaque conclusion suggérée.
 */

const PREDICTOR_LABELS: Record<string, string> = {
  squad: "A rejoint une squad",
  alerts_3: "A reçu ≥ 3 alertes",
  targets_2: "A ajouté 2 cibles",
  push_enabled: "A activé les notifications",
  referral_shared: "A partagé un parrainage",
};

const SEGMENTS = [
  { key: "all", label: "Toutes" },
  { key: "squad", label: "Avec squad" },
  { key: "no_squad", label: "Sans squad" },
  { key: "single_target", label: "1 cible" },
  { key: "multi_target", label: "Plusieurs cibles" },
] as const;
type SegmentKey = (typeof SEGMENTS)[number]["key"];

/** Fusionne deux ventilations disjointes (même cohorte ⇒ même ancienneté). */
function mergeCohorts(a: CohortInput[], b: CohortInput[]): CohortInput[] {
  const byCohort = new Map<string, CohortInput>();
  for (const c of [...a, ...b]) {
    const cur = byCohort.get(c.cohort);
    if (!cur) {
      byCohort.set(c.cohort, {
        cohort: c.cohort,
        size: c.size,
        retainedByWeek: [...c.retainedByWeek],
      });
      continue;
    }
    cur.size += c.size;
    const width = Math.max(cur.retainedByWeek.length, c.retainedByWeek.length);
    cur.retainedByWeek = Array.from(
      { length: width },
      (_, i) => (cur.retainedByWeek[i] ?? 0) + (c.retainedByWeek[i] ?? 0),
    );
  }
  return [...byCohort.values()];
}

export function CohortsTab({ analytics }: { analytics: ProductAnalyticsData }) {
  const [segment, setSegment] = useState<SegmentKey>("all");

  const bySegment = useMemo(() => {
    const map = new Map<string, CohortInput[]>();
    for (const s of analytics.cohorts.segments) map.set(s.key, s.cohorts);
    return map;
  }, [analytics.cohorts.segments]);

  const cohorts = useMemo((): CohortInput[] => {
    if (segment === "all") {
      // « Toutes » = réunion des deux moitiés d'une même ventilation.
      return mergeCohorts(
        bySegment.get("squad") ?? [],
        bySegment.get("no_squad") ?? [],
      );
    }
    return bySegment.get(segment) ?? [];
  }, [bySegment, segment]);

  const weeks = useMemo(
    () =>
      cohorts.reduce((m, c) => Math.max(m, c.retainedByWeek.length), 0) || 0,
    [cohorts],
  );

  const rows = useMemo(
    () =>
      buildRetentionGrid(
        [...cohorts].sort((a, b) => (a.cohort < b.cohort ? 1 : -1)),
        weeks,
      ),
    [cohorts, weeks],
  );

  const predictorRows = computeConversion(
    analytics.predictors.behaviors.map((b) => ({
      key: b.key,
      label: PREDICTOR_LABELS[b.key] ?? b.key,
      n: b.n,
      converted: b.converted,
    })),
  );
  const baseline =
    analytics.predictors.total > 0
      ? Math.round(
          (analytics.predictors.totalConverted / analytics.predictors.total) *
            1000,
        ) / 10
      : null;

  return (
    <div className="space-y-6">
      {/* ─── Rétention ───────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <HubCardHeader
            title="Rétention par cohorte d'inscription"
            subtitle="Part de la cohorte encore active à S+n. Découpable par comportement — c'est ce découpage qui rend la courbe actionnable."
            action={
              <div className="flex flex-wrap gap-1">
                {SEGMENTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSegment(s.key)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                      segment === s.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            }
          />
          {rows.length > 0 && weeks > 0 ? (
            <>
              <RetentionHeatmap rows={rows} weeks={weeks} />
              <CorrelationNote />
            </>
          ) : (
            <AwaitingEvents
              compact
              what="les inscriptions et l'activité qui suit (`signup_completed`, puis tout événement)"
            />
          )}
        </CardContent>
      </Card>

      {/* ─── Prédicteurs ─────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <HubCardHeader
            title="Prédicteurs d'abonnement"
            subtitle={
              baseline === null
                ? "Facteur de conversion de chaque comportement vs la moyenne."
                : `Facteur de conversion vs la moyenne (${baseline} % sur ${analytics.predictors.total} inscrits).`
            }
          />
          {analytics.predictors.total > 0 ? (
            <>
              <ConversionTable
                rows={predictorRows}
                baseline={baseline}
                labelHeader="Comportement"
                nHeader="Inscrits"
                convertedHeader="Abonnés"
                showLift
              />
              <CorrelationNote />
            </>
          ) : (
            <AwaitingEvents
              compact
              what="les événements de comportement (squad, alertes, cibles, notifications, parrainage)"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
