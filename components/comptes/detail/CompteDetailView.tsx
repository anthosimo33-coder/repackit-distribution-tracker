"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  useSnapshotAge,
  snapshotQueryArgs,
} from "@/components/snapshot-age-selector/SnapshotAgeContext";
import {
  PublicationDetailDialog,
  type PublicationWithImage,
} from "@/components/PublicationDetailDialog";
import { PublicationEditDialog } from "@/components/PublicationEditDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import type { Compte } from "@/components/comptes/CompteDialog";
import { CompteDetailHeader } from "./CompteDetailHeader";
import { CompteStatsGrid } from "./CompteStatsGrid";
import { CompteCalendar } from "./CompteCalendar";
import { CompteFormatLists } from "./CompteFormatLists";

/**
 * Vue détail compte. Source unique des publications : listPublications (déjà
 * enrichie imageUrl + icp + displayMetrics), filtrée client-side par
 * `p.compte === compte.handle` (publications.compte est une string = handle).
 * Une seule query alimente stats + calendrier + liste, et fournit la donnée
 * complète aux dialogs détail/édition (mêmes que le tracker). La période
 * globale (SnapshotAgeSelector du header) pilote les displayMetrics côté
 * serveur.
 */
export function CompteDetailView({ compte }: { compte: Compte }) {
  const { age, customDay } = useSnapshotAge();
  const allPubs = useQuery(
    api.publications.listPublications,
    snapshotQueryArgs({ age, customDay }),
  );

  const publications = useMemo<PublicationWithImage[]>(
    () => (allPubs ?? []).filter((p) => p.compte === compte.handle),
    [allPubs, compte.handle],
  );

  // Dialogs partagés par le calendrier et les listes (pattern TrackerListSection :
  // détail en lecture → bouton Modifier → dialog d'édition).
  const [viewingPub, setViewingPub] = useState<PublicationWithImage | null>(
    null,
  );
  const [editingPub, setEditingPub] = useState<Doc<"publications"> | null>(
    null,
  );

  return (
    <div className="space-y-6">
      <CompteDetailHeader compte={compte} />

      {allPubs === undefined ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="mt-2 h-3 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Skeleton className="h-[28rem] w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <CompteStatsGrid publications={publications} />
          <CompteCalendar publications={publications} onView={setViewingPub} />
          <CompteFormatLists
            publications={publications}
            onView={setViewingPub}
          />
        </>
      )}

      {viewingPub && (
        <PublicationDetailDialog
          key={viewingPub._id}
          publication={viewingPub}
          open
          onOpenChange={(o) => !o && setViewingPub(null)}
          onEdit={() => {
            setEditingPub(viewingPub);
            setViewingPub(null);
          }}
        />
      )}

      {editingPub && (
        <PublicationEditDialog
          key={editingPub._id}
          publication={editingPub}
          open
          onOpenChange={(o) => !o && setEditingPub(null)}
        />
      )}
    </div>
  );
}
