"use client";

import { use } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { ClipDetailScreen } from "@/components/clip/ClipDetailScreen";

/**
 * Fiche d'un clip — vue admin (lecture seule) de l'espace d'un CLIPPEUR. Même
 * écran que /clip/clips/[id], alimenté par `getClipDetailAsAdmin`.
 *
 * Le segment est [clipId] car [id] désigne déjà le créateur observé (même raison
 * que [assignmentId] côté partenaire).
 *
 * L'isolation ne tient PAS à cette route : le cœur partagé renvoie `null` pour un
 * assignment qui n'appartient pas au clippeur ciblé, et le wrapper refuse une
 * fiche qui n'est pas de population clippeur.
 */
export default function ViewAsClipDetailPage({
  params,
}: {
  params: Promise<{ clipId: string }>;
}) {
  const { clipId } = use(params);
  return <ClipDetailScreen clipId={clipId as Id<"assignments">} />;
}
