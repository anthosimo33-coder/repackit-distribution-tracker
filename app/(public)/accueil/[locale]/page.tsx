import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { PublicHome } from "@/components/public-home/PublicHome";
import type { ShowcaseStats } from "@/components/public-home/ShowcaseFigures";
import { LOCALES, isLocale, type Locale } from "@/i18n/locales";

/**
 * ACCUEIL PUBLIC — la vitrine du studio, PRÉRENDUE.
 *
 * L'URL que voit le visiteur reste `/` : c'est le proxy qui réécrit vers
 * `/accueil/<langue>` après avoir résolu la langue (cf. proxy.ts). Cette page
 * n'est donc jamais atteinte par un lien — d'où le `canonical` vers `/`, sans
 * quoi un moteur indexerait quatre URLs pour une seule page.
 *
 * POURQUOI PRÉRENDUE. Chaque visite anonyme invoquait une fonction serveur et
 * rendait la page entière — robots d'indexation compris. Vérifié en production
 * le 21/09/2026 : `x-vercel-cache: MISS` sur chaque requête, `cache-control:
 * private, no-cache, no-store`. Statique, la page est servie par le CDN et
 * n'invoque plus rien.
 *
 * CE QUI LA GARDE STATIQUE, et qu'on casse sans s'en apercevoir :
 *   - aucun `cookies()` / `headers()` ici NI dans le layout au-dessus ;
 *   - `setRequestLocale` AVANT tout `getTranslations()` de l'arbre, sinon
 *     `i18n/request.ts` repart lire la requête ;
 *   - `dynamicParams = false` : une langue inconnue est un 404, pas un rendu
 *     à la volée.
 * Le contrôle est dans la sortie de `next build` : `/accueil/[locale]` doit
 * porter « ● SSG », jamais « ƒ ».
 *
 * LES CHIFFRES, eux, sont vivants : figés ici au prérendu (pour le HTML et les
 * robots), rafraîchis après hydratation par `ShowcaseFigures`.
 */

/** Une heure : les chiffres du HTML servi sans JavaScript. */
export const revalidate = 3600;

/** Les quatre langues livrées, et rien d'autre. */
export const dynamicParams = false;

export function generateStaticParams(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }));
}

// i18n-exempt: générique TypeScript (le chemin de route), pas du texte d'interface
type HomeRouteProps = PageProps<"/accueil/[locale]">;

export async function generateMetadata({
  params,
}: HomeRouteProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "home.meta" });
  return {
    title: t("title"),
    description: t("description"),
    robots: "index, follow",
    // Les quatre langues sont la MÊME page, servie sur `/`.
    alternates: { canonical: "/" },
  };
}

export default async function PublicHomePage({
  params,
}: HomeRouteProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return <PublicHome stats={await showcaseStats()} />;
}

/**
 * Chiffres de la vitrine, lus au prérendu. Toute panne masque le bloc au lieu
 * de casser la page.
 *
 * ⚠️ PAS `fetchQuery` de `convex/nextjs` : il impose `cache: "no-store"` à sa
 * requête (node_modules/convex/dist/esm/nextjs/index.js), ce qui bascule la
 * route en rendu dynamique — exactement ce qu'on vient de supprimer. Mesuré :
 * avec lui, `next build` sort « ƒ /accueil/[locale] ». Le client HTTP nu fait
 * le même appel sans cette contrainte.
 */
async function showcaseStats(): Promise<ShowcaseStats | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  try {
    return await new ConvexHttpClient(url).query(api.showcase.getShowcaseStats, {});
  } catch {
    return null;
  }
}
