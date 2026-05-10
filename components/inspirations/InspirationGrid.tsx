"use client";

import {
  InspirationCard,
  type InspirationCardData,
} from "./InspirationCard";

export function InspirationGrid({
  inspirations,
}: {
  inspirations: InspirationCardData[];
}) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {inspirations.map((i) => (
        <InspirationCard key={i._id} inspiration={i} />
      ))}
    </div>
  );
}
