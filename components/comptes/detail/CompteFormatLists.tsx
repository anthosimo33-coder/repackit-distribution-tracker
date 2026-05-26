"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getMediaType } from "@/lib/media-type";
import { FORMAT_CONFIGS, type FormatKey } from "@/lib/format-config";
import type { PublicationWithImage } from "@/components/PublicationDetailDialog";
import { CompteFormatList } from "./CompteFormatList";

const FORMAT_ORDER: FormatKey[] = ["carousel", "short", "screenrecorder"];

function pickDefaultTab(pubs: PublicationWithImage[]): FormatKey {
  const counts: Record<FormatKey, number> = {
    carousel: 0,
    short: 0,
    screenrecorder: 0,
  };
  for (const p of pubs) counts[getMediaType(p) as FormatKey] += 1;
  let best: FormatKey = "carousel";
  for (const key of FORMAT_ORDER) {
    if (counts[key] > counts[best]) best = key;
  }
  return best;
}

/**
 * Publications du compte groupées par format (Tabs). Onglet actif par défaut :
 * le format le plus représenté (sinon Carrousels).
 */
export function CompteFormatLists({
  publications,
  onView,
}: {
  publications: PublicationWithImage[];
  onView: (p: PublicationWithImage) => void;
}) {
  const groups = useMemo(() => {
    const g: Record<FormatKey, PublicationWithImage[]> = {
      carousel: [],
      short: [],
      screenrecorder: [],
    };
    for (const p of publications) g[getMediaType(p) as FormatKey].push(p);
    return g;
  }, [publications]);

  const [tab, setTab] = useState<FormatKey>(() => pickDefaultTab(publications));

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as FormatKey)}>
      <TabsList>
        {FORMAT_ORDER.map((key) => (
          <TabsTrigger key={key} value={key}>
            {FORMAT_CONFIGS[key].plural} ({groups[key].length})
          </TabsTrigger>
        ))}
      </TabsList>
      {FORMAT_ORDER.map((key) => (
        <TabsContent key={key} value={key} className="mt-4">
          <CompteFormatList
            publications={groups[key]}
            mediaType={key}
            onView={onView}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
