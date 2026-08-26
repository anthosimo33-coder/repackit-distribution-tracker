import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { ProjectProvider } from "@/components/project/ProjectProvider";
import { ViewAsProvider } from "@/components/portal/ViewAsProvider";
import { ViewAsShell } from "@/components/portal/ViewAsShell";
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "@/i18n/locales";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Admin « voir l'espace d'un créateur » (LECTURE SEULE) — layout du mode vue.
 *
 * Route SŒUR de /admin/[projectSlug] (segment statique « voir ») → elle
 * N'HÉRITE PAS du layout admin (sidebar interne) : on rend le shell créateur.
 *   - ProjectProvider résout le projet par slug et GATE l'accès admin/superadmin
 *     côté client (un créateur y est renvoyé vers /app ; un non-membre voit
 *     « accès refusé ») — la vraie barrière reste serveur (adminViewAsQuery) ;
 *   - ViewAsProvider résout le créateur ciblé (scopé projet) et alimente les
 *     contextes (projet synthétique + mode view-as) ;
 *   - ViewAsShell ajoute le bandeau persistant + la nav read-only.
 * Monté sous AppShell (<Authenticated>) via le layout racine.
 *
 * LANGUE DE LA PERSONNE OBSERVÉE. Le provider racine monte les messages de
 * l'APPELANT, donc de l'admin. La preview rendait par conséquent dans la langue
 * de l'admin : l'espace d'une créatrice anglophone s'affichait en français, avec
 * ses dates et ses montants au format français. Une preview qui existe pour
 * montrer ce que la personne voit doit rendre comme elle le voit.
 *
 * On résout donc SA langue ici, côté serveur, avant le premier rendu — et on
 * passe le catalogue correspondant au shell, qui le monte autour de la nav et
 * du contenu. Le bandeau, lui, reste en dehors : il s'adresse à l'admin.
 *
 * La lecture est encapsulée : toute panne retombe sur le défaut du produit. Une
 * preview dans la mauvaise langue est un défaut d'affichage ; une preview qui ne
 * s'ouvre pas est un écran perdu.
 */
async function creatorLocale(
  projectSlug: string,
  creatorId: Id<"creators">,
): Promise<Locale> {
  try {
    const token = await convexAuthNextjsToken();
    if (!token) return DEFAULT_LOCALE;
    const res = await fetchQuery(
      api.i18n.getCreatorLocale,
      { projectSlug, creatorId },
      { token },
    );
    return normalizeLocale(res?.locale) ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export default async function ViewAsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectSlug: string; id: string }>;
}) {
  const { projectSlug, id } = await params;
  const creatorId = id as Id<"creators">;
  const locale = await creatorLocale(projectSlug, creatorId);
  const messages = (await import(`../../../../../messages/${locale}.json`))
    .default;

  return (
    <ProjectProvider slug={projectSlug}>
      <ViewAsProvider creatorId={creatorId}>
        <ViewAsShell locale={locale} messages={messages}>
          {children}
        </ViewAsShell>
      </ViewAsProvider>
    </ProjectProvider>
  );
}
