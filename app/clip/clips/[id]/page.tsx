import { ClipDetailScreen } from "@/components/clip/ClipDetailScreen";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Fiche d'UN clip — script, consignes, dépôt du montage, publication. Route à
 * part de la liste : un montage se fait écran plein.
 *
 * L'isolation ne tient PAS à cette route : `getMyClip` renvoie `null` pour un
 * assignment qui n'appartient pas au clippeur authentifié (clipperQuery +
 * contrôle d'appartenance), donc un id deviné ne montre rien.
 */
export default async function ClipDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClipDetailScreen clipId={id as Id<"assignments">} />;
}
