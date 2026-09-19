import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { fetchQuery } from "convex/nextjs";
import { isAuthenticatedNextjs } from "@convex-dev/auth/nextjs/server";
import { api } from "@/convex/_generated/api";
import { RoleRedirect } from "@/components/layout/RoleRedirect";
import { PublicHome, type ShowcaseStats } from "@/components/public-home/PublicHome";

/**
 * `/` — deux pages selon la session, tranché CÔTÉ SERVEUR (cookie Convex Auth) :
 *   - connecté → routage par rôle (RoleRedirect, inchangé) ;
 *   - visiteur → page d'accueil publique du studio.
 * Le proxy laisse passer `/` sans session, l'AppShell le rend nu : la garde
 * de la branche connectée est dans RoleRedirect.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (await isAuthenticatedNextjs()) return {};
  const t = await getTranslations("home.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: "index, follow",
  };
}

export default async function HomePage() {
  if (await isAuthenticatedNextjs()) return <RoleRedirect />;
  return <PublicHome stats={await showcaseStats()} />;
}

/** Chiffres de la vitrine ; toute panne masque le bloc au lieu de casser la page. */
async function showcaseStats(): Promise<ShowcaseStats | null> {
  try {
    return await fetchQuery(api.showcase.getShowcaseStats, {});
  } catch {
    return null;
  }
}
