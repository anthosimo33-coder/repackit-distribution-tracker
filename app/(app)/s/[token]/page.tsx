import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { PublicSharePage } from "@/components/share/PublicSharePage";

/**
 * Lien public d'un dashboard. Route hors session (proxy.ts, AppShell).
 *
 * Le titre est lu côté serveur pour l'aperçu du lien (WhatsApp, Slack,
 * iMessage) : un robot d'aperçu n'exécute pas le JavaScript de la page. Même
 * lecture que la page — un lien invalide ne révèle pas davantage ici.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  try {
    const share = await fetchQuery(api.publicShares.getPublicShare, { token });
    if (share.status === "valid") {
      return { title: `${share.name} · ${share.projectName}` };
    }
  } catch {
    /* aperçu best-effort : la page gère elle-même l'erreur */
  }
  // i18n-exempt: nom de marque, identique dans toutes les langues
  return { title: "Jarvia" };
}

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicSharePage token={token} />;
}
